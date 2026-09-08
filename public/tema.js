(function () {
    function aplicarIcone() {
        const botao = document.getElementById("temaToggle");
        if (!botao) {
            return;
        }

        const escuro = document.documentElement.getAttribute("data-tema") === "escuro";
        botao.textContent = escuro ? "☀️" : "🌙";
        botao.setAttribute("aria-label", escuro ? "Ativar modo claro" : "Ativar modo escuro");
    }

    document.addEventListener("DOMContentLoaded", function () {
        aplicarIcone();

        const botao = document.getElementById("temaToggle");
        if (!botao) {
            return;
        }

        botao.addEventListener("click", function () {
            const escuroAtivo = document.documentElement.getAttribute("data-tema") === "escuro";

            if (escuroAtivo) {
                document.documentElement.removeAttribute("data-tema");
                localStorage.setItem("tema", "claro");
            } else {
                document.documentElement.setAttribute("data-tema", "escuro");
                localStorage.setItem("tema", "escuro");
            }

            aplicarIcone();
        });
    });
})();
