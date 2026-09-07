"""Contrato de ida e volta das preferências.

Achado da auditoria de 2026-08-09: `aba` e `painel_vista` eram enviadas
pela interface mas não constavam da allowlist de `set_config`, que devolvia
`False` em silêncio — as duas funcionalidades de "lembrar onde o usuário
estava" nunca funcionaram em versão nenhuma.

Nenhum teste pegou porque os E2E que cobrem isso batem no mock do harness,
que aceita qualquer chave: eles provam que a interface ENVIA a chamada
certa, não que o backend a ACEITA. Este arquivo fecha o outro lado — grava
pela ponte e lê de volta por `get_estado`, sem mock no meio.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    return licitarium.Api()


# (chave, valor gravado, campo em get_estado) — toda preferência que a
# interface manda tem de sobreviver à ida e volta
@pytest.mark.parametrize("chave, valor, campo", [
    ("tema", "observatorio", "tema"),
    ("largura", "expandida", "largura"),
    ("fonte", "grande", "fonte"),
    ("densidade", "compacta", "densidade"),
    ("maximizar", "0", "maximizar"),
    ("aba", "itens", "aba"),
    ("painel_vista", "economia", "painel_vista"),
    ("ref_ordem", "nome", "ref_ordem"),
    ("limite_dispensa_compras", "70000", "limite_dispensa_compras"),
    ("limite_dispensa_obras", "140000", "limite_dispensa_obras"),
])
def test_preferencia_sobrevive_a_ida_e_volta(api, chave, valor, campo):
    assert api.set_config(chave, valor) is True
    assert api.get_estado()[campo] == valor


def test_toda_chave_que_a_interface_manda_esta_na_allowlist():
    """A allowlist e os call sites da interface não podem divergir.

    É exatamente a divergência que deixou `aba` e `painel_vista` mudas por
    versões a fio: o JS mandava, o Python recusava, ninguém via.
    """
    raiz = Path(__file__).resolve().parents[1] / "ui"
    import re
    enviadas = set()
    for arquivo in ("app.js", "painel.js"):
        texto = (raiz / arquivo).read_text(encoding="utf-8")
        enviadas |= set(re.findall(r'set_config\??\.?\(\s*"([a-z_]+)"', texto))
    assert enviadas, "nenhuma chamada encontrada — o regex ficou obsoleto"
    fora = enviadas - set(licitarium.Api.CHAVES_CONFIG)
    assert not fora, f"a interface manda chaves que o backend recusa: {fora}"


def test_chave_desconhecida_e_recusada(api):
    assert api.set_config("inventada", "x") is False
    assert "inventada" not in api.get_estado()


def test_valor_nulo_nao_finge_que_gravou(api):
    """`pncp._config(db, chave, None)` cai no ramo de LEITURA e não grava —
    devolver True ali seria dizer que gravou sem ter gravado."""
    assert api.set_config("tema", None) is False
    assert api.get_estado()["tema"] == "portal"      # o padrão, intacto
