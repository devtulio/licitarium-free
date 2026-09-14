# Gera design/splash_boot.png — mostrada pelo bootloader do PyInstaller
# ENQUANTO ele extrai a runtime pra %TEMP% (antes de qualquer código Python
# rodar), pedido do usuário (2026-09-14): sem isso, os ~2-4s de extração do
# onefile passam em silêncio, sem nenhum feedback.
#
# Deliberadamente NEUTRA — sem marca/selo/tema: uma splash com a "moldura"
# do app apareceria ANTES da splash temática de verdade (`ui/index.html`),
# dando a impressão de duas aberturas em sequência (motivo registrado em
# `Licitarium.spec` pra nunca ter usado Splash() do PyInstaller antes). Uma
# tela simples e genérica não compete com a identidade visual do app — lê
# como "o sistema operacional preparando algo", não como "o app abriu".
from PIL import Image, ImageDraw, ImageFont

L, A = 360, 140
F = 4  # supersample

FUNDO = (245, 245, 246, 255)
BORDA = (214, 216, 219, 255)
TEXTO = (74, 78, 84, 255)
TRILHO = (222, 224, 227, 255)
BARRA = (150, 154, 160, 255)

SEGOE = "C:/Windows/Fonts/segoeui.ttf"


def desenhar():
    img = Image.new("RGBA", (L * F, A * F), FUNDO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, L * F - 1, A * F - 1], outline=BORDA, width=F)

    fonte = ImageFont.truetype(SEGOE, 15 * F)
    texto = "Preparando ambiente…"
    bbox = d.textbbox((0, 0), texto, font=fonte)
    tx = (L * F - (bbox[2] - bbox[0])) / 2
    ty = A * F / 2 - 10 * F
    d.text((tx, ty), texto, font=fonte, fill=TEXTO)

    # trilho estático (a extração não reporta progresso real pro bootloader
    # mostrar barra de verdade — mesmo raciocínio de design/gerar_splash.py)
    bw = 160 * F
    bx0 = (L * F - bw) / 2
    by = A * F / 2 + 18 * F
    d.rounded_rectangle([bx0, by, bx0 + bw, by + 3 * F], radius=2 * F,
                        fill=TRILHO)
    d.rounded_rectangle([bx0, by, bx0 + bw * 0.4, by + 3 * F], radius=2 * F,
                        fill=BARRA)

    return img.resize((L, A), Image.LANCZOS)


if __name__ == "__main__":
    img = desenhar()
    img.convert("RGB").save("splash_boot.png")
    print("splash_boot.png", img.size)
