async function api(url, opcoes = {}) {
    const resposta = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opcoes
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
        throw new Error(dados.erro || "Erro na operação.");
    }

    return dados;
}


// ======================================================
// SESSÃO
// ======================================================

async function verificarLogin() {
    try {
        const sessao = await api("/api/sessao");

        if (!sessao.logado) {
            irParaComTransicao("index.html");
            return;
        }

        carregarEstoque();
    } catch {
        irParaComTransicao("index.html");
    }
}

document.getElementById("logout").addEventListener("click", async function () {
    await api("/api/logout", { method: "POST" });
    irParaComTransicao("index.html");
});


// ======================================================
// CARREGAR ESTOQUE
// ======================================================

let itensCarregados = [];

async function carregarEstoque() {
    const lista = document.getElementById("lista");

    try {
        itensCarregados = await api("/api/itens");
        renderizarItens(itensCarregados);
    } catch (e) {
        lista.innerHTML = `<p class="erro">${escapar(e.message)}</p>`;
    }
}

function renderizarItens(itens) {
    const lista = document.getElementById("lista");
    lista.innerHTML = "";

    if (itens.length === 0) {
        lista.innerHTML = `<div class="vazio">Nenhum item cadastrado.</div>`;
        return;
    }

    itens.forEach(item => {
        const elemento = document.createElement("div");
        elemento.className = "item";

        elemento.innerHTML = `
            <div>
                <h3>${escapar(item.nome)}</h3>
                <small>Unidade: ${escapar(item.unidade)}</small>
            </div>

            <div class="valor">
                ${formatar(item.quantidade)} ${escapar(item.unidade)}
            </div>

            <div class="acoes">
                <button class="btn verde" onclick="alterar(${item.id}, 'somar', 1)">+1</button>
                <button class="btn amarelo" onclick="alterar(${item.id}, 'diminuir', 1)">-1</button>
                <button class="btn cinza" onclick="quantidadePersonalizada(${item.id}, 'somar')">+ quantidade</button>
                <button class="btn cinza" onclick="quantidadePersonalizada(${item.id}, 'diminuir')">- quantidade</button>
                <button class="btn vermelho" onclick="excluir(${item.id})">Excluir</button>
            </div>
        `;

        lista.appendChild(elemento);
    });
}

document.getElementById("buscaItens").addEventListener("input", function () {
    const termo = this.value.trim().toLowerCase();

    const filtrados = itensCarregados.filter(item =>
        item.nome.toLowerCase().includes(termo)
    );

    renderizarItens(filtrados);
});

async function alterar(id, operacao, quantidade) {
    try {
        await api(`/api/itens/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ operacao, quantidade })
        });

        carregarEstoque();
    } catch (e) {
        alert(e.message);
    }
}


// ======================================================
// PAINEL DE QUANTIDADE PERSONALIZADA
// ======================================================

let modalItemId = null;
let modalOperacao = null;

function abrirModalQuantidade(id, operacao) {
    const item = itensCarregados.find(i => i.id === id);

    modalItemId = id;
    modalOperacao = operacao;

    document.getElementById("modalTitulo").textContent =
        operacao === "somar" ? "Adicionar quantidade" : "Remover quantidade";

    document.getElementById("modalItemNome").textContent = item ? item.nome : "";

    const input = document.getElementById("modalQuantidadeInput");
    input.value = "";
    document.getElementById("modalErro").textContent = "";

    document.getElementById("modalQuantidade").classList.remove("hidden");
    input.focus();
}

function fecharModalQuantidade() {
    document.getElementById("modalQuantidade").classList.add("hidden");
    modalItemId = null;
    modalOperacao = null;
}

function quantidadePersonalizada(id, operacao) {
    abrirModalQuantidade(id, operacao);
}

document.getElementById("modalCancelar").addEventListener("click", fecharModalQuantidade);

document.getElementById("modalQuantidade").addEventListener("click", function (evento) {
    if (evento.target === this) {
        fecharModalQuantidade();
    }
});

document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape" && !document.getElementById("modalQuantidade").classList.contains("hidden")) {
        fecharModalQuantidade();
    }
});

async function confirmarModalQuantidade() {
    const erro = document.getElementById("modalErro");
    erro.textContent = "";

    const valor = document.getElementById("modalQuantidadeInput").value;
    const quantidade = Number(valor);

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
        erro.textContent = "Digite uma quantidade válida.";
        return;
    }

    try {
        await api(`/api/itens/${modalItemId}`, {
            method: "PATCH",
            body: JSON.stringify({ operacao: modalOperacao, quantidade })
        });

        fecharModalQuantidade();
        carregarEstoque();
    } catch (e) {
        erro.textContent = e.message;
    }
}

document.getElementById("modalConfirmar").addEventListener("click", confirmarModalQuantidade);

document.getElementById("modalQuantidadeInput").addEventListener("keydown", function (evento) {
    if (evento.key === "Enter") {
        evento.preventDefault();
        confirmarModalQuantidade();
    }
});

async function excluir(id) {
    if (!confirm("Deseja realmente excluir este item?")) {
        return;
    }

    try {
        await api(`/api/itens/${id}`, { method: "DELETE" });
        carregarEstoque();
    } catch (e) {
        alert(e.message);
    }
}

document.getElementById("atualizar").addEventListener("click", carregarEstoque);


// ======================================================
// FORMATAÇÃO E SEGURANÇA
// ======================================================

function formatar(numero) {
    return Number(numero).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function escapar(valor) {
    return String(valor)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


verificarLogin();
