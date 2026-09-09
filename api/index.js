// A Vercel detecta automaticamente qualquer arquivo dentro de /api como
// uma função serverless, usando seu empacotador padrão (mais confiável
// que o formato antigo "builds"/"routes"). Aqui só reaproveitamos o
// app do server.js que já existe na raiz do projeto.
module.exports = require("../server.js");
