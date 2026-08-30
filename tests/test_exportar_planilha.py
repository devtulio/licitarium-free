"""Exportação da lista em planilha (.xlsx) — substituiu o CSV cru
(pedido do usuário, 2026-08-29): colunas curadas (sem `raw`/`sync_em`),
cabeçalho traduzido.
"""
import json
import sys
from pathlib import Path

import openpyxl
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium


class JanelaFalsa:
    def __init__(self, resposta=None):
        self.resposta = resposta

    def create_file_dialog(self, tipo, **kwargs):
        return self.resposta


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    raw = json.dumps({"amparoLegal": {"nome": "Art. 75, II"}})
    db.execute(
        "INSERT INTO contratacoes (numero_controle, ano, sequencial,"
        " modalidade_nome, orgao_nome, unidade, objeto, situacao,"
        " valor_estimado, valor_homologado, data_publicacao, raw, sync_em)"
        " VALUES ('C1',2026,10,'Dispensa','Prefeitura','Sec. Adm',"
        " 'Aquisição de merenda escolar','Homologada',1000.0,900.0,"
        " '2026-03-01',?,'2026-03-02T10:00:00')", (raw,))
    db.commit()
    db.close()
    api = licitarium.Api()
    api._janela = JanelaFalsa()
    return api


def test_exportar_lista_cura_colunas_e_traduz_cabecalho(api, tmp_path):
    destino = tmp_path / "contratacoes.xlsx"
    api._janela.resposta = str(destino)

    r = api.exportar_planilha("contratacoes", {})
    assert r["ok"] and r["linhas"] == 1

    ws = openpyxl.load_workbook(destino).active
    cabecalho = [c.value for c in ws[1]]
    # colunas técnicas/internas não vazam pra planilha do usuário
    assert "raw" not in cabecalho and "sync_em" not in cabecalho
    assert "OBJETO" in cabecalho and "SITUAÇÃO" in cabecalho
    assert "VALOR HOMOLOGADO" in cabecalho
    # par estimado/homologado presente → coluna Deságio por fórmula
    assert "DESÁGIO" in cabecalho
    linha = dict(zip(cabecalho, [c.value for c in ws[2]]))
    assert linha["OBJETO"] == "Aquisição de merenda escolar"
    assert linha["VALOR HOMOLOGADO"] == 900.0
