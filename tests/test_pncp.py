"""Testes do motor de sync (HTTP mockado — nenhuma chamada real ao PNCP)."""
import sqlite3
import sys
import urllib.error
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium
import pncp


@pytest.fixture
def db():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(licitarium.SCHEMA)
    yield con
    con.close()


def contratacao(numero, cnpj="11111111000111", **extra):
    base = {
        "numeroControlePNCP": numero, "anoCompra": 2026, "sequencialCompra": 1,
        "orgaoEntidade": {"cnpj": cnpj, "razaoSocial": "Prefeitura Teste"},
        "unidadeOrgao": {"nomeUnidade": "Secretaria"},
        "modalidadeId": 8, "modalidadeNome": "Dispensa de licitação",
        "situacaoCompraNome": "Homologada", "objetoCompra": "Objeto de teste",
        "valorTotalEstimado": 100.0, "valorTotalHomologado": 90.0,
        "dataPublicacaoPncp": "2026-03-01", "dataAtualizacao": "2026-03-02",
    }
    base.update(extra)
    return base


def test_janelas_respeitam_limite():
    janelas = list(pncp._janelas(date(2021, 1, 1), date(2023, 6, 15)))
    assert janelas[0][0] == date(2021, 1, 1)
    assert janelas[-1][1] == date(2023, 6, 15)
    for a, b in janelas:
        assert (b - a).days < pncp.JANELA_MAX_DIAS
    # janelas contíguas, sem buraco nem sobreposição
    for (_, fim_ant), (ini_seg, _) in zip(janelas, janelas[1:]):
        assert (ini_seg - fim_ant).days == 1


def test_paginar_percorre_todas_as_paginas(monkeypatch):
    paginas = {
        1: {"data": [{"n": 1}, {"n": 2}], "totalPaginas": 2},
        2: {"data": [{"n": 3}], "totalPaginas": 2},
    }
    monkeypatch.setattr(pncp, "_get",
                        lambda caminho, params, **kw: paginas[params["pagina"]])
    itens = list(pncp._paginar("/x", {}, 50))
    assert [i["n"] for i in itens] == [1, 2, 3]


def test_paginar_sem_dados(monkeypatch):
    monkeypatch.setattr(pncp, "_get", lambda caminho, params, **kw: None)
    assert list(pncp._paginar("/x", {}, 50)) == []


def test_baixar_nao_perde_nem_duplica_consulta(monkeypatch):
    """Fases 1 e 2 baixam em paralelo: os lotes chegam fora de ordem."""
    monkeypatch.setattr(pncp, "_get", lambda caminho, params, **kw:
                        {"data": [{"de": params["q"]}], "totalPaginas": 1}
                        if params["pagina"] == 1 else None)
    consultas = [(f"r{i}", {"q": i}) for i in range(12)]
    colhido = list(pncp._baixar("/x", consultas, 50))
    assert sorted(r for r, _, _ in colhido) == sorted(r for r, _ in consultas)
    assert sorted(l[0]["de"] for _, l, _ in colhido) == list(range(12))
    assert all(e is None for _, _, e in colhido)
    # sem paralelismo o resultado é o mesmo, só que na ordem de entrada
    monkeypatch.setattr(pncp, "_paralelismo_atual", lambda: 1)
    assert [r for r, _, _ in pncp._baixar("/x", consultas, 50)] == \
        [r for r, _ in consultas]


@pytest.mark.parametrize("conexoes", [4, 1])
def test_consulta_que_falha_nao_leva_as_outras_junto(monkeypatch, conexoes):
    """Uma janela ruim entre 12 não pode descartar as 11 que responderam.

    O portal recusa em rajada (429 medido em 13 de 60 requisições em
    2026-08-14): antes, o `f.result()` de uma única consulta subia e a fase
    inteira ia embora com ele.
    """
    def fake_get(caminho, params, **kw):
        if params["q"] == 7:
            raise pncp.PncpErro("HTTP 429 em /x")
        return ({"data": [{"de": params["q"]}], "totalPaginas": 1}
                if params["pagina"] == 1 else None)
    monkeypatch.setattr(pncp, "_get", fake_get)
    monkeypatch.setattr(pncp, "_paralelismo_atual", lambda: conexoes)
    colhido = list(pncp._baixar("/x", [(f"r{i}", {"q": i}) for i in range(12)], 50))
    assert len(colhido) == 12
    falhas = {r: e for r, _, e in colhido if e}
    assert list(falhas) == ["r7"] and isinstance(falhas["r7"], pncp.PncpErro)
    assert sorted(l[0]["de"] for _, l, e in colhido if not e) == \
        [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]


def test_tamanho_de_pagina_por_endpoint(db, monkeypatch):
    """`/contratacoes/*` recusa acima de 50; contratos/atas aceitam 500.

    Medido contra a API real em 2026-08-14: com 100 o portal devolve
    `400 "Tamanho de página inválido"` nas contratações, e `/contratos`
    entrega 60 registros numa página. Trocar os dois de lugar quebraria a
    fase 1 inteira sem nenhum outro teste acusar.
    """
    vistos = []
    monkeypatch.setattr(pncp, "_get", lambda caminho, params, **kw:
                        vistos.append((caminho, params["tamanhoPagina"])))
    pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 1, 2))
    pncp.sync_contratos(db, "45148970000177", date(2026, 1, 1), date(2026, 1, 2))
    pncp.sync_atas(db, "45148970000177", date(2026, 1, 1), date(2026, 1, 2))
    por_caminho = {c: t for c, t in vistos}
    assert por_caminho["/v1/contratacoes/atualizacao"] == 50
    assert por_caminho["/v1/contratos/atualizacao"] == 500
    assert por_caminho["/v1/atas/atualizacao"] == 500


def test_baixar_rele_o_paralelismo_entre_as_levas(monkeypatch):
    """O recuo por 429 só serve se for relido no meio da fase.

    A fase 1 manda tudo numa chamada só de `_baixar`; enquanto a
    concorrência era decidida uma vez, a escada 4 → 2 → 1 nunca chegava a
    valer justamente na fase que mais dispara 429.
    """
    lidos = []
    monkeypatch.setattr(pncp, "_get", lambda caminho, params, **kw:
                        {"data": [{"de": params["q"]}], "totalPaginas": 1}
                        if params["pagina"] == 1 else None)

    def paralelismo():
        lidos.append(len(lidos))
        return 4 if len(lidos) == 1 else 1  # portal reclama depois da 1ª leva
    monkeypatch.setattr(pncp, "_paralelismo_atual", paralelismo)
    colhido = list(pncp._baixar("/x", [(f"r{i}", {"q": i}) for i in range(24)], 50))
    assert len(colhido) == 24
    # 1ª leva com 4 conexões leva 16; o resto sai de 4 em 4, já recuado
    assert len(lidos) == 3
    assert sorted(l[0]["de"] for _, l, _ in colhido) == list(range(24))


def test_falha_parcial_grava_o_que_veio_mas_nao_da_a_fase_por_completa(
        db, monkeypatch):
    """Dispensa responde, pregão eletrônico cai: o que veio tem de ficar.

    E `sincronizar_tudo` não pode carimbar `last_sync_contratacoes`, senão a
    janela do pregão vira buraco permanente no acervo.
    """
    def fake_get(caminho, params, **kw):
        if params["codigoModalidadeContratacao"] == 6:
            raise pncp.PncpErro("HTTP 500 em /v1/contratacoes/atualizacao")
        if params["codigoModalidadeContratacao"] == 8 and params["pagina"] == 1:
            return {"data": [contratacao("PNCP-1")], "totalPaginas": 1}
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    with pytest.raises(pncp.PncpErro) as exc:
        pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1))
    assert "1 de 13 consultas" in str(exc.value)
    assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 1
    assert pncp._config(db, "last_sync_contratacoes") is None


def test_sync_contratacoes_idempotente(db, monkeypatch):
    def fake_get(caminho, params, **kw):
        if params["codigoModalidadeContratacao"] == 8 and params["pagina"] == 1:
            return {"data": [contratacao("PNCP-1"), contratacao("PNCP-2")],
                    "totalPaginas": 1}
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    n1 = pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1))
    n2 = pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1))
    assert n1 == n2 == 2
    assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 2
    linha = db.execute("SELECT * FROM contratacoes WHERE numero_controle='PNCP-1'"
                       ).fetchone()
    assert linha["orgao_cnpj"] == "11111111000111"
    assert linha["valor_homologado"] == 90.0
    assert "numeroControlePNCP" in linha["raw"]


def test_descobrir_orgaos(db, monkeypatch):
    monkeypatch.setattr(pncp, "_get", lambda c, p, **kw:
        {"data": [contratacao("A", cnpj="11111111000111"),
                  contratacao("B", cnpj="22222222000122")], "totalPaginas": 1}
        if p["codigoModalidadeContratacao"] == 8 and p["pagina"] == 1 else None)
    pncp.sync_contratacoes(db, "1", date(2026, 1, 1), date(2026, 1, 2))
    pncp.descobrir_orgaos(db)
    cnpjs = {r[0] for r in db.execute("SELECT cnpj FROM orgaos")}
    assert cnpjs == {"11111111000111", "22222222000122"}
    # rodar de novo não duplica nem desfaz desativação manual
    db.execute("UPDATE orgaos SET ativo=0 WHERE cnpj='22222222000122'")
    pncp.descobrir_orgaos(db)
    assert db.execute("SELECT COUNT(*) FROM orgaos").fetchone()[0] == 2
    assert db.execute("SELECT ativo FROM orgaos WHERE cnpj='22222222000122'"
                      ).fetchone()[0] == 0


def test_sincronizar_tudo_continua_apos_falha(db, monkeypatch):
    servido = []  # 1 registro numa única janela (como na API real, em que
                  # o item só aparece na janela da sua dataAtualizacao)
    def fake_get(caminho, params, base=None, **kw):
        if base == pncp.BASE_PNCP:
            return None            # fase 3 (itens) sem dados neste teste
        if "contratos" in caminho:
            raise pncp.PncpErro("PNCP fora do ar")
        if "contratacoes" in caminho:
            if (params["codigoModalidadeContratacao"] == 8
                    and params["pagina"] == 1 and not servido):
                servido.append(1)
                return {"data": [contratacao("PNCP-1")], "totalPaginas": 1}
            return None
        return None  # atas: vazio, mas sem erro
    monkeypatch.setattr(pncp, "_get", fake_get)
    resumo = pncp.sincronizar_tudo(db, "3534203")
    assert resumo["contratacoes"] == 1
    assert resumo["contratos"] is None     # falhou, não bloqueou o resto
    assert resumo["atas"] == 0
    assert resumo["itens"] == 0            # fase 3 rodou por último
    # last_sync só avança para quem concluiu
    assert pncp._config(db, "last_sync_contratacoes") is not None
    assert pncp._config(db, "last_sync_contratos") is None
    erros = db.execute("SELECT COUNT(*) FROM sync_log WHERE status='erro'"
                       ).fetchone()[0]
    assert erros >= 1


def test_sincronizar_tudo_ignora_municipios_referencia(db, monkeypatch):
    """O Free não tem mais pesquisa de preços — linhas sobreviventes de
    `municipios_referencia` (tabela dormente, de uma versão anterior) não
    podem gerar chamada nenhuma ao PNCP por outro município."""
    db.execute("INSERT INTO municipios_referencia (ibge, nome, uf) "
               "VALUES ('3552205', 'Olímpia', 'SP')")
    db.commit()
    chamados = []
    def fake_get(caminho, params, base=None, **kw):
        if base != pncp.BASE_PNCP and "codigoMunicipioIbge" in params:
            chamados.append(params["codigoMunicipioIbge"])
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    pncp.sincronizar_tudo(db, "3534203")
    assert "3552205" not in chamados
    assert pncp._config(db, "last_sync_ref_3552205") is None


def test_sync_itens_nao_para_tudo_num_erro_de_uma_contratacao(db, monkeypatch):
    """Uma contratação com erro de rede não pode impedir as demais da fila
    de serem tentadas — mesma regra que `_baixar` já aplica na fase 1."""
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C1', 2026, 1, '111', '2026-06-05', '2026-06-05')")
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C2', 2026, 2, '111', '2026-06-01', '2026-06-01')")
    db.commit()
    item = {"numeroItem": 1, "descricao": "CANETA", "temResultado": False,
            "dataAtualizacao": "2026-06-01"}

    def fake_get(caminho, params, base=None, **kw):
        if "/1/itens" in caminho:            # C1 (sequencial=1): fora do ar
            raise pncp.PncpErro("PNCP fora do ar")
        if caminho.endswith("/itens"):        # C2 (sequencial=2): ok
            return [item] if params.get("pagina") == 1 else []
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)

    # C1 vem primeiro na fila (data_publicacao mais recente); mesmo assim
    # C2 tem que ser tentada e gravada
    with pytest.raises(pncp.PncpErro, match="1 itens gravados"):
        pncp.sync_itens(db)
    assert db.execute("SELECT COUNT(*) FROM itens WHERE"
                      " contratacao_controle='C2'").fetchone()[0] == 1
    versoes = dict(db.execute(
        "SELECT numero_controle, itens_versao FROM contratacoes"))
    assert versoes["C1"] is None       # continua pendente, tenta de novo
    assert versoes["C2"] == "2026-06-01"


def test_watermark_contratos_e_por_cnpj(db, monkeypatch):
    """Antes, `last_sync_contratos` era uma chave só pra todos os órgãos: um
    CNPJ birrento travava a janela de todo mundo para sempre. Agora cada
    CNPJ tem seu próprio marcador."""
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, orgao_cnpj,"
        " orgao_nome, data_publicacao, referencia)"
        " VALUES ('C1', 2026, 'BOM', 'Órgão Bom', '2026-01-01', 0)")
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, orgao_cnpj,"
        " orgao_nome, data_publicacao, referencia)"
        " VALUES ('C2', 2026, 'RUIM', 'Órgão Ruim', '2026-01-01', 0)")
    db.commit()
    pncp.descobrir_orgaos(db)

    janelas_bom = []
    def fake_get(caminho, params, base=None, **kw):
        if base == pncp.BASE_PNCP or "contratacoes" in caminho:
            return None       # fase 1 e itens: sem novidade neste teste
        if "contratos" in caminho:
            if params["cnpjOrgao"] == "RUIM":
                raise pncp.PncpErro("PNCP fora do ar")
            janelas_bom.append(params["dataInicial"])
            return None
        return None            # atas/pca: vazio
    monkeypatch.setattr(pncp, "_get", fake_get)

    pncp.sincronizar_tudo(db, "3534203")
    n1 = len(janelas_bom)          # janelas geradas na 1ª passada
    pncp.sincronizar_tudo(db, "3534203")

    # a ÚLTIMA janela de qualquer passada termina perto de hoje só porque
    # `_janelas` sempre fatia até `hoje` — isso não prova nada. O que
    # importa é onde a 2ª passada COMEÇA: se o watermark de BOM avançou de
    # verdade, ela não recomeça do início do PNCP outra vez.
    assert janelas_bom[0] == pncp._amd(pncp.DATA_INICIO_PNCP)
    assert janelas_bom[n1] != pncp._amd(pncp.DATA_INICIO_PNCP)


def test_sync_pca_idempotente_e_parametros(db, monkeypatch):
    """PCA achata itens do plano; endpoint usa dataInicio/dataFim."""
    params_vistos, servido = [], []
    plano = {"idPcaPncp": "111-0-000001/2026", "anoPca": 2026,
             "orgaoEntidadeCnpj": "11111111000111", "nomeUnidade": "Sec. Adm",
             "itens": [
                 {"numeroItem": 1, "descricaoItem": "Papel A4",
                  "nomeClassificacaoCatalogo": "Material",
                  "quantidadeEstimada": 100.0, "valorTotal": 2500.0},
                 {"numeroItem": 2, "descricaoItem": "Consultoria",
                  "nomeClassificacaoCatalogo": "Serviço",
                  "quantidadeEstimada": 1.0, "valorTotal": 30000.0}]}
    def fake_get(caminho, params, **kw):
        assert "pca" in caminho
        params_vistos.append(params)
        if params["pagina"] == 1 and not servido:
            servido.append(1)
            return {"data": [plano], "totalPaginas": 1}
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    n1 = pncp.sync_pca(db, "11111111000111", date(2026, 1, 1), date(2026, 2, 1))
    servido.clear()
    n2 = pncp.sync_pca(db, "11111111000111", date(2026, 1, 1), date(2026, 2, 1))
    assert n1 == n2 == 2
    assert db.execute("SELECT COUNT(*) FROM pca_itens").fetchone()[0] == 2
    linha = db.execute(
        "SELECT * FROM pca_itens WHERE id='111-0-000001/2026#1'").fetchone()
    assert linha["descricao"] == "Papel A4"
    assert linha["ano"] == 2026
    # o endpoint de PCA usa dataInicio/dataFim, não dataInicial/dataFinal
    assert all("dataInicio" in p and "dataInicial" not in p
               for p in params_vistos)


def test_sync_itens_grava_resultado_e_marca_versao(db, monkeypatch):
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C1', 2026, 30, '111', '2026-07-01', '2026-06-01')")
    db.commit()
    item = {"numeroItem": 1, "descricao": "PAPEL A4", "unidadeMedida": "RESMA",
            "quantidade": 100.0, "valorUnitarioEstimado": 24.9,
            "valorTotal": 2490.0, "temResultado": True,
            "dataAtualizacao": "2026-06-20",
            "materialOuServicoNome": "Material",
            "situacaoCompraItemNome": "Homologado"}
    resultado = {"niFornecedor": "999", "nomeRazaoSocialFornecedor": "FORN X",
                 "valorUnitarioHomologado": 18.75, "valorTotalHomologado": 1875.0,
                 "quantidadeHomologada": 100.0, "dataResultado": "2026-06-20"}

    def fake_get(caminho, params, base=None, **kw):
        assert base == pncp.BASE_PNCP
        if caminho.endswith("/resultados"):
            return [resultado]
        return [item] if params.get("pagina") == 1 else []
    monkeypatch.setattr(pncp, "_get", fake_get)

    assert pncp.sync_itens(db) == 1
    r = db.execute("SELECT * FROM itens").fetchone()
    assert r["id"] == "C1#1"
    assert r["valor_unitario_homologado"] == 18.75
    assert r["fornecedor_nome"] == "FORN X"
    assert r["descricao"] == "PAPEL A4"
    # contratação marcada com a versão coletada: não revisita sem alteração
    assert db.execute("SELECT itens_versao FROM contratacoes").fetchone()[0] \
        == "2026-07-01"
    assert pncp.sync_itens(db) == 0
    # contratação alterada no PNCP volta para a fila, mas o item continua o
    # mesmo: relê a listagem e para por aí, sem regravar nada
    db.execute("UPDATE contratacoes SET data_atualizacao='2026-07-15'")
    db.commit()
    assert pncp.sync_itens(db) == 0
    # item alterado de verdade é recoletado
    item["dataAtualizacao"] = "2026-07-14"
    item["valorUnitarioEstimado"] = 26.0
    db.execute("UPDATE contratacoes SET data_atualizacao='2026-07-16'")
    db.commit()
    assert pncp.sync_itens(db) == 1
    assert db.execute(
        "SELECT valor_unitario_estimado FROM itens").fetchone()[0] == 26.0


def test_item_inalterado_nao_custa_requisicao_nem_apaga_preco(db, monkeypatch):
    """A economia da revisita não pode custar o preço já homologado.

    `_upsert_item` é INSERT OR REPLACE: regravar um item sem ter buscado o
    resultado zeraria o valor homologado. Item inalterado é pulado inteiro.
    """
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C9', 2026, 7, '111', 'v1', '2026-01-01')")
    db.execute(
        "INSERT INTO itens (id, contratacao_controle, numero_item, descricao,"
        " data_atualizacao, tem_resultado, valor_unitario_homologado)"
        " VALUES ('C9#1', 'C9', 1, 'CANETA', '2026-05-05', 1, 3.5)")
    db.commit()
    item = {"numeroItem": 1, "descricao": "CANETA", "temResultado": True,
            "dataAtualizacao": "2026-05-05"}
    caminhos = []

    def fake_get(caminho, params, base=None, **kw):
        caminhos.append(caminho)
        if caminho.endswith("/itens"):
            return [item] if params.get("pagina") == 1 else []
        return [{"valorUnitarioHomologado": 99.0}]   # não deve ser chamado
    monkeypatch.setattr(pncp, "_get", fake_get)

    assert pncp.sync_itens(db) == 0
    assert not any(c.endswith("/resultados") for c in caminhos)
    assert db.execute(
        "SELECT valor_unitario_homologado FROM itens").fetchone()[0] == 3.5

    # resultado que faltou (coleta interrompida) é buscado mesmo com a
    # dataAtualizacao intacta — ela não muda por causa disso
    db.execute("UPDATE itens SET valor_unitario_homologado=NULL")
    db.execute("UPDATE contratacoes SET itens_versao=NULL")
    db.commit()
    assert pncp.sync_itens(db) == 1
    assert db.execute(
        "SELECT valor_unitario_homologado FROM itens").fetchone()[0] == 99.0


def test_paralelismo_recupera_depois_da_janela(monkeypatch):
    """429 da fase 1 não pode deixar a fase 3 sequencial para sempre."""
    monkeypatch.setattr(pncp, "_bloqueios", pncp.collections.deque())
    agora = [1000.0]
    monkeypatch.setattr(pncp.time, "monotonic", lambda: agora[0])

    assert pncp._paralelismo_atual() == pncp.CONEXOES_PARALELAS
    pncp._registrar_bloqueio()
    assert pncp._paralelismo_atual() == 2          # recuo intermediário
    pncp._registrar_bloqueio()
    pncp._registrar_bloqueio()
    assert pncp._paralelismo_atual() == 1          # rajada: sequencial
    agora[0] += pncp.JANELA_BLOQUEIOS + 1
    assert pncp._paralelismo_atual() == pncp.CONEXOES_PARALELAS


def test_sync_itens_sem_resultado_nao_busca_vencedor(db, monkeypatch):
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao) VALUES ('C2', 2026, 5, '111', 'x')")
    db.commit()
    caminhos = []

    def fake_get(caminho, params, base=None, **kw):
        caminhos.append(caminho)
        if caminho.endswith("/itens"):
            return ([{"numeroItem": 7, "descricao": "CANETA",
                      "temResultado": False, "valorUnitarioEstimado": 1.9}]
                    if params.get("pagina") == 1 else [])
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    assert pncp.sync_itens(db) == 1
    assert not any(c.endswith("/resultados") for c in caminhos)
    r = db.execute("SELECT * FROM itens").fetchone()
    assert r["tem_resultado"] == 0 and r["valor_unitario_homologado"] is None


def test_sync_pca_respeita_data_minima(db, monkeypatch):
    """Endpoint rejeita dataInicio < 2021-04-01; janela deve ser cortada."""
    datas = []
    monkeypatch.setattr(pncp, "_get",
                        lambda c, p, **kw: datas.append(p["dataInicio"]))
    pncp.sync_pca(db, "1", date(2021, 1, 1), date(2021, 6, 1))
    assert datas and min(datas) == "20210401"
    datas.clear()
    assert pncp.sync_pca(db, "1", date(2021, 1, 1), date(2021, 3, 1)) == 0
    assert datas == []  # janela inteira antes do mínimo: nenhuma chamada


def test_sync_incremental_com_sobreposicao(db, monkeypatch):
    """Segunda rodada parte de last_sync - 1 dia (catch-up seguro)."""
    chamadas = []
    def fake_get(caminho, params, **kw):
        if "contratacoes" in caminho:
            chamadas.append(params["dataInicial"])
        return None
    monkeypatch.setattr(pncp, "_get", fake_get)
    pncp._config(db, "last_sync_contratacoes", "2026-07-20")
    pncp.sincronizar_tudo(db, "1")
    assert chamadas and all(c == "20260719" for c in chamadas)


def test_erro_de_servidor_reduz_o_paralelismo(monkeypatch):
    """Portal sobrecarregado é pedido de trégua, não convite a insistir.

    Antes, só o 429 registrava bloqueio: diante de uma sequência de 502 o
    programa continuava atacando com quatro conexões simultâneas.
    """
    pncp._bloqueios.clear()
    assert pncp._paralelismo_atual() == pncp.CONEXOES_PARALELAS

    chamadas = []

    def falhar(req, timeout=None):
        chamadas.append(req.full_url)
        raise urllib.error.HTTPError(req.full_url, 503, "Service Unavailable",
                                     {}, None)

    monkeypatch.setattr(pncp.urllib.request, "urlopen", falhar)
    monkeypatch.setattr(pncp.time, "sleep", lambda s: None)
    with pytest.raises(pncp.PncpErro):
        pncp._get("/v1/x", {}, tentativas=3, pacing=False)

    assert len(chamadas) == 3            # tentou de novo antes de desistir
    assert len(pncp._bloqueios) >= 2     # e anotou os avisos do servidor
    assert pncp._paralelismo_atual() < pncp.CONEXOES_PARALELAS
    pncp._bloqueios.clear()


def test_backoff_tem_sorteio_para_nao_repetir_a_rajada():
    esperas = {round(pncp._espera(2), 4) for _ in range(20)}
    assert len(esperas) > 1               # não é sempre o mesmo instante
    assert all(4 <= e <= 4.5 for e in esperas)


def test_timeout_cresce_a_cada_tentativa():
    """O PNCP não recusa, demora: repetir com o mesmo prazo repete a falha."""
    assert [pncp._timeout(i) for i in range(5)] == [30, 45, 60, 75, 90]
    assert pncp._timeout(9) == 90        # não cresce para sempre


def test_erro_de_timeout_nao_fala_em_falta_de_conexao(monkeypatch):
    """"Sem conexão" mandava o usuário procurar defeito na internet dele."""
    def estourar(req, timeout=None):
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(pncp.urllib.request, "urlopen", estourar)
    monkeypatch.setattr(pncp.time, "sleep", lambda s: None)
    with pytest.raises(pncp.PncpErro) as e:
        pncp._get("/v1/x", {}, tentativas=2, pacing=False)
    assert "não respondeu" in str(e.value) and "portal" in str(e.value)
    pncp._bloqueios.clear()


def test_sync_da_abertura_respeita_intervalo_minimo(tmp_path, monkeypatch):
    """Abrir o programa cinco vezes numa hora não coleta cinco vezes."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "s.db")
    db = licitarium.abrir_db()
    chamou = []
    monkeypatch.setattr(pncp, "sync_ipca", lambda *a, **k: chamou.append("ipca"))
    monkeypatch.setattr(pncp, "sync_contratacoes",
                        lambda *a, **k: chamou.append("contratacoes") or 0)
    monkeypatch.setattr(pncp, "descobrir_orgaos", lambda db: [])
    monkeypatch.setattr(pncp, "sync_itens", lambda *a, **k: 0)
    try:
        pncp.sincronizar_tudo(db, "3534203", forcado=True)
        assert chamou, "a primeira coleta tem de rodar"

        chamou.clear()
        r = pncp.sincronizar_tudo(db, "3534203", forcado=False)
        assert r.get("pulado") is True and not chamou

        # o botão Sincronizar continua valendo sempre
        pncp.sincronizar_tudo(db, "3534203", forcado=True)
        assert chamou
    finally:
        db.close()


def test_404_na_listagem_de_itens_nao_vira_ausencia(tmp_path, monkeypatch):
    """404 sob carga é portal ocupado, não "esta contratação não tem item".

    Antes o 404 virava lista vazia, `itens_versao` era carimbado e a
    contratação NUNCA MAIS era revisitada — os preços dela sumiam do banco
    em silêncio (auditoria de falha silenciosa, 2026-08-09).
    """
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, orgao_cnpj, ano,"
               " sequencial, data_atualizacao, objeto)"
               " VALUES ('C','111',2026,7,'2026-01-01','x')")
    db.commit()

    def so_404(caminho, params, **kw):
        if "/itens" in caminho:
            raise pncp.ItensIndisponiveis("HTTP 404 em " + caminho)
        return None
    monkeypatch.setattr(pncp, "_get", so_404)

    assert pncp.sync_itens(db) == 0
    # a contratação continua pendente: itens_versao não foi carimbado
    versao = db.execute("SELECT itens_versao FROM contratacoes"
                        " WHERE numero_controle='C'").fetchone()[0]
    assert versao is None
    # e o usuário fica sabendo, em Configurações → Sincronizações recentes
    log = db.execute("SELECT status, erro FROM sync_log"
                     " WHERE tipo='itens'").fetchone()
    assert log[0] == "aviso" and "404" in log[1]
    db.close()


def test_listagem_vazia_de_verdade_carimba_normalmente(tmp_path, monkeypatch):
    """O contrário do teste acima: 204/lista vazia É ausência, e aí a
    contratação tem de ser dada por resolvida — senão o sync revisita ela
    para sempre."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t2.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, orgao_cnpj, ano,"
               " sequencial, data_atualizacao, objeto)"
               " VALUES ('C','111',2026,7,'2026-01-01','x')")
    db.commit()
    monkeypatch.setattr(pncp, "_get", lambda c, p, **kw: None)

    pncp.sync_itens(db)
    versao = db.execute("SELECT itens_versao FROM contratacoes"
                        " WHERE numero_controle='C'").fetchone()[0]
    assert versao == "2026-01-01"
    db.close()


def test_num_converte_ou_devolve_none():
    assert pncp._num(100.0) == 100.0
    assert pncp._num("90") == 90.0
    assert pncp._num("") is None
    assert pncp._num(None) is None
    assert pncp._num("não é número") is None


def test_valor_malformado_do_pncp_nao_vira_text_na_coluna_real(db, monkeypatch):
    """Sem _num(), item.get("valorTotalEstimado") gravava a string crua —
    afinidade do SQLite não converte TEXT numa coluna REAL, e o valor-lixo
    quebrava relatorios.py mais tarde (moeda(), sum() em Python, filtro
    "> 0" do SQL). "N/D" é não vazio — não pega o `or 0` que mascararia
    string vazia — e ainda assim não é número."""
    monkeypatch.setattr(pncp, "_get", lambda c, p, **kw:
        {"data": [contratacao("PNCP-X", valorTotalEstimado="N/D",
                              valorTotalHomologado=None)],
         "totalPaginas": 1} if p["pagina"] == 1 and
        p["codigoModalidadeContratacao"] == 8 else None)
    pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1))
    linha = db.execute("SELECT valor_estimado, valor_homologado FROM"
                       " contratacoes WHERE numero_controle='PNCP-X'"
                       ).fetchone()
    assert linha["valor_estimado"] is None
    assert linha["valor_homologado"] is None


# ── parada da coleta a pedido do usuário ────────────────────────────────

def test_cancelamento_interrompe_e_nao_carimba_janela(db, monkeypatch):
    """Parar no meio não pode deixar o acervo dizendo que sincronizou.

    O `last_sync_<tipo>` é o que decide de onde a próxima coleta parte:
    se ele avançasse numa coleta interrompida, a janela não coletada
    ficaria para trás em silêncio, e só reapareceria se alguém mandasse
    refazer tudo.
    """
    chamadas = []

    def fake_get(caminho, params, base=None, **kw):
        chamadas.append(caminho)
        if base == pncp.BASE_PNCP:
            return None
        if "contratacoes" in caminho and params.get("pagina") == 1:
            return {"data": [contratacao("PNCP-1")], "totalPaginas": 1}
        return None

    monkeypatch.setattr(pncp, "_get", fake_get)

    def progresso(msg):                     # para na primeira etapa
        raise pncp.SyncCancelado()

    with pytest.raises(pncp.SyncCancelado):
        pncp.sincronizar_tudo(db, "3534203", progresso)

    # nenhuma janela foi dada como concluída
    for tipo in ("contratacoes", "contratos", "atas", "itens"):
        assert pncp._config(db, f"last_sync_{tipo}") is None, tipo


def test_cancelamento_nao_e_engolido_pelo_tratamento_de_falha(db, monkeypatch):
    """SyncCancelado não pode herdar de PncpErro.

    `sincronizar_tudo` engole PncpErro de propósito, para que a falha de um
    tipo não derrube os outros. Se o cancelamento caísse nesse mesmo balde,
    a coleta seguiria para a fase seguinte em vez de parar.
    """
    assert not issubclass(pncp.SyncCancelado, pncp.PncpErro)

    monkeypatch.setattr(pncp, "_get",
                        lambda *a, **k: {"data": [], "totalPaginas": 0})
    etapas = []

    def progresso(msg):
        etapas.append(msg)
        if len(etapas) >= 2:                # deixa começar e então para
            raise pncp.SyncCancelado()

    with pytest.raises(pncp.SyncCancelado):
        pncp.sincronizar_tudo(db, "3534203", progresso)
    # parou de fato: não chegou nem perto de percorrer a coleta inteira
    assert len(etapas) == 2


def test_api_para_a_coleta_pelo_progresso(monkeypatch, tmp_path):
    """A Api levanta o cancelamento de dentro da própria função de
    progresso — é o ponto único por onde a coleta passa."""
    api = licitarium.Api()
    api._status["rodando"] = True

    # sem pedido de parada, o progresso só registra a mensagem
    api._progresso("Contratações — 1 de 3…")
    assert api._status["msg"] == "Contratações — 1 de 3…"

    r = api.parar_sync()
    assert r == {"ok": True, "rodando": True}
    with pytest.raises(pncp.SyncCancelado):
        api._progresso("Contratações — 2 de 3…")


def test_parar_sem_coleta_em_curso_nao_mente():
    api = licitarium.Api()
    assert api.parar_sync() == {"ok": False, "rodando": False}
    assert not api._sync_parar.is_set()     # não deixa armadilha armada


def test_get_404_em_listagem_falha_em_vez_de_fingir_vazio(monkeypatch):
    """Sincronizado do Licitarium Pro (2026-08-16): numa listagem de consulta
    'sem registros' é 204/corpo vazio, nunca 404 — um 404 é falha do portal.
    Com retry_404 retenta e levanta PncpErro (não deixa a marca d'água
    avançar sobre janela não baixada); sem ele, 404 continua sendo None
    (endpoints onde 404 é semântico, ex.: CNPJ inexistente)."""
    def raise_404(*a, **k):
        raise urllib.error.HTTPError("http://x", 404, "Not Found", {}, None)
    monkeypatch.setattr(pncp.urllib.request, "urlopen", raise_404)
    monkeypatch.setattr(pncp.time, "sleep", lambda *a, **k: None)  # sem espera real

    with pytest.raises(pncp.PncpErro):
        pncp._get("/v1/contratacoes", {}, tentativas=2, pacing=False, retry_404=True)
    # sem retry_404 o 404 volta a ser "sem registros" (comportamento antigo)
    assert pncp._get("/v1/orgaos/x", {}, tentativas=2, pacing=False) is None
