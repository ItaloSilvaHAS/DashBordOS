// Estado global
let sessionId = localStorage.getItem('sessionId');
let pastaAtual = '';
let pathsRapidos = {};
let arquivoSelecionado = null;
let notas = [];
let historicoComandos = [];

// ============ AUTENTICAÇÃO ============
async function fazerLogin() {
    const senha = document.getElementById('senhaLogin').value;
    const erroEl = document.getElementById('erroLogin');
    
    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            sessionId = data.sessionId;
            localStorage.setItem('sessionId', sessionId);
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
            inicializarDashboard();
        } else {
            erroEl.textContent = data.erro || 'Senha incorreta';
        }
    } catch (err) {
        erroEl.textContent = 'Erro de conexão';
    }
}

async function fazerLogout() {
    await fetchAuth('/logout', { method: 'POST' });
    sessionId = null;
    localStorage.removeItem('sessionId');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('senhaLogin').value = '';
}

// Helper para requests autenticadas
async function fetchAuth(url, options = {}) {
    options.headers = {
        ...options.headers,
        'X-Session-Id': sessionId
    };
    
    const res = await fetch(url, options);
    
    if (res.status === 401) {
        fazerLogout();
        throw new Error('Sessão expirada');
    }
    
    return res;
}

// ============ INICIALIZAÇÃO ============
async function inicializarDashboard() {
    await carregarPathsRapidos();
    await carregarNotas();
    await carregarDrives();
    await carregarInfoSistema();
    atualizarStatus();
    setInterval(atualizarStatus, 2000);
    
    // Navegação
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            navegarPara(section);
        });
    });
}

function navegarPara(section) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    document.querySelector(`[data-section="${section}"]`).classList.add('active');
    document.getElementById(section).classList.add('active');
    
    // Carregar dados específicos da seção
    switch(section) {
        case 'arquivos':
            if (!pastaAtual) irParaHome();
            break;
        case 'processos':
            atualizarProcessos();
            break;
        case 'sistema':
            carregarInfoSistema();
            break;
        case 'rede':
            carregarRede();
            break;
    }
}

// Verificar sessão ao carregar
window.addEventListener('load', async () => {
    if (sessionId) {
        try {
            const res = await fetchAuth('/status');
            if (res.ok) {
                document.getElementById('loginScreen').classList.add('hidden');
                document.getElementById('dashboard').classList.remove('hidden');
                inicializarDashboard();
            }
        } catch (err) {
            // Sessão inválida
            sessionId = null;
            localStorage.removeItem('sessionId');
        }
    }
});

// ============ STATUS DO SISTEMA ============
async function atualizarStatus() {
    try {
        const res = await fetchAuth('/status');
        const s = await res.json();
        
        // CPU
        document.getElementById('cpuValue').textContent = s.cpu;
        document.getElementById('cpuProgress').style.width = `${s.cpu}%`;
        document.getElementById('cpuProgress').style.background = getCpuColor(parseFloat(s.cpu));
        
        // RAM
        document.getElementById('ramValue').textContent = s.ram;
        document.getElementById('ramUsed').textContent = s.ramUsed;
        document.getElementById('ramTotal').textContent = s.ramTotal;
        document.getElementById('ramProgress').style.width = `${s.ram}%`;
        
        // Disco
        document.getElementById('diskValue').textContent = s.diskPercent;
        document.getElementById('diskUsed').textContent = s.diskUsed;
        document.getElementById('diskTotal').textContent = s.diskTotal;
        document.getElementById('diskProgress').style.width = `${s.diskPercent}%`;
        
        // Rede
        document.getElementById('netRx').textContent = s.netRx;
        document.getElementById('netTx').textContent = s.netTx;
        
        // Uptime
        const uptime = formatUptime(s.uptime);
        document.getElementById('uptimeDisplay').textContent = uptime;
        
        // CPU Cores
        if (s.cpuCores) {
            const container = document.getElementById('cpuCoresContainer');
            container.innerHTML = s.cpuCores.map((load, i) => `
                <div class="cpu-core">
                    <div class="cpu-core-label">Core ${i + 1}</div>
                    <div class="cpu-core-value">${load}%</div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Erro ao atualizar status:', err);
    }
}

function getCpuColor(value) {
    if (value < 50) return 'var(--accent-blue)';
    if (value < 80) return 'var(--accent-orange)';
    return 'var(--accent-red)';
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    
    let result = '';
    if (days > 0) result += `${days}d `;
    if (hours > 0) result += `${hours}h `;
    result += `${mins}m`;
    return result;
}

// ============ DRIVES ============
async function carregarDrives() {
    try {
        const res = await fetchAuth('/drives');
        const data = await res.json();
        
        const container = document.getElementById('drivesContainer');
        container.innerHTML = data.drives.map(d => `
            <div class="drive-item" onclick="irParaCaminho('${d.mount.replace(/\\/g, '\\\\')}')">
                <div class="drive-header">
                    <span><i class="fas fa-hdd"></i> ${d.mount}</span>
                    <span>${d.porcentagem}%</span>
                </div>
                <div class="drive-progress">
                    <div class="drive-progress-fill" style="width: ${d.porcentagem}%"></div>
                </div>
                <div class="drive-details">
                    <span>${d.usado} GB usados</span>
                    <span>${d.disponivel} GB livres</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Erro ao carregar drives:', err);
    }
}

// ============ PATHS RÁPIDOS ============
async function carregarPathsRapidos() {
    try {
        const res = await fetchAuth('/desktop-path');
        pathsRapidos = await res.json();
    } catch (err) {
        console.error('Erro ao carregar paths:', err);
    }
}

function irPara(tipo) {
    const path = pathsRapidos[tipo] || pathsRapidos.home;
    if (path) {
        carregarArquivos(path);
    }
}

function irParaHome() {
    irPara('home');
}

// ============ GERENCIADOR DE ARQUIVOS ============
async function carregarArquivos(pasta) {
    try {
        const res = await fetchAuth(`/arquivos?pasta=${encodeURIComponent(pasta)}`);
        const data = await res.json();
        
        if (data.erro) {
            showToast(data.erro, 'error');
            return;
        }
        
        pastaAtual = data.pastaAtual;
        document.getElementById('caminhoAtual').value = pastaAtual;
        
        const container = document.getElementById('fileList');
        
        if (data.arquivos.length === 0) {
            container.innerHTML = '<div class="file-item"><p style="color: var(--text-muted)">Pasta vazia</p></div>';
            return;
        }
        
        container.innerHTML = data.arquivos.map(arquivo => `
            <div class="file-item" ondblclick="${arquivo.tipo === 'pasta' ? `carregarArquivos('${arquivo.caminho.replace(/\\/g, '\\\\')}')` : `abrirArquivo('${arquivo.caminho.replace(/\\/g, '\\\\')}')`}">
                <div class="file-icon ${arquivo.tipo}">
                    <i class="fas ${arquivo.tipo === 'pasta' ? 'fa-folder' : getFileIcon(arquivo.nome)}"></i>
                </div>
                <div class="file-info">
                    <div class="file-name">${arquivo.nome}</div>
                    <div class="file-meta">
                        ${arquivo.tipo === 'arquivo' ? formatSize(arquivo.tamanho) : 'Pasta'}
                        ${arquivo.modificado ? ' • ' + formatDate(arquivo.modificado) : ''}
                    </div>
                </div>
                <div class="file-actions-menu">
                    ${arquivo.tipo === 'arquivo' ? `
                        <button class="file-action-btn" onclick="event.stopPropagation(); editarArquivo('${arquivo.caminho.replace(/\\/g, '\\\\')}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="file-action-btn" onclick="event.stopPropagation(); downloadArquivo('${arquivo.caminho.replace(/\\/g, '\\\\')}')">
                            <i class="fas fa-download"></i>
                        </button>
                    ` : ''}
                    <button class="file-action-btn" onclick="event.stopPropagation(); mostrarModalRenomear('${arquivo.caminho.replace(/\\/g, '\\\\')}', '${arquivo.nome}')">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="file-action-btn delete" onclick="event.stopPropagation(); confirmarDeletar('${arquivo.caminho.replace(/\\/g, '\\\\')}', '${arquivo.nome}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast('Erro ao carregar arquivos', 'error');
    }
}

function getFileIcon(nome) {
    const ext = nome.split('.').pop().toLowerCase();
    const icons = {
        'txt': 'fa-file-alt', 'doc': 'fa-file-word', 'docx': 'fa-file-word',
        'pdf': 'fa-file-pdf', 'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel',
        'ppt': 'fa-file-powerpoint', 'pptx': 'fa-file-powerpoint',
        'jpg': 'fa-file-image', 'jpeg': 'fa-file-image', 'png': 'fa-file-image', 'gif': 'fa-file-image',
        'mp3': 'fa-file-audio', 'wav': 'fa-file-audio', 'flac': 'fa-file-audio',
        'mp4': 'fa-file-video', 'avi': 'fa-file-video', 'mkv': 'fa-file-video',
        'zip': 'fa-file-archive', 'rar': 'fa-file-archive', '7z': 'fa-file-archive',
        'js': 'fa-file-code', 'py': 'fa-file-code', 'html': 'fa-file-code', 'css': 'fa-file-code',
        'exe': 'fa-window-maximize', 'msi': 'fa-window-maximize'
    };
    return icons[ext] || 'fa-file';
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function voltarPasta() {
    if (pastaAtual) {
        const parent = pastaAtual.split(/[/\\]/).slice(0, -1).join('/') || '/';
        carregarArquivos(parent);
    }
}

function irParaCaminho() {
    const caminho = document.getElementById('caminhoAtual').value;
    if (caminho) carregarArquivos(caminho);
}

function atualizarArquivos() {
    if (pastaAtual) carregarArquivos(pastaAtual);
}

// ============ OPERAÇÕES DE ARQUIVO ============
function mostrarModalCriarPasta() {
    showModal(`
        <h2><i class="fas fa-folder-plus"></i> Nova Pasta</h2>
        <input type="text" id="novaPastaNome" placeholder="Nome da pasta">
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn primary" onclick="criarPasta()">Criar</button>
        </div>
    `);
    document.getElementById('novaPastaNome').focus();
}

async function criarPasta() {
    const nome = document.getElementById('novaPastaNome').value;
    if (!nome) return showToast('Digite um nome', 'error');
    
    try {
        const res = await fetchAuth('/criar-pasta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caminho: pastaAtual, nome })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Pasta criada!', 'success');
            fecharModal();
            atualizarArquivos();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao criar pasta', 'error');
    }
}

function mostrarModalCriarArquivo() {
    showModal(`
        <h2><i class="fas fa-file-plus"></i> Novo Arquivo</h2>
        <input type="text" id="novoArquivoNome" placeholder="Nome do arquivo (ex: texto.txt)">
        <textarea id="novoArquivoConteudo" placeholder="Conteúdo (opcional)" rows="5"></textarea>
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn primary" onclick="criarArquivo()">Criar</button>
        </div>
    `);
    document.getElementById('novoArquivoNome').focus();
}

async function criarArquivo() {
    const nome = document.getElementById('novoArquivoNome').value;
    const conteudo = document.getElementById('novoArquivoConteudo').value;
    if (!nome) return showToast('Digite um nome', 'error');
    
    try {
        const res = await fetchAuth('/criar-arquivo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caminho: pastaAtual, nome, conteudo })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Arquivo criado!', 'success');
            fecharModal();
            atualizarArquivos();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao criar arquivo', 'error');
    }
}

function mostrarModalRenomear(caminho, nomeAtual) {
    showModal(`
        <h2><i class="fas fa-pen"></i> Renomear</h2>
        <input type="text" id="novoNome" value="${nomeAtual}">
        <input type="hidden" id="caminhoRenomear" value="${caminho}">
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn primary" onclick="renomear()">Renomear</button>
        </div>
    `);
    document.getElementById('novoNome').focus();
    document.getElementById('novoNome').select();
}

async function renomear() {
    const caminhoAntigo = document.getElementById('caminhoRenomear').value;
    const nomeNovo = document.getElementById('novoNome').value;
    if (!nomeNovo) return showToast('Digite um nome', 'error');
    
    try {
        const res = await fetchAuth('/renomear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caminhoAntigo, nomeNovo })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Renomeado!', 'success');
            fecharModal();
            atualizarArquivos();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao renomear', 'error');
    }
}

function confirmarDeletar(caminho, nome) {
    showModal(`
        <h2><i class="fas fa-exclamation-triangle" style="color: var(--accent-red)"></i> Confirmar Exclusão</h2>
        <p>Tem certeza que deseja deletar "<strong>${nome}</strong>"?</p>
        <p style="color: var(--text-muted); font-size: 14px; margin-top: 10px;">Esta ação não pode ser desfeita.</p>
        <input type="hidden" id="caminhoDeletar" value="${caminho}">
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn danger" onclick="deletar()">Deletar</button>
        </div>
    `);
}

async function deletar() {
    const caminho = document.getElementById('caminhoDeletar').value;
    
    try {
        const res = await fetchAuth('/deletar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caminho })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Deletado!', 'success');
            fecharModal();
            atualizarArquivos();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao deletar', 'error');
    }
}

async function editarArquivo(caminho) {
    try {
        const res = await fetchAuth(`/ler-arquivo?caminho=${encodeURIComponent(caminho)}`);
        const data = await res.json();
        
        if (data.erro) {
            showToast(data.erro, 'error');
            return;
        }
        
        showModal(`
            <h2><i class="fas fa-edit"></i> Editar: ${data.nome}</h2>
            <textarea id="conteudoEditar" rows="15" style="font-family: monospace;">${escapeHtml(data.conteudo)}</textarea>
            <input type="hidden" id="caminhoEditar" value="${caminho}">
            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
                <button class="modal-btn primary" onclick="salvarArquivo()">Salvar</button>
            </div>
        `);
    } catch (err) {
        showToast('Erro ao ler arquivo', 'error');
    }
}

async function salvarArquivo() {
    const caminho = document.getElementById('caminhoEditar').value;
    const conteudo = document.getElementById('conteudoEditar').value;
    
    try {
        const res = await fetchAuth('/salvar-arquivo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caminho, conteudo })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Arquivo salvo!', 'success');
            fecharModal();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao salvar', 'error');
    }
}

function abrirArquivo(caminho) {
    editarArquivo(caminho);
}

function downloadArquivo(caminho) {
    window.open(`/download?caminho=${encodeURIComponent(caminho)}&session=${sessionId}`, '_blank');
}

// ============ BUSCAR ============
function mostrarModalBuscar() {
    showModal(`
        <h2><i class="fas fa-search"></i> Buscar Arquivos</h2>
        <input type="text" id="termoBusca" placeholder="Digite o termo de busca">
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn primary" onclick="buscarArquivos()">Buscar</button>
        </div>
        <div id="resultadosBusca" style="margin-top: 20px; max-height: 300px; overflow-y: auto;"></div>
    `);
    document.getElementById('termoBusca').focus();
}

async function buscarArquivos() {
    const termo = document.getElementById('termoBusca').value;
    if (!termo) return;
    
    const container = document.getElementById('resultadosBusca');
    container.innerHTML = '<p>Buscando...</p>';
    
    try {
        const res = await fetchAuth(`/buscar?pasta=${encodeURIComponent(pastaAtual)}&termo=${encodeURIComponent(termo)}`);
        const data = await res.json();
        
        if (data.resultados.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted)">Nenhum resultado encontrado</p>';
            return;
        }
        
        container.innerHTML = data.resultados.map(r => `
            <div class="file-item" onclick="carregarArquivos('${r.caminho.replace(/\\/g, '\\\\').split('/').slice(0, -1).join('/')}'); fecharModal();">
                <div class="file-icon file"><i class="fas fa-file"></i></div>
                <div class="file-info">
                    <div class="file-name">${r.nome}</div>
                    <div class="file-meta" style="word-break: break-all;">${r.caminho}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p style="color: var(--accent-red)">Erro na busca</p>';
    }
}

// ============ PROCESSOS ============
async function atualizarProcessos() {
    try {
        const res = await fetchAuth('/processos');
        const data = await res.json();
        
        document.getElementById('totalProcessos').textContent = data.total;
        
        const tbody = document.getElementById('processosList');
        tbody.innerHTML = data.processos.map(p => `
            <tr>
                <td>${p.pid}</td>
                <td>${p.name}</td>
                <td>${p.cpu}%</td>
                <td>${p.mem}%</td>
                <td>${p.state}</td>
                <td>
                    <button class="kill-btn" onclick="matarProcesso(${p.pid}, '${p.name}')">
                        <i class="fas fa-times"></i> Encerrar
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Erro ao carregar processos', 'error');
    }
}

async function matarProcesso(pid, nome) {
    if (!confirm(`Encerrar processo "${nome}" (PID: ${pid})?`)) return;
    
    try {
        const res = await fetchAuth('/matar-processo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast('Processo encerrado!', 'success');
            atualizarProcessos();
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao encerrar processo', 'error');
    }
}

// ============ TERMINAL ============
async function executarComando() {
    const input = document.getElementById('terminalInput');
    const comando = input.value.trim();
    if (!comando) return;
    
    input.value = '';
    historicoComandos.push(comando);
    
    const output = document.getElementById('terminalOutput');
    output.innerHTML += `<div class="command">$ ${escapeHtml(comando)}</div>`;
    
    try {
        const res = await fetchAuth('/cmd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comando })
        });
        const data = await res.json();
        
        if (data.saida) {
            output.innerHTML += `<div class="output">${escapeHtml(data.saida)}</div>`;
        }
        if (data.erro) {
            output.innerHTML += `<div class="error">${escapeHtml(data.erro)}</div>`;
        }
    } catch (err) {
        output.innerHTML += `<div class="error">Erro ao executar comando</div>`;
    }
    
    output.scrollTop = output.scrollHeight;
    atualizarHistorico();
}

function atualizarHistorico() {
    const container = document.getElementById('comandoHistorico');
    container.innerHTML = historicoComandos.slice(-10).reverse().map(cmd => `
        <div class="history-item" onclick="document.getElementById('terminalInput').value = '${escapeHtml(cmd)}'">${escapeHtml(cmd)}</div>
    `).join('');
}

function limparTerminal() {
    document.getElementById('terminalOutput').innerHTML = '';
}

// ============ SISTEMA INFO ============
async function carregarInfoSistema() {
    try {
        const res = await fetchAuth('/system-info');
        const info = await res.json();
        
        const container = document.getElementById('systemInfoGrid');
        container.innerHTML = `
            <div class="info-card">
                <h3><i class="fas fa-desktop"></i> Sistema</h3>
                <div class="info-row"><span class="label">Fabricante</span><span class="value">${info.system.manufacturer || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Modelo</span><span class="value">${info.system.model || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Hostname</span><span class="value">${info.os.hostname || 'N/A'}</span></div>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-microchip"></i> Processador</h3>
                <div class="info-row"><span class="label">Fabricante</span><span class="value">${info.cpu.manufacturer || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Modelo</span><span class="value">${info.cpu.brand || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Velocidade</span><span class="value">${info.cpu.speed || 'N/A'} GHz</span></div>
                <div class="info-row"><span class="label">Núcleos</span><span class="value">${info.cpu.cores || 'N/A'} (${info.cpu.physicalCores || 'N/A'} físicos)</span></div>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-memory"></i> Memória</h3>
                <div class="info-row"><span class="label">Total</span><span class="value">${info.memory.total}</span></div>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-tv"></i> Placa de Vídeo</h3>
                ${info.graphics.map(g => `
                    <div class="info-row"><span class="label">Modelo</span><span class="value">${g.model || 'N/A'}</span></div>
                    <div class="info-row"><span class="label">VRAM</span><span class="value">${g.vram || 'N/A'} MB</span></div>
                `).join('')}
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-windows"></i> Sistema Operacional</h3>
                <div class="info-row"><span class="label">Plataforma</span><span class="value">${info.os.platform || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Distro</span><span class="value">${info.os.distro || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Versão</span><span class="value">${info.os.release || 'N/A'}</span></div>
                <div class="info-row"><span class="label">Arquitetura</span><span class="value">${info.os.arch || 'N/A'}</span></div>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-hdd"></i> Discos</h3>
                ${info.disks.map(d => `
                    <div class="info-row"><span class="label">${d.name || 'Disco'}</span><span class="value">${d.size} - ${d.type || 'N/A'}</span></div>
                `).join('')}
            </div>
            
            ${info.battery ? `
                <div class="info-card">
                    <h3><i class="fas fa-battery-three-quarters"></i> Bateria</h3>
                    <div class="info-row"><span class="label">Nível</span><span class="value">${info.battery.percent}%</span></div>
                    <div class="info-row"><span class="label">Carregando</span><span class="value">${info.battery.isCharging ? 'Sim' : 'Não'}</span></div>
                </div>
            ` : ''}
        `;
    } catch (err) {
        showToast('Erro ao carregar info do sistema', 'error');
    }
}

// ============ SCREENSHOT ============
async function capturarTela() {
    const container = document.getElementById('screenshotContainer');
    container.innerHTML = '<p>Capturando...</p>';
    
    try {
        const res = await fetchAuth('/screenshot');
        const data = await res.json();
        
        if (data.ok) {
            container.innerHTML = `<img src="${data.imagem}" alt="Screenshot">`;
        } else {
            container.innerHTML = `<p style="color: var(--accent-red)">${data.erro}</p>`;
        }
    } catch (err) {
        container.innerHTML = '<p style="color: var(--accent-red)">Erro ao capturar tela</p>';
    }
}

// ============ REDE ============
async function carregarRede() {
    try {
        const res = await fetchAuth('/rede');
        const data = await res.json();
        
        // Interfaces
        const interfacesContainer = document.getElementById('interfacesContainer');
        interfacesContainer.innerHTML = data.interfaces.map(i => `
            <div class="interface-item">
                <div class="interface-name"><i class="fas fa-ethernet"></i> ${i.nome}</div>
                <div class="interface-details">
                    <p><strong>IP:</strong> ${i.ip}</p>
                    <p><strong>MAC:</strong> ${i.mac}</p>
                    <p><strong>Tipo:</strong> ${i.tipo}</p>
                </div>
            </div>
        `).join('');
        
        // Estatísticas
        const statsContainer = document.getElementById('netStatsContainer');
        statsContainer.innerHTML = data.estatisticas.map(s => `
            <div class="interface-item">
                <div class="interface-name">${s.interface}</div>
                <div class="interface-details">
                    <p><i class="fas fa-arrow-down" style="color: var(--accent-green)"></i> ${s.rxBytes} MB recebidos (${s.rxSec} KB/s)</p>
                    <p><i class="fas fa-arrow-up" style="color: var(--accent-orange)"></i> ${s.txBytes} MB enviados (${s.txSec} KB/s)</p>
                </div>
            </div>
        `).join('');
        
        // Conexões
        const conexoesBody = document.getElementById('conexoesList');
        conexoesBody.innerHTML = data.conexoes.map(c => `
            <tr>
                <td>${c.protocolo}</td>
                <td>${c.localAddress}</td>
                <td>${c.localPort}</td>
                <td>${c.peerAddress || '-'}</td>
                <td>${c.peerPort || '-'}</td>
                <td>${c.state}</td>
            </tr>
        `).join('');
    } catch (err) {
        showToast('Erro ao carregar info de rede', 'error');
    }
}

// ============ ENERGIA ============
function confirmarAcao(acao) {
    const mensagens = {
        'desligar': 'Tem certeza que deseja DESLIGAR o computador?',
        'reiniciar': 'Tem certeza que deseja REINICIAR o computador?',
        'suspender': 'Tem certeza que deseja SUSPENDER o computador?',
        'hibernar': 'Tem certeza que deseja HIBERNAR o computador?',
        'bloquear': 'Tem certeza que deseja BLOQUEAR a sessão?'
    };
    
    showModal(`
        <h2><i class="fas fa-exclamation-triangle" style="color: var(--accent-orange)"></i> Confirmar</h2>
        <p>${mensagens[acao]}</p>
        <div class="modal-buttons">
            <button class="modal-btn secondary" onclick="fecharModal()">Cancelar</button>
            <button class="modal-btn danger" onclick="executarAcaoEnergia('${acao}')">${acao.charAt(0).toUpperCase() + acao.slice(1)}</button>
        </div>
    `);
}

async function executarAcaoEnergia(acao) {
    try {
        const res = await fetchAuth('/energia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast(`${acao} executado!`, 'success');
        } else {
            showToast(data.erro, 'error');
        }
        fecharModal();
    } catch (err) {
        showToast('Erro ao executar ação', 'error');
    }
}

// ============ PROGRAMAS ============
async function abrirPrograma(programa) {
    try {
        const res = await fetchAuth('/abrir-programa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ programa })
        });
        const data = await res.json();
        
        if (data.ok) {
            showToast(`${programa} aberto!`, 'success');
        } else {
            showToast(data.erro, 'error');
        }
    } catch (err) {
        showToast('Erro ao abrir programa', 'error');
    }
}

// ============ NOTAS ============
async function carregarNotas() {
    try {
        const res = await fetchAuth('/notas');
        const data = await res.json();
        notas = data.notas || [];
        renderizarNotas();
    } catch (err) {
        console.error('Erro ao carregar notas:', err);
    }
}

function renderizarNotas() {
    const container = document.getElementById('notasContainer');
    
    if (notas.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted)">Nenhuma nota. Clique em "Nova Nota" para criar.</p>';
        return;
    }
    
    container.innerHTML = notas.map((nota, i) => `
        <div class="nota-card">
            <div class="nota-header">
                <input type="text" class="nota-titulo" value="${escapeHtml(nota.titulo)}" 
                       onchange="atualizarNota(${i}, 'titulo', this.value)" placeholder="Título">
            </div>
            <button class="nota-delete" onclick="deletarNota(${i})"><i class="fas fa-trash"></i></button>
            <textarea class="nota-conteudo" onchange="atualizarNota(${i}, 'conteudo', this.value)" 
                      placeholder="Escreva sua nota aqui...">${escapeHtml(nota.conteudo)}</textarea>
        </div>
    `).join('');
}

function adicionarNota() {
    notas.push({ titulo: 'Nova Nota', conteudo: '', data: new Date().toISOString() });
    salvarNotas();
    renderizarNotas();
}

function atualizarNota(index, campo, valor) {
    notas[index][campo] = valor;
    salvarNotas();
}

function deletarNota(index) {
    if (confirm('Deletar esta nota?')) {
        notas.splice(index, 1);
        salvarNotas();
        renderizarNotas();
    }
}

async function salvarNotas() {
    try {
        await fetchAuth('/notas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notas })
        });
    } catch (err) {
        console.error('Erro ao salvar notas:', err);
    }
}

// ============ UTILITÁRIOS ============
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showModal(content) {
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('modalOverlay').classList.remove('hidden');
}

function fecharModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
}

// Fechar modal clicando fora
document.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') {
        fecharModal();
    }
});

// Toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Atalhos de teclado
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharModal();
});
