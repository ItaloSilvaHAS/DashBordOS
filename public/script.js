async function atualizarStatus() {
    const res = await fetch("/status");
    const s = await res.json();

    document.getElementById("cpu").textContent = s.cpu;
    document.getElementById("ram").textContent = s.ram;
    document.getElementById("ramUsed").textContent = s.ramUsed;
    document.getElementById("ramTotal").textContent = s.ramTotal;
}

setInterval(atualizarStatus, 1500);
atualizarStatus();

async function abrir() {
    const prog = document.getElementById("prog").value;
    const res = await fetch("/abrir/" + prog);
    const r = await res.json();
    document.getElementById("respAbrir").textContent = r.msg || r.erro;
}

async function executar() {
    const comando = document.getElementById("cmd").value;

    const res = await fetch("/cmd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comando })
    });

    const r = await res.json();
    document.getElementById("saidaCmd").textContent = r.saida || r.erro;
}

async function listar() {
    const pasta = document.getElementById("pasta").value;

    const res = await fetch("/listar/" + pasta);
    const r = await res.json();

    document.getElementById("arquivos").textContent = r.conteudo || r.erro;
}
