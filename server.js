const express = require("express");
const app = express();
const si = require("systeminformation");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cors = require("cors");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configuração de segurança básica
const SESSION_PASSWORD = "admin123"; // Altere para sua senha
let activeSessions = new Map();

// Middleware de autenticação
function requireAuth(req, res, next) {
    const sessionId = req.headers["x-session-id"];
    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(401).json({ erro: "Não autorizado" });
    }
    next();
}

// ============ AUTENTICAÇÃO ============
app.post("/login", (req, res) => {
    const { senha } = req.body;
    if (senha === SESSION_PASSWORD) {
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        activeSessions.set(sessionId, { created: Date.now() });
        res.json({ ok: true, sessionId });
    } else {
        res.status(401).json({ ok: false, erro: "Senha incorreta" });
    }
});

app.post("/logout", (req, res) => {
    const sessionId = req.headers["x-session-id"];
    if (sessionId) activeSessions.delete(sessionId);
    res.json({ ok: true });
});

// ============ INFORMAÇÕES DO SISTEMA ============
app.get("/status", requireAuth, async (req, res) => {
    try {
        const [cpu, mem, disk, networkStats, time] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.networkStats(),
            si.time()
        ]);

        const mainDisk = disk[0] || {};
        const network = networkStats[0] || {};

        res.json({
            cpu: cpu.currentLoad.toFixed(1),
            cpuCores: cpu.cpus.map(c => c.load.toFixed(1)),
            ram: ((mem.active / mem.total) * 100).toFixed(1),
            ramUsed: (mem.active / 1024 / 1024 / 1024).toFixed(2),
            ramTotal: (mem.total / 1024 / 1024 / 1024).toFixed(2),
            ramFree: (mem.free / 1024 / 1024 / 1024).toFixed(2),
            diskUsed: (mainDisk.used / 1024 / 1024 / 1024).toFixed(1),
            diskTotal: (mainDisk.size / 1024 / 1024 / 1024).toFixed(1),
            diskPercent: mainDisk.use ? mainDisk.use.toFixed(1) : 0,
            netRx: (network.rx_sec / 1024).toFixed(1),
            netTx: (network.tx_sec / 1024).toFixed(1),
            uptime: time.uptime
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get("/system-info", requireAuth, async (req, res) => {
    try {
        const [system, bios, cpu, graphics, osInfo, mem, disk, network, battery] = await Promise.all([
            si.system(),
            si.bios(),
            si.cpu(),
            si.graphics(),
            si.osInfo(),
            si.mem(),
            si.diskLayout(),
            si.networkInterfaces(),
            si.battery()
        ]);

        res.json({
            system: {
                manufacturer: system.manufacturer,
                model: system.model,
                serial: system.serial
            },
            bios: {
                vendor: bios.vendor,
                version: bios.version
            },
            cpu: {
                manufacturer: cpu.manufacturer,
                brand: cpu.brand,
                speed: cpu.speed,
                cores: cpu.cores,
                physicalCores: cpu.physicalCores
            },
            graphics: graphics.controllers.map(g => ({
                vendor: g.vendor,
                model: g.model,
                vram: g.vram
            })),
            os: {
                platform: osInfo.platform,
                distro: osInfo.distro,
                release: osInfo.release,
                arch: osInfo.arch,
                hostname: osInfo.hostname
            },
            memory: {
                total: (mem.total / 1024 / 1024 / 1024).toFixed(2) + " GB"
            },
            disks: disk.map(d => ({
                name: d.name,
                size: (d.size / 1024 / 1024 / 1024).toFixed(1) + " GB",
                type: d.type
            })),
            network: network.filter(n => n.ip4).map(n => ({
                iface: n.iface,
                ip4: n.ip4,
                mac: n.mac,
                type: n.type
            })),
            battery: battery.hasBattery ? {
                percent: battery.percent,
                isCharging: battery.isCharging,
                timeRemaining: battery.timeRemaining
            } : null
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ============ PROCESSOS ============
app.get("/processos", requireAuth, async (req, res) => {
    try {
        const processes = await si.processes();
        const sorted = processes.list
            .sort((a, b) => b.cpu - a.cpu)
            .slice(0, 50)
            .map(p => ({
                pid: p.pid,
                name: p.name,
                cpu: p.cpu.toFixed(1),
                mem: p.mem.toFixed(1),
                state: p.state
            }));
        res.json({ processos: sorted, total: processes.all });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post("/matar-processo", requireAuth, (req, res) => {
    const { pid } = req.body;
    if (!pid || isNaN(pid)) {
        return res.json({ erro: "PID inválido" });
    }
    
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`;
    
    exec(cmd, (err, stdout, stderr) => {
        if (err) return res.json({ erro: stderr || err.message });
        res.json({ ok: true, msg: `Processo ${pid} encerrado` });
    });
});

// ============ GERENCIADOR DE ARQUIVOS ============
app.get("/arquivos", requireAuth, (req, res) => {
    let pasta = req.query.pasta || os.homedir();
    
    // Sanitização básica
    pasta = path.normalize(pasta);
    
    try {
        if (!fs.existsSync(pasta)) {
            return res.json({ erro: "Pasta não encontrada" });
        }

        const stats = fs.statSync(pasta);
        if (!stats.isDirectory()) {
            return res.json({ erro: "Não é uma pasta" });
        }

        const items = fs.readdirSync(pasta, { withFileTypes: true });
        const arquivos = items.map(item => {
            let info = {
                nome: item.name,
                tipo: item.isDirectory() ? "pasta" : "arquivo",
                caminho: path.join(pasta, item.name)
            };
            
            try {
                const itemStats = fs.statSync(info.caminho);
                info.tamanho = itemStats.size;
                info.modificado = itemStats.mtime;
            } catch (e) {
                info.tamanho = 0;
                info.modificado = null;
            }
            
            return info;
        }).sort((a, b) => {
            if (a.tipo === b.tipo) return a.nome.localeCompare(b.nome);
            return a.tipo === "pasta" ? -1 : 1;
        });

        res.json({
            pastaAtual: pasta,
            pastaPai: path.dirname(pasta),
            arquivos
        });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/criar-pasta", requireAuth, (req, res) => {
    const { caminho, nome } = req.body;
    if (!caminho || !nome) {
        return res.json({ erro: "Caminho e nome são obrigatórios" });
    }
    
    // Sanitização
    const nomeSanitizado = nome.replace(/[<>:"/\\|?*]/g, "");
    const novaPasta = path.join(caminho, nomeSanitizado);
    
    try {
        fs.mkdirSync(novaPasta);
        res.json({ ok: true, msg: "Pasta criada com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/criar-arquivo", requireAuth, (req, res) => {
    const { caminho, nome, conteudo } = req.body;
    if (!caminho || !nome) {
        return res.json({ erro: "Caminho e nome são obrigatórios" });
    }
    
    const nomeSanitizado = nome.replace(/[<>:"/\\|?*]/g, "");
    const novoArquivo = path.join(caminho, nomeSanitizado);
    
    try {
        fs.writeFileSync(novoArquivo, conteudo || "");
        res.json({ ok: true, msg: "Arquivo criado com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/renomear", requireAuth, (req, res) => {
    const { caminhoAntigo, nomeNovo } = req.body;
    if (!caminhoAntigo || !nomeNovo) {
        return res.json({ erro: "Caminho e novo nome são obrigatórios" });
    }
    
    const nomeSanitizado = nomeNovo.replace(/[<>:"/\\|?*]/g, "");
    const novoCaminho = path.join(path.dirname(caminhoAntigo), nomeSanitizado);
    
    try {
        fs.renameSync(caminhoAntigo, novoCaminho);
        res.json({ ok: true, msg: "Renomeado com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/deletar", requireAuth, (req, res) => {
    const { caminho } = req.body;
    if (!caminho) {
        return res.json({ erro: "Caminho é obrigatório" });
    }
    
    try {
        const stats = fs.statSync(caminho);
        if (stats.isDirectory()) {
            fs.rmSync(caminho, { recursive: true });
        } else {
            fs.unlinkSync(caminho);
        }
        res.json({ ok: true, msg: "Deletado com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/copiar", requireAuth, (req, res) => {
    const { origem, destino } = req.body;
    if (!origem || !destino) {
        return res.json({ erro: "Origem e destino são obrigatórios" });
    }
    
    try {
        const nomeArquivo = path.basename(origem);
        const caminhoDestino = path.join(destino, nomeArquivo);
        
        const stats = fs.statSync(origem);
        if (stats.isDirectory()) {
            fs.cpSync(origem, caminhoDestino, { recursive: true });
        } else {
            fs.copyFileSync(origem, caminhoDestino);
        }
        res.json({ ok: true, msg: "Copiado com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/mover", requireAuth, (req, res) => {
    const { origem, destino } = req.body;
    if (!origem || !destino) {
        return res.json({ erro: "Origem e destino são obrigatórios" });
    }
    
    try {
        const nomeArquivo = path.basename(origem);
        const caminhoDestino = path.join(destino, nomeArquivo);
        fs.renameSync(origem, caminhoDestino);
        res.json({ ok: true, msg: "Movido com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.get("/ler-arquivo", requireAuth, (req, res) => {
    const { caminho } = req.query;
    if (!caminho) {
        return res.json({ erro: "Caminho é obrigatório" });
    }
    
    try {
        const stats = fs.statSync(caminho);
        if (stats.size > 5 * 1024 * 1024) {
            return res.json({ erro: "Arquivo muito grande (máx 5MB)" });
        }
        
        const conteudo = fs.readFileSync(caminho, "utf-8");
        res.json({ ok: true, conteudo, nome: path.basename(caminho) });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.post("/salvar-arquivo", requireAuth, (req, res) => {
    const { caminho, conteudo } = req.body;
    if (!caminho) {
        return res.json({ erro: "Caminho é obrigatório" });
    }
    
    try {
        fs.writeFileSync(caminho, conteudo || "");
        res.json({ ok: true, msg: "Arquivo salvo com sucesso" });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

app.get("/download", requireAuth, (req, res) => {
    const { caminho } = req.query;
    if (!caminho) {
        return res.status(400).json({ erro: "Caminho é obrigatório" });
    }
    
    try {
        if (!fs.existsSync(caminho)) {
            return res.status(404).json({ erro: "Arquivo não encontrado" });
        }
        res.download(caminho);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ============ TERMINAL ============
app.post("/cmd", requireAuth, (req, res) => {
    const { comando } = req.body;
    if (!comando) {
        return res.json({ erro: "Comando é obrigatório" });
    }
    
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArg = isWindows ? "/c" : "-c";
    
    exec(comando, { shell, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        res.json({
            ok: !err,
            saida: stdout || "",
            erro: stderr || (err ? err.message : "")
        });
    });
});

// ============ PROGRAMAS ============
app.post("/abrir-programa", requireAuth, (req, res) => {
    const { programa } = req.body;
    if (!programa) {
        return res.json({ erro: "Programa é obrigatório" });
    }
    
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `start "" "${programa}"` : `xdg-open "${programa}" || open "${programa}"`;
    
    exec(cmd, { shell: true }, (err) => {
        if (err) return res.json({ erro: err.message });
        res.json({ ok: true, msg: `${programa} iniciado` });
    });
});

// ============ CONTROLE DE ENERGIA ============
app.post("/energia", requireAuth, (req, res) => {
    const { acao } = req.body;
    const isWindows = process.platform === "win32";
    
    let cmd;
    switch (acao) {
        case "desligar":
            cmd = isWindows ? "shutdown /s /t 0" : "shutdown now";
            break;
        case "reiniciar":
            cmd = isWindows ? "shutdown /r /t 0" : "reboot";
            break;
        case "suspender":
            cmd = isWindows ? "rundll32.exe powrprof.dll,SetSuspendState 0,1,0" : "systemctl suspend";
            break;
        case "hibernar":
            cmd = isWindows ? "shutdown /h" : "systemctl hibernate";
            break;
        case "bloquear":
            cmd = isWindows ? "rundll32.exe user32.dll,LockWorkStation" : "loginctl lock-session";
            break;
        default:
            return res.json({ erro: "Ação inválida" });
    }
    
    exec(cmd, (err) => {
        if (err) return res.json({ erro: err.message });
        res.json({ ok: true, msg: `Ação ${acao} executada` });
    });
});

// ============ REDE ============
app.get("/rede", requireAuth, async (req, res) => {
    try {
        const [interfaces, connections, stats] = await Promise.all([
            si.networkInterfaces(),
            si.networkConnections(),
            si.networkStats()
        ]);
        
        res.json({
            interfaces: interfaces.filter(i => i.ip4).map(i => ({
                nome: i.iface,
                ip: i.ip4,
                mac: i.mac,
                tipo: i.type,
                velocidade: i.speed
            })),
            conexoes: connections.slice(0, 30).map(c => ({
                protocolo: c.protocol,
                localAddress: c.localAddress,
                localPort: c.localPort,
                peerAddress: c.peerAddress,
                peerPort: c.peerPort,
                state: c.state
            })),
            estatisticas: stats.map(s => ({
                interface: s.iface,
                rxBytes: (s.rx_bytes / 1024 / 1024).toFixed(2),
                txBytes: (s.tx_bytes / 1024 / 1024).toFixed(2),
                rxSec: (s.rx_sec / 1024).toFixed(1),
                txSec: (s.tx_sec / 1024).toFixed(1)
            }))
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ============ APPS INSTALADOS ============
app.get("/apps", requireAuth, async (req, res) => {
    try {
        // Para Windows, lista programas instalados
        const isWindows = process.platform === "win32";
        
        if (isWindows) {
            exec('wmic product get name,version /format:csv', { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err) {
                    // Fallback para PowerShell
                    exec('powershell "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName, DisplayVersion | ConvertTo-Json"', 
                        { maxBuffer: 10 * 1024 * 1024 }, 
                        (err2, stdout2) => {
                            if (err2) return res.json({ apps: [] });
                            try {
                                const apps = JSON.parse(stdout2);
                                res.json({ apps: apps.filter(a => a.DisplayName).slice(0, 100) });
                            } catch (e) {
                                res.json({ apps: [] });
                            }
                        }
                    );
                    return;
                }
                
                const lines = stdout.split('\n').filter(l => l.trim());
                const apps = lines.slice(1).map(l => {
                    const parts = l.split(',');
                    return { nome: parts[1], versao: parts[2] };
                }).filter(a => a.nome);
                
                res.json({ apps: apps.slice(0, 100) });
            });
        } else {
            // Linux - lista pacotes instalados (dpkg ou rpm)
            exec('which dpkg && dpkg -l | head -100 || rpm -qa | head -100', (err, stdout) => {
                if (err) return res.json({ apps: [] });
                res.json({ apps: stdout.split('\n').filter(l => l.trim()).slice(0, 100) });
            });
        }
    } catch (err) {
        res.json({ apps: [] });
    }
});

// ============ SERVIÇOS ============
app.get("/servicos", requireAuth, async (req, res) => {
    try {
        const services = await si.services('*');
        res.json({
            servicos: services.slice(0, 50).map(s => ({
                nome: s.name,
                running: s.running,
                cpu: s.cpu,
                mem: s.mem
            }))
        });
    } catch (err) {
        res.json({ servicos: [] });
    }
});

// ============ ÁREA DE TRABALHO ============
app.get("/desktop-path", requireAuth, (req, res) => {
    const isWindows = process.platform === "win32";
    const desktop = isWindows 
        ? path.join(os.homedir(), "Desktop")
        : path.join(os.homedir(), "Área de Trabalho") || path.join(os.homedir(), "Desktop");
    
    res.json({ 
        desktop, 
        home: os.homedir(),
        downloads: path.join(os.homedir(), "Downloads"),
        documents: path.join(os.homedir(), isWindows ? "Documents" : "Documentos")
    });
});

// ============ CLIPBOARD ============
app.post("/clipboard", requireAuth, (req, res) => {
    const { texto } = req.body;
    const isWindows = process.platform === "win32";
    
    let cmd;
    if (isWindows) {
        cmd = `echo ${texto} | clip`;
    } else {
        cmd = `echo "${texto}" | xclip -selection clipboard`;
    }
    
    exec(cmd, (err) => {
        if (err) return res.json({ erro: err.message });
        res.json({ ok: true, msg: "Copiado para área de transferência" });
    });
});

// ============ VOLUME (Windows) ============
app.post("/volume", requireAuth, (req, res) => {
    const { nivel } = req.body;
    const isWindows = process.platform === "win32";
    
    if (!isWindows) {
        return res.json({ erro: "Disponível apenas no Windows" });
    }
    
    const script = `
        $wshell = New-Object -ComObject WScript.Shell
        for($i=0; $i -lt 50; $i++) { $wshell.SendKeys([char]174) }
        for($i=0; $i -lt ${Math.floor(nivel / 2)}; $i++) { $wshell.SendKeys([char]175) }
    `;
    
    exec(`powershell -Command "${script}"`, (err) => {
        if (err) return res.json({ erro: err.message });
        res.json({ ok: true, msg: `Volume ajustado para ${nivel}%` });
    });
});

// ============ SCREENSHOT ============
app.get("/screenshot", requireAuth, (req, res) => {
    const isWindows = process.platform === "win32";
    const screenshotPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
    
    let cmd;
    if (isWindows) {
        // Usa PowerShell para capturar tela no Windows
        cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${screenshotPath.replace(/\\/g, '\\\\')}'); }"`;
    } else {
        cmd = `import -window root ${screenshotPath}`;
    }
    
    exec(cmd, (err) => {
        if (err) {
            return res.json({ erro: "Não foi possível capturar a tela" });
        }
        
        setTimeout(() => {
            if (fs.existsSync(screenshotPath)) {
                const imageBuffer = fs.readFileSync(screenshotPath);
                const base64Image = imageBuffer.toString('base64');
                fs.unlinkSync(screenshotPath);
                res.json({ ok: true, imagem: `data:image/png;base64,${base64Image}` });
            } else {
                res.json({ erro: "Screenshot não encontrado" });
            }
        }, 500);
    });
});

// ============ DRIVES ============
app.get("/drives", requireAuth, async (req, res) => {
    try {
        const disks = await si.fsSize();
        res.json({
            drives: disks.map(d => ({
                nome: d.fs,
                mount: d.mount,
                tipo: d.type,
                tamanho: (d.size / 1024 / 1024 / 1024).toFixed(1),
                usado: (d.used / 1024 / 1024 / 1024).toFixed(1),
                disponivel: (d.available / 1024 / 1024 / 1024).toFixed(1),
                porcentagem: d.use.toFixed(1)
            }))
        });
    } catch (err) {
        res.json({ drives: [] });
    }
});

// ============ HISTÓRICO DE COMANDOS ============
let comandoHistorico = [];

app.get("/historico-cmd", requireAuth, (req, res) => {
    res.json({ historico: comandoHistorico.slice(-50) });
});

app.post("/cmd", requireAuth, (req, res) => {
    const { comando } = req.body;
    if (!comando) {
        return res.json({ erro: "Comando é obrigatório" });
    }
    
    comandoHistorico.push({ comando, data: new Date().toISOString() });
    
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    
    exec(comando, { shell, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        res.json({
            ok: !err,
            saida: stdout || "",
            erro: stderr || (err ? err.message : "")
        });
    });
});

// ============ BUSCAR ARQUIVOS ============
app.get("/buscar", requireAuth, (req, res) => {
    const { pasta, termo } = req.query;
    if (!pasta || !termo) {
        return res.json({ erro: "Pasta e termo são obrigatórios" });
    }
    
    const isWindows = process.platform === "win32";
    const cmd = isWindows 
        ? `dir "${pasta}" /s /b | findstr /i "${termo}"`
        : `find "${pasta}" -iname "*${termo}*" 2>/dev/null | head -100`;
    
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) {
            return res.json({ resultados: [] });
        }
        
        const resultados = stdout.split('\n')
            .filter(l => l.trim())
            .slice(0, 100)
            .map(caminho => ({
                caminho: caminho.trim(),
                nome: path.basename(caminho.trim())
            }));
        
        res.json({ resultados });
    });
});

// ============ NOTAS RÁPIDAS ============
const notesFile = path.join(__dirname, 'notas.json');

app.get("/notas", requireAuth, (req, res) => {
    try {
        if (fs.existsSync(notesFile)) {
            const notas = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
            res.json({ notas });
        } else {
            res.json({ notas: [] });
        }
    } catch (err) {
        res.json({ notas: [] });
    }
});

app.post("/notas", requireAuth, (req, res) => {
    const { notas } = req.body;
    try {
        fs.writeFileSync(notesFile, JSON.stringify(notas, null, 2));
        res.json({ ok: true });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

// ============ FAVORITOS ============
const favoritesFile = path.join(__dirname, 'favoritos.json');

app.get("/favoritos", requireAuth, (req, res) => {
    try {
        if (fs.existsSync(favoritesFile)) {
            const favoritos = JSON.parse(fs.readFileSync(favoritesFile, 'utf-8'));
            res.json({ favoritos });
        } else {
            res.json({ favoritos: [] });
        }
    } catch (err) {
        res.json({ favoritos: [] });
    }
});

app.post("/favoritos", requireAuth, (req, res) => {
    const { favoritos } = req.body;
    try {
        fs.writeFileSync(favoritesFile, JSON.stringify(favoritos, null, 2));
        res.json({ ok: true });
    } catch (err) {
        res.json({ erro: err.message });
    }
});

// ============ START SERVER ============
const PORT = 3000;
app.listen(PORT, "localhost", () => {
    console.log(`\n🖥️  Dashboard do PC disponível em http://localhost:${PORT}`);
    console.log(`🔐 Senha padrão: ${SESSION_PASSWORD}`);
    console.log(`⚠️  Use apenas localmente!\n`);
});
