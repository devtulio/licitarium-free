"""Testes da orquestração de sync do Licitarium sobre o motor_pncp.

O HTTP resiliente (retry, paralelismo, disjuntor) mudou de dono — mora em
`motor_pncp` agora, com sua própria suíte (repo devtulio/motor-pncp). Aqui
só interessa o que é deste projeto: schema, upsert, orquestração de fases
e escopo — testado com um `FakeMotor` que imita a superfície pública do
`Motor` real, sem rede nenhuma.
"""
import sqlite3
import sys
import unittest.mock
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motor_pncp.tipos import (
    Ata,
    Contratacao,
    Contrato,
    Item,
    Orgao,
    PlanoPca,
    Resultado,
)

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


class FakeMotor:
    """Dublê do `Motor` — mesma superfície pública, cada método delega
    pra uma função que o teste fornece. Sem rede nenhuma; ver
    `motor_pncp.tipos` pros dataclasses reais que o motor devolveria."""

    def __init__(self, *, contratacoes=None, contratos=None, atas=None,
                pca=None, itens_e_resultados=None, ipca=None,
                consultar_orgao=None, contar_contratacoes=None):
        self._contratacoes = contratacoes or (lambda ibge, inicio, fim: iter(()))
        self._contratos = contratos or (lambda cnpj, inicio, fim: iter(()))
        self._atas = atas or (lambda cnpj, inicio, fim: iter(()))
        self._pca = pca or (lambda cnpj, inicio, fim: iter(()))
        self._itens_e_resultados = itens_e_resultados or (
            lambda pendentes, **kw: iter(()))
        self._ipca = ipca or (lambda inicio=None: iter(()))
        self._consultar_orgao = consultar_orgao or (lambda cnpj: None)
        self._contar_contratacoes = contar_contratacoes or (
            lambda ibge, inicio, fim: {"total": 0, "parcial": False})

    def contratacoes(self, codigo_ibge, inicio, fim):
        return self._contratacoes(codigo_ibge, inicio, fim)

    def contratos(self, cnpj, inicio, fim):
        return self._contratos(cnpj, inicio, fim)

    def atas(self, cnpj, inicio, fim):
        return self._atas(cnpj, inicio, fim)

    def pca(self, cnpj, inicio, fim):
        return self._pca(cnpj, inicio, fim)

    def itens_e_resultados(self, pendentes, *, pendente=None, on_erro=None):
        return self._itens_e_resultados(pendentes, pendente=pendente,
                                        on_erro=on_erro)

    def ipca(self, inicio=None):
        return self._ipca(inicio)

    def consultar_orgao(self, cnpj):
        return self._consultar_orgao(cnpj)

    def contar_contratacoes(self, codigo_ibge, inicio, fim):
        return self._contar_contratacoes(codigo_ibge, inicio, fim)


def vazio():
    """FakeMotor cujas fases não geram nada — o padrão pros testes que só
    querem exercitar orquestração (janelas, intervalo mínimo etc.)."""
    return FakeMotor()


# ── upsert / schema ──────────────────────────────────────────────────────

def test_sync_contratacoes_idempotente(db):
    raws = [contratacao("PNCP-1"), contratacao("PNCP-2")]
    motor = FakeMotor(contratacoes=lambda i, a, b: (Contratacao(r) for r in raws))
    n1 = pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1),
                                motor=motor)
    n2 = pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1),
                                motor=motor)
    assert n1 == n2 == 2
    assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 2
    linha = db.execute("SELECT * FROM contratacoes WHERE numero_controle='PNCP-1'"
                       ).fetchone()
    assert linha["orgao_cnpj"] == "11111111000111"
    assert linha["valor_homologado"] == 90.0
    assert linha["referencia"] == 0
    assert "numeroControlePNCP" in linha["raw"]


def test_sync_contratacoes_commita_em_lote_nao_so_no_fim(db):
    """"database is locked" em set_config (achado do usuário, v1.60.11):
    a fase só commitava no `finally`, depois do gerador inteiro — a
    transação ficava aberta pelos minutos inteiros da sincronização,
    segurando o lock de escrita além do busy_timeout de qualquer escritor
    concorrente (a ponte JS chamando set_config, por exemplo). Agora tem
    que soltar o lock a cada _COMMIT_A_CADA linhas, não só ao final.
    """
    raws = [contratacao(f"PNCP-{i}") for i in range(pncp._COMMIT_A_CADA + 5)]
    motor = FakeMotor(contratacoes=lambda i, a, b: (Contratacao(r) for r in raws))
    espiao = unittest.mock.MagicMock(wraps=db)  # commit() conta, resto vai pro banco real
    pncp.sync_contratacoes(espiao, "3534203", date(2026, 1, 1), date(2026, 3, 1),
                           motor=motor)
    assert espiao.commit.call_count >= 2, \
        "só commitou no fim — lock ficaria preso o sync inteiro"


def test_falha_no_meio_grava_o_que_veio_mas_nao_da_a_fase_por_completa(db):
    """Uma falha no meio do gerador não pode apagar o que já veio antes
    dela, e `sincronizar_tudo` não pode carimbar `last_sync_contratacoes`
    — senão o resto vira buraco permanente no acervo."""
    def gerador(ibge, inicio, fim):
        yield Contratacao(contratacao("PNCP-1"))
        raise pncp.PncpErro("2 de 13 consultas falharam")
    motor = FakeMotor(contratacoes=gerador)
    with pytest.raises(pncp.PncpErro):
        pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1),
                               motor=motor)
    assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 1
    assert pncp._config(db, "last_sync_contratacoes") is None


def test_descobrir_orgaos(db):
    db.executemany(
        "INSERT INTO contratacoes (numero_controle, referencia, orgao_cnpj,"
        " orgao_nome) VALUES (?,0,?,?)",
        [("A", "11111111000111", "Prefeitura A"),
         ("B", "22222222000122", "Prefeitura B")])
    db.commit()
    pncp.descobrir_orgaos(db)
    cnpjs = {r[0] for r in db.execute("SELECT cnpj FROM orgaos")}
    assert cnpjs == {"11111111000111", "22222222000122"}
    # rodar de novo não duplica nem desfaz desativação manual
    db.execute("UPDATE orgaos SET ativo=0 WHERE cnpj='22222222000122'")
    pncp.descobrir_orgaos(db)
    assert db.execute("SELECT COUNT(*) FROM orgaos").fetchone()[0] == 2
    assert db.execute("SELECT ativo FROM orgaos WHERE cnpj='22222222000122'"
                      ).fetchone()[0] == 0


def test_num_converte_ou_devolve_none():
    assert pncp._num(100.0) == 100.0
    assert pncp._num("90") == 90.0
    assert pncp._num("") is None
    assert pncp._num(None) is None
    assert pncp._num("não é número") is None


def test_valor_malformado_do_pncp_nao_vira_text_na_coluna_real(db):
    """Sem _num(), item.get("valorTotalEstimado") gravava a string crua —
    afinidade do SQLite não converte TEXT numa coluna REAL, e o valor-lixo
    quebrava relatorios.py mais tarde (moeda(), sum() em Python, filtro
    "> 0" do SQL). "N/D" é não vazio — não pega o `or 0` que mascararia
    string vazia — e ainda assim não é número."""
    raw = contratacao("PNCP-X", valorTotalEstimado="N/D", valorTotalHomologado=None)
    motor = FakeMotor(contratacoes=lambda i, a, b: iter([Contratacao(raw)]))
    pncp.sync_contratacoes(db, "3534203", date(2026, 1, 1), date(2026, 3, 1),
                           motor=motor)
    linha = db.execute("SELECT valor_estimado, valor_homologado FROM"
                       " contratacoes WHERE numero_controle='PNCP-X'").fetchone()
    assert linha["valor_estimado"] is None
    assert linha["valor_homologado"] is None


def test_consultar_orgao_devolve_dict_cru_ou_none():
    """`licitarium.py` espera o dict cru (`.get("razaoSocial")`,
    `.get("esferaId")`) — não o tipo do motor. Trocar isso é risco maior
    que o ganho de tipagem aqui."""
    raw = {"cnpj": "111", "razaoSocial": "Prefeitura X", "esferaId": "M"}
    motor = FakeMotor(consultar_orgao=lambda cnpj: Orgao(raw))
    assert pncp.consultar_orgao("111", motor=motor) == raw

    motor_vazio = FakeMotor(consultar_orgao=lambda cnpj: None)
    assert pncp.consultar_orgao("999", motor=motor_vazio) is None


def test_estimar_volume_usa_contar_contratacoes():
    motor = FakeMotor(contar_contratacoes=lambda ibge, inicio, fim:
                      {"total": 100, "parcial": False})
    r = pncp.estimar_volume("3534203", motor=motor)
    assert r["contratacoes"] == 100
    assert r["parcial"] is False
    assert r["itens"] == round(100 * pncp.ITENS_POR_CONTRATACAO)


# ── contratos, atas, PCA (fase 2) ────────────────────────────────────────

def test_sync_contratos_idempotente(db):
    raw = {"numeroControlePNCP": "CT-1", "numeroControlePncpCompra": "C1",
          "orgaoEntidade": {"cnpj": "111"}, "numeroContratoEmpenho": "44/2026",
          "anoContrato": 2026, "sequencialContrato": 44,
          "niFornecedor": "999", "nomeRazaoSocialFornecedor": "FORN X",
          "objetoContrato": "objeto", "valorGlobal": 5000.0,
          "dataVigenciaInicio": "2026-01-01", "dataVigenciaFim": "2026-12-31",
          "dataPublicacaoPncp": "2026-01-05", "dataAtualizacao": "2026-01-05"}
    motor = FakeMotor(contratos=lambda cnpj, i, f: iter([Contrato(raw)]))
    n1 = pncp.sync_contratos(db, "111", date(2026, 1, 1), date(2026, 2, 1), motor=motor)
    n2 = pncp.sync_contratos(db, "111", date(2026, 1, 1), date(2026, 2, 1), motor=motor)
    assert n1 == n2 == 1
    linha = db.execute("SELECT * FROM contratos WHERE numero_controle='CT-1'").fetchone()
    assert linha["fornecedor_nome"] == "FORN X"
    assert linha["valor_global"] == 5000.0


def test_sync_atas_idempotente(db):
    raw = {"numeroControlePNCPAta": "AT-1", "numeroControlePNCPCompra": "C1",
          "cnpjOrgao": "111", "numeroAtaRegistroPreco": "7", "anoAta": 2026,
          "objetoContratacao": "objeto", "vigenciaInicio": "2026-01-01",
          "vigenciaFim": "2027-01-01", "dataAtualizacao": "2026-01-05"}
    motor = FakeMotor(atas=lambda cnpj, i, f: iter([Ata(raw)]))
    n = pncp.sync_atas(db, "111", date(2026, 1, 1), date(2026, 2, 1), motor=motor)
    assert n == 1
    linha = db.execute("SELECT * FROM atas WHERE numero_controle='AT-1'").fetchone()
    assert linha["numero_ata"] == "7"


def test_sync_pca_achata_itens_do_plano(db):
    """PCA achata itens do plano; contexto do plano vai em cada linha."""
    plano_raw = {"idPcaPncp": "111-0-000001/2026", "anoPca": 2026,
                "orgaoEntidadeCnpj": "11111111000111", "nomeUnidade": "Sec. Adm",
                "itens": [
                    {"numeroItem": 1, "descricaoItem": "Papel A4",
                     "nomeClassificacaoCatalogo": "Material",
                     "quantidadeEstimada": 100.0, "valorTotal": 2500.0},
                    {"numeroItem": 2, "descricaoItem": "Consultoria",
                     "nomeClassificacaoCatalogo": "Serviço",
                     "quantidadeEstimada": 1.0, "valorTotal": 30000.0}]}
    motor = FakeMotor(pca=lambda cnpj, i, f: iter([PlanoPca(plano_raw)]))
    n1 = pncp.sync_pca(db, "11111111000111", date(2026, 1, 1), date(2026, 2, 1),
                       motor=motor)
    n2 = pncp.sync_pca(db, "11111111000111", date(2026, 1, 1), date(2026, 2, 1),
                       motor=motor)
    assert n1 == n2 == 2
    assert db.execute("SELECT COUNT(*) FROM pca_itens").fetchone()[0] == 2
    linha = db.execute(
        "SELECT * FROM pca_itens WHERE id='111-0-000001/2026#1'").fetchone()
    assert linha["descricao"] == "Papel A4"
    assert linha["ano"] == 2026


# ── fases de sincronização / itens ───────────────────────────────────────

def test_sync_itens_grava_resultado_e_marca_versao(db):
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C1', 2026, 30, '111', '2026-07-01', '2026-06-01')")
    db.commit()
    item_raw = {"numeroItem": 1, "descricao": "PAPEL A4", "unidadeMedida": "RESMA",
               "quantidade": 100.0, "valorUnitarioEstimado": 24.9,
               "valorTotal": 2490.0, "temResultado": True,
               "dataAtualizacao": "2026-06-20",
               "materialOuServicoNome": "Material",
               "situacaoCompraItemNome": "Homologado"}
    resultado_raw = {"niFornecedor": "999", "nomeRazaoSocialFornecedor": "FORN X",
                     "valorUnitarioHomologado": 18.75, "valorTotalHomologado": 1875.0,
                     "quantidadeHomologada": 100.0, "dataResultado": "2026-06-20"}

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            item = Item(dict(item_raw))
            if pendente(c, item):
                yield c, [(item, Resultado(resultado_raw))]
            else:
                yield c, []
    motor = FakeMotor(itens_e_resultados=gerador)

    assert pncp.sync_itens(db, motor=motor) == 1
    r = db.execute("SELECT * FROM itens").fetchone()
    assert r["id"] == "C1#1"
    assert r["valor_unitario_homologado"] == 18.75
    assert r["fornecedor_nome"] == "FORN X"
    assert r["descricao"] == "PAPEL A4"
    # contratação marcada com a versão coletada: não revisita sem alteração
    assert db.execute("SELECT itens_versao FROM contratacoes").fetchone()[0] \
        == "2026-07-01"
    assert pncp.sync_itens(db, motor=motor) == 0

    # contratação alterada no PNCP volta para a fila, mas o item continua o
    # mesmo: relê a listagem e para por aí, sem regravar nada
    db.execute("UPDATE contratacoes SET data_atualizacao='2026-07-15'")
    db.commit()
    assert pncp.sync_itens(db, motor=motor) == 0

    # item alterado de verdade é recoletado
    item_raw["dataAtualizacao"] = "2026-07-14"
    item_raw["valorUnitarioEstimado"] = 26.0
    db.execute("UPDATE contratacoes SET data_atualizacao='2026-07-16'")
    db.commit()
    assert pncp.sync_itens(db, motor=motor) == 1
    assert db.execute(
        "SELECT valor_unitario_estimado FROM itens").fetchone()[0] == 26.0


def test_sync_itens_preenche_fornecedor_da_ata_vinculada(db):
    """A ata (ARP) não traz fornecedor no próprio JSON do PNCP — só o
    resultado do item da contratação de origem tem. Pedido do usuário
    (2026-08-30): CNPJ/razão social do fornecedor na planilha de atas."""
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C1', 2026, 30, '111', '2026-07-01', '2026-06-01')")
    db.execute(
        "INSERT INTO atas (numero_controle, contratacao_controle)"
        " VALUES ('A1', 'C1')")
    db.commit()
    item_raw = {"numeroItem": 1, "descricao": "PAPEL A4", "temResultado": True,
               "dataAtualizacao": "2026-06-20"}
    resultado_raw = {"niFornecedor": "999", "nomeRazaoSocialFornecedor": "FORN X",
                     "dataResultado": "2026-06-20"}

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            yield c, [(Item(item_raw), Resultado(resultado_raw))]
    motor = FakeMotor(itens_e_resultados=gerador)

    pncp.sync_itens(db, motor=motor)
    ata = db.execute("SELECT fornecedor_ni, fornecedor_nome FROM atas"
                     " WHERE numero_controle='A1'").fetchone()
    assert ata["fornecedor_ni"] == "999"
    assert ata["fornecedor_nome"] == "FORN X"


def test_item_inalterado_nao_custa_busca_nem_apaga_preco(db):
    """A economia da revisita não pode custar o preço já homologado.
    `_upsert_item` é INSERT OR REPLACE: regravar um item sem resultado
    zeraria o valor homologado. Item inalterado é pulado por completo —
    `pendente()` devolve False e o motor nem chega a buscar resultado."""
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao)"
        " VALUES ('C9', 2026, 7, '111', 'v1', '2026-01-01')")
    db.execute(
        "INSERT INTO itens (id, contratacao_controle, numero_item, descricao,"
        " data_atualizacao, tem_resultado, valor_unitario_homologado)"
        " VALUES ('C9#1', 'C9', 1, 'CANETA', '2026-05-05', 1, 3.5)")
    db.commit()
    item_raw = {"numeroItem": 1, "descricao": "CANETA", "temResultado": True,
               "dataAtualizacao": "2026-05-05"}
    buscou_resultado = []

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            item = Item(item_raw)
            if not pendente(c, item):
                yield c, []
                continue
            buscou_resultado.append(True)
            yield c, [(item, Resultado({"valorUnitarioHomologado": 99.0}))]
    motor = FakeMotor(itens_e_resultados=gerador)

    assert pncp.sync_itens(db, motor=motor) == 0
    assert not buscou_resultado
    assert db.execute(
        "SELECT valor_unitario_homologado FROM itens").fetchone()[0] == 3.5

    # resultado que faltou (coleta interrompida) é buscado mesmo com a
    # dataAtualizacao intacta — ela não muda por causa disso
    db.execute("UPDATE itens SET valor_unitario_homologado=NULL")
    db.execute("UPDATE contratacoes SET itens_versao=NULL")
    db.commit()
    assert pncp.sync_itens(db, motor=motor) == 1
    assert db.execute(
        "SELECT valor_unitario_homologado FROM itens").fetchone()[0] == 99.0


def test_sync_itens_sem_resultado_nao_busca_vencedor(db):
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao) VALUES ('C2', 2026, 5, '111', 'x')")
    db.commit()
    item_raw = {"numeroItem": 7, "descricao": "CANETA", "temResultado": False,
               "valorUnitarioEstimado": 1.9}

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            yield c, [(Item(item_raw), None)]
    motor = FakeMotor(itens_e_resultados=gerador)

    assert pncp.sync_itens(db, motor=motor) == 1
    r = db.execute("SELECT * FROM itens").fetchone()
    assert r["tem_resultado"] == 0 and r["valor_unitario_homologado"] is None


def test_404_na_listagem_de_itens_nao_vira_ausencia(tmp_path, monkeypatch):
    """404 sob carga é portal ocupado, não "esta contratação não tem item".
    Antes o 404 virava lista vazia, `itens_versao` era carimbado e a
    contratação NUNCA MAIS era revisitada — os preços dela sumiam do banco
    em silêncio (auditoria de falha silenciosa, 2026-08-09). `on_erro` com
    `ItensIndisponiveis` é como o motor sinaliza isso agora."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, orgao_cnpj, ano,"
               " sequencial, data_atualizacao, objeto)"
               " VALUES ('C','111',2026,7,'2026-01-01','x')")
    db.commit()

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            on_erro(c, pncp.ItensIndisponiveis("HTTP 404 na listagem"))
        yield from ()
    motor = FakeMotor(itens_e_resultados=gerador)

    assert pncp.sync_itens(db, motor=motor) == 0
    # a contratação continua pendente: itens_versao não foi carimbado
    versao = db.execute("SELECT itens_versao FROM contratacoes"
                        " WHERE numero_controle='C'").fetchone()[0]
    assert versao is None
    # e o usuário fica sabendo, em Configurações → Sincronizações recentes
    log = db.execute("SELECT status, erro FROM sync_log"
                     " WHERE tipo='itens'").fetchone()
    assert log[0] == "aviso" and "404" in log[1]
    db.close()


def test_contratacao_quebrada_nao_trava_as_outras(db):
    """Medido no acervo real (2026-09-05): a mesma contratação (orgao_cnpj
    + compra) falhava e, como a fila é ordenada da mais recente pra mais
    antiga, travava a fase inteira em TODA sincronização — sempre no
    mesmo lugar. `on_erro` sem o disjuntor disparar (aqui, o FakeMotor
    nunca levanta PncpErro) deixa o motor seguir pras demais."""
    db.executemany(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao) VALUES (?,?,?,?,?,?)",
        [("QUEBRADA", 2026, 1, "999", "2026-07-01", "2026-06-02"),
         ("BOA", 2026, 1, "111", "2026-07-01", "2026-06-01")])
    db.commit()
    item_raw = {"numeroItem": 1, "descricao": "PAPEL A4", "temResultado": False,
               "dataAtualizacao": "2026-06-20"}

    def gerador(pendentes, *, pendente, on_erro):
        for c in pendentes:
            if c["numero_controle"] == "QUEBRADA":
                on_erro(c, pncp.PncpErro("HTTP 503 persistente"))
                continue
            yield c, [(Item(item_raw), None)]
    motor = FakeMotor(itens_e_resultados=gerador)

    assert pncp.sync_itens(db, motor=motor) == 1  # a boa gravou mesmo assim
    linhas = {r["numero_controle"]: r["itens_versao"]
             for r in db.execute("SELECT numero_controle, itens_versao FROM contratacoes")}
    assert linhas["BOA"] == "2026-07-01"       # marcada, não revisita
    assert linhas["QUEBRADA"] is None          # continua pendente
    aviso = db.execute(
        "SELECT erro FROM sync_log WHERE tipo='itens' AND status='aviso'"
    ).fetchone()
    assert aviso and "QUEBRADA" in aviso["erro"]


def test_sync_itens_propaga_pncperro_do_disjuntor(db):
    """Quando o motor decide que a fase morreu, levanta `PncpErro` — o que
    já entrou fica gravado (upsert já commitado por contratação), e a
    exceção sobe pra `sincronizar_tudo` não avançar `last_sync_itens`."""
    db.executemany(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " orgao_cnpj, data_atualizacao, data_publicacao) VALUES (?,2026,1,?,?,?)",
        [(f"C{i}", str(i), "2026-07-01", f"2026-06-{i + 1:02d}") for i in range(5)])
    db.commit()

    processada = {}

    def gerador(pendentes, *, pendente, on_erro):
        processada["numero"] = pendentes[0]["numero_controle"]
        yield pendentes[0], [(Item({"numeroItem": 1, "temResultado": False,
                                    "dataAtualizacao": "x"}), None)]
        raise pncp.PncpErro("parado após 5 falhas seguidas")
    motor = FakeMotor(itens_e_resultados=gerador)

    with pytest.raises(pncp.PncpErro):
        pncp.sync_itens(db, motor=motor)
    # a primeira já tinha sido gravada e commitada antes do erro subir
    assert db.execute("SELECT itens_versao FROM contratacoes WHERE"
                      " numero_controle=?", (processada["numero"],)
                      ).fetchone()[0] is not None


def test_listagem_vazia_de_verdade_carimba_normalmente(tmp_path, monkeypatch):
    """O contrário do teste de 404: contratação sem nenhum item pendente
    (o motor devolve lista vazia, não erro) tem de ser dada por resolvida
    — senão o sync revisita ela para sempre."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t2.db")
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, orgao_cnpj, ano,"
               " sequencial, data_atualizacao, objeto)"
               " VALUES ('C','111',2026,7,'2026-01-01','x')")
    db.commit()
    motor = FakeMotor(itens_e_resultados=lambda pendentes, **kw:
                      ((c, []) for c in pendentes))

    pncp.sync_itens(db, motor=motor)
    versao = db.execute("SELECT itens_versao FROM contratacoes"
                        " WHERE numero_controle='C'").fetchone()[0]
    assert versao == "2026-01-01"
    db.close()


def test_watermark_contratos_e_por_cnpj(db):
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

    def fake_contratos(cnpj, inicio, fim):
        if cnpj == "RUIM":
            raise pncp.PncpErro("PNCP fora do ar")
        return iter(())
    motor = FakeMotor(contratos=fake_contratos)

    pncp.sincronizar_tudo(db, "3534203", motor=motor)
    assert pncp._config(db, "last_sync_contratos_BOM") is not None
    assert pncp._config(db, "last_sync_contratos_RUIM") is None


# ── ipca ──────────────────────────────────────────────────────────────────

def test_ipca_desde_sem_sync_anterior_usa_serie_inteira(db):
    """Primeira vez: `motor.ipca()` decide o início (2021) sozinho."""
    assert pncp._ipca_desde(db) is None


def test_ipca_desde_com_sync_anterior_recorta_60_dias(db):
    """Depois da primeira vez, não rebaixa mais a série inteira — só os
    últimos ~60 dias, folga suficiente pro BCB revisar o mês corrente."""
    pncp._config(db, "last_sync_ipca", "2026-09-05")
    assert pncp._ipca_desde(db) == "07/07/2026"


def test_sync_ipca_grava_por_competencia(db, monkeypatch):
    monkeypatch.setattr(pncp, "ipca", lambda inicio, **kw: iter([
        {"competencia": "2026-01", "variacao": 0.5},
        {"competencia": "2026-02", "variacao": 0.3}]))
    assert pncp.sync_ipca(db) == 2
    linhas = {r["competencia"]: r["variacao"] for r in db.execute("SELECT * FROM ipca")}
    assert linhas == {"2026-01": 0.5, "2026-02": 0.3}


def test_sincronizar_tudo_nao_rebaixa_ipca_inteiro_na_segunda_chamada(db, monkeypatch):
    """`sincronizar_tudo` chamado várias vezes seguidas não pode
    redownloadar a série inteira do IPCA em toda chamada — só a primeira."""
    inicios = []

    def fake_ipca(inicio=None, **kw):
        inicios.append(inicio)
        return iter(())
    monkeypatch.setattr(pncp, "ipca", fake_ipca)
    motor = FakeMotor()

    pncp.sincronizar_tudo(db, "3534203", motor=motor)
    pncp.sincronizar_tudo(db, "3534203", motor=motor)
    assert inicios[0] is None          # primeira: série inteira
    assert inicios[1] is not None      # segunda: recorte incremental


# ── orquestração / sincronizar_tudo ─────────────────────────────────────

def test_sincronizar_tudo_continua_apos_falha(db):
    motor = FakeMotor(
        contratacoes=lambda i, a, b: iter([Contratacao(contratacao("PNCP-1"))]),
        contratos=lambda cnpj, i, f: (_ for _ in ()).throw(
            pncp.PncpErro("PNCP fora do ar")))
    resumo = pncp.sincronizar_tudo(db, "3534203", motor=motor)
    assert resumo["contratacoes"] == 1
    assert resumo["contratos"] is None     # falhou, não bloqueou o resto
    assert resumo["atas"] == 0
    assert resumo["itens"] == 0            # fase 3 rodou por último, sem pendente
    # last_sync só avança para quem concluiu
    assert pncp._config(db, "last_sync_contratacoes") is not None
    erros = db.execute("SELECT COUNT(*) FROM sync_log WHERE status='erro'"
                       ).fetchone()[0]
    assert erros >= 1


def test_sincronizar_tudo_escopo_tudo_sincroniza_referencia(db):
    """Fase 2 do reencaixe (município de referência): `escopo="tudo"`
    (o default) sincroniza tanto o próprio município quanto os de
    referência cadastrados, gravando referencia=1 nos últimos."""
    db.execute("INSERT INTO municipios_referencia (ibge, nome, uf) "
               "VALUES ('3552205', 'Olímpia', 'SP')")
    db.commit()
    ibges_vistos = []

    def fake_contratacoes(ibge, inicio, fim):
        ibges_vistos.append(ibge)
        return iter([Contratacao(contratacao(f"PNCP-{ibge}"))])
    motor = FakeMotor(contratacoes=fake_contratacoes)

    pncp.sincronizar_tudo(db, "3534203", motor=motor)
    assert ibges_vistos == ["3534203", "3552205"]
    assert pncp._config(db, "last_sync_ref_3552205") is not None
    linha = db.execute(
        "SELECT referencia FROM contratacoes WHERE numero_controle=?",
        ("PNCP-3552205",)).fetchone()
    assert linha["referencia"] == 1
    linha_propria = db.execute(
        "SELECT referencia FROM contratacoes WHERE numero_controle=?",
        ("PNCP-3534203",)).fetchone()
    assert linha_propria["referencia"] == 0


def test_sincronizar_tudo_escopo_proprio_pula_referencia(db):
    """`escopo="proprio"` sincroniza só o próprio município — sem chamar
    contratações para municípios de referência cadastrados."""
    db.execute("INSERT INTO municipios_referencia (ibge, nome, uf) "
               "VALUES ('3552205', 'Olímpia', 'SP')")
    db.commit()
    ibges_vistos = []

    def fake_contratacoes(ibge, inicio, fim):
        ibges_vistos.append(ibge)
        return iter(())
    motor = FakeMotor(contratacoes=fake_contratacoes)

    pncp.sincronizar_tudo(db, "3534203", motor=motor, escopo="proprio")
    assert ibges_vistos == ["3534203"]
    assert pncp._config(db, "last_sync_ref_3552205") is None


def test_sincronizar_tudo_escopo_invalido_levanta(db):
    with pytest.raises(ValueError):
        pncp.sincronizar_tudo(db, "3534203", motor=vazio(), escopo="chute")


def test_sync_incremental_com_sobreposicao(db):
    """Segunda rodada parte de last_sync - 1 dia (catch-up seguro)."""
    janelas_vistas = []

    def gerador(ibge, inicio, fim):
        janelas_vistas.append(inicio)
        return iter(())
    motor = FakeMotor(contratacoes=gerador)
    pncp._config(db, "last_sync_contratacoes", "2026-07-20")
    pncp.sincronizar_tudo(db, "1", motor=motor)
    assert janelas_vistas and all(d == date(2026, 7, 19) for d in janelas_vistas)


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


# ── parada da coleta a pedido do usuário ────────────────────────────────

def test_cancelamento_interrompe_e_nao_carimba_janela(db):
    """Parar no meio não pode deixar o acervo dizendo que sincronizou.
    O `last_sync_<tipo>` é o que decide de onde a próxima coleta parte."""
    def gerador(ibge, inicio, fim):
        yield Contratacao(contratacao("PNCP-1"))
        raise pncp.SyncCancelado()
    motor = FakeMotor(contratacoes=gerador)

    with pytest.raises(pncp.SyncCancelado):
        pncp.sincronizar_tudo(db, "3534203", motor=motor)

    # nenhuma janela foi dada como concluída
    for tipo in ("contratacoes", "itens"):
        assert pncp._config(db, f"last_sync_{tipo}") is None, tipo
    # mas o que já veio antes do cancelamento ficou gravado
    assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 1


def test_cancelamento_nao_e_engolido_pelo_tratamento_de_falha(db):
    """SyncCancelado não pode herdar de PncpErro. `sincronizar_tudo`
    engole PncpErro de propósito, para que a falha de um tipo não derrube
    os outros — se o cancelamento caísse nesse balde, a coleta seguiria
    para a fase seguinte em vez de parar. Quem levanta, na coleta real, é
    o `progresso` passado ao `Motor` — aqui simulado direto no gerador de
    uma fase, já que o `FakeMotor` não invoca `progresso` sozinho."""
    assert not issubclass(pncp.SyncCancelado, pncp.PncpErro)

    def gerador(ibge, inicio, fim):
        raise pncp.SyncCancelado()
        yield  # pragma: no cover — inalcançável, só faz disto um gerador
    motor = FakeMotor(contratacoes=gerador)

    with pytest.raises(pncp.SyncCancelado):
        pncp.sincronizar_tudo(db, "3534203", motor=motor)


def test_api_para_a_coleta_pelo_progresso():
    """A Api levanta o cancelamento de dentro da própria função de
    progresso — é o ponto único por onde a coleta passa."""
    api = licitarium.Api()
    api._status["rodando"] = True

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


def test_separar_fornecedores_uma_linha_por_fornecedor():
    """Pedido do usuário (2026-08-30): "separar cada ata com seu respectivo
    fornecedor, como na planilha de contratos" — a ARP pode ter mais de um
    vencedor (vários itens); `_atualizar_fornecedor_ata` guarda agregado
    pareado por posição, `separar_fornecedores` desfaz em linhas."""
    linhas = [
        {"numero_controle": "A1",
         "fornecedor_ni": f"111{pncp.SEPARADOR_FORNECEDOR}222",
         "fornecedor_nome": f"FORN X{pncp.SEPARADOR_FORNECEDOR}FORN Y"},
        {"numero_controle": "A2", "fornecedor_ni": None, "fornecedor_nome": None},
    ]
    r = pncp.separar_fornecedores(linhas)
    assert len(r) == 3
    assert r[0] == {"numero_controle": "A1", "fornecedor_ni": "111",
                    "fornecedor_nome": "FORN X"}
    assert r[1] == {"numero_controle": "A1", "fornecedor_ni": "222",
                    "fornecedor_nome": "FORN Y"}
    assert r[2] == linhas[1]  # sem fornecedor: passa direto, sem duplicar
