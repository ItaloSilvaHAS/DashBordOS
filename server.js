const express = require("express");
const app = express();
const si = require("systeminformation");
const { exec } = require("child_process");
const path = require("path");
const cors = require("cors");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* --- Abrir programa --- */
app.get("/abrir/:programa", (req, res) => {
    const programa = req.params.programa;

    exec(programa, (err) => {
        if (err) return res.json({ ok: false, erro: err.message });
        res.json({ ok: true, msg: `${programa} aberto!` });
    });
});

/* --- Informações do sistema --- */
app.get("/status", async (req, res) => {
    const cpu = await si.currentLoad();
    const mem = await si.mem();

    res.json({
        cpu: cpu.currentLoad.toFixed(1),
        ram: ((mem.active / mem.total) * 100).toFixed(1),
        ramUsed: (mem.active / 1024 / 1024 / 1024).toFixed(2),
        ramTotal: (mem.total / 1024 / 1024 / 1024).toFixed(2)
    });
});

/* --- Executar comando --- */
app.post("/cmd", (req, res) => {
    const { comando } = req.body;

    exec(comando, (err, stdout, stderr) => {
        if (err) return res.json({ erro: stderr });
        res.json({ ok: true, saida: stdout });
    });
});

/* --- Listar arquivos --- */
app.get("/listar/*", (req, res) => {
    const pasta = req.params[0];
    const fullPath = path.resolve(pasta);

    exec(`dir "${fullPath}"`, (err, stdout) => {
        if (err) return res.json({ erro: "Não foi possível acessar a pasta" });
        res.json({ conteudo: stdout });
    });
});

/* --- Start server --- */
app.listen(3000, () =>
    console.log("Dashboard disponível em http://localhost:3000")
);
