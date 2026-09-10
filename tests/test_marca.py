"""A arte da marca mora em design/*.svg e é copiada para ui/marca.js e
marca.py por design/gerar_marca.py.

Estes testes existem porque a cópia já era feita à mão, em três lugares
(ui/app.js, relatorios.py e o desenho em Pillow do gerar_ico.py), e
sincronizar dependia de alguém lembrar. Aqui a divergência falha o CI.
"""
import re
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
DESIGN = RAIZ / "design"

# fontTools só é preciso para REGERAR a marca; quem só roda o app não
# precisa dele, então os testes que regeram pulam quando ele falta
fonttools = pytest.importorskip


def _miolo(svg):
    return re.search(r"<svg[^>]*>(.*)</svg>", svg, re.DOTALL).group(1).strip("\n")


def test_marca_js_espelha_o_svg_canonico():
    marca_js = (RAIZ / "ui" / "marca.js").read_text(encoding="utf-8")
    for chave, arquivo in (("selo", "icone-t1.svg"),
                           ("estandarte", "estandarte-t3.svg")):
        esperado = _miolo((DESIGN / arquivo).read_text(encoding="utf-8"))
        assert esperado in marca_js, f"{chave} divergiu de design/{arquivo}"


def test_marca_py_espelha_o_svg_canonico():
    import marca
    corpo = _miolo((DESIGN / "estandarte-t3.svg").read_text(encoding="utf-8"))
    assert corpo in marca.ESTANDARTE
    # o relatório usa a mesma peça — sem segunda cópia no relatorios.py
    import relatorios
    assert relatorios.ESTANDARTE is marca.ESTANDARTE


def test_a_marca_nao_depende_de_fonte_instalada():
    """Nenhuma peça pode ter <text>: era assim até a 1.32.0, e num Windows
    sem Georgia a marca mudava de desenho na máquina do usuário."""
    for arquivo in ("icone-t1.svg", "icone-t1-16.svg", "estandarte-t3.svg"):
        svg = (DESIGN / arquivo).read_text(encoding="utf-8")
        assert "<text" not in svg, f"{arquivo} voltou a depender de fonte"
        assert "font-family" not in svg, arquivo


def test_manual_traz_o_mesmo_estandarte():
    """O MANUAL.html é peça avulsa e carrega a própria cópia da marca —
    era a quinta cópia, e ficou pra trás na revisão da 1.33.0 até este
    teste existir. O exergo lá usa var(--text) porque o manual tem tema."""
    manual = (RAIZ / "MANUAL.html").read_text(encoding="utf-8")
    canonico = _miolo((DESIGN / "estandarte-t3.svg").read_text(encoding="utf-8"))
    for linha in canonico.split("\n"):
        linha = linha.strip()
        if not linha or linha.startswith("<!--") or "currentColor" in linha:
            continue
        assert linha in manual, f"MANUAL.html divergiu da marca: {linha[:60]}"


def test_gerador_e_deterministico_e_esta_em_dia():
    """Rodar o gerador não pode mudar nada — se mudar, alguém editou a arte
    à mão sem regerar as cópias."""
    pytest.importorskip("fontTools")
    antes = {p: p.read_bytes() for p in
             [DESIGN / "icone-t1.svg", DESIGN / "icone-t1-16.svg",
              DESIGN / "estandarte-t3.svg", RAIZ / "ui" / "marca.js",
              RAIZ / "marca.py"]}
    r = subprocess.run([sys.executable, str(DESIGN / "gerar_marca.py")],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    divergiu = [p.name for p, b in antes.items() if p.read_bytes() != b]
    assert not divergiu, f"regerar mudou {divergiu} — arte editada à mão?"
