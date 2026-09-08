// Faz a página "sumir" suavemente antes de navegar para outra página
// do mesmo site (usado nos links do cabeçalho, tipo "Ver estoque" e "Voltar").
function irParaComTransicao(url) {
    document.body.classList.add("saindo");

    setTimeout(function () {
        window.location.href = url;
    }, 220);
}

document.addEventListener("click", function (evento) {
    const link = evento.target.closest("a");

    if (!link) {
        return;
    }

    const href = link.getAttribute("href") || "";
    const mesmaOrigem = link.origin === window.location.origin;
    const abreNovaAba = link.target === "_blank";

    if (!mesmaOrigem || abreNovaAba || href.startsWith("#")) {
        return;
    }

    evento.preventDefault();
    irParaComTransicao(link.href);
});
