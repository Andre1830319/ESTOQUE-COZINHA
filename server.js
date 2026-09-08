const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// ======================================================
// CONEXÃO COM O MYSQL
// ======================================================

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "admin", // coloque aqui a senha do seu MySQL
    database: "estoque_cozinha",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ======================================================
// CONFIGURAÇÃO DO EXPRESS
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: "CHAVE-SECRETA-TROQUE-ESTA-CHAVE",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000 // 8 horas
    }
}));

app.use(express.static(path.join(__dirname, "public")));

function autenticado(req, res, next) {
    if (!req.session.usuarioId) {
        return res.status(401).json({ erro: "Você precisa estar logado." });
    }
    next();
}

// ======================================================
// SEMANA ATUAL (usada para o reset semanal do estoque)
// ======================================================

function semanaAtual() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const inicioAno = new Date(ano, 0, 1);

    const diferenca = Math.floor((agora - inicioAno) / (1000 * 60 * 60 * 24)) + 1;
    const diaSemana = inicioAno.getDay() === 0 ? 7 : inicioAno.getDay();
    const numeroSemana = Math.ceil((diferenca + diaSemana - 1) / 7);

    return `${ano}-S${String(numeroSemana).padStart(2, "0")}`;
}

async function verificarResetSemanal() {
    const semana = semanaAtual();

    const [linhas] = await pool.query(
        "SELECT semana FROM controle_semanal WHERE id = 1 LIMIT 1"
    );

    const semanaSalva = linhas.length > 0 ? linhas[0].semana : "";

    if (semanaSalva !== semana) {
        await pool.query("UPDATE itens SET quantidade = 0, semana = ?", [semana]);
        await pool.query("UPDATE controle_semanal SET semana = ? WHERE id = 1", [semana]);
        console.log(`Estoque resetado para a semana ${semana}.`);
    }
}

// ======================================================
// REGISTRO DE MOVIMENTAÇÕES (entradas, saídas e exclusões)
// Isso é o que alimenta o relatório mensal.
// ======================================================

async function registrarMovimentacao(itemNome, tipo, quantidade, unidade, usuario) {
    await pool.query(
        `INSERT INTO movimentacoes (item_nome, tipo, quantidade, unidade, usuario)
         VALUES (?, ?, ?, ?, ?)`,
        [itemNome, tipo, quantidade, unidade, usuario]
    );
}

// ======================================================
// RELATÓRIO MENSAL AUTOMÁTICO
// O relatório do mês atual é reescrito toda vez que alguém
// adiciona, soma, diminui ou exclui um item — então ele
// está sempre atualizado, sem precisar esperar o mês virar.
// Quando o mês termina, o arquivo daquele mês fica "parado"
// (congelado com os últimos dados) e um novo começa a ser
// escrito para o mês seguinte.
// ======================================================

function calcularMesAtual() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = agora.getMonth() + 1;

    return {
        referencia: `${ano}-${String(mes).padStart(2, "0")}`,
        inicio: new Date(ano, mes - 1, 1),
        fim: new Date(ano, mes, 1) // primeiro dia do mês seguinte (limite exclusivo)
    };
}

async function atualizarRelatorioMensal(referencia, inicio, fim) {
    const [movimentos] = await pool.query(
        `SELECT item_nome, tipo, unidade, SUM(quantidade) AS total
         FROM movimentacoes
         WHERE criado_em >= ? AND criado_em < ?
         GROUP BY item_nome, tipo, unidade
         ORDER BY item_nome ASC`,
        [inicio, fim]
    );

    // Soma do estoque atual de todos os produtos, agrupada por unidade
    // de medida (ex.: total em kg, total em un, total em L...).
    const [totaisPorUnidade] = await pool.query(
        `SELECT unidade, SUM(quantidade) AS total
         FROM itens
         GROUP BY unidade
         ORDER BY unidade ASC`
    );

    const pastaRelatorios = path.join(__dirname, "relatorios");

    if (!fs.existsSync(pastaRelatorios)) {
        fs.mkdirSync(pastaRelatorios);
    }

    const nomeArquivo = `relatorio-${referencia}.txt`;
    const caminhoArquivo = path.join(pastaRelatorios, nomeArquivo);

    let conteudo = "RELATÓRIO MENSAL DE ESTOQUE\n";
    conteudo += `Referente a: ${referencia}\n`;
    conteudo += `Gerado em: ${new Date().toLocaleString("pt-BR")}\n\n`;

    if (movimentos.length === 0) {
        conteudo += "Nenhuma movimentação registrada neste mês.\n";
    } else {
        const itens = {};

        movimentos.forEach(linha => {
            if (!itens[linha.item_nome]) {
                itens[linha.item_nome] = { entrada: 0, saida: 0, exclusao: 0, unidade: linha.unidade };
            }
            itens[linha.item_nome][linha.tipo] = Number(linha.total);
        });

        Object.keys(itens).forEach(nome => {
            const dados = itens[nome];
            conteudo += `- ${nome}\n`;
            conteudo += `    Adicionado: ${dados.entrada} ${dados.unidade}\n`;
            conteudo += `    Retirado: ${dados.saida} ${dados.unidade}\n`;

            if (dados.exclusao > 0) {
                conteudo += `    Removido do cadastro: ${dados.exclusao} ${dados.unidade}\n`;
            }

            conteudo += "\n";
        });
    }

    conteudo += "----------------------------------------\n";
    conteudo += "SOMA TOTAL DO ESTOQUE POR UNIDADE DE MEDIDA\n\n";

    if (totaisPorUnidade.length === 0) {
        conteudo += "Nenhum produto cadastrado no momento.\n";
    } else {
        totaisPorUnidade.forEach(linha => {
            conteudo += `- ${linha.unidade}: ${Number(linha.total)}\n`;
        });
    }

    fs.writeFileSync(caminhoArquivo, conteudo, "utf-8");

    // Se o relatório desse mês já existir, só atualiza a data. Se não
    // existir ainda, cria o registro agora.
    await pool.query(
        `INSERT INTO relatorios_gerados (mes_referencia, arquivo)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
            arquivo = VALUES(arquivo),
            gerado_em = CURRENT_TIMESTAMP`,
        [referencia, nomeArquivo]
    );
}

async function atualizarRelatorioMesAtual() {
    const { referencia, inicio, fim } = calcularMesAtual();
    await atualizarRelatorioMensal(referencia, inicio, fim);
}

// ======================================================
// GARANTIR COLUNAS DA PERGUNTA DE SEGURANÇA
// Se o banco já existia antes dessa funcionalidade, a tabela
// "usuarios" pode não ter as colunas "pergunta_seguranca" e
// "resposta_hash" (o CREATE TABLE IF NOT EXISTS não as adiciona
// em uma tabela que já existe). Aqui a gente checa e cria essas
// colunas automaticamente, sem precisar rodar SQL na mão.
// ======================================================

async function garantirColunasUsuarios() {
    const [colunas] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'`
    );

    const nomesColunas = colunas.map(coluna => coluna.COLUMN_NAME);

    if (!nomesColunas.includes("pergunta_seguranca")) {
        await pool.query(
            "ALTER TABLE usuarios ADD COLUMN pergunta_seguranca VARCHAR(255) NOT NULL DEFAULT ''"
        );
        console.log("Coluna 'pergunta_seguranca' criada na tabela usuarios.");
    }

    if (!nomesColunas.includes("resposta_hash")) {
        await pool.query(
            "ALTER TABLE usuarios ADD COLUMN resposta_hash VARCHAR(255) NOT NULL DEFAULT ''"
        );
        console.log("Coluna 'resposta_hash' criada na tabela usuarios.");
    }
}

// ======================================================
// CRIAÇÃO AUTOMÁTICA DO ADMINISTRADOR
// ======================================================

async function criarAdministrador() {
    const [usuarios] = await pool.query(
        "SELECT id FROM usuarios WHERE usuario = 'admin' LIMIT 1"
    );

    if (usuarios.length === 0) {
        const senhaHash = await bcrypt.hash("admin123", 10);
        const respostaHash = await bcrypt.hash("cozinha", 10);

        await pool.query(
            `INSERT INTO usuarios (usuario, senha_hash, pergunta_seguranca, resposta_hash)
             VALUES (?, ?, ?, ?)`,
            ["admin", senhaHash, " Qual local você trabalha da cantina??", respostaHash]
        );

        console.log("Administrador criado.");
        console.log("Usuário: admin");
        console.log("Senha: admin123");
        console.log("Pergunta de segurança padrão: 'Qual local você trabalha da cantina??' (resposta: cozinha)");
        console.log("Recomendado trocar a senha e a pergunta de segurança assim que possível.");
    }
}

// ======================================================
// LOGIN / SESSÃO / LOGOUT
// ======================================================

app.post("/api/login", async (req, res) => {
    try {
        const { usuario, senha } = req.body;

        if (!usuario || !senha) {
            return res.status(400).json({ erro: "Informe usuário e senha." });
        }

        const [usuarios] = await pool.query(
            "SELECT * FROM usuarios WHERE usuario = ? LIMIT 1",
            [usuario]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({ erro: "Usuário ou senha inválidos." });
        }

        const usuarioBanco = usuarios[0];
        const senhaCorreta = await bcrypt.compare(senha, usuarioBanco.senha_hash);

        if (!senhaCorreta) {
            return res.status(401).json({ erro: "Usuário ou senha inválidos." });
        }

        req.session.usuarioId = usuarioBanco.id;
        req.session.usuario = usuarioBanco.usuario;

        await verificarResetSemanal();
        atualizarRelatorioMesAtual().catch(erro => console.error("Erro ao atualizar relatório mensal:", erro));

        res.json({ sucesso: true, usuario: usuarioBanco.usuario, semana: semanaAtual() });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro interno no login." });
    }
});

app.get("/api/sessao", async (req, res) => {
    if (!req.session.usuarioId) {
        return res.json({ logado: false });
    }

    await verificarResetSemanal();
    atualizarRelatorioMesAtual().catch(erro => console.error("Erro ao atualizar relatório mensal:", erro));

    res.json({ logado: true, usuario: req.session.usuario, semana: semanaAtual() });
});

app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ sucesso: true });
    });
});

// ======================================================
// TROCA DE SENHA (usuário já logado)
// ======================================================

app.post("/api/trocar-senha", autenticado, async (req, res) => {
    try {
        const { senhaAtual, novaSenha } = req.body;

        if (!senhaAtual || !novaSenha) {
            return res.status(400).json({ erro: "Preencha a senha atual e a nova senha." });
        }

        if (novaSenha.length < 6) {
            return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 6 caracteres." });
        }

        const [usuarios] = await pool.query(
            "SELECT * FROM usuarios WHERE id = ? LIMIT 1",
            [req.session.usuarioId]
        );

        const usuarioBanco = usuarios[0];
        const senhaCorreta = await bcrypt.compare(senhaAtual, usuarioBanco.senha_hash);

        if (!senhaCorreta) {
            return res.status(401).json({ erro: "A senha atual está incorreta." });
        }

        const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

        await pool.query(
            "UPDATE usuarios SET senha_hash = ? WHERE id = ?",
            [novaSenhaHash, usuarioBanco.id]
        );

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao trocar a senha." });
    }
});

// Trocar o nome de usuário (usuário já logado)
app.post("/api/trocar-usuario", autenticado, async (req, res) => {
    try {
        const { senhaAtual, novoUsuario } = req.body;

        if (!senhaAtual || !novoUsuario) {
            return res.status(400).json({ erro: "Preencha a senha atual e o novo usuário." });
        }

        const usuarioFinal = novoUsuario.trim();

        if (usuarioFinal.length < 3) {
            return res.status(400).json({ erro: "O novo usuário precisa ter pelo menos 3 caracteres." });
        }

        const [usuarios] = await pool.query(
            "SELECT * FROM usuarios WHERE id = ? LIMIT 1",
            [req.session.usuarioId]
        );

        const usuarioBanco = usuarios[0];
        const senhaCorreta = await bcrypt.compare(senhaAtual, usuarioBanco.senha_hash);

        if (!senhaCorreta) {
            return res.status(401).json({ erro: "A senha atual está incorreta." });
        }

        if (usuarioFinal === usuarioBanco.usuario) {
            return res.status(400).json({ erro: "Esse já é o seu usuário atual." });
        }

        const [existentes] = await pool.query(
            "SELECT id FROM usuarios WHERE usuario = ? AND id != ? LIMIT 1",
            [usuarioFinal, usuarioBanco.id]
        );

        if (existentes.length > 0) {
            return res.status(400).json({ erro: "Esse nome de usuário já está em uso." });
        }

        await pool.query(
            "UPDATE usuarios SET usuario = ? WHERE id = ?",
            [usuarioFinal, usuarioBanco.id]
        );

        req.session.usuario = usuarioFinal;

        res.json({ sucesso: true, usuario: usuarioFinal });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao trocar o usuário." });
    }
});

// Atualizar a pergunta/resposta de segurança (usuário já logado)
app.post("/api/pergunta-seguranca", autenticado, async (req, res) => {
    try {
        const { senhaAtual, pergunta, resposta } = req.body;

        if (!senhaAtual || !pergunta || !resposta) {
            return res.status(400).json({ erro: "Preencha todos os campos." });
        }

        const [usuarios] = await pool.query(
            "SELECT * FROM usuarios WHERE id = ? LIMIT 1",
            [req.session.usuarioId]
        );

        const usuarioBanco = usuarios[0];
        const senhaCorreta = await bcrypt.compare(senhaAtual, usuarioBanco.senha_hash);

        if (!senhaCorreta) {
            return res.status(401).json({ erro: "A senha atual está incorreta." });
        }

        const respostaHash = await bcrypt.hash(resposta.trim().toLowerCase(), 10);

        await pool.query(
            "UPDATE usuarios SET pergunta_seguranca = ?, resposta_hash = ? WHERE id = ?",
            [pergunta.trim(), respostaHash, usuarioBanco.id]
        );

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao salvar a pergunta de segurança." });
    }
});

// ======================================================
// ESQUECEU A SENHA (fluxo sem estar logado)
// ======================================================

app.get("/api/pergunta-seguranca/:usuario", async (req, res) => {
    try {
        const [usuarios] = await pool.query(
            "SELECT pergunta_seguranca FROM usuarios WHERE usuario = ? LIMIT 1",
            [req.params.usuario]
        );

        if (usuarios.length === 0) {
            return res.status(404).json({ erro: "Usuário não encontrado." });
        }

        if (!usuarios[0].pergunta_seguranca) {
            return res.status(404).json({ erro: "Este usuário ainda não configurou uma pergunta de segurança." });
        }

        res.json({ pergunta: usuarios[0].pergunta_seguranca });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao buscar a pergunta de segurança." });
    }
});

app.post("/api/recuperar-senha", async (req, res) => {
    try {
        const { usuario, resposta, novaSenha } = req.body;

        if (!usuario || !resposta || !novaSenha) {
            return res.status(400).json({ erro: "Preencha todos os campos." });
        }

        if (novaSenha.length < 6) {
            return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 6 caracteres." });
        }

        const [usuarios] = await pool.query(
            "SELECT * FROM usuarios WHERE usuario = ? LIMIT 1",
            [usuario]
        );

        if (usuarios.length === 0) {
            return res.status(400).json({ erro: "Não foi possível redefinir a senha." });
        }

        const usuarioBanco = usuarios[0];

        if (!usuarioBanco.resposta_hash) {
            return res.status(400).json({ erro: "Este usuário ainda não configurou uma pergunta de segurança." });
        }

        const respostaCorreta = await bcrypt.compare(
            resposta.trim().toLowerCase(),
            usuarioBanco.resposta_hash
        );

        if (!respostaCorreta) {
            return res.status(400).json({ erro: "Resposta de segurança incorreta." });
        }

        const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

        await pool.query(
            "UPDATE usuarios SET senha_hash = ? WHERE id = ?",
            [novaSenhaHash, usuarioBanco.id]
        );

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao redefinir a senha." });
    }
});

// ======================================================
// ITENS DO ESTOQUE
// ======================================================

app.get("/api/itens", autenticado, async (req, res) => {
    try {
        await verificarResetSemanal();

        const [itens] = await pool.query(
            "SELECT id, nome, quantidade, unidade FROM itens ORDER BY nome ASC"
        );

        res.json(itens);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao carregar estoque." });
    }
});

app.post("/api/itens", autenticado, async (req, res) => {
    try {
        const { nome, quantidade, unidade } = req.body;

        if (!nome) {
            return res.status(400).json({ erro: "Informe o nome do item." });
        }

        const qtd = Number(quantidade);

        if (!Number.isFinite(qtd) || qtd < 0) {
            return res.status(400).json({ erro: "Quantidade inválida." });
        }

        await verificarResetSemanal();

        const semana = semanaAtual();
        const nomeFinal = nome.trim();
        const unidadeFinal = unidade || "un";

        // Se o item já existir, soma a quantidade em vez de duplicar.
        await pool.query(
            `INSERT INTO itens (nome, quantidade, unidade, semana)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                quantidade = quantidade + VALUES(quantidade),
                unidade = VALUES(unidade),
                semana = VALUES(semana)`,
            [nomeFinal, qtd, unidadeFinal, semana]
        );

        await registrarMovimentacao(nomeFinal, "entrada", qtd, unidadeFinal, req.session.usuario);
        await atualizarRelatorioMesAtual();

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao adicionar item." });
    }
});

app.patch("/api/itens/:id", autenticado, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { operacao, quantidade } = req.body;
        const qtd = Number(quantidade);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        if (!Number.isFinite(qtd) || qtd <= 0) {
            return res.status(400).json({ erro: "Quantidade inválida." });
        }

        if (operacao !== "somar" && operacao !== "diminuir") {
            return res.status(400).json({ erro: "Operação inválida." });
        }

        await verificarResetSemanal();

        const [itens] = await pool.query(
            "SELECT nome, unidade FROM itens WHERE id = ? LIMIT 1",
            [id]
        );

        if (itens.length === 0) {
            return res.status(404).json({ erro: "Item não encontrado." });
        }

        const item = itens[0];

        if (operacao === "somar") {
            await pool.query(
                "UPDATE itens SET quantidade = quantidade + ? WHERE id = ?",
                [qtd, id]
            );
            await registrarMovimentacao(item.nome, "entrada", qtd, item.unidade, req.session.usuario);
        } else {
            await pool.query(
                "UPDATE itens SET quantidade = GREATEST(quantidade - ?, 0) WHERE id = ?",
                [qtd, id]
            );
            await registrarMovimentacao(item.nome, "saida", qtd, item.unidade, req.session.usuario);
        }

        await atualizarRelatorioMesAtual();

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao alterar estoque." });
    }
});

app.delete("/api/itens/:id", autenticado, async (req, res) => {
    try {
        const id = Number(req.params.id);

        const [itens] = await pool.query(
            "SELECT nome, quantidade, unidade FROM itens WHERE id = ? LIMIT 1",
            [id]
        );

        if (itens.length === 0) {
            return res.status(404).json({ erro: "Item não encontrado." });
        }

        const item = itens[0];

        await pool.query("DELETE FROM itens WHERE id = ?", [id]);

        if (Number(item.quantidade) > 0) {
            await registrarMovimentacao(item.nome, "exclusao", item.quantidade, item.unidade, req.session.usuario);
            await atualizarRelatorioMesAtual();
        }

        res.json({ sucesso: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao excluir item." });
    }
});

// ======================================================
// RELATÓRIOS MENSAIS
// ======================================================

app.get("/api/relatorios", autenticado, async (req, res) => {
    try {
        const [relatorios] = await pool.query(
            "SELECT mes_referencia, arquivo, gerado_em FROM relatorios_gerados ORDER BY mes_referencia DESC"
        );

        res.json(relatorios);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao listar relatórios." });
    }
});

app.get("/api/relatorios/:arquivo", autenticado, (req, res) => {
    const { arquivo } = req.params;

    // Só aceita nomes no formato esperado, para não permitir acessar
    // outros arquivos do servidor.
    if (!/^relatorio-\d{4}-\d{2}\.txt$/.test(arquivo)) {
        return res.status(400).json({ erro: "Arquivo inválido." });
    }

    const caminho = path.join(__dirname, "relatorios", arquivo);

    if (!fs.existsSync(caminho)) {
        return res.status(404).json({ erro: "Relatório não encontrado." });
    }

    res.download(caminho);
});

// ======================================================
// INICIALIZAÇÃO DO SERVIDOR
// ======================================================

async function iniciar() {
    try {
        await pool.query("SELECT 1");
        console.log("MySQL conectado.");

        await garantirColunasUsuarios();
        await criarAdministrador();
        await verificarResetSemanal();

        // Garante que o relatório do mês atual já exista assim que o
        // servidor liga, mesmo antes de qualquer movimentação nova.
        await atualizarRelatorioMesAtual();

        app.listen(PORT, () => {
            console.log("");
            console.log("Sistema disponível em:");
            console.log(`http://localhost:${PORT}`);
            console.log("");
        });
    } catch (erro) {
        console.error("Erro ao iniciar o sistema:");
        console.error(erro.message);
    }
}

iniciar();
