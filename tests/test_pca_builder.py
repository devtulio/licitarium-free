"""Testes do montador de minuta do PCA."""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium
import pca_builder


@pytest.fixture
def db():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(licitarium.SCHEMA)
    dados = [
        # (id, ano, descricao, unidade, qtd, unitario, data)
        ("a", 2024, "FILTRO DE AR DO MOTOR MODELO X", "UND", 100, 90.0, "2024-05-01"),
        ("b", 2025, "FILTRO DE AR DO MOTOR MODELO Y", "UND", 200, 100.0, "2025-05-01"),
        ("c", 2025, "FILTRO DE AR DO MOTOR MODELO Z", "UND", 100, 110.0, "2025-08-01"),
        ("d", 2025, "PAPEL SULFITE A4 BRANCO", "RESMA", 50, 20.0, "2025-03-01"),
        ("e", 2024, "PROPOSTA PARA TODOS OS ITENS", "UN", 1, 500000.0, "2024-01-01"),
    ]
    con.executemany(
        "INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
        " numero_item, descricao, unidade, quantidade_homologada,"
        " valor_unitario_homologado, data_resultado, material_servico)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,'Material')",
        [(i, "C", ano, 1, n, desc, un, q, v, d)
         for n, (i, ano, desc, un, q, v, d) in enumerate(dados, 1)])
    con.commit()
    yield con
    con.close()


def test_chave_ignora_pontuacao_e_palavras_vazias():
    assert pca_builder.chave_agrupamento("Filtro de ar do motor, modelo X") \
        == "FILTRO AR MOTOR"
    assert pca_builder.chave_agrupamento("PAPEL SULFITE A4", 2) == "PAPEL SULFITE"
    assert pca_builder.chave_agrupamento("") == ""


def test_chave_ignora_quantidade_no_inicio():
    """Sincronizado do Licitarium Pro (2026-08-16): quantidade na FRENTE não
    é produto — '06 TENDAS' e '12 TENDAS' são a mesma família (senão o número
    virava radical e dividia o acumulado do fracionamento contra o mesmo
    teto). Número no MEIO fica ('PNEU 295' precisa do 295)."""
    assert pca_builder.chave_agrupamento("06 TENDAS") \
        == pca_builder.chave_agrupamento("12 TENDAS") == "TENDAS"
    assert pca_builder.chave_agrupamento("100 CADEIRAS ESCOLARES", 2) == "CADEIRAS ESCOLARES"
    assert "295" in pca_builder.chave_agrupamento("PNEU 295")


def test_consolida_agrupando_e_descarta_lote(db):
    grupos = {g["chave"]: g for g in pca_builder.consolidar(db)[0]}
    assert "FILTRO AR MOTOR" in grupos
    # o lote "proposta para todos os itens" não vira item de plano
    assert not any("TODOS" in k for k in grupos)
    filtro = grupos["FILTRO AR MOTOR"]
    assert filtro["itens"] == 3 and filtro["anos"] == [2024, 2025]
    # média dos anos: 2024=100, 2025=300 -> 200; +10% -> 220
    assert filtro["quantidade_base"] == 200.0
    assert filtro["quantidade"] == 220.0
    assert filtro["valor_unitario"] == 100.0        # mediana de 90/100/110


def test_bases_de_quantidade(db):
    def qtd(base):
        g = {x["chave"]: x for x in pca_builder.consolidar(db, base=base,
                                                           margem=0)[0]}
        return g["FILTRO AR MOTOR"]["quantidade"]
    assert qtd("media") == 200.0
    assert qtd("ultimo") == 300.0      # 2025
    assert qtd("maior") == 300.0
    assert qtd("soma") == 400.0


def test_estatisticas_de_preco(db):
    def preco(est):
        g = {x["chave"]: x for x in pca_builder.consolidar(db, estatistica=est)[0]}
        return g["FILTRO AR MOTOR"]["valor_unitario"]
    assert preco("mediana") == 100.0
    assert preco("media") == 100.0
    assert preco("menor") == 90.0
    assert preco("recente") == 110.0   # resultado de 2025-08


def test_margem_aplicada(db):
    g = {x["chave"]: x for x in pca_builder.consolidar(db, margem=25)[0]}
    assert g["PAPEL SULFITE"[:0] or "PAPEL SULFITE A4"]["quantidade"] == 62.5


def test_filtro_por_anos(db):
    grupos = pca_builder.consolidar(db, anos=[2025])[0]
    filtro = {g["chave"]: g for g in grupos}["FILTRO AR MOTOR"]
    assert filtro["anos"] == [2025] and filtro["quantidade_base"] == 300.0


def test_minuta_persiste_e_preserva_edicao(db):
    n = pca_builder.gerar_minuta(db, 2027, {"margem": 10})
    assert n >= 2
    itens = pca_builder.listar_minuta(db, 2027)
    alvo = next(i for i in itens if i["chave"] == "FILTRO AR MOTOR")
    # o gestor ajusta a quantidade e marca como editado
    db.execute("UPDATE pca_minuta_itens SET quantidade=999, editado=1"
               " WHERE id=?", (alvo["id"],))
    db.commit()
    # regerar não pode descartar o ajuste manual
    pca_builder.gerar_minuta(db, 2027, {"margem": 50})
    itens = pca_builder.listar_minuta(db, 2027)
    alvo = next(i for i in itens if i["chave"] == "FILTRO AR MOTOR")
    assert alvo["quantidade"] == 999 and alvo["editado"] == 1
    # os não editados seguem o parâmetro novo
    papel = next(i for i in itens if "PAPEL" in i["chave"])
    assert papel["quantidade"] == 75.0          # 50 * 1,5


def test_totais_ignora_excluidos(db):
    pca_builder.gerar_minuta(db, 2027, {})
    itens = pca_builder.listar_minuta(db, 2027)
    db.execute("UPDATE pca_minuta_itens SET incluir=0 WHERE id=?",
               (itens[0]["id"],))
    db.commit()
    t = pca_builder.totais(pca_builder.listar_minuta(db, 2027))
    assert t["excluidos"] == 1
    assert t["grupos"] == len(itens) - 1


def test_chave_descarta_prefixo_burocratico():
    assert pca_builder.chave_agrupamento(
        "AQUISIÇÃO DE PAPEL SULFITE A4") == "PAPEL SULFITE A4"
    assert pca_builder.chave_agrupamento(
        "CONTRATAÇÃO DE EMPRESA ESPECIALIZADA PARA MANUTENÇÃO DE VIAS") \
        == "MANUTENÇÃO VIAS"
    assert pca_builder.chave_agrupamento(
        "REGISTRO DE PREÇOS PARA AQUISIÇÃO DE ÓLEO DIESEL") == "ÓLEO DIESEL"
    # descrição que já começa pelo item não é afetada
    assert pca_builder.chave_agrupamento("PNEU 295 80R22") == "PNEU 295 80R22"


def test_sinaliza_preco_disperso(db):
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
               " numero_item, descricao, unidade, quantidade_homologada,"
               " valor_unitario_homologado, data_resultado)"
               " VALUES ('z','C',2025,1,50,'PAPEL SULFITE A4 CAIXA','CX',1,"
               "2000.0,'2025-10-01')")
    db.commit()
    g = {x["chave"]: x for x in pca_builder.consolidar(db)[0]}
    papel = g["PAPEL SULFITE A4"]
    assert papel["preco_disperso"] is True      # R$ 20 x R$ 2.000
    assert g["FILTRO AR MOTOR"]["preco_disperso"] is False


def test_ipca_corrige_preco_antigo_a_valor_de_hoje(db):
    """Melhoria pedida pelo usuário (2026-08-30): comparar preço de anos
    diferentes sem corrigir subestima o custo — mediana mistura reais de
    épocas distintas. Corrigido pela série do Banco Central (mesma lógica
    do motor de pesquisa de preços, removido do Free na v1.44.0)."""
    db.execute("INSERT INTO ipca VALUES ('2026-06', 0.0)")
    db.execute("INSERT INTO ipca VALUES ('2026-07', 10.0)")  # +10% em julho
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
               " numero_item, descricao, unidade, quantidade_homologada,"
               " valor_unitario_homologado, data_resultado)"
               " VALUES ('ipca1','C',2026,1,1,'RESMA PAPEL SULFITE TESTE',"
               "'RESMA',10,100.0,'2026-06-15')")
    db.commit()
    grupos, meta = pca_builder.consolidar(db, palavras=4, estatistica="media")
    g = {x["chave"]: x for x in grupos}["RESMA PAPEL SULFITE TESTE"]
    assert g["valor_unitario"] == pytest.approx(110.0)  # 100 * 1,10
    assert meta["ipca_ate"] == "2026-07"
    assert meta["precos_corrigidos"] >= 1


def test_sem_serie_ipca_nao_corrige_nada(db):
    """Banco sem IPCA sincronizado ainda (piloto novo) não trava nem muda
    valor nenhum — vira no-op transparente."""
    grupos, meta = pca_builder.consolidar(db)
    g = {x["chave"]: x for x in grupos}["FILTRO AR MOTOR"]
    assert g["valor_unitario"] == 100.0     # mediana crua, sem correção
    assert meta["ipca_ate"] is None
    assert meta["precos_corrigidos"] == 0


def test_corrigir_precos_false_desliga_a_correcao(db):
    db.execute("INSERT INTO ipca VALUES ('2026-07', 10.0)")
    db.commit()
    grupos, meta = pca_builder.consolidar(db, corrigir_precos=False)
    assert meta["ipca_ate"] is None and meta["precos_corrigidos"] == 0


def test_funde_grupos_de_radical_diferente_mas_descricao_parecida(db):
    """Melhoria pedida (2026-08-30): corte fixo de N palavras não junta
    "CIMENTO PORTLAND CP II 50KG" com "CIMENTO CP II PORTLAND SACO 50KG"
    (radicais de 3 palavras diferem) — Jaccard de tokens (mesma técnica do
    Fracionamento) funde os dois grupos."""
    for i, (desc, unit) in enumerate([
            ("CIMENTO PORTLAND CP II 50KG", 30.0),
            ("CIMENTO CP II PORTLAND SACO 50KG", 32.0)], start=30):
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
            " numero_item, descricao, unidade, quantidade_homologada,"
            " valor_unitario_homologado, data_resultado)"
            " VALUES (?,'C',2025,1,?,?,'SC',10,?,'2025-04-01')",
            (f"cim{i}", i, desc, unit))
    db.commit()
    grupos, _ = pca_builder.consolidar(db)
    fundidos = [g for g in grupos if "CIMENTO" in g["chave"]]
    assert len(fundidos) == 1
    assert fundidos[0]["itens"] == 2


def test_base_tendencia_projeta_por_regressao_linear(db):
    """Melhoria pedida (2026-08-30): item em consumo CRESCENTE ano a ano
    fica mal servido por média/último — a reta projeta o próximo ano."""
    for ano, qtd in [(2023, 100), (2024, 200), (2025, 300)]:
        db.execute(
            "INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
            " numero_item, descricao, unidade, quantidade_homologada,"
            " valor_unitario_homologado, data_resultado)"
            " VALUES (?,'C',?,1,40,'GRAMPO METALICO PADRAO','CX',?,5.0,?)",
            (f"tend{ano}", ano, qtd, f"{ano}-04-01"))
    db.commit()
    grupos, _ = pca_builder.consolidar(db, base="tendencia", margem=0,
                                       ano_alvo=2026)
    g = {x["chave"]: x for x in grupos}["GRAMPO METALICO PADRAO"]
    assert g["quantidade"] == pytest.approx(400.0)   # reta: 100/ano, 2026->400


def test_familia_e_curva_abc():
    assert pca_builder.familia("PNEU 295 80R22") == "PNEU"
    assert pca_builder.familia("") == ""
    itens = [{"valor_total": 800.0}, {"valor_total": 150.0},
             {"valor_total": 40.0}, {"valor_total": 10.0},
             {"valor_total": 0}]
    pca_builder.classificar_abc(itens)
    # 800/1000 = 80% -> A; +150 = 95% -> B; o resto C
    assert [i["abc"] for i in itens] == ["A", "B", "C", "C", "C"]


def test_resumo_por_familia(db):
    pca_builder.gerar_minuta(db, 2027, {})
    itens = pca_builder.listar_minuta(db, 2027)
    fam = {f["familia"]: f for f in pca_builder.resumo_familias(itens)}
    assert "FILTRO" in fam and "PAPEL" in fam
    assert fam["FILTRO"]["itens"] == 1
    assert fam["FILTRO"]["valor"] > 0


def test_mesclar_soma_quantidade_e_pondera_preco(db):
    # duas linhas da MESMA unidade — inseridas direto na minuta, sem passar
    # por gerar_minuta, pra controlar a unidade de cada uma
    db.executemany(
        "INSERT INTO pca_minuta_itens (id, ano_alvo, chave, descricao,"
        " unidade, quantidade, valor_unitario, margem, incluir, origem)"
        " VALUES (?,2027,?,?,?,?,?,0,1,'{}')",
        [(1, "FILTRO A", "Filtro A", "UND", 200, 100.0),
         (2, "FILTRO B", "Filtro B", "UND", 50, 20.0)])
    db.commit()
    # 200 un a R$100 + 50 un a R$20 -> 250 un a R$84 (média ponderada)
    r = pca_builder.mesclar(db, 2027, [1, 2])
    assert r["ok"] and r["itens"] == 2
    depois = pca_builder.listar_minuta(db, 2027)
    fundido = next(i for i in depois if i["mesclado"])
    assert fundido["quantidade"] == 250.0
    assert fundido["valor_unitario"] == 84.0
    assert len(depois) == 1


def test_mesclar_recusa_unidades_diferentes(db):
    """soma de quantidade sem checar a unidade era fantasma: 200 UND + 50
    RESMA virava "250 UND" — mesclar() (ação manual) recusa em vez de
    corromper, diferente de consolidar() (automático), que só sinaliza
    unidades_divergentes (achado da auditoria 2026-08-11)."""
    pca_builder.gerar_minuta(db, 2027, {"margem": 0})
    itens = pca_builder.listar_minuta(db, 2027)
    filtro = next(i for i in itens if i["chave"] == "FILTRO AR MOTOR")
    papel = next(i for i in itens if "PAPEL" in i["chave"])
    assert filtro["unidade"] == "UND" and papel["unidade"] == "RESMA"
    r = pca_builder.mesclar(db, 2027, [filtro["id"], papel["id"]])
    assert r["ok"] is False
    assert "UND" in r["erro"] and "RESMA" in r["erro"]
    # nada foi tocado
    assert pca_builder.listar_minuta(db, 2027) == itens


def test_mesclar_exige_dois_itens(db):
    pca_builder.gerar_minuta(db, 2027, {})
    itens = pca_builder.listar_minuta(db, 2027)
    assert pca_builder.mesclar(db, 2027, [itens[0]["id"]])["ok"] is False


def test_dividir_restaura_os_originais(db):
    db.executemany(
        "INSERT INTO pca_minuta_itens (id, ano_alvo, chave, descricao,"
        " unidade, quantidade, valor_unitario, margem, incluir, origem)"
        " VALUES (?,2027,?,?,?,?,?,0,1,'{}')",
        [(1, "FILTRO A", "Filtro A", "UND", 200, 100.0),
         (2, "FILTRO B", "Filtro B", "UND", 50, 20.0)])
    db.commit()
    antes = pca_builder.listar_minuta(db, 2027)
    ids = [antes[0]["id"], antes[1]["id"]]
    originais = {(i["chave"], i["quantidade"]) for i in antes[:2]}
    pca_builder.mesclar(db, 2027, ids)
    fundido = next(i for i in pca_builder.listar_minuta(db, 2027)
                   if i["mesclado"])
    r = pca_builder.dividir(db, fundido["id"])
    assert r["ok"] and r["itens"] == 2
    depois = pca_builder.listar_minuta(db, 2027)
    assert len(depois) == len(antes)
    assert originais <= {(i["chave"], i["quantidade"]) for i in depois}


def test_dividir_recusa_item_nao_mesclado(db):
    pca_builder.gerar_minuta(db, 2027, {})
    item = pca_builder.listar_minuta(db, 2027)[0]
    assert pca_builder.dividir(db, item["id"])["ok"] is False


def test_marca_unidade_divergente(db):
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
               " numero_item, descricao, unidade, quantidade_homologada,"
               " valor_unitario_homologado, data_resultado)"
               " VALUES ('f','C',2025,1,9,'FILTRO DE AR DO MOTOR W','CX',10,"
               "95.0,'2025-09-01')")
    db.commit()
    g = {x["chave"]: x for x in pca_builder.consolidar(db)[0]}
    assert g["FILTRO AR MOTOR"]["unidades_divergentes"] is True


def test_delta_vs_ano_anterior(db):
    """Melhoria pedida (2026-08-30): comparar às cegas com o ano passado é
    o jeito mais rápido de pegar item fora da curva na revisão."""
    pca_builder.gerar_minuta(db, 2026, {"margem": 0})
    itens = pca_builder.listar_minuta(db, 2026)
    # 2026 ainda não tem ano anterior gerado: sem comparação
    assert all(i["valor_ano_anterior"] is None for i in itens)
    pca_builder.gerar_minuta(db, 2027, {"margem": 0})
    itens_2027 = pca_builder.listar_minuta(db, 2027)
    filtro = next(i for i in itens_2027 if i["chave"] == "FILTRO AR MOTOR")
    filtro_2026 = next(i for i in itens if i["chave"] == "FILTRO AR MOTOR")
    assert filtro["valor_ano_anterior"] == filtro_2026["valor_total"]


def test_ata_vigente_cobre_o_item(db):
    """Melhoria pedida (2026-08-30): item já coberto por ARP em vigor pode
    não precisar entrar de novo no plano — o sistema já sabe quais atas
    estão vigentes, só faltava cruzar com a minuta."""
    # item de outra contratação, sem ata nenhuma vinculada — controle
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
              " numero_item, descricao, unidade, quantidade_homologada,"
              " valor_unitario_homologado, data_resultado)"
              " VALUES ('sem_ata','OUTRA',2025,1,60,"
              "'TONER IMPRESSORA LASER PRETO','UND',5,300.0,'2025-06-01')")
    db.execute("INSERT INTO atas (numero_controle, contratacao_controle,"
              " numero_ata, ano_ata, vigencia_fim)"
              " VALUES ('AT1','C','7',2026, date('now','+180 day'))")
    db.commit()
    pca_builder.gerar_minuta(db, 2027, {})
    itens = pca_builder.listar_minuta(db, 2027)
    filtro = next(i for i in itens if i["chave"] == "FILTRO AR MOTOR")
    assert filtro["ata_vigente"]["numero_ata"] == "7"
    toner = next(i for i in itens if "TONER" in i["chave"])
    assert toner["ata_vigente"] is None
