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
// LOGIN / TELAS
// ======================================================

function atualizarUsuarioAtualTexto(nome) {
    const elemento = document.getElementById("usuarioAtualTexto");
    if (elemento) {
        elemento.textContent = nome;
    }
}

async function verificarLogin() {
    try {
        const sessao = await api("/api/sessao");

        if (sessao.logado) {
            atualizarUsuarioAtualTexto(sessao.usuario);
            mostrarEstoque();
            carregarRelatorios();
        } else {
            mostrarLogin();
        }
    } catch {
        mostrarLogin();
    }
}

function mostrarLogin() {
    document.getElementById("loginTela").classList.remove("hidden");
    document.getElementById("recuperarTela").classList.add("hidden");
    document.getElementById("estoqueTela").classList.add("hidden");
}

function mostrarRecuperar() {
    document.getElementById("loginTela").classList.add("hidden");
    document.getElementById("recuperarTela").classList.remove("hidden");
    document.getElementById("estoqueTela").classList.add("hidden");
}

function mostrarEstoque() {
    document.getElementById("loginTela").classList.add("hidden");
    document.getElementById("recuperarTela").classList.add("hidden");
    document.getElementById("estoqueTela").classList.remove("hidden");
}


document.getElementById("loginForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("loginErro");
    erro.textContent = "";

    try {
        const dados = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                usuario: document.getElementById("usuario").value,
                senha: document.getElementById("senha").value
            })
        });

        atualizarUsuarioAtualTexto(dados.usuario);
        mostrarEstoque();
        carregarRelatorios();
    } catch (e) {
        erro.textContent = e.message;
    }
});


// ======================================================
// TROCAR USUÁRIO
// ======================================================

document.getElementById("usuarioForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("usuarioErro");
    const sucesso = document.getElementById("usuarioSucesso");

    erro.textContent = "";
    sucesso.textContent = "";

    try {
        const dados = await api("/api/trocar-usuario", {
            method: "POST",
            body: JSON.stringify({
                senhaAtual: document.getElementById("senhaAtualUsuario").value,
                novoUsuario: document.getElementById("novoUsuario").value
            })
        });

        atualizarUsuarioAtualTexto(dados.usuario);
        sucesso.textContent = "Usuário alterado com sucesso!";
        document.getElementById("usuarioForm").reset();

        setTimeout(() => {
            sucesso.textContent = "";
        }, 2000);
    } catch (e) {
        erro.textContent = e.message;
    }
});


// ======================================================
// ESQUECEU A SENHA
// ======================================================

document.getElementById("linkEsqueciSenha").addEventListener("click", function (evento) {
    evento.preventDefault();
    mostrarRecuperar();
});

document.getElementById("linkVoltarLogin").addEventListener("click", function (evento) {
    evento.preventDefault();
    document.getElementById("buscarPerguntaForm").reset();
    document.getElementById("redefinirSenhaForm").reset();
    document.getElementById("redefinirSenhaForm").classList.add("hidden");
    document.getElementById("buscarPerguntaErro").textContent = "";
    document.getElementById("redefinirSenhaErro").textContent = "";
    mostrarLogin();
});

document.getElementById("buscarPerguntaForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("buscarPerguntaErro");
    erro.textContent = "";

    const usuario = document.getElementById("usuarioRecuperar").value;

    try {
        const dados = await api(`/api/pergunta-seguranca/${encodeURIComponent(usuario)}`);

        document.getElementById("perguntaTexto").textContent = dados.pergunta;
        document.getElementById("redefinirSenhaForm").classList.remove("hidden");
    } catch (e) {
        erro.textContent = e.message;
        document.getElementById("redefinirSenhaForm").classList.add("hidden");
    }
});

document.getElementById("redefinirSenhaForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("redefinirSenhaErro");
    const sucesso = document.getElementById("redefinirSenhaSucesso");

    erro.textContent = "";
    sucesso.textContent = "";

    const novaSenha = document.getElementById("novaSenhaRecuperar").value;
    const confirmar = document.getElementById("confirmarNovaSenhaRecuperar").value;

    if (novaSenha !== confirmar) {
        erro.textContent = "As senhas não coincidem.";
        return;
    }

    try {
        await api("/api/recuperar-senha", {
            method: "POST",
            body: JSON.stringify({
                usuario: document.getElementById("usuarioRecuperar").value,
                resposta: document.getElementById("respostaSeguranca").value,
                novaSenha
            })
        });

        sucesso.textContent = "Senha redefinida com sucesso! Você já pode entrar.";

        setTimeout(() => {
            document.getElementById("buscarPerguntaForm").reset();
            document.getElementById("redefinirSenhaForm").reset();
            document.getElementById("redefinirSenhaForm").classList.add("hidden");
            sucesso.textContent = "";
            mostrarLogin();
        }, 2000);
    } catch (e) {
        erro.textContent = e.message;
    }
});


// ======================================================
// ADICIONAR ITEM
// ======================================================

document.getElementById("itemForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("itemErro");
    const sucesso = document.getElementById("itemSucesso");

    erro.textContent = "";
    sucesso.textContent = "";

    try {
        await api("/api/itens", {
            method: "POST",
            body: JSON.stringify({
                nome: document.getElementById("nome").value,
                quantidade: document.getElementById("quantidade").value,
                unidade: document.getElementById("unidade").value
            })
        });

        document.getElementById("itemForm").reset();
        sucesso.textContent = "Item adicionado com sucesso!";

        setTimeout(() => {
            sucesso.textContent = "";
        }, 2000);
    } catch (e) {
        erro.textContent = e.message;
    }
});


// ======================================================
// RELATÓRIOS MENSAIS
// ======================================================

let relatoriosCarregados = [];

async function carregarRelatorios() {
    try {
        relatoriosCarregados = await api("/api/relatorios");
        popularFiltroAno(relatoriosCarregados);
        aplicarFiltrosRelatorios();
    } catch (e) {
        document.getElementById("listaRelatorios").innerHTML = `<p class="erro">${escapar(e.message)}</p>`;
    }
}

function anoDoRelatorio(relatorio) {
    return relatorio.mes_referencia.split("-")[0];
}

function popularFiltroAno(relatorios) {
    const select = document.getElementById("filtroAno");
    const anoSelecionado = select.value;

    const anos = [...new Set(relatorios.map(anoDoRelatorio))].sort((a, b) => b.localeCompare(a));

    select.innerHTML = `<option value="">Todos os anos</option>`;

    anos.forEach(ano => {
        const opcao = document.createElement("option");
        opcao.value = ano;
        opcao.textContent = ano;
        select.appendChild(opcao);
    });

    if (anos.includes(anoSelecionado)) {
        select.value = anoSelecionado;
    }
}

function renderizarRelatorios(relatorios) {
    const lista = document.getElementById("listaRelatorios");
    lista.innerHTML = "";

    if (relatorios.length === 0) {
        lista.innerHTML = `<div class="vazio">Nenhum relatório encontrado.</div>`;
        return;
    }

    relatorios.forEach(relatorio => {
        const linha = document.createElement("div");
        linha.className = "relatorio";

        linha.innerHTML = `
            <span>
                Relatório de ${escapar(relatorio.mes_referencia)}
                <span class="anoTag">${escapar(anoDoRelatorio(relatorio))}</span>
            </span>
            <a class="btn cinza" href="/api/relatorios/${encodeURIComponent(relatorio.arquivo)}">Baixar</a>
        `;

        lista.appendChild(linha);
    });
}

function aplicarFiltrosRelatorios() {
    const termo = document.getElementById("buscaRelatorios").value.trim().toLowerCase();
    const ano = document.getElementById("filtroAno").value;

    const filtrados = relatoriosCarregados.filter(relatorio => {
        const bateTermo = relatorio.mes_referencia.toLowerCase().includes(termo);
        const bateAno = !ano || anoDoRelatorio(relatorio) === ano;
        return bateTermo && bateAno;
    });

    renderizarRelatorios(filtrados);
}

document.getElementById("buscaRelatorios").addEventListener("input", aplicarFiltrosRelatorios);
document.getElementById("filtroAno").addEventListener("change", aplicarFiltrosRelatorios);


// ======================================================
// TROCAR SENHA
// ======================================================

document.getElementById("abrirSenha").addEventListener("click", function () {
    const tela = document.getElementById("senhaTela");
    tela.classList.toggle("hidden");

    if (!tela.classList.contains("hidden")) {
        document.getElementById("senhaAtual").focus();
    }
});

document.getElementById("senhaForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("senhaErro");
    const sucesso = document.getElementById("senhaSucesso");

    erro.textContent = "";
    sucesso.textContent = "";

    const novaSenha = document.getElementById("novaSenha").value;
    const confirmarSenha = document.getElementById("confirmarSenha").value;

    if (novaSenha !== confirmarSenha) {
        erro.textContent = "As senhas novas não coincidem.";
        return;
    }

    try {
        await api("/api/trocar-senha", {
            method: "POST",
            body: JSON.stringify({
                senhaAtual: document.getElementById("senhaAtual").value,
                novaSenha
            })
        });

        sucesso.textContent = "Senha alterada com sucesso!";
        document.getElementById("senhaForm").reset();

        setTimeout(() => {
            sucesso.textContent = "";
        }, 2000);
    } catch (e) {
        erro.textContent = e.message;
    }
});

document.getElementById("perguntaForm").addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const erro = document.getElementById("perguntaErro");
    const sucesso = document.getElementById("perguntaSucesso");

    erro.textContent = "";
    sucesso.textContent = "";

    try {
        await api("/api/pergunta-seguranca", {
            method: "POST",
            body: JSON.stringify({
                senhaAtual: document.getElementById("senhaAtualPergunta").value,
                pergunta: document.getElementById("pergunta").value,
                resposta: document.getElementById("resposta").value
            })
        });

        sucesso.textContent = "Pergunta de segurança salva com sucesso!";
        document.getElementById("perguntaForm").reset();

        setTimeout(() => {
            sucesso.textContent = "";
        }, 2000);
    } catch (e) {
        erro.textContent = e.message;
    }
});


// ======================================================
// LOGOUT / ATUALIZAR
// ======================================================

document.getElementById("logout").addEventListener("click", async function () {
    await api("/api/logout", { method: "POST" });
    mostrarLogin();
    document.getElementById("loginForm").reset();
});

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
