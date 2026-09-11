// Faz a página "sumir" suavemente antes de navegar para outra página
// do mesmo site (usado nos links do cabeçalho, tipo "Ver estoque" e "Voltar").
// Durante a troca, mostra um spinner com o logo por cima para dar
// a sensação de carregamento (delay de 1s antes de navegar de fato).

function criarOverlayTransicao() {
    let overlay = document.getElementById("overlayTransicao");

    if (overlay) {
        return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "overlayTransicao";
    overlay.className = "overlayTransicao";
    overlay.innerHTML = `
        <div class="spinnerTransicao">
            <img src="logo-transicao.png" alt="Carregando" class="logoTransicao">
        </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
}

function irParaComTransicao(url) {
    const overlay = criarOverlayTransicao();

    document.body.classList.add("saindo");

    requestAnimationFrame(function () {
        overlay.classList.add("visivel");
    });

    setTimeout(function () {
        window.location.href = url;
    }, 3000);
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
