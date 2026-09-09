"""Cópia do acervo: exportar, conferir e restaurar.

O banco é reconstruível a partir do PNCP, e por isso o Licitarium nasceu sem
cópia de segurança. Em 2026-08-05 um acervo com seis municípios de referência
se perdeu, e reconstruí-lo custaria horas de coleta — a cópia troca essas
horas por um arquivo.
"""
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium


class JanelaFalsa:
    """Responde aos diálogos de arquivo como o usuário responderia."""

    def __init__(self, resposta=None):
        self.resposta = resposta
        self.pedidos = []

    def create_file_dialog(self, tipo, **kwargs):
        self.pedidos.append({"tipo": tipo, **kwargs})
        return self.resposta


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    import pncp
    pncp._config(db, "municipio_nome", "Orindiúva")
    db.execute("INSERT INTO contratacoes (numero_controle, ano, objeto)"
               " VALUES ('A', 2026, 'Merenda')")
    db.execute("INSERT INTO itens (id, contratacao_controle, descricao,"
               " valor_unitario_homologado) VALUES ('A#1','A','PAPEL A4',19.9)")
    db.execute("INSERT INTO municipios_referencia (ibge, nome, uf)"
               " VALUES ('3517901','Guaraci','SP')")
    db.commit()
    db.close()
    api = licitarium.Api()
    api._janela = JanelaFalsa()
    return api


def test_exportar_gera_zip_com_banco_e_manifesto(api, tmp_path):
    destino = tmp_path / "copia.zip"
    api._janela.resposta = str(destino)

    r = api.exportar_acervo()
    assert r["ok"] and Path(r["arquivo"]) == destino
    assert r["contagens"]["itens"] == 1
    assert r["contagens"]["municipios_referencia"] == 1
    # o nome sugerido segue o padrão da família (DB_<SIGLA>_BACKUP_<data>)
    assert api._janela.pedidos[0]["save_filename"].startswith(
        "DB_LICITARIUM_BACKUP_")

    with zipfile.ZipFile(destino) as z:
        assert set(z.namelist()) == {"licitarium.db", "manifesto.json"}
        m = json.loads(z.read("manifesto.json"))
    assert m["_sgx"] == "LICITARIUM" and m["schema"] == licitarium.ACERVO_SCHEMA
    assert m["municipio"] == "Orindiúva" and m["versao"] == licitarium.VERSAO


def test_restaurar_devolve_o_acervo_e_guarda_o_atual(api, tmp_path):
    api._janela.resposta = str(tmp_path / "copia.zip")
    api.exportar_acervo()

    # o acervo se perde e o programa recomeça vazio, como aconteceu de verdade
    licitarium.ARQUIVO_DB.unlink()
    db = licitarium.abrir_db()
    assert db.execute("SELECT COUNT(*) FROM itens").fetchone()[0] == 0
    db.close()

    r = api.importar_acervo()
    assert r["ok"] and r["itens"] == 1 and r["municipio"] == "Orindiúva"
    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT descricao FROM itens").fetchone()[0] \
            == "PAPEL A4"
        assert db.execute(
            "SELECT nome FROM municipios_referencia").fetchone()[0] == "Guaraci"
    finally:
        db.close()
    # o banco que estava no lugar não foi apagado: dá para voltar atrás
    assert list(tmp_path.glob("t.db.substituido-*"))


def test_zip_sem_banco_dentro_e_recusado(api, tmp_path):
    falso = tmp_path / "qualquer.zip"
    with zipfile.ZipFile(falso, "w") as z:
        z.writestr("planilha.csv", "a;b;c")
    api._janela.resposta = str(falso)

    r = api.importar_acervo()
    assert r["ok"] is False and "não é uma cópia" in r["erro"]
    assert not list(tmp_path.glob("t.db.substituido-*"))


def test_banco_corrompido_dentro_do_zip_nao_substitui_nada(api, tmp_path):
    ruim = tmp_path / "ruim.zip"
    with zipfile.ZipFile(ruim, "w") as z:
        z.writestr("licitarium.db", b"nao sou um banco" * 500)
    api._janela.resposta = str(ruim)

    r = api.importar_acervo()
    assert r["ok"] is False and "não pôde ser lido" in r["erro"]
    # o acervo bom continua de pé
    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT COUNT(*) FROM itens").fetchone()[0] == 1
    finally:
        db.close()


def test_cancelar_o_dialogo_nao_e_erro(api):
    api._janela.resposta = None
    assert api.exportar_acervo() == {"ok": False, "erro": None}
    assert api.importar_acervo() == {"ok": False, "erro": None}
    assert api.exportar_json() == {"ok": False, "erro": None}


# ── exportar dados brutos (.json) ────────────────────────────────────────

def test_exportar_json_gera_arquivo_valido_com_todas_as_tabelas(api, tmp_path):
    destino = tmp_path / "acervo.json"
    api._janela.resposta = str(destino)

    r = api.exportar_json()
    assert r["ok"] and Path(r["arquivo"]) == destino

    dado = json.loads(destino.read_text(encoding="utf-8"))
    assert dado["_sgx"] == "LICITARIUM"
    assert dado["municipio"] == "Orindiúva"
    assert len(dado["contratacoes"]) == 1
    assert dado["contratacoes"][0]["objeto"] == "Merenda"
    assert len(dado["itens"]) == 1
    assert dado["itens"][0]["descricao"] == "PAPEL A4"
    assert len(dado["municipios_referencia"]) == 1
    # tabela sem linha nenhuma continua uma lista válida, não quebra o JSON
    assert dado["contratos"] == []
    assert dado["atas"] == []


def test_exportar_json_avisa_quando_nao_consegue_gravar(api, tmp_path):
    # pasta pai inexistente: open() levanta OSError de verdade, sem mock —
    # mesmo caminho de erro de disco cheio/sem permissão
    destino = tmp_path / "pasta-que-nao-existe" / "acervo.json"
    api._janela.resposta = str(destino)

    r = api.exportar_json()
    assert r["ok"] is False
    assert "não consegui gravar" in r["erro"]
    assert not destino.exists()


def test_copia_leva_o_que_ainda_esta_no_diario_de_transacoes(api, tmp_path):
    """A cópia sai pela API de backup do SQLite, não copiando o arquivo.

    Em WAL, o que acabou de ser gravado ainda vive no `-wal`: copiar só o
    `.db` entregaria uma cópia sem os dados mais recentes — justamente os
    da sincronização em curso.
    """
    pendente = sqlite3.connect(licitarium.ARQUIVO_DB)
    pendente.execute("PRAGMA journal_mode=WAL")
    pendente.execute("INSERT INTO contratacoes (numero_controle, ano, objeto)"
                     " VALUES ('B', 2026, 'Recem gravada')")
    pendente.commit()          # commitado, mas ainda no -wal (sem checkpoint)

    api._janela.resposta = str(tmp_path / "durante.zip")
    r = api.exportar_acervo()
    assert r["ok"]
    assert Path(str(licitarium.ARQUIVO_DB) + "-wal").stat().st_size > 0
    pendente.close()

    with zipfile.ZipFile(tmp_path / "durante.zip") as z:
        z.extract("licitarium.db", tmp_path / "conferencia")
    copia = sqlite3.connect(
        f"file:{tmp_path / 'conferencia' / 'licitarium.db'}?mode=ro&immutable=1",
        uri=True)
    try:
        assert copia.execute("PRAGMA quick_check(1)").fetchone()[0] == "ok"
        gravado = copia.execute("SELECT objeto FROM contratacoes"
                                " WHERE numero_controle='B'").fetchone()[0]
        assert gravado == "Recem gravada"
    finally:
        copia.close()


# ── falha na gravação não pode ficar muda (auditoria, 2026-08-09) ─────────

def test_exportar_avisa_e_nao_deixa_zip_pela_metade(api, tmp_path,
                                                    monkeypatch):
    """Disco cheio deixava um .zip truncado, de nome plausível, e a tela
    presa em "Salvando cópia…" — o usuário achava que tinha backup."""
    destino = tmp_path / "copia.zip"
    api._janela.resposta = str(destino)

    def sem_espaco(*a, **k):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(licitarium.zipfile, "ZipFile", sem_espaco)

    r = api.exportar_acervo()
    assert r["ok"] is False
    assert "não consegui gravar" in r["erro"]
    assert not destino.exists()          # o arquivo pela metade não fica


def test_importar_devolve_o_acervo_quando_a_troca_falha(api, tmp_path,
                                                        monkeypatch):
    """Antes o acervo era renomeado ANTES da cópia: uma falha no meio
    deixava o usuário sem banco nenhum, o dele sob um nome que ninguém
    contou, e o programa criando um vazio na abertura seguinte."""
    copia = tmp_path / "copia.zip"
    api._janela.resposta = str(copia)
    assert api.exportar_acervo()["ok"]

    antes = licitarium.ARQUIVO_DB.read_bytes()
    api._janela.resposta = str(copia)

    original = licitarium.Path.replace

    def falhar(self, alvo):
        if str(alvo) == str(licitarium.ARQUIVO_DB):
            raise OSError(13, "Permission denied")
        return original(self, alvo)
    monkeypatch.setattr(licitarium.Path, "replace", falhar)

    r = api.importar_acervo()
    assert r["ok"] is False
    assert "devolvido ao lugar" in r["erro"]
    # o acervo do usuário continua onde estava, e intacto
    assert licitarium.ARQUIVO_DB.exists()
    assert licitarium.ARQUIVO_DB.read_bytes() == antes
