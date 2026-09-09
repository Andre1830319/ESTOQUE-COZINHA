// Na Vercel as variáveis de ambiente já vêm prontas; o dotenv só é
// necessário para ler o arquivo .env quando rodamos localmente.
if (!process.env.VERCEL) {
    require("dotenv").config();
}

const dns = require("dns");
// Alguns provedores de banco (como o Aiven) respondem mais rápido em IPv4.
// Em ambientes serverless como a Vercel, a resolução IPv6 às vezes trava até
// dar timeout; forçar IPv4 primeiro evita esse travamento.
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cookieSession = require("cookie-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================================================
// CONEXÃO COM O MYSQL
// ======================================================

// Em ambiente serverless (Vercel), cada instância da função pode criar seu
// próprio pool. Por isso mantemos o connectionLimit baixo, para não estourar
// o limite de conexões do banco quando várias instâncias sobem ao mesmo tempo.
// Faz a leitura manual da DATABASE_URL (em vez de confiar que o driver
// entende um campo "uri" dentro do objeto de configuração), pra garantir
// que host/usuário/senha/banco sejam sempre interpretados corretamente.
function lerDatabaseUrl(url) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, "")
    };
}

const pool = mysql.createPool(
    process.env.DATABASE_URL
        ? {
            ...lerDatabaseUrl(process.env.DATABASE_URL),
            waitForConnections: true,
            connectionLimit: process.env.VERCEL ? 1 : 5,
            queueLimit: 0,
            connectTimeout: 10000,
            ssl: process.env.DATABASE_SSL === "true"
                ? { rejectUnauthorized: true }
                : undefined
        }
        : {
            host: "localhost",
            user: "root",
            password: "admin",
            database: "estoque_cozinha",
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        }
);

// ======================================================
// CONFIGURAÇÃO DO EXPRESS
// ======================================================

// Necessário na Vercel (e em qualquer proxy reverso) para que o Express
// reconheça a conexão HTTPS e o cookie "secure" funcione corretamente.
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
    name: "sessao",
    keys: [
        process.env.SESSION_SECRET || "chave-local-desenvolvimento"
    ],
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
}));

// Os arquivos da interface ficam na pasta public.
app.use(express.static(path.join(__dirname, "public")));

function autenticado(req, res, next) {
    if (!req.session || !req.session.usuarioId) {
        return res.status(401).json({
            erro: "Você precisa estar logado."
        });
    }

    next();
}

// ======================================================
// SEMANA ATUAL
// ======================================================

function semanaAtual() {
    const agora = new Date();
    const ano = agora.getFullYear();
    const inicioAno = new Date(ano, 0, 1);

    const diferenca = Math.floor(
        (agora - inicioAno) /
        (1000 * 60 * 60 * 24)
    ) + 1;

    const diaSemana =
        inicioAno.getDay() === 0
            ? 7
            : inicioAno.getDay();

    const numeroSemana = Math.ceil(
        (diferenca + diaSemana - 1) / 7
    );

    return `${ano}-S${String(numeroSemana).padStart(2, "0")}`;
}

async function verificarResetSemanal() {
    const semana = semanaAtual();

    const [linhas] = await pool.query(
        "SELECT semana FROM controle_semanal WHERE id = 1 LIMIT 1"
    );

    const semanaSalva =
        linhas.length > 0
            ? linhas[0].semana
            : "";

    if (semanaSalva !== semana) {
        await pool.query(
            "UPDATE itens SET quantidade = 0, semana = ?",
            [semana]
        );

        await pool.query(
            "UPDATE controle_semanal SET semana = ? WHERE id = 1",
            [semana]
        );

        console.log(
            `Estoque resetado para a semana ${semana}.`
        );
    }
}

// ======================================================
// REGISTRO DE MOVIMENTAÇÕES
// ======================================================

async function registrarMovimentacao(
    itemNome,
    tipo,
    quantidade,
    unidade,
    usuario
) {
    await pool.query(
        `INSERT INTO movimentacoes
            (item_nome, tipo, quantidade, unidade, usuario)
         VALUES (?, ?, ?, ?, ?)`,
        [
            itemNome,
            tipo,
            quantidade,
            unidade,
            usuario
        ]
    );
}

// ======================================================
// RELATÓRIO MENSAL
// ======================================================

function calcularMesAtual() {
    const agora = new Date();

    const ano = agora.getFullYear();
    const mes = agora.getMonth() + 1;

    return {
        referencia:
            `${ano}-${String(mes).padStart(2, "0")}`,

        inicio:
            new Date(ano, mes - 1, 1),

        fim:
            new Date(ano, mes, 1)
    };
}

async function atualizarRelatorioMensal(
    referencia,
    inicio,
    fim
) {
    const [movimentos] = await pool.query(
        `SELECT
            item_nome,
            tipo,
            unidade,
            SUM(quantidade) AS total
         FROM movimentacoes
         WHERE criado_em >= ?
           AND criado_em < ?
         GROUP BY item_nome, tipo, unidade
         ORDER BY item_nome ASC`,
        [inicio, fim]
    );

    const [totaisPorUnidade] = await pool.query(
        `SELECT
            unidade,
            SUM(quantidade) AS total
         FROM itens
         GROUP BY unidade
         ORDER BY unidade ASC`
    );

    const nomeArquivo =
        `relatorio-${referencia}.txt`;

    let conteudo =
        "RELATÓRIO MENSAL DE ESTOQUE\n";

    conteudo +=
        `Referente a: ${referencia}\n`;

    conteudo +=
        `Gerado em: ${new Date().toLocaleString("pt-BR")}\n\n`;

    if (movimentos.length === 0) {
        conteudo +=
            "Nenhuma movimentação registrada neste mês.\n";
    } else {
        const itens = {};

        movimentos.forEach(linha => {
            if (!itens[linha.item_nome]) {
                itens[linha.item_nome] = {
                    entrada: 0,
                    saida: 0,
                    exclusao: 0,
                    unidade: linha.unidade
                };
            }

            itens[linha.item_nome][linha.tipo] =
                Number(linha.total);
        });

        Object.keys(itens).forEach(nome => {
            const dados = itens[nome];

            conteudo += `- ${nome}\n`;

            conteudo +=
                `    Adicionado: ${dados.entrada} ${dados.unidade}\n`;

            conteudo +=
                `    Retirado: ${dados.saida} ${dados.unidade}\n`;

            if (dados.exclusao > 0) {
                conteudo +=
                    `    Removido do cadastro: ${dados.exclusao} ${dados.unidade}\n`;
            }

            conteudo += "\n";
        });
    }

    conteudo +=
        "----------------------------------------\n";

    conteudo +=
        "SOMA TOTAL DO ESTOQUE POR UNIDADE DE MEDIDA\n\n";

    if (totaisPorUnidade.length === 0) {
        conteudo +=
            "Nenhum produto cadastrado no momento.\n";
    } else {
        totaisPorUnidade.forEach(linha => {
            conteudo +=
                `- ${linha.unidade}: ${Number(linha.total)}\n`;
        });
    }

    // Na Vercel não usamos o sistema de arquivos
    // para armazenamento permanente.
    await pool.query(
        `INSERT INTO relatorios_gerados
            (mes_referencia, arquivo, conteudo)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
            arquivo = VALUES(arquivo),
            conteudo = VALUES(conteudo),
            gerado_em = CURRENT_TIMESTAMP`,
        [
            referencia,
            nomeArquivo,
            conteudo
        ]
    );
}

async function atualizarRelatorioMesAtual() {
    const {
        referencia,
        inicio,
        fim
    } = calcularMesAtual();

    await atualizarRelatorioMensal(
        referencia,
        inicio,
        fim
    );
}

// ======================================================
// GARANTIR COLUNAS DA PERGUNTA DE SEGURANÇA
// ======================================================

async function garantirColunasUsuarios() {
    const [colunas] = await pool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'usuarios'`
    );

    const nomesColunas =
        colunas.map(
            coluna => coluna.COLUMN_NAME
        );

    if (!nomesColunas.includes("pergunta_seguranca")) {
        await pool.query(
            `ALTER TABLE usuarios
             ADD COLUMN pergunta_seguranca
             VARCHAR(255) NOT NULL DEFAULT ''`
        );

        console.log(
            "Coluna 'pergunta_seguranca' criada."
        );
    }

    if (!nomesColunas.includes("resposta_hash")) {
        await pool.query(
            `ALTER TABLE usuarios
             ADD COLUMN resposta_hash
             VARCHAR(255) NOT NULL DEFAULT ''`
        );

        console.log(
            "Coluna 'resposta_hash' criada."
        );
    }
}

// ======================================================
// CRIAÇÃO AUTOMÁTICA DO ADMINISTRADOR
// ======================================================

async function criarAdministrador() {
    const [usuarios] = await pool.query(
        `SELECT id
         FROM usuarios
         WHERE usuario = 'admin'
         LIMIT 1`
    );

    if (usuarios.length === 0) {
        const senhaHash =
            await bcrypt.hash("admin123", 10);

        const respostaHash =
            await bcrypt.hash("cozinha", 10);

        await pool.query(
            `INSERT INTO usuarios
                (
                    usuario,
                    senha_hash,
                    pergunta_seguranca,
                    resposta_hash
                )
             VALUES (?, ?, ?, ?)`,
            [
                "admin",
                senhaHash,
                "Qual local você trabalha da cantina??",
                respostaHash
            ]
        );

        console.log(
            "Administrador criado."
        );
    }
}

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", async (req, res) => {
    try {
        const {
            usuario,
            senha
        } = req.body;

        if (!usuario || !senha) {
            return res.status(400).json({
                erro: "Informe usuário e senha."
            });
        }

        const [usuarios] = await pool.query(
            `SELECT *
             FROM usuarios
             WHERE usuario = ?
             LIMIT 1`,
            [usuario]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                erro: "Usuário ou senha inválidos."
            });
        }

        const usuarioBanco =
            usuarios[0];

        const senhaCorreta =
            await bcrypt.compare(
                senha,
                usuarioBanco.senha_hash
            );

        if (!senhaCorreta) {
            return res.status(401).json({
                erro: "Usuário ou senha inválidos."
            });
        }

        req.session.usuarioId =
            usuarioBanco.id;

        req.session.usuario =
            usuarioBanco.usuario;

        await verificarResetSemanal();

        atualizarRelatorioMesAtual()
            .catch(erro =>
                console.error(
                    "Erro ao atualizar relatório mensal:",
                    erro
                )
            );

        res.json({
            sucesso: true,
            usuario: usuarioBanco.usuario,
            semana: semanaAtual()
        });

    } catch (erro) {
        console.error(erro);

        res.status(500).json({
            erro: "Erro interno no login."
        });
    }
});

// ======================================================
// SESSÃO
// ======================================================

app.get("/api/sessao", async (req, res) => {
    try {
        if (!req.session || !req.session.usuarioId) {
            return res.json({
                logado: false
            });
        }

        await verificarResetSemanal();

        atualizarRelatorioMesAtual()
            .catch(erro =>
                console.error(
                    "Erro ao atualizar relatório mensal:",
                    erro
                )
            );

        res.json({
            logado: true,
            usuario: req.session.usuario,
            semana: semanaAtual()
        });

    } catch (erro) {
        console.error(erro);

        res.status(500).json({
            erro: "Erro ao verificar sessão."
        });
    }
});

// ======================================================
// LOGOUT
// ======================================================

app.post("/api/logout", (req, res) => {
    req.session = null;

    res.json({
        sucesso: true
    });
});

// ======================================================
// TROCA DE SENHA
// ======================================================

app.post(
    "/api/trocar-senha",
    autenticado,
    async (req, res) => {
        try {
            const {
                senhaAtual,
                novaSenha
            } = req.body;

            if (!senhaAtual || !novaSenha) {
                return res.status(400).json({
                    erro:
                        "Preencha a senha atual e a nova senha."
                });
            }

            if (novaSenha.length < 6) {
                return res.status(400).json({
                    erro:
                        "A nova senha precisa ter pelo menos 6 caracteres."
                });
            }

            const [usuarios] =
                await pool.query(
                    `SELECT *
                     FROM usuarios
                     WHERE id = ?
                     LIMIT 1`,
                    [req.session.usuarioId]
                );

            if (usuarios.length === 0) {
                return res.status(404).json({
                    erro: "Usuário não encontrado."
                });
            }

            const usuarioBanco =
                usuarios[0];

            const senhaCorreta =
                await bcrypt.compare(
                    senhaAtual,
                    usuarioBanco.senha_hash
                );

            if (!senhaCorreta) {
                return res.status(401).json({
                    erro:
                        "A senha atual está incorreta."
                });
            }

            const novaSenhaHash =
                await bcrypt.hash(
                    novaSenha,
                    10
                );

            await pool.query(
                `UPDATE usuarios
                 SET senha_hash = ?
                 WHERE id = ?`,
                [
                    novaSenhaHash,
                    usuarioBanco.id
                ]
            );

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao trocar a senha."
            });
        }
    }
);

// ======================================================
// TROCAR USUÁRIO
// ======================================================

app.post(
    "/api/trocar-usuario",
    autenticado,
    async (req, res) => {
        try {
            const {
                senhaAtual,
                novoUsuario
            } = req.body;

            if (!senhaAtual || !novoUsuario) {
                return res.status(400).json({
                    erro:
                        "Preencha a senha atual e o novo usuário."
                });
            }

            const usuarioFinal =
                novoUsuario.trim();

            if (usuarioFinal.length < 3) {
                return res.status(400).json({
                    erro:
                        "O novo usuário precisa ter pelo menos 3 caracteres."
                });
            }

            const [usuarios] =
                await pool.query(
                    `SELECT *
                     FROM usuarios
                     WHERE id = ?
                     LIMIT 1`,
                    [req.session.usuarioId]
                );

            if (usuarios.length === 0) {
                return res.status(404).json({
                    erro: "Usuário não encontrado."
                });
            }

            const usuarioBanco =
                usuarios[0];

            const senhaCorreta =
                await bcrypt.compare(
                    senhaAtual,
                    usuarioBanco.senha_hash
                );

            if (!senhaCorreta) {
                return res.status(401).json({
                    erro:
                        "A senha atual está incorreta."
                });
            }

            if (
                usuarioFinal ===
                usuarioBanco.usuario
            ) {
                return res.status(400).json({
                    erro:
                        "Esse já é o seu usuário atual."
                });
            }

            const [existentes] =
                await pool.query(
                    `SELECT id
                     FROM usuarios
                     WHERE usuario = ?
                       AND id != ?
                     LIMIT 1`,
                    [
                        usuarioFinal,
                        usuarioBanco.id
                    ]
                );

            if (existentes.length > 0) {
                return res.status(400).json({
                    erro:
                        "Esse nome de usuário já está em uso."
                });
            }

            await pool.query(
                `UPDATE usuarios
                 SET usuario = ?
                 WHERE id = ?`,
                [
                    usuarioFinal,
                    usuarioBanco.id
                ]
            );

            req.session.usuario =
                usuarioFinal;

            res.json({
                sucesso: true,
                usuario: usuarioFinal
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao trocar o usuário."
            });
        }
    }
);

// ======================================================
// PERGUNTA DE SEGURANÇA
// ======================================================

app.post(
    "/api/pergunta-seguranca",
    autenticado,
    async (req, res) => {
        try {
            const {
                senhaAtual,
                pergunta,
                resposta
            } = req.body;

            if (
                !senhaAtual ||
                !pergunta ||
                !resposta
            ) {
                return res.status(400).json({
                    erro:
                        "Preencha todos os campos."
                });
            }

            const [usuarios] =
                await pool.query(
                    `SELECT *
                     FROM usuarios
                     WHERE id = ?
                     LIMIT 1`,
                    [req.session.usuarioId]
                );

            if (usuarios.length === 0) {
                return res.status(404).json({
                    erro: "Usuário não encontrado."
                });
            }

            const usuarioBanco =
                usuarios[0];

            const senhaCorreta =
                await bcrypt.compare(
                    senhaAtual,
                    usuarioBanco.senha_hash
                );

            if (!senhaCorreta) {
                return res.status(401).json({
                    erro:
                        "A senha atual está incorreta."
                });
            }

            const respostaHash =
                await bcrypt.hash(
                    resposta
                        .trim()
                        .toLowerCase(),
                    10
                );

            await pool.query(
                `UPDATE usuarios
                 SET pergunta_seguranca = ?,
                     resposta_hash = ?
                 WHERE id = ?`,
                [
                    pergunta.trim(),
                    respostaHash,
                    usuarioBanco.id
                ]
            );

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao salvar a pergunta de segurança."
            });
        }
    }
);

// ======================================================
// ESQUECEU A SENHA
// ======================================================

app.get(
    "/api/pergunta-seguranca/:usuario",
    async (req, res) => {
        try {
            const [usuarios] =
                await pool.query(
                    `SELECT pergunta_seguranca
                     FROM usuarios
                     WHERE usuario = ?
                     LIMIT 1`,
                    [req.params.usuario]
                );

            if (usuarios.length === 0) {
                return res.status(404).json({
                    erro:
                        "Usuário não encontrado."
                });
            }

            if (
                !usuarios[0]
                    .pergunta_seguranca
            ) {
                return res.status(404).json({
                    erro:
                        "Este usuário ainda não configurou uma pergunta de segurança."
                });
            }

            res.json({
                pergunta:
                    usuarios[0]
                        .pergunta_seguranca
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao buscar a pergunta de segurança."
            });
        }
    }
);

app.post(
    "/api/recuperar-senha",
    async (req, res) => {
        try {
            const {
                usuario,
                resposta,
                novaSenha
            } = req.body;

            if (
                !usuario ||
                !resposta ||
                !novaSenha
            ) {
                return res.status(400).json({
                    erro:
                        "Preencha todos os campos."
                });
            }

            if (novaSenha.length < 6) {
                return res.status(400).json({
                    erro:
                        "A nova senha precisa ter pelo menos 6 caracteres."
                });
            }

            const [usuarios] =
                await pool.query(
                    `SELECT *
                     FROM usuarios
                     WHERE usuario = ?
                     LIMIT 1`,
                    [usuario]
                );

            if (usuarios.length === 0) {
                return res.status(400).json({
                    erro:
                        "Não foi possível redefinir a senha."
                });
            }

            const usuarioBanco =
                usuarios[0];

            if (!usuarioBanco.resposta_hash) {
                return res.status(400).json({
                    erro:
                        "Este usuário ainda não configurou uma pergunta de segurança."
                });
            }

            const respostaCorreta =
                await bcrypt.compare(
                    resposta
                        .trim()
                        .toLowerCase(),
                    usuarioBanco.resposta_hash
                );

            if (!respostaCorreta) {
                return res.status(400).json({
                    erro:
                        "Resposta de segurança incorreta."
                });
            }

            const novaSenhaHash =
                await bcrypt.hash(
                    novaSenha,
                    10
                );

            await pool.query(
                `UPDATE usuarios
                 SET senha_hash = ?
                 WHERE id = ?`,
                [
                    novaSenhaHash,
                    usuarioBanco.id
                ]
            );

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao redefinir a senha."
            });
        }
    }
);

// ======================================================
// ITENS DO ESTOQUE
// ======================================================

app.get(
    "/api/itens",
    autenticado,
    async (req, res) => {
        try {
            await verificarResetSemanal();

            const [itens] =
                await pool.query(
                    `SELECT
                        id,
                        nome,
                        quantidade,
                        unidade
                     FROM itens
                     ORDER BY nome ASC`
                );

            res.json(itens);

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao carregar estoque."
            });
        }
    }
);

app.post(
    "/api/itens",
    autenticado,
    async (req, res) => {
        try {
            const {
                nome,
                quantidade,
                unidade
            } = req.body;

            if (!nome) {
                return res.status(400).json({
                    erro:
                        "Informe o nome do item."
                });
            }

            const qtd =
                Number(quantidade);

            if (
                !Number.isFinite(qtd) ||
                qtd < 0
            ) {
                return res.status(400).json({
                    erro:
                        "Quantidade inválida."
                });
            }

            await verificarResetSemanal();

            const semana =
                semanaAtual();

            const nomeFinal =
                nome.trim();

            const unidadeFinal =
                unidade || "un";

            await pool.query(
                `INSERT INTO itens
                    (nome, quantidade, unidade, semana)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    quantidade =
                        quantidade + VALUES(quantidade),
                    unidade =
                        VALUES(unidade),
                    semana =
                        VALUES(semana)`,
                [
                    nomeFinal,
                    qtd,
                    unidadeFinal,
                    semana
                ]
            );

            await registrarMovimentacao(
                nomeFinal,
                "entrada",
                qtd,
                unidadeFinal,
                req.session.usuario
            );

            await atualizarRelatorioMesAtual();

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao adicionar item."
            });
        }
    }
);

app.patch(
    "/api/itens/:id",
    autenticado,
    async (req, res) => {
        try {
            const id =
                Number(req.params.id);

            const {
                operacao,
                quantidade
            } = req.body;

            const qtd =
                Number(quantidade);

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    erro: "ID inválido."
                });
            }

            if (
                !Number.isFinite(qtd) ||
                qtd <= 0
            ) {
                return res.status(400).json({
                    erro:
                        "Quantidade inválida."
                });
            }

            if (
                operacao !== "somar" &&
                operacao !== "diminuir"
            ) {
                return res.status(400).json({
                    erro:
                        "Operação inválida."
                });
            }

            await verificarResetSemanal();

            const [itens] =
                await pool.query(
                    `SELECT
                        nome,
                        unidade
                     FROM itens
                     WHERE id = ?
                     LIMIT 1`,
                    [id]
                );

            if (itens.length === 0) {
                return res.status(404).json({
                    erro:
                        "Item não encontrado."
                });
            }

            const item =
                itens[0];

            if (operacao === "somar") {
                await pool.query(
                    `UPDATE itens
                     SET quantidade =
                         quantidade + ?
                     WHERE id = ?`,
                    [qtd, id]
                );

                await registrarMovimentacao(
                    item.nome,
                    "entrada",
                    qtd,
                    item.unidade,
                    req.session.usuario
                );

            } else {
                await pool.query(
                    `UPDATE itens
                     SET quantidade =
                         GREATEST(
                             quantidade - ?,
                             0
                         )
                     WHERE id = ?`,
                    [qtd, id]
                );

                await registrarMovimentacao(
                    item.nome,
                    "saida",
                    qtd,
                    item.unidade,
                    req.session.usuario
                );
            }

            await atualizarRelatorioMesAtual();

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao alterar estoque."
            });
        }
    }
);

app.delete(
    "/api/itens/:id",
    autenticado,
    async (req, res) => {
        try {
            const id =
                Number(req.params.id);

            const [itens] =
                await pool.query(
                    `SELECT
                        nome,
                        quantidade,
                        unidade
                     FROM itens
                     WHERE id = ?
                     LIMIT 1`,
                    [id]
                );

            if (itens.length === 0) {
                return res.status(404).json({
                    erro:
                        "Item não encontrado."
                });
            }

            const item =
                itens[0];

            await pool.query(
                "DELETE FROM itens WHERE id = ?",
                [id]
            );

            if (Number(item.quantidade) > 0) {
                await registrarMovimentacao(
                    item.nome,
                    "exclusao",
                    item.quantidade,
                    item.unidade,
                    req.session.usuario
                );

                await atualizarRelatorioMesAtual();
            }

            res.json({
                sucesso: true
            });

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao excluir item."
            });
        }
    }
);

// ======================================================
// RELATÓRIOS MENSAIS
// ======================================================

app.get(
    "/api/relatorios",
    autenticado,
    async (req, res) => {
        try {
            const [relatorios] =
                await pool.query(
                    `SELECT
                        mes_referencia,
                        arquivo,
                        gerado_em
                     FROM relatorios_gerados
                     ORDER BY
                        mes_referencia DESC`
                );

            res.json(relatorios);

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao listar relatórios."
            });
        }
    }
);

app.get(
    "/api/relatorios/:arquivo",
    autenticado,
    async (req, res) => {
        try {
            const {
                arquivo
            } = req.params;

            if (
                !/^relatorio-\d{4}-\d{2}\.txt$/
                    .test(arquivo)
            ) {
                return res.status(400).json({
                    erro:
                        "Arquivo inválido."
                });
            }

            const [relatorios] =
                await pool.query(
                    `SELECT conteudo
                     FROM relatorios_gerados
                     WHERE arquivo = ?
                     LIMIT 1`,
                    [arquivo]
                );

            if (relatorios.length === 0) {
                return res.status(404).json({
                    erro:
                        "Relatório não encontrado."
                });
            }

            res.setHeader(
                "Content-Type",
                "text/plain; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${arquivo}"`
            );

            res.send(
                relatorios[0].conteudo
            );

        } catch (erro) {
            console.error(erro);

            res.status(500).json({
                erro:
                    "Erro ao baixar relatório."
            });
        }
    }
);

// ======================================================
// INICIALIZAÇÃO
// ======================================================

async function iniciar() {
    try {
        await pool.query("SELECT 1");

        console.log(
            "MySQL conectado."
        );

        await garantirColunasUsuarios();
        await criarAdministrador();
        await verificarResetSemanal();
        await atualizarRelatorioMesAtual();

        console.log(
            "Sistema inicializado."
        );

    } catch (erro) {
        console.error(
            "Erro ao inicializar o sistema:"
        );

        console.error(erro);
    }
}

iniciar();

// Na Vercel a função é invocada de forma serverless (sem app.listen).
// Localmente ("npm start"), continuamos escutando a porta normalmente.
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;