"""Testes da pesquisa de preços e municípios de referência (Api), portados
do Pretiarium Free.
"""
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium
import pncp


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "p.db")
    db = licitarium.abrir_db()
    pncp._config(db, "municipio_ibge", "3550308")
    pncp._config(db, "municipio_nome", "São Paulo")
    itens = [
        # id, contratacao_controle, descricao, unidade, valor_unit_homolog,
        # fornecedor_ni, fornecedor_nome, referencia, municipio_ibge
        ("A#1", "A", "PAPEL SULFITE A4", "RESMA", 25.0, "1", "Fornecedor A",
         0, "3550308"),
        ("A#2", "A", "PAPEL SULFITE A4", "CX", 250.0, "2", "Fornecedor B",
         0, "3550308"),
        ("B#1", "B", "CANETA ESFEROGRAFICA AZUL", "UN", 1.5, "1",
         "Fornecedor A", 0, "3550308"),
        ("C#1", "C", "PAPEL SULFITE A4", "RESMA", 22.0, "3", "Fornecedor C",
         1, "3536604"),
    ]
    for id_, cc, desc, un, val, ni, nome, ref, ibge in itens:
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, numero_item,"
            " descricao, unidade, valor_unitario_homologado, fornecedor_ni,"
            " fornecedor_nome, tem_resultado, referencia, municipio_ibge,"
            " ano) VALUES (?,?,1,?,?,?,?,?,1,?,?,2026)",
            (id_, cc, desc, un, val, ni, nome, ref, ibge))
    db.commit()
    db.close()
    return licitarium.Api()


# ── descartes ────────────────────────────────────────────────────────────

def test_descartar_preco_e_listar_descartes(api):
    assert api.descartar_preco("papel a4", "A#1", "excessivo") == {"ok": True}
    d = api.descartes("papel a4")
    assert len(d) == 1
    assert d[0]["item_id"] == "A#1" and d[0]["motivo"] == "excessivo"
    # busca com espaços/maiúsculas extras é a mesma pesquisa (chave_termo)
    assert api.descartes("  Papel A4 ") == d


def test_descartar_sem_item_id_recusa(api):
    assert api.descartar_preco("papel a4", None) == {"ok": False}


def test_motivos_descarte_lista_rotulos(api):
    m = api.motivos_descarte()
    ids = [x["id"] for x in m]
    assert "excessivo" in ids and "servico" in ids
    assert all("texto" in x for x in m)


# ── seleção por critério ────────────────────────────────────────────────

def test_classificar_por_unidade_seleciona_e_acumula(api):
    # "Resma" bate A#1 (próprio) e C#1 (referência) — sem filtro de origem
    r = api.classificar_por_unidade("papel a4", "Resma")
    assert r == {"ok": True, "n": 2}
    assert set(api.selecionados("papel a4")) == {"A#1", "C#1"}
    # unidade diferente ACUMULA na seleção, não substitui
    r2 = api.classificar_por_unidade("papel a4", "Caixa")
    assert r2["n"] == 1
    assert set(api.selecionados("papel a4")) == {"A#1", "A#2", "C#1"}


def test_fornecedores_pesquisa_precos_ordenado_por_frequencia(api):
    r = api.fornecedores_pesquisa_precos("papel a4")
    # os três fornecedores de PAPEL SULFITE A4 (próprio + referência), um
    # item cada — empate de frequência desempata por nome (ORDER BY n DESC, nome)
    assert [x["ni"] for x in r] == ["1", "2", "3"]


def test_selecionar_por_fornecedor(api):
    r = api.selecionar_por_fornecedor("papel a4", "1")
    assert r == {"ok": True, "n": 1}
    assert api.selecionados("papel a4") == ["A#1"]


def test_selecionar_por_faixa(api):
    r = api.selecionar_por_faixa("papel a4", minimo=100)
    assert r == {"ok": True, "n": 1}
    assert api.selecionados("papel a4") == ["A#2"]


def test_selecionar_por_faixa_sem_limites_recusa(api):
    assert api.selecionar_por_faixa("papel a4") == {"ok": False}


def test_selecionar_por_texto(api):
    r = api.selecionar_por_texto("papel a4", "sulfite")
    assert r["n"] == 3   # A#1, A#2 (próprio) + C#1 (referência)
    r2 = api.selecionar_por_texto("papel a4", "inexistente")
    assert r2["n"] == 0


def test_selecionar_e_desselecionar_preco_desfaz_descarte(api):
    api.descartar_preco("papel a4", "A#1", "excessivo")
    assert len(api.descartes("papel a4")) == 1
    assert api.selecionar_preco("papel a4", "A#1") == {"ok": True}
    # reconsiderar limpa o descarte
    assert api.descartes("papel a4") == []
    assert api.selecionados("papel a4") == ["A#1"]
    assert api.desselecionar_preco("papel a4", "A#1") == {"ok": True}
    assert api.selecionados("papel a4") == []


def test_desselecionar_sem_item_limpa_tudo(api):
    api.selecionar_preco("papel a4", "A#1")
    api.selecionar_preco("papel a4", "A#2")
    assert len(api.selecionados("papel a4")) == 2
    api.desselecionar_preco("papel a4")
    assert api.selecionados("papel a4") == []


def test_selecionar_todos_precos_reseta_descartes_fora_do_recorte(api):
    api.descartar_preco("papel a4", "A#1", "excessivo")
    r = api.selecionar_todos_precos("papel a4")
    # PAPEL SULFITE A4 tem 3 itens no total (A#1, A#2, C#1 referência)
    assert r["n"] == 3
    assert api.descartes("papel a4") == []
    assert set(api.selecionados("papel a4")) == {"A#1", "A#2", "C#1"}


def test_selecionar_por_faixa_com_origem_proprio_exclui_referencia(api):
    r = api.selecionar_por_faixa("papel a4", maximo=30, origem="proprio")
    assert set(api.selecionados("papel a4")) == {"A#1"}  # C#1 é referência


# ── sugerir_termo (corretor de digitação) ───────────────────────────────

def test_sugerir_termo_corrige_palavra_errada(api):
    # "a4" tem menos de 3 letras — só "papl" entra na correção
    assert api.sugerir_termo("papl a4") == "PAPEL"


def test_sugerir_termo_sem_mudanca_devolve_none(api):
    # já bate com o vocabulário — nada a sugerir
    assert api.sugerir_termo("papel") is None


def test_sugerir_termo_vazio(api):
    assert api.sugerir_termo("") is None
    assert api.sugerir_termo(None) is None


# ── municípios de referência ─────────────────────────────────────────────

def test_adicionar_listar_remover_municipio_referencia(api):
    r = api.adicionar_municipio_referencia("3536604", "Orindiúva", "SP")
    assert r == {"ok": True}
    lista = api.listar_municipios_referencia()
    assert len(lista) == 1 and lista[0]["ibge"] == "3536604"
    assert lista[0]["itens"] == 1          # C#1 tem valor homologado
    assert lista[0]["status"] == "vermelho"  # nunca sincronizou

    r2 = api.remover_municipio_referencia("3536604")
    assert r2 == {"ok": True}
    assert api.listar_municipios_referencia() == []
    # itens/contratações do município de referência saem junto
    db = licitarium.abrir_db()
    try:
        assert db.execute(
            "SELECT COUNT(*) FROM itens WHERE municipio_ibge='3536604'"
        ).fetchone()[0] == 0
    finally:
        db.close()


def test_adicionar_municipio_igual_ao_proprio_recusa(api):
    r = api.adicionar_municipio_referencia("3550308", "São Paulo", "SP")
    assert r["ok"] is False


def test_remover_municipio_referencia_recusa_com_sync_ativo(api):
    api._sync_ativo.acquire()
    try:
        r = api.remover_municipio_referencia("3536604")
        assert r == {"ok": False, "erro": licitarium.MSG_SYNC_ATIVO}
    finally:
        api._sync_ativo.release()


def test_estimar_municipio_referencia(api, monkeypatch):
    monkeypatch.setattr(pncp, "estimar_volume",
                        lambda codigo, **kw: {"contratacoes": 10, "mb": 1.0})
    assert api.estimar_municipio_referencia("3536604") == \
        {"contratacoes": 10, "mb": 1.0}


def test_estimar_municipio_referencia_propaga_erro_do_pncp(api, monkeypatch):
    def falha(codigo, **kw):
        raise pncp.PncpErro("portal fora do ar")
    monkeypatch.setattr(pncp, "estimar_volume", falha)
    r = api.estimar_municipio_referencia("3536604")
    assert r == {"erro": "portal fora do ar"}


# ── sincronizar repassa escopo/ibge_escolhido ────────────────────────────

def test_sincronizar_escopo_invalido_recusa(api):
    r = api.sincronizar(escopo="chute")
    assert r == {"ok": False, "erro": "escopo inválido: 'chute'"}


# ── opções do modal de sincronização ────────────────────────────────────

def test_opcoes_sync_traz_proprio_e_referencia(api):
    api.adicionar_municipio_referencia("3536604", "Orindiúva", "SP")
    d = api.opcoes_sync()
    assert d["proprio_nome"] == "São Paulo"
    assert len(d["referencia"]) == 1
    ref = d["referencia"][0]
    assert ref == {"ibge": "3536604", "nome": "Orindiúva", "uf": "SP",
                    "nunca_sincronizado": True, "status": "vermelho"}


def test_opcoes_sync_reflete_last_sync(api):
    api.adicionar_municipio_referencia("3536604", "Orindiúva", "SP")
    db = licitarium.abrir_db()
    try:
        pncp._config(db, "last_sync_ref_3536604", "2026-09-07T10:00:00")
        db.commit()
    finally:
        db.close()
    d = api.opcoes_sync()
    assert d["referencia"][0]["nunca_sincronizado"] is False


def test_rodar_sync_repassa_escopo_e_ibge_escolhido(api, monkeypatch):
    chamadas = []

    def fake_sincronizar_tudo(db, ibge, progresso, forcado=True,
                              escopo="tudo", ibge_escolhido=None, motor=None):
        chamadas.append((ibge, forcado, escopo, ibge_escolhido))
        return {}
    monkeypatch.setattr(pncp, "sincronizar_tudo", fake_sincronizar_tudo)
    api._sync_ativo.acquire()  # _rodar_sync sempre roda com o lock preso
    api._rodar_sync(forcado=False, escopo="municipio",
                    ibge_escolhido="3536604")
    assert chamadas == [("3550308", False, "municipio", "3536604")]


# ── métodos que dependem de relatorios.py (portados) ─────────────────────

def test_estatisticas_preco(api):
    # PAPEL SULFITE A4: A#1 (25.0, RESMA), A#2 (250.0, CX), C#1 (22.0,
    # RESMA, referência) — os três entram, sem filtro de origem
    r = api.estatisticas_preco("papel a4")
    assert r["n"] == 3
    assert r["minimo"] == 22.0 and r["maximo"] == 250.0
    assert r["total"] == 3
    assert r["proprios"] == 2 and r["referencia"] == 1
    assert r["fornecedores"] == 3
    # excluir A#2 tira o valor mais alto da amostra
    r2 = api.estatisticas_preco("papel a4", excluidos=["A#2"])
    assert r2["n"] == 2 and r2["maximo"] == 25.0


def test_estatisticas_preco_respeita_filtro_de_unidade(api):
    # achado 2026-09-07: sem `unidade`, o resumo olhava o termo inteiro
    # mesmo com o filtro "Resma" ativo na tela — A#2 (CX) entrava junto
    r = api.estatisticas_preco("papel a4", unidade="Resma")
    assert r["n"] == 2          # A#1 e C#1 (RESMA) — A#2 (CX) fica fora
    assert r["maximo"] == 25.0
    assert r["total"] == 2


def test_selecionar_todos_precos_respeita_filtro_de_unidade(api):
    r = api.selecionar_todos_precos("papel a4", unidade="Resma")
    assert r == {"ok": True, "n": 2}
    assert set(api.selecionados("papel a4")) == {"A#1", "C#1"}


def test_desselecionar_preco_sem_item_respeita_filtro_de_unidade(api):
    # marca tudo (RESMA + CX), depois desmarca só o filtro "Resma" ativo
    # — o item de outra unidade selecionado antes não pode sumir junto
    api.selecionar_preco("papel a4", "A#1")
    api.selecionar_preco("papel a4", "A#2")
    api.selecionar_preco("papel a4", "C#1")
    assert api.desselecionar_preco("papel a4", unidade="Resma") == {"ok": True}
    assert api.selecionados("papel a4") == ["A#2"]


def test_dados_grafico_precos(api):
    # sem seleção prévia, exigir_selecao recusa (mensagem de erro, não 500)
    r = api.dados_grafico_precos("papel a4")
    assert r == {"ok": False,
                 "erro": "selecione na aba Preços os itens que entram na "
                         "pesquisa antes de gerar o documento"}
    # depois de selecionar, o gráfico sai com resumo + itens
    api.selecionar_todos_precos("papel a4")
    r2 = api.dados_grafico_precos("papel a4")
    assert r2["ok"] is True
    assert r2["resumo"]["n"] == 3
    assert len(r2["resumo"]["itens"]) == 3


def test_painel_precos(api):
    r = api.painel_precos()
    assert r["total"] == 4          # A#1, A#2, B#1, C#1
    assert r["homologados"] == 4
    assert r["fornecedores"] == 3
    nomes = {m["nome"] for m in r["municipios"]}
    assert "São Paulo" in nomes


def test_concentracao_fornecedores(api):
    r = api.concentracao_fornecedores("PAPEL SULFITE A4")
    assert r["total"] == 3
    assert {f["fornecedor"] for f in r["fornecedores"]} == \
        {"Fornecedor A", "Fornecedor B", "Fornecedor C"}
