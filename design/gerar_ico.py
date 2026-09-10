# Gera licitarium.ico multi-frame a partir da geometria T1 (tabula ansata).
# Frames 256/128/64/48/32 usam a arte completa; 24/16 usam o frame dedicado
# (sem filete, L maior). Receita: desenhar a 1024px e reduzir com LANCZOS;
# frames ordenados do maior para o menor; fundo transparente.
#
# A letra vem da MESMA fonte da marca vetorial — EB Garamond vendorizada,
# instanciada nos mesmos pesos que design/gerar_marca.py usa. Até a 1.32.0
# este arquivo desenhava com georgiab.ttf de C:/Windows/Fonts: dependia de
# uma fonte proprietária instalada na máquina de quem gerasse, e o ícone
# saía diferente da arte vetorial (que já era Georgia normal, não Bold).
from pathlib import Path

import gerar_marca as marca
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = Path(__file__).resolve().parent
RED = (139, 46, 46, 255)      # #8b2e2e
CREAM = (245, 239, 226, 255)  # #f5efe2
CREAM70 = (245, 239, 226, 178)
F = 16                        # supersample: viewBox 64 -> canvas 1024


def _fonte_pillow(peso, altura_capitular):
    """EB Garamond no peso pedido, dimensionada pela ALTURA DA CAPITULAR.

    O `size` do Pillow é o corpo (em), não a capitular — pedir size=15
    daria uma letra bem menor que 15. Aqui o corpo é calculado para que a
    capitular caia exatamente na altura pedida, que é a medida que a arte
    vetorial usa.
    """
    ttf = AQUI / f"_ebgaramond-{peso}.ttf"
    if not ttf.exists():
        f = TTFont(marca.FONTE)
        instantiateVariableFont(f, {"wght": peso}, inplace=True)
        f.save(ttf)
    tt = TTFont(ttf)
    proporcao = marca._altura_capitular(tt) / tt["head"].unitsPerEm
    return ImageFont.truetype(str(ttf), round(altura_capitular / proporcao))


def _letra_centrada(d, img, texto, fonte, centro, cor):
    """Desenha centrando pela mancha de tinta — mesma regra da arte vetorial
    (ver centrada_na_tinta em gerar_marca.py)."""
    x0, y0, x1, y1 = d.textbbox((0, 0), texto, font=fonte)
    d.text((centro[0] - (x0 + x1) / 2, centro[1] - (y0 + y1) / 2),
           texto, font=fonte, fill=cor)


def _canvas():
    img = Image.new("RGBA", (64 * F, 64 * F), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def _pt(*coords):
    return [(x * F, y * F) for x, y in coords]


def arte_completa():
    img, d = _canvas()
    d.polygon(_pt((11, 25), (3, 19), (3, 45), (11, 39)), fill=RED)
    d.polygon(_pt((53, 25), (61, 19), (61, 45), (53, 39)), fill=RED)
    d.rectangle([9 * F, 17 * F, 55 * F, 47 * F], fill=RED)
    d.rectangle([12.5 * F, 20.5 * F, 51.5 * F, 43.5 * F],
                outline=CREAM70, width=round(1.4 * F))
    fonte = _fonte_pillow(marca.PESO_ICONE, marca.CAPITULAR_ICONE * F)
    _letra_centrada(d, img, "L", fonte, (32 * F, 32 * F), CREAM)
    return img


def arte_16px():
    img, d = _canvas()
    d.polygon(_pt((10, 24), (1, 17), (1, 47), (10, 40)), fill=RED)
    d.polygon(_pt((54, 24), (63, 17), (63, 47), (54, 40)), fill=RED)
    d.rectangle([8 * F, 13 * F, 56 * F, 51 * F], fill=RED)
    fonte = _fonte_pillow(marca.PESO_MINI, marca.CAPITULAR_MINI * F)
    # branco puro: a 16px o tom creme não sobrevive e cada nível de contraste conta
    _letra_centrada(d, img, "L", fonte, (32 * F, 32 * F), (255, 255, 255, 255))
    return img


def main():
    completa, dedicada = arte_completa(), arte_16px()
    frames = [(s, completa) for s in (256, 128, 64, 48, 32)] + \
             [(s, dedicada) for s in (24, 16)]
    imgs = []
    for s, art in frames:
        im = art.resize((s, s), Image.LANCZOS)
        if s <= 24:  # frames pequenos: recuperar nitidez perdida na redução
            im = im.filter(ImageFilter.SHARPEN)
        imgs.append(im)
    # caminhos presos à pasta do script: rodar da raiz do repo já espalhou
    # .ico e previews no lugar errado
    imgs[0].save(AQUI / "licitarium.ico", format="ICO", append_images=imgs[1:])
    completa.resize((256, 256), Image.LANCZOS).save(AQUI / "icone-preview-256.png")
    dedicada.resize((16, 16), Image.LANCZOS).filter(ImageFilter.SHARPEN) \
            .resize((128, 128), Image.NEAREST) \
            .save(AQUI / "icone-preview-16x.png")  # 16px ampliado 8x p/ inspeção
    completa.resize((32, 32), Image.LANCZOS).resize((128, 128), Image.NEAREST) \
            .save(AQUI / "icone-preview-32x.png")  # 32px ampliado 4x p/ inspeção
    for temporaria in AQUI.glob("_ebgaramond-*.ttf"):
        temporaria.unlink()
    ico = Image.open(AQUI / "licitarium.ico")
    print("frames:", sorted(ico.info.get("sizes")))


if __name__ == "__main__":
    main()
