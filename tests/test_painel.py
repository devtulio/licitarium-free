"""Painel: os números das três vistas e o documento em A3.

O painel é a primeira tela do programa, e cada número dele vira decisão: se o
deságio, o funil ou o medidor de limite mentirem, mentem para quem assina.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium
import relatorios

ANO = 2026


def _db():
    return licitarium.abrir_db()


@pytest.fixture
def api(tmp_path, monkeypatch):
    """Dois exercícios, com dispensa, pregão, contrato e ata vencendo."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    contratacoes = [
        # (id, ano, modalidade, unidade, estimado, homologado, publicação)
        ("D1", ANO, 8, "Saúde", 30000.0, 27000.0, f"{ANO}-02-10"),
        ("D2", ANO, 8, "Saúde", 25000.0, 25000.0, f"{ANO}-03-05"),
        ("P1", ANO, 6, "Educação", 400000.0, 320000.0, f"{ANO}-03-20"),
        # sem homologação e publicada há muito tempo: é pendência
        ("P2", ANO, 6, "Educação", 90000.0, None, f"{ANO}-01-05"),
        ("D3", ANO - 1, 8, "Saúde", 20000.0, 18000.0, f"{ANO - 1}-04-01"),
    ]
    for id_, ano, mod, uni, est, hom, pub in contratacoes:
        # dispensa (mod=8) precisa de amparo legal com teto por valor
        # (art. 75, II — compras/serviços comuns) pra contar no medidor de
        # fracionamento: achado 2026-08-12, teto_da_dispensa() trata amparo
        # ausente como "sem teto" (conservador), então sem isto as dispensas
        # da fixture ficariam de fora do termômetro por padrão
        raw = '{"amparoLegal": {"nome": "Lei 14.133/2021, Art. 75, II"}}' \
            if mod == 8 else '{}'
        db.execute(
            "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
            " orgao_cnpj, unidade, modalidade_id, modalidade_nome, objeto,"
            " valor_estimado, valor_homologado, data_publicacao, referencia,"
            " raw) VALUES (?,?,1,'111',?,?,?,'Objeto',?,?,?,0,?)",
            (id_, ano, uni, mod, "Dispensa" if mod == 8 else "Pregão",
             est, hom, pub, raw))
    # item homologado: é o que faz a contratação contar como "com resultado"
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, descricao,"
               " unidade, valor_unitario_homologado, raw)"
               " VALUES ('D1#1','D1',?, 'ITEM','UN',2700.0,'{}')", (ANO,))
    venc = (date.today() + timedelta(days=20)).isoformat()
    db.execute("INSERT INTO contratos (numero_controle, contratacao_controle,"
               " orgao_cnpj, fornecedor_ni, fornecedor_nome, objeto,"
               " valor_global, vigencia_inicio, vigencia_fim, data_publicacao,"
               " raw) VALUES ('K1','D1','111','9','FORNECEDOR UM LTDA','Obj',"
               " 27000.0,?,?,?, '{}')", (f"{ANO}-01-01", venc, f"{ANO}-02-15"))
    db.execute("INSERT INTO atas (numero_controle, contratacao_controle,"
               " orgao_cnpj, numero_ata, ano_ata, objeto, vigencia_inicio,"
               " vigencia_fim, raw) VALUES ('A1','P1','111','5',?, 'Obj',?,?,"
               " '{\"numeroAtaRegistroPreco\":\"5\",\"anoAta\":2026}')",
               (ANO, f"{ANO}-01-01",
                (date.today() + timedelta(days=45)).isoformat()))
    db.commit()
    db.close()
    return licitarium.Api()


# ── execução ────────────────────────────────────────────────────────────

def test_cards_e_serie_mensal(api):
    d = api.painel(ANO)
    c = d["execucao"]["cards"]
    assert c["n"] == 4                       # só o exercício pedido
    assert c["homologado"] == pytest.approx(372000.0)
    assert c["contratos_vigentes"] == 1 and c["atas_vigentes"] == 1
    meses = {m["mes"]: m for m in d["execucao"]["meses"]}
    assert len(d["execucao"]["meses"]) == 12          # o ano inteiro, com zeros
    assert meses[2]["valor"] == pytest.approx(27000.0)
    assert meses[3]["valor"] == pytest.approx(345000.0)
    assert meses[3]["estimado"] == pytest.approx(425000.0)
    assert meses[7]["valor"] == 0                     # mês sem contratação
    # o ano anterior vem junto: é contra ele que o hero compara
    assert d["execucao"]["homologado_anterior"] == pytest.approx(18000.0)


def test_modalidades_ordenadas_por_valor(api):
    d = api.painel(ANO)
    mods = d["execucao"]["modalidades"]
    assert mods[0]["modalidade_nome"] == "Pregão"
    assert mods[0]["n"] == 2


# ── análise ─────────────────────────────────────────────────────────────

def test_serie_acumulada_e_so_do_homologado(api):
    """Processo sem homologação não entra no acumulado de homologado.

    O resumo executivo usa COALESCE(homologado, estimado) para não zerar
    processo em andamento; no painel isso faria o gráfico mostrar como pago
    o que ainda é estimativa.
    """
    a = api.painel(ANO)["analise"]
    assert sorted(a["series"]) == [str(ANO - 2), str(ANO - 1), str(ANO)]
    atual = a["series"][str(ANO)]
    assert len(atual) == 12
    assert atual[1] == pytest.approx(27000.0)     # fev
    assert atual[2] == pytest.approx(372000.0)    # mar, acumulado
    assert atual[11] == pytest.approx(372000.0)   # acumulado não decresce
    # P2 tem R$ 90.000 estimados e nenhuma homologação: fica de fora
    assert atual[0] == 0
    assert a["series"][str(ANO - 2)][11] == 0     # exercício sem dados


def test_desagio_por_modalidade(api):
    a = api.painel(ANO)["analise"]
    pcts = {d["modalidade"]: d["pct"] for d in a["desagios"]}
    # pregão: 320.000 sobre 400.000 estimados = 20% de deságio
    assert pcts["Pregão"] == pytest.approx(20.0)
    # dispensas: 52.000 sobre 55.000 = 5,45%
    assert pcts["Dispensa"] == pytest.approx(5.4545, rel=1e-3)


def test_curva_de_concentracao_termina_em_cem(api):
    a = api.painel(ANO)["analise"]
    assert a["curva"][-1] == pytest.approx(100.0)
    assert a["fornecedores_total"] == 1


def test_calor_agrupa_a_cauda_em_outras(api):
    a = api.painel(ANO)["analise"]
    assert "Outras" in a["calor"]
    assert all(len(v) == 12 for v in a["calor"].values())
    assert a["calor"]["Dispensa"][1] == 1        # uma dispensa em fevereiro
    assert a["calor"]["Pregão"][2] == 1


# ── vigilância ──────────────────────────────────────────────────────────

def test_funil_do_edital_ao_contrato(api):
    f = api.painel(ANO)["vigilancia"]["funil"]
    assert f["publicadas"] == 4
    assert f["com_resultado"] == 1     # só D1 tem item homologado
    assert f["com_contrato"] == 1
    assert f["vigentes"] == 1


def test_medidor_de_limite_agrupa_por_objeto(api):
    """Por unidade o medidor não separava nada.

    O campo `unidade` do PNCP traz o nome do órgão: no acervo do piloto, as
    16 dispensas caíam todas em "MUNICIPIO DE ORINDIUVA" e o termômetro
    virava uma linha só. O art. 75 fala em objeto de mesma natureza, que é
    também o agrupamento útil.
    """
    db = _db()
    try:
        db.execute("UPDATE contratacoes SET objeto='AQUISIÇÃO DE PAPEL A4'"
                   " WHERE numero_controle='D1'")
        db.execute("UPDATE contratacoes SET objeto='AQUISICAO DE PAPEL A4"
                   " SULFITE' WHERE numero_controle='D2'")
        # mesma unidade administrativa, objeto diferente
        db.execute("INSERT INTO contratacoes (numero_controle, ano, sequencial,"
                   " orgao_cnpj, unidade, modalidade_id, modalidade_nome,"
                   " objeto, valor_estimado, valor_homologado, data_publicacao,"
                   " referencia, raw) VALUES ('D9',?,9,'111','Saúde',8,"
                   " 'Dispensa','CONTRATAÇÃO DE MANUTENÇÃO PREDIAL',9000,9000,"
                   " ?,0,?)", (ANO, f"{ANO}-05-05",
                   '{"amparoLegal": {"nome": "Lei 14.133/2021, Art. 75, II"}}'))
        db.commit()
    finally:
        db.close()

    v = api.painel(ANO)["vigilancia"]
    # os dois papéis (textos parecidos, mesmo órgão) caem no mesmo grupo;
    # a manutenção (texto sem relação) fica separada, mesmo na mesma unidade
    papel = next(o for o in v["limites"] if o["n"] == 2)
    manutencao = next(o for o in v["limites"] if o["n"] == 1)
    assert papel["total"] == pytest.approx(52000.0)
    assert papel["pct"] == pytest.approx(52000 / v["limite_compras"] * 100)
    assert "PAPEL A4" in papel["objeto"].upper()
    assert "MANUTENÇÃO PREDIAL" in manutencao["objeto"].upper()


def test_alertas_contam_o_que_exige_acao(api):
    a = api.painel(ANO)["alertas"]
    # contrato e ata não somam mais num alerta só: cada um vai a uma tela
    assert a["vencendo_contratos"] == 1        # K1, em 20 dias
    assert a["vencendo_atas"] == 1             # A1, em 45 dias
    assert a["paradas"] == 1                   # P2, publicada em janeiro
    # o objeto das duas dispensas soma R$ 52.000 dos R$ 62.639,92 do
    # art. 75, II — 83% do limite, sem estourar
    assert a["perto_do_limite"] == 1 and a["acima_do_limite"] == 0
    assert isinstance(a["propostas"], int)


def test_alerta_distingue_perto_de_acima_do_limite(api):
    db = _db()
    try:
        db.execute("UPDATE contratacoes SET valor_homologado=90000"
                   " WHERE numero_controle='D1'")
        db.commit()
    finally:
        db.close()
    a = api.painel(ANO)["alertas"]
    assert a["acima_do_limite"] == 1


# ── o clique no alerta tem de filtrar a lista, não só levar até ela ────────
# Esta seção fecha o círculo: cada alerta carrega junto os dados que o
# clique precisa para filtrar a lista exatamente pelo que ele contou —
# nunca "a modalidade inteira" nem "nada".

def test_alerta_de_limite_expoe_os_objetos_que_contou(api):
    """O clique filtra por estes PROCESSOS, não por toda dispensa do ano.

    D1 e D2 nascem com o mesmo objeto genérico ("Objeto") no fixture — o
    agrupamento por similaridade funde os dois, e o alerta expõe o
    numero_controle de cada um (não mais um radical de texto — o
    agrupamento virou similaridade, não é recalculável em SQL)."""
    a = api.painel(ANO)["alertas"]
    assert set(a["objetos_perto_do_limite"]) == {"D1", "D2"}


def test_clique_no_alerta_de_limite_traz_so_esses_objetos(api):
    """De ponta a ponta: o que o alerta contou é o que a lista mostra.

    D1 e D2 (papel A4) somam 83% do limite e disparam o alerta; D3 é
    dispensa do exercício anterior e P1/P2 não são dispensa — nenhum dos
    três pode aparecer na lista filtrada.
    """
    db = _db()
    try:
        db.execute("UPDATE contratacoes SET objeto='AQUISIÇÃO DE PAPEL A4'"
                   " WHERE numero_controle='D1'")
        db.execute("UPDATE contratacoes SET objeto='AQUISICAO DE PAPEL A4"
                   " SULFITE' WHERE numero_controle='D2'")
        db.execute("UPDATE contratacoes SET objeto='CONTRATAÇÃO DE"
                   " MANUTENÇÃO PREDIAL' WHERE numero_controle='D3'")
        db.commit()
    finally:
        db.close()

    objetos = api.painel(ANO)["alertas"]["objetos_perto_do_limite"]
    r = api.listar("contratacoes", {"objetos": objetos})
    assert {i["numero_controle"] for i in r["itens"]} == {"D1", "D2"}
    assert r["total"] == 2


def test_lista_sem_objetos_no_filtro_nao_aplica_nada(api):
    """Filtro vazio ou ausente não pode virar `IN ()`, que zeraria a lista."""
    r = api.listar("contratacoes", {"objetos": []})
    assert r["total"] > 0
    r2 = api.listar("contratacoes", {})
    assert r2["total"] == r["total"]


def test_clique_no_alerta_de_parada_traz_so_o_processo_parado(api):
    """P2: publicada em janeiro, sem homologação — é a única pendência.

    Mesmo critério do alerta (relatorios.dados_painel): mais de 90 dias
    desde a publicação e nenhum valor homologado ainda.
    """
    a = api.painel(ANO)["alertas"]
    assert a["paradas"] == 1

    r = api.listar("contratacoes", {"parada": True})
    assert r["total"] == 1 and r["itens"][0]["numero_controle"] == "P2"


def test_parada_nao_reaparece_apos_homologar(api):
    db = _db()
    try:
        db.execute("UPDATE contratacoes SET valor_homologado=90000"
                   " WHERE numero_controle='P2'")
        db.commit()
    finally:
        db.close()
    r = licitarium.Api().listar("contratacoes", {"parada": True})
    assert r["total"] == 0


def test_clique_no_alerta_de_vencimento_nao_traz_o_vigente_distante(api):
    """"Vigentes" (sem teto) não é "vence em 60 dias" (janela fechada).

    K1 vence em 20 dias — entra nos dois filtros. Um contrato vigente com
    vigência a 200 dias só pode aparecer em "vigentes"; em "vencendo" ele
    infla a lista sem ter nada a ver com o alerta que o usuário clicou —
    foi assim que "25 vencem em 60 dias" virava lista de 50.
    """
    db = _db()
    try:
        venc_longe = (date.today() + timedelta(days=200)).isoformat()
        db.execute("INSERT INTO contratos (numero_controle,"
                   " contratacao_controle, orgao_cnpj, fornecedor_ni,"
                   " fornecedor_nome, objeto, valor_global, vigencia_inicio,"
                   " vigencia_fim, data_publicacao, raw) VALUES ('K2','D1',"
                   " '111','9','FORNECEDOR UM LTDA','Obj',10000.0,"
                   f" '{ANO}-01-01', ?, '{ANO}-02-15', '{{}}')", (venc_longe,))
        db.commit()
    finally:
        db.close()

    todos_vigentes = licitarium.Api().listar("contratos", {"vigentes": True})
    assert todos_vigentes["total"] == 2                # K1 e K2

    so_vencendo = licitarium.Api().listar("contratos", {"vencendo": True})
    assert so_vencendo["total"] == 1
    assert so_vencendo["itens"][0]["numero_controle"] == "K1"


def test_vencendo_tambem_vale_para_atas(api):
    db = _db()
    try:
        # A1 (fixture base) vence em 45 dias; esta vence em 200 — só a
        # primeira pode sobrar se o filtro estiver aplicado de verdade
        db.execute("INSERT INTO atas (numero_controle, contratacao_controle,"
                   " orgao_cnpj, numero_ata, ano_ata, objeto, vigencia_inicio,"
                   " vigencia_fim, raw) VALUES ('A2','P1','111','6',?,'Obj',"
                   f" '{ANO}-01-01', ?,"
                   " '{\"numeroAtaRegistroPreco\":\"6\",\"anoAta\":2026}')",
                   (ANO, (date.today() + timedelta(days=200)).isoformat()))
        db.commit()
    finally:
        db.close()

    r = licitarium.Api().listar("atas", {"vencendo": True})
    assert r["total"] == 1 and r["itens"][0]["numero_controle"] == "A1"


def test_kpi_do_topo_tambem_separa_contrato_de_ata(tmp_path, monkeypatch):
    """Mesma métrica, call site irmão de dados_painel (Api._kpis).

    O chip do topo das listas usa uma consulta separada da do Painel — os
    dois calculam a mesma coisa, então os dois tinham o bug de somar
    contrato com ata, e os dois precisam da mesma correção.
    """
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "k.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, ano, objeto)"
               " VALUES ('K',2026,'x')")
    venc = (date.today() + timedelta(days=10)).isoformat()
    db.execute("INSERT INTO contratos (numero_controle, contratacao_controle,"
               " orgao_cnpj, vigencia_fim, raw) VALUES ('C1','K','111',?,"
               " '{}')", (venc,))
    db.execute("INSERT INTO atas (numero_controle, contratacao_controle,"
               " orgao_cnpj, numero_ata, ano_ata, vigencia_fim, raw)"
               " VALUES ('A1','K','111','1',2026,?,'{}')", (venc,))
    db.execute("INSERT INTO atas (numero_controle, contratacao_controle,"
               " orgao_cnpj, numero_ata, ano_ata, vigencia_fim, raw)"
               " VALUES ('A2','K','111','2',2026,?,'{}')", (venc,))
    db.commit()
    db.close()

    k = licitarium.Api()._kpis(licitarium.abrir_db())
    assert k["vencendo_60_contratos"] == 1
    assert k["vencendo_60_atas"] == 2


def test_comparacao_com_o_ano_anterior_usa_o_mesmo_periodo(api):
    """Comparar oito meses com doze é aritmética do calendário.

    O acervo tem uma contratação de abril do exercício anterior. Pedindo o
    exercício corrente, ela só entra na comparação se já tiver passado a
    data de hoje — do contrário o painel diria "caiu" só porque o ano ainda
    não terminou.
    """
    hoje = date.today()
    d = api.painel(hoje.year)
    assert d["comparacao_parcial"] is True

    # exercício fechado compara ano inteiro com ano inteiro
    assert api.painel(ANO - 1)["comparacao_parcial"] is (ANO - 1 == hoje.year)


def test_funil_conta_o_mesmo_conjunto_nas_quatro_etapas(api):
    """A última etapa não pode ser maior que a primeira.

    "Vigentes hoje" contava contratos de qualquer exercício: no acervo real
    isso dava 50 vigentes para 34 publicadas, e o funil alargava no fim.
    """
    db = _db()
    try:
        # contrato vigente de um exercício anterior: não é deste funil
        db.execute("INSERT INTO contratos (numero_controle,"
                   " contratacao_controle, orgao_cnpj, fornecedor_ni,"
                   " fornecedor_nome, objeto, valor_global, vigencia_inicio,"
                   " vigencia_fim, data_publicacao, raw)"
                   " VALUES ('K9','D3','111','9','OUTRO','Obj',1000,?,?,?,'{}')",
                   (f"{ANO - 1}-01-01",
                    (date.today() + timedelta(days=300)).isoformat(),
                    f"{ANO - 1}-02-01"))
        db.commit()
    finally:
        db.close()

    f = api.painel(ANO)["vigilancia"]["funil"]
    assert f["vigentes"] == 1                       # só o contrato de D1
    assert f["publicadas"] >= f["com_resultado"] >= f["vigentes"]


def test_ano_ausente_usa_o_mais_recente_do_acervo(api):
    assert api.painel()["ano"] == ANO


# ── o painel impresso ───────────────────────────────────────────────────

def test_documento_sai_em_a4_paisagem(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_painel(
        [["execucao", "<div class='card'>gráfico</div>"],
         ["analise", "<svg><rect/></svg>"]], ANO)
    assert r["ok"]
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert "size: A4 landscape" in html
    # o navegador "economiza tinta" por padrão e devolveria barras cinzentas
    assert "print-color-adjust: exact" in html
    assert "Execução do exercício" in html and "Análise comparativa" in html
    assert "<svg><rect/></svg>" in html          # o SVG da tela vai inteiro
    assert "break-after:page" in html            # uma vista por página


def test_grade_do_papel_pode_apertar_o_svg_abaixo_do_min_content(
        tmp_path, monkeypatch):
    """Grid item começa com `min-width:auto` = min-content = a largura FIXA
    do SVG do ECharts. Sem `min-width:0` a faixa não encolhe abaixo disso, a
    página transborda o A4 paisagem (medido: body 2700px p/ 1017 úteis) e os
    gráficos da direita saem cortados no PDF real (2026-08-16). A tela ganhou
    o `min-width:0` na 1.42.0 (estilo.css:561); o papel usa CSS_PAINEL
    próprio e não carrega o estilo.css — este é o mesmo conserto do outro
    lado da fronteira tela/papel. Removê-lo daqui reabre o corte."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_painel(
        [["execucao", "<div class='card'>x</div>"]], ANO)
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert ".faixa > *, .card, .graf, .graf-par, .graf-echart { min-width:0; }" \
        in html, "grade do papel sem min-width:0 volta a cortar gráfico"


def test_ultima_vista_nao_quebra_pagina_e_deixa_o_rodape_sozinho(
        tmp_path, monkeypatch):
    """`.secao-painel` quebra página depois de cada vista, mas a ÚLTIMA não
    pode — depois dela só vem o `<footer>`. Como o footer é o último filho da
    página, a última seção não é `:last-child`; com esse seletor o reset não
    casava e a última vista mantinha o break-after:page, jogando o rodapé
    sozinho numa página em branco no fim (PDF real, 2026-08-16). O reset é por
    `:last-of-type` (a última `<section>`, ignora o footer)."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_painel(
        [["execucao", "<div class='card'>x</div>"]], ANO)
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert ".secao-painel:last-of-type { break-after:auto; }" in html, \
        "reset por :last-child deixa página em branco com o rodapé no fim"
    assert ".secao-painel:last-child { break-after:auto" not in html, \
        ":last-child não casa com a última vista (o footer vem depois)"


def test_painel_impresso_nao_segue_o_tema_da_tela(tmp_path, monkeypatch):
    """O painel impresso é peça institucional, não vitrine do tema.

    Reversão consciente da v1.14.4 (pedido do usuário em 2026-08-08): lá o
    documento passou a seguir o tema porque saía sempre pergaminho e isso
    ignorava a escolha da tela. Agora a regra é outra e mais forte —
    documento oficial não tem tema: papel branco, grafite, réguas
    discretas, qualquer que seja a tela. Imprimir no Observatório (tema
    escuro) gerava documento de fundo escuro, que nunca ia parecer peça de
    Tribunal de Contas.
    """
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    api = licitarium.Api()
    api.set_config("tema", "observatorio")
    r = api.imprimir_painel(
        [["execucao", "<div class='card'>gráfico</div>"]], ANO)
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert "#ffffff" in html               # papel branco, sempre
    assert "#1a212b" not in html           # nada da superfície escura
    assert "#10151c" not in html           # nem do fundo do Observatório
    assert "#f5efe2" not in html           # nem do bege do pergaminho
    # as séries do papel são as do Portal, calibradas para fundo branco
    assert "#2a78d6" in html
    assert "#b7d3f6" not in html           # rampa clara do Observatório sai


def test_impressao_ignora_vista_vazia(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_painel([["execucao", "<b>x</b>"],
                                          ["analise", ""]], ANO)
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert "Análise comparativa" not in html


# ── ficha do modal de detalhe ───────────────────────────────────────────

def test_imprimir_detalhe_grava_a_ficha_com_o_que_a_tela_montou(
        tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    licitarium.abrir_db().close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    meta = '<div><div class="k">Fornecedor</div><div class="v">Acme</div></div>'
    r = licitarium.Api().imprimir_detalhe(
        "contratos", "12345/2026-1", "Contrato de manutenção",
        "12345/2026-1", meta)
    assert r["ok"]
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert meta in html
    assert "Contrato de manutenção" in html
    assert "size: A4 portrait" in html
    assert "detalhe_12345_2026-1" in r["arquivo"]


def test_imprimir_detalhe_nomeia_o_pdf_da_contratacao_pela_modalidade(
        tmp_path, monkeypatch):
    """Pedido do usuário (2026-08-12): mesma lógica dos contratos, agora
    pras contratações — MODALIDADE + número-ano + órgão, sem fornecedor
    (a contratação em si pode não ter um único fornecedor definido)."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, orgao_nome, modalidade_nome, objeto) VALUES"
        " (?,?,?,?,?,?,?)",
        ("X-1", 2026, 28, "45148970000177", "MUNICIPIO DE ORINDIUVA",
         "Pregão eletrônico", "Aquisição de material"))
    db.commit()
    db.close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_detalhe(
        "contratacoes", "X-1", "Aquisição de material", "X-1", "<div></div>")
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert ("<title>PREGÃO ELETRÔNICO 28-2026 "
            "MUNICIPIO DE ORINDIUVA</title>") in html


def test_imprimir_detalhe_nomeia_o_pdf_pelo_contrato_orgao_e_fornecedor(
        tmp_path, monkeypatch):
    """Pedido do usuário (2026-08-12): o nome sugerido ao "Salvar como
    PDF" (o <title>) identifica o documento sem precisar abrir — não o
    município genérico de sempre."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO orgaos (cnpj, razao_social) VALUES (?,?)",
              ("45148970000177", "MUNICIPIO DE ORINDIUVA"))
    db.execute(
        "INSERT INTO contratos (numero_controle, orgao_cnpj, numero_contrato,"
        " ano_contrato, fornecedor_nome, objeto, valor_global) VALUES"
        " (?,?,?,?,?,?,?)",
        ("Y-1", "45148970000177", "0046", 2026,
         "M J M VALVERDE SERVIÇOS E LOCAÇÕES ME", "Festa do peão", 32000))
    db.commit()
    db.close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_detalhe(
        "contratos", "Y-1", "Festa do peão", "Y-1", "<div></div>")
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert ("<title>CONTRATO 46-2026 MUNICIPIO DE ORINDIUVA X "
            "M J M VALVERDE SERVIÇOS E LOCAÇÕES ME</title>") in html


def test_imprimir_detalhe_nomeia_o_pdf_da_ata_sem_fornecedor(
        tmp_path, monkeypatch):
    """Ata não tem fornecedor no PNCP (é por item, não por ata) — o nome
    do PDF fica só com tipo, número e órgão."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO orgaos (cnpj, razao_social) VALUES (?,?)",
              ("45148970000177", "MUNICIPIO DE ORINDIUVA"))
    db.execute(
        "INSERT INTO atas (numero_controle, orgao_cnpj, numero_ata, ano_ata,"
        " objeto) VALUES (?,?,?,?,?)",
        ("Z-1", "45148970000177", "26", 2025, "Fraldas"))
    db.commit()
    db.close()
    monkeypatch.setattr(licitarium.webbrowser, "open", lambda *a, **k: None)

    r = licitarium.Api().imprimir_detalhe(
        "atas", "Z-1", "Fraldas", "Z-1", "<div></div>")
    html = Path(r["arquivo"]).read_text(encoding="utf-8")
    assert ("<title>ATA DE REGISTRO DE PREÇOS 26-2025 "
            "MUNICIPIO DE ORINDIUVA</title>") in html


# ── economia ────────────────────────────────────────────────────────────

def test_economia_totais_batem_com_os_cards_do_ano(api):
    d = api.painel(ANO)
    e, c = d["economia"], d["execucao"]["cards"]
    assert e["estimado"] == c["estimado"]
    assert e["homologado"] == c["homologado"]
    assert e["economizado"] == pytest.approx(c["estimado"] - c["homologado"])
    assert e["pct"] == pytest.approx(c["desagio"])
    # D3, exercício anterior: 20.000 estimados, 18.000 homologados
    assert e["economizado_anterior"] == pytest.approx(2000.0)


def test_economia_por_modalidade_traz_valor_em_reais(api):
    por_mod = {m["modalidade"]: m
               for m in api.painel(ANO)["economia"]["por_modalidade"]}
    # pregão: 400.000 estimados, 320.000 homologados
    assert por_mod["Pregão"]["economizado"] == pytest.approx(80000.0)
    # dispensas: 55.000 estimados, 52.000 homologados
    assert por_mod["Dispensa"]["economizado"] == pytest.approx(3000.0)


def test_economia_por_modalidade_ordena_pelo_economizado_nao_pelo_estimado(api):
    """Achado 2026-08-12 (portado do licitarium-relatorios): a lista
    ordenava por `valor_estimado` (SQL `ORDER BY 3`), mas o gráfico desenha
    `economizado` — as outras três listas (família/categoria/fornecedor) já
    ordenavam certo, só esta estava com a métrica errada. Modalidade com
    estimado ALTO e economia baixa não pode vir antes de uma com estimado
    baixo mas economia alta."""
    db = _db()
    try:
        db.executemany(
            "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
            " orgao_cnpj, modalidade_nome, objeto, valor_estimado,"
            " valor_homologado, data_publicacao, referencia)"
            " VALUES (?,?,?,?,?,?,?,?,?,0)",
            [("MOD-1", ANO, 900, "111", "Concorrência", "obra grande",
              100000.0, 99000.0, f"{ANO}-01-01"),   # estimado alto, economia mínima
             ("MOD-2", ANO, 901, "111", "Inexigibilidade", "serviço técnico",
              20000.0, 5000.0, f"{ANO}-01-01")])    # estimado baixo, economia alta
        db.commit()
    finally:
        db.close()

    nomes = [m["modalidade"] for m in api.painel(ANO)["economia"]["por_modalidade"]]
    assert nomes.index("Inexigibilidade") < nomes.index("Concorrência")


def test_economia_por_familia_agrupa_como_o_medidor_de_limite(api):
    """Mesma chave de agrupamento do fracionamento (pca_builder.chave_agrupamento):
    os dois "papel A4" do PNCP caem na mesma família."""
    db = _db()
    try:
        db.executemany(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, categoria, valor_total_estimado,"
            " valor_total_homologado, referencia, raw)"
            " VALUES (?,?,?,?,?,?,?,?,0,'{}')",
            [("D1#papel", "D1", "111", ANO, "AQUISIÇÃO DE PAPEL A4",
              "Material de consumo", 5000.0, 4000.0),
             ("D2#papel", "D2", "111", ANO, "AQUISICAO DE PAPEL A4 SULFITE",
              "Material de consumo", 3000.0, 2500.0),
             ("P1#tinta", "P1", "111", ANO, "CARTUCHO DE TINTA",
              "Material de consumo", 2000.0, 1800.0)])
        db.commit()
    finally:
        db.close()

    por_familia = {f["nome"]: f
                   for f in api.painel(ANO)["economia"]["por_familia"]}
    papel = por_familia["PAPEL A4"]
    assert papel["n"] == 2
    assert papel["estimado"] == pytest.approx(8000.0)
    assert papel["economizado"] == pytest.approx(1500.0)
    assert "CARTUCHO TINTA" in por_familia


def test_economia_por_categoria_usa_material_servico_quando_falta_categoria(api):
    db = _db()
    try:
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, categoria, material_servico, valor_total_estimado,"
            " valor_total_homologado, referencia, raw)"
            " VALUES ('P1#serv','P1','111',?,'MANUTENÇÃO DE VEÍCULO',NULL,"
            "'Serviço de manutenção',6000.0,5000.0,0,'{}')", (ANO,))
        db.commit()
    finally:
        db.close()

    por_cat = {c["nome"]: c
               for c in api.painel(ANO)["economia"]["por_categoria"]}
    assert "Serviço de manutenção" in por_cat
    assert por_cat["Serviço de manutenção"]["economizado"] == pytest.approx(1000.0)


def test_economia_por_categoria_usa_material_servico_quando_categoria_e_nao_se_aplica(api):
    """Achado 2026-08-12 (portado do licitarium-relatorios): o PNCP preenche
    `categoria` com "Não se aplica" — string truthy, `categoria or material`
    nunca caía pro fallback e "Economia por categoria" saía com uma barra
    só chamada "Não se aplica", sem informação nenhuma."""
    db = _db()
    try:
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, categoria, material_servico, valor_total_estimado,"
            " valor_total_homologado, referencia, raw)"
            " VALUES ('P1#serv','P1','111',?,'MANUTENÇÃO DE VEÍCULO',"
            "'Não se aplica','Serviço',6000.0,5000.0,0,'{}')", (ANO,))
        db.commit()
    finally:
        db.close()

    por_cat = {c["nome"]: c
               for c in api.painel(ANO)["economia"]["por_categoria"]}
    assert "Não se aplica" not in por_cat
    assert "Serviço" in por_cat
    assert por_cat["Serviço"]["economizado"] == pytest.approx(1000.0)


def test_economia_por_fornecedor_agrupa_pelo_documento(api):
    """A mesma empresa aparece com grafias diferentes entre processos — o
    agrupamento é pelo `ni` (CNPJ/CPF), não pelo nome."""
    db = _db()
    try:
        db.executemany(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, fornecedor_ni, fornecedor_nome,"
            " valor_total_estimado, valor_total_homologado, referencia, raw)"
            " VALUES (?,?,?,?,?,?,?,?,?,0,'{}')",
            [("D1#f1", "D1", "111", ANO, "PAPEL A4", "111222",
              "PAPELARIA CENTRAL LTDA", 5000.0, 4000.0),
             # mesmo CNPJ, grafia diferente: tem de somar na mesma linha
             ("D2#f1", "D2", "111", ANO, "CANETA", "111222",
              "Papelaria Central Ltda ME", 3000.0, 2500.0),
             ("P1#f1", "P1", "111", ANO, "MERENDA", "999888",
              "ALIMENTOS SA", 2000.0, 1900.0)])
        db.commit()
    finally:
        db.close()

    por_forn = {f["ni"]: f
                for f in api.painel(ANO)["economia"]["por_fornecedor"]}
    assert len(por_forn) == 2
    central = por_forn["111222"]
    assert central["n"] == 2
    assert central["estimado"] == pytest.approx(8000.0)
    assert central["economizado"] == pytest.approx(1500.0)
    assert central["pct"] == pytest.approx(18.75)


def test_economia_por_fornecedor_ignora_item_sem_fornecedor(api):
    """Item sem `ni` não é atribuível a ninguém — fica de fora do ranking,
    em vez de virar uma linha "(sem fornecedor)" que ninguém pode cobrar."""
    db = _db()
    try:
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, fornecedor_ni, fornecedor_nome,"
            " valor_total_estimado, valor_total_homologado, referencia, raw)"
            " VALUES ('D1#x','D1','111',?,'ITEM ÓRFÃO',NULL,NULL,"
            " 9000.0,1000.0,0,'{}')", (ANO,))
        db.commit()
    finally:
        db.close()

    assert api.painel(ANO)["economia"]["por_fornecedor"] == []


def test_economia_por_fornecedor_ordenada_por_valor_economizado(api):
    db = _db()
    try:
        db.executemany(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, fornecedor_ni, fornecedor_nome,"
            " valor_total_estimado, valor_total_homologado, referencia, raw)"
            " VALUES (?,?,?,?,?,?,?,?,?,0,'{}')",
            [("D1#o1", "D1", "111", ANO, "A", "1", "POUCO", 1000.0, 900.0),
             ("D1#o2", "D1", "111", ANO, "B", "2", "MUITO", 9000.0, 4000.0)])
        db.commit()
    finally:
        db.close()

    ranking = api.painel(ANO)["economia"]["por_fornecedor"]
    assert [f["nome"] for f in ranking] == ["MUITO", "POUCO"]


def test_economia_series_acumula_estimado_menos_homologado(api):
    """Mesmo padrão da série de Análise (acumulado de 3 exercícios), mas
    seguindo a regra dos KPIs de economia: estimado menos homologado sobre
    todo o exercício, sem exigir que o processo já tenha fechado."""
    e = api.painel(ANO)["economia"]
    assert sorted(e["series"]) == [str(ANO - 2), str(ANO - 1), str(ANO)]
    atual = e["series"][str(ANO)]
    assert len(atual) == 12
    assert atual[0] == pytest.approx(90000.0)    # jan: P2, sem homologação
    assert atual[1] == pytest.approx(93000.0)    # fev: + D1 (30.000-27.000)
    assert atual[2] == pytest.approx(173000.0)   # mar: + D2 (0) + P1 (80.000)
    assert atual[11] == pytest.approx(173000.0)  # acumulado não decresce
    anterior = e["series"][str(ANO - 1)]
    assert anterior[2] == 0                      # antes de abril, nada
    assert anterior[3] == pytest.approx(2000.0)  # D3: 20.000-18.000
    assert anterior[11] == pytest.approx(2000.0)
    assert e["series"][str(ANO - 2)][11] == 0    # exercício sem dados


def test_economia_ordenada_por_valor_economizado(api):
    db = _db()
    try:
        db.executemany(
            "INSERT INTO itens (id, contratacao_controle, orgao_cnpj, ano,"
            " descricao, categoria, valor_total_estimado,"
            " valor_total_homologado, referencia, raw)"
            " VALUES (?,?,?,?,?,?,?,?,0,'{}')",
            [("D1#a", "D1", "111", ANO, "CADEIRA ESCOLAR", "Cat",
              1000.0, 900.0),
             ("D1#b", "D1", "111", ANO, "MESA ESCRITORIO", "Cat",
              5000.0, 3000.0)])
        db.commit()
    finally:
        db.close()

    economizados = [f["economizado"]
                    for f in api.painel(ANO)["economia"]["por_familia"]]
    assert economizados == sorted(economizados, reverse=True)


def test_filtro_de_orgao_nao_quebra_o_painel(api):
    """`contratacoes` e `itens` têm as duas uma coluna orgao_cnpj.

    Sem prefixo na consulta com JOIN, o SQLite recusa tudo com "ambiguous
    column name" — e o painel não abre para quem filtra por órgão.
    """
    d = api.painel(ANO, "111")
    assert d["vigilancia"]["funil"]["publicadas"] == 4
    assert d["execucao"]["cards"]["n"] == 4

    # órgão sem nada no acervo devolve painel vazio, não exceção
    vazio = api.painel(ANO, "000")
    assert vazio["execucao"]["cards"]["n"] == 0
    assert vazio["vigilancia"]["funil"]["publicadas"] == 0


# ── a fronteira entre a tela e o papel ──────────────────────────────────────

def test_toda_classe_do_painel_tem_estilo_no_documento_impresso():
    """O painel impresso NÃO carrega `ui/estilo.css`.

    `imprimir_painel` leva só o HTML das vistas; quem o formata é o
    `CSS_PAINEL`, montado à parte em relatorios.py. Classe nova no
    `ui/painel.js` que não ganhe regra lá sai sem estilo nenhum no papel —
    foi o que aconteceu com o calendário da agenda na v1.40.0: a grade sumiu
    e os 92 dias saíram empilhados numa coluna, ocupando duas páginas. O
    defeito só apareceu quando alguém imprimiu de verdade e olhou o PDF.

    A regra aqui é: classe que o painel emite ou está no CSS do documento,
    ou está na lista de dispensadas abaixo — com motivo. Nunca em silêncio.
    """
    import re
    js = (Path(licitarium.DIR_APP) / "ui" / "painel.js").read_text(encoding="utf-8")
    # class="a b ${expr}" — só os literais interessam; a parte interpolada é
    # sempre modificador (u/a/t, hoje, on) e vem coberta pelos literais
    emitidas = set()
    for bloco in re.findall(r'class="([^"$]*)', js):
        emitidas.update(c for c in bloco.split() if c)

    # Dispensadas, cada uma por um motivo:
    DISPENSADAS = {
        # existem só na tela e são escondidas ou irrelevantes no papel
        "graf", "graf-echart", "graf-tt", "so-tela", "chips", "chip",
        "subabas", "painel-topo", "cresce", "carregando",
        "ctr", "ajuda",
        # modificadores sem geometria própria (herdam da classe base)
        "on", "oculto", "hoje", "venc", "fora", "u", "a", "t",
        "grave", "aviso", "info", "ok", "warn", "err", "up", "down", "dir",
        # o documento tem tipografia própria para estes
        "num", "obj", "dim", "base",
    }
    faltando = sorted(c for c in emitidas - DISPENSADAS
                      if f".{c}" not in relatorios.CSS_PAINEL)
    assert not faltando, (
        "classes emitidas pelo painel sem regra no CSS do documento impresso "
        f"(nem dispensadas): {faltando}")


def test_pagina_impressa_nao_tem_largura_fixa_maior_que_o_papel():
    """A4 paisagem com margem de 1,4 cm tem ~1017 px úteis a 96 dpi.

    O `.pagina` tinha `max-width: 1080px` (A4) / 1480px (A3) — calibrado em
    pixel de tela, não na caixa do papel. Na impressão real (navegador
    honrando a `@page`), o bloco ficava mais largo que a área imprimível e
    os gráficos, de largura 100%, saíam ~63 px pela direita e eram cortados.
    O retrato era pior: 820px contra 688px úteis (132 px fora).

    O defeito escapou porque o teste de geometria gerava o PDF passando
    `margin` no `page.pdf()`, ignorando a `@page` do CSS — media numa caixa
    que a impressão real nunca usa. A régua tem de ser a caixa do papel.
    """
    for paisagem, papel in [(True, "A4"), (True, "A3"), (False, "A4")]:
        css = relatorios._css(paisagem, papel)
        pagina = [ln for ln in css.splitlines() if ".pagina {" in ln]
        assert pagina, f"{papel} {paisagem}: regra .pagina não achada"
        assert "max-width:100%" in pagina[0] or "max-width: 100%" in pagina[0], (
            f"{papel} paisagem={paisagem}: .pagina com largura fixa "
            f"({pagina[0].strip()}) — transborda a caixa do papel na "
            "impressão real")
