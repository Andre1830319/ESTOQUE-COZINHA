CREATE DATABASE IF NOT EXISTS estoque_cozinha
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE estoque_cozinha;

-- Usuários do sistema (agora com pergunta de segurança para recuperar a senha)
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    senha_hash VARCHAR(255) NOT NULL,
    pergunta_seguranca VARCHAR(255) NOT NULL DEFAULT '',
    resposta_hash VARCHAR(255) NOT NULL DEFAULT '',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Se o banco já existia antes dessa versão, essas duas colunas não vão
-- existir ainda. Rode as linhas abaixo manualmente nesse caso
-- (ignore os erros se as colunas já existirem):
-- ALTER TABLE usuarios ADD COLUMN pergunta_seguranca VARCHAR(255) NOT NULL DEFAULT '';
-- ALTER TABLE usuarios ADD COLUMN resposta_hash VARCHAR(255) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS itens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL UNIQUE,
    quantidade DECIMAL(10,2) NOT NULL DEFAULT 0,
    unidade VARCHAR(20) NOT NULL DEFAULT 'un',
    semana VARCHAR(20) NOT NULL DEFAULT '',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS controle_semanal (
    id INT PRIMARY KEY,
    semana VARCHAR(20) NOT NULL DEFAULT ''
);

INSERT INTO controle_semanal (id, semana)
VALUES (1, '')
ON DUPLICATE KEY UPDATE id = id;

-- Histórico de tudo que entra, sai ou é excluído do estoque.
-- É essa tabela que alimenta o relatório mensal.
CREATE TABLE IF NOT EXISTS movimentacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_nome VARCHAR(120) NOT NULL,
    tipo ENUM('entrada', 'saida', 'exclusao') NOT NULL,
    quantidade DECIMAL(10,2) NOT NULL,
    unidade VARCHAR(20) NOT NULL DEFAULT 'un',
    usuario VARCHAR(50) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Controle de quais relatórios mensais já foram gerados,
-- para o sistema não gerar o mesmo relatório duas vezes.
CREATE TABLE IF NOT EXISTS relatorios_gerados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mes_referencia VARCHAR(7) NOT NULL UNIQUE, -- formato AAAA-MM
    arquivo VARCHAR(255) NOT NULL,
    gerado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
