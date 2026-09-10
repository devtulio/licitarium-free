"""Gera as peças vetoriais da marca do Licitarium.

Por que um gerador, e não SVG editado à mão: as letras da marca deixaram
de ser `<text font-family="Georgia">` e passaram a ser **contorno vetorial**
(v1.33.0). Isso tira a dependência de fonte instalada — antes, num Windows
sem Georgia, o L do ícone e as inscrições do estandarte caíam num fallback
qualquer — e permite controlar a inscrição sem `textLength`, que distorcia
os glifos para caber.

A fonte é a **EB Garamond** já vendorizada em `ui/fonts/` (SIL OFL, que
permite vetorizar e redistribuir). Georgia e Palatino renderizam melhor no
tamanho pequeno, mas são proprietárias: embarcar contorno delas num repo
MIT público seria risco de licença.

Uso:  python design/gerar_marca.py
Saída: design/icone-t1.svg, icone-t1-16.svg, estandarte-t3.svg
"""
from pathlib import Path

from fontTools.misc.transform import Identity
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

RAIZ = Path(__file__).resolve().parent.parent
FONTE = RAIZ / "ui" / "fonts" / "eb-garamond-variable.woff2"

# Paleta da marca (IDENTIDADE.md §4) — fixa, não segue tema.
SINETE = "#8b2e2e"      # vermelho-sinete
DOURADO = "#b08d3e"     # bronze/latão
PEDRA = "#ded5c2"       # calcário das placas
TINTA = "#2b2115"       # tinta sobre pedra
CREME = "#f5efe2"       # pergaminho

# O peso da letra é decisão ótica, medida em render (não no código): 600
# sustenta o traço fino da Garamond nos frames >= 32 px; os frames 16/24
# precisam de 700, porque ali o traço fino simplesmente some.
PESO_ICONE = 600
# 800 (topo do eixo) no frame de 16/24: a arte anterior usava Georgia Bold
# ali, e no 16 px cada nível de massa conta.
PESO_MINI = 800

# Altura da capitular em cada arte, em unidades do viewBox de 64.
# O 30 do frame mini não é gosto: medindo a fração de pixels de letra que
# sobrevive à redução para 16 px, a Georgia Bold antiga entregava 13,5% e a
# EB Garamond 800 só alcança isso perto de 30 — ela é uma old-style de
# traço leve, e nem o bold dela tem a massa de uma Georgia Bold. Como a arte
# mini já abre mão do filete para ganhar espaço, a letra pode ocupar quase
# toda a tabula: ali legibilidade vale mais que respiro.
CAPITULAR_ICONE = 15
CAPITULAR_MINI = 30

_fontes = {}


def _fonte(peso):
    if peso not in _fontes:
        f = TTFont(FONTE)
        instantiateVariableFont(f, {"wght": peso}, inplace=True)
        _fontes[peso] = f
    return _fontes[peso]


def _num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _altura_capitular(fonte):
    conj = fonte.getGlyphSet()
    c = BoundsPen(conj)
    conj[fonte.getBestCmap()[ord("H")]].draw(c)
    return c.bounds[3] - c.bounds[1]


def cadeia(texto, peso, altura, x=0.0, base=0.0, tracking=0.0):
    """Texto -> path SVG. `base` é a linha de base; `altura` é a altura da
    capitular. Devolve (d, largura) — a largura sai medida, não imposta."""
    fonte = _fonte(peso)
    conj, cmap = fonte.getGlyphSet(), fonte.getBestCmap()
    escala = altura / _altura_capitular(fonte)
    caneta = SVGPathPen(conj, ntos=_num)
    cursor = x
    for ch in texto:
        nome = cmap.get(ord(ch))
        if nome is None:                      # glifo ausente: reserva o espaço
            cursor += altura * 0.3 + tracking
            continue
        glifo = conj[nome]
        glifo.draw(TransformPen(caneta,
                                Identity.translate(cursor, base).scale(escala, -escala)))
        cursor += glifo.width * escala + tracking
    return caneta.getCommands(), (cursor - tracking - x if texto else 0.0)


def centrada(texto, peso, altura, centro_x, base, tracking=0.0):
    """Mesma coisa, centrada em `centro_x` — sem distorcer o glifo."""
    _, largura = cadeia(texto, peso, altura, tracking=tracking)
    return cadeia(texto, peso, altura, x=centro_x - largura / 2,
                  base=base, tracking=tracking)[0], largura


def centrada_na_tinta(texto, peso, altura, centro_x, base):
    """Centra pela mancha de tinta, não pelo avanço.

    O avanço de um glifo inclui o espaço lateral que a fonte reserva para o
    texto corrido — e o L da Garamond reserva bem mais à direita que à
    esquerda. Centrar por ele deixa a letra visivelmente encostada num lado
    quando ela está sozinha num brasão.
    """
    fonte = _fonte(peso)
    conj, cmap = fonte.getGlyphSet(), fonte.getBestCmap()
    escala = altura / _altura_capitular(fonte)
    caixa = BoundsPen(conj)
    conj[cmap[ord(texto)]].draw(caixa)
    x0, _, x1, _ = caixa.bounds
    meio_tinta = (x0 + x1) / 2 * escala
    return cadeia(texto, peso, altura, x=centro_x - meio_tinta, base=base)[0]


def _largura_unitaria(texto, peso, tracking_rel):
    """Largura da cadeia com capitular = 1 — o fator que converte corpo em
    largura. `tracking_rel` é o espacejamento em frações da capitular."""
    _, w = cadeia(texto, peso, altura=1.0, tracking=tracking_rel)
    return w


def ajustada(texto, peso, largura_alvo, centro_x, base_relativa, topo,
             tracking_rel=0.0, teto=None):
    """Compõe a inscrição resolvendo o corpo a partir da largura disponível.

    Nasce de um erro: ao tirar o `textLength`, as inscrições passaram a sair
    na medida real do desenho e transbordaram a pedra. Fixar o corpo à mão
    quebra de novo a cada troca de texto (o nome do município, por exemplo);
    derivar da largura não quebra.

    `base_relativa` é a linha de base como fração da capitular abaixo de
    `topo` — 1.0 significa "a base fica uma capitular abaixo do topo".
    """
    unitaria = _largura_unitaria(texto, peso, tracking_rel)
    altura = largura_alvo / unitaria
    if teto is not None:
        altura = min(altura, teto)
    d, largura = centrada(texto, peso, altura, centro_x,
                          base=topo + altura * base_relativa,
                          tracking=altura * tracking_rel)
    return d, largura, altura


# ── ícone: tabula ansata ────────────────────────────────────────────────
# A silhueta (retângulo + ansae em cauda de andorinha) é o que identifica o
# ícone na barra de tarefas antes de qualquer cor — por isso não muda.
def icone():
    # o vão dentro do filete tem 23 de altura (20,5..43,5); a capitular fica
    # menor que isso para sobrar respiro em cima e embaixo, e é centrada nele
    d = centrada_na_tinta("L", PESO_ICONE, altura=CAPITULAR_ICONE, centro_x=32,
                          base=32 + CAPITULAR_ICONE / 2)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Licitarium — ícone oficial: tabula ansata (frames >= 32px).
       Gerado por design/gerar_marca.py; L em contorno, sem dependência de fonte. -->
  <polygon points="11,25 3,19 3,45 11,39" fill="{SINETE}"/>
  <polygon points="53,25 61,19 61,45 53,39" fill="{SINETE}"/>
  <rect x="9" y="17" width="46" height="30" fill="{SINETE}"/>
  <rect x="12.5" y="20.5" width="39" height="23" fill="none" stroke="{CREME}"
        stroke-width="1.4" opacity=".7"/>
  <path d="{d}" fill="{CREME}"/>
</svg>
"""


def icone_mini():
    # sem filete, a letra ocupa quase toda a tabula de 38 de altura
    d = centrada_na_tinta("L", PESO_MINI, altura=CAPITULAR_MINI, centro_x=32,
                          base=32 + CAPITULAR_MINI / 2)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Licitarium — frame dedicado 16/24px: tabula cheia, sem filete, L máximo.
       O filete e a folga viram ruído abaixo de 32px; aqui a legibilidade manda. -->
  <polygon points="10,24 1,17 1,47 10,40" fill="{SINETE}"/>
  <polygon points="54,24 63,17 63,47 54,40" fill="{SINETE}"/>
  <rect x="8" y="13" width="48" height="38" fill="{SINETE}"/>
  <path d="{d}" fill="{CREME}"/>
</svg>
"""


# ── estandarte (signum): tabula montada na hasta ────────────────────────
def estandarte():
    # A pedra vai de x=11 a x=53 (42 de largura). As inscrições ocupam 36,
    # deixando 3 de margem de cada lado — a epigrafia romana também
    # reservava margem, a inscrição nunca encostava na borda da placa.
    nome, _, _ = ajustada("LICITARIVM", 500, largura_alvo=36, centro_x=32,
                          topo=21.6, base_relativa=1.0, tracking_rel=0.11)
    divisa, _, _ = ajustada("SVB · HASTA · PVBLICA", 500, largura_alvo=34,
                            centro_x=32, topo=31.9, base_relativa=1.0,
                            tracking_rel=0.06)
    # o exergo é gravado no suporte, fora da pedra: largura menor, e teto de
    # corpo para não competir com o nome
    exergo, _, _ = ajustada("MMXXVI", 500, largura_alvo=22, centro_x=32,
                            topo=58.6, base_relativa=1.0, tracking_rel=0.14,
                            teto=4.0)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Licitarium — marca de apresentação: estandarte (signum) com tabula ansata.
       Gerado por design/gerar_marca.py; inscrições em contorno.
       O exergo usa currentColor: é inscrito no suporte, não na pedra, e em
       tinta fixa ele sumia no fundo escuro do Observatório (achado da 1.1.0). -->
  <line x1="32" y1="57" x2="32" y2="15" stroke="{DOURADO}" stroke-width="2.6"
        stroke-linecap="round"/>
  <ellipse cx="32" cy="10.5" rx="2.3" ry="5" fill="{DOURADO}"/>
  <polygon points="12,25.5 5,21 5,37 12,32.5" fill="{PEDRA}" stroke="{TINTA}"
           stroke-width="1.6"/>
  <polygon points="52,25.5 59,21 59,37 52,32.5" fill="{PEDRA}" stroke="{TINTA}"
           stroke-width="1.6"/>
  <rect x="11" y="19" width="42" height="20" fill="{PEDRA}" stroke="{TINTA}"
        stroke-width="1.6"/>
  <path d="{nome}" fill="{TINTA}"/>
  <path d="{divisa}" fill="{SINETE}"/>
  <line x1="20" y1="57.5" x2="44" y2="57.5" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" opacity=".85"/>
  <path d="{exergo}" fill="currentColor" opacity=".85"/>
</svg>
"""


PECAS = {
    "icone-t1.svg": icone,
    "icone-t1-16.svg": icone_mini,
    "estandarte-t3.svg": estandarte,
}


# ── cópias derivadas ────────────────────────────────────────────────────
# A mesma arte era mantida à mão em três lugares (design/*.svg, ui/app.js e
# relatorios.py). O comentário em relatorios.py já dizia "fonte da verdade:
# design/estandarte-t3.svg" — ou seja, a duplicação era conhecida e
# dependia de alguém lembrar de sincronizar. Agora as cópias saem daqui, e
# tests/test_marca.py falha se alguém editar uma sem regerar.
import re


def _miolo(svg):
    """Conteúdo entre <svg> e </svg>, sem o cabeçalho XML."""
    corpo = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.DOTALL).group(1)
    return corpo.strip("\n")


CABECALHO = ("// GERADO por design/gerar_marca.py — não editar à mão.\n"
             "// A arte canônica vive em design/*.svg; este arquivo é cópia\n"
             "// derivada, e tests/test_marca.py trava as duas juntas.\n")


def marca_js(pecas):
    selo = _miolo(pecas["icone-t1.svg"])
    est = _miolo(pecas["estandarte-t3.svg"])
    return (CABECALHO +
            f"const MARCA = {{\n  selo: `{selo}`,\n  estandarte: `{est}`,\n}};\n")


def marca_py(pecas):
    est = pecas["estandarte-t3.svg"]
    est = re.sub(r"<svg[^>]*>",
                 '<svg viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">',
                 est, count=1).strip()
    return (CABECALHO.replace("//", "#") +
            '"""Arte da marca usada no documento impresso."""\n\n'
            f'ESTANDARTE = """{est}"""\n')


DERIVADAS = {
    Path("ui") / "marca.js": marca_js,
    Path("marca.py"): marca_py,
}


def main():
    destino = Path(__file__).resolve().parent
    pecas = {}
    for nome, fabrica in PECAS.items():
        pecas[nome] = fabrica()
        (destino / nome).write_text(pecas[nome], encoding="utf-8")
        print("escrito design/" + nome)
    for rel, fabrica in DERIVADAS.items():
        (RAIZ / rel).write_text(fabrica(pecas), encoding="utf-8")
        print("escrito", rel.as_posix())


if __name__ == "__main__":
    main()
