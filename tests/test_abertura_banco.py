"""Abertura do banco: WAL órfão, banco corrompido e encerramento limpo.

Em 2026-08-05 o programa parou de abrir com `database disk image is
malformed` — traceback antes da janela, sem nenhuma mensagem ao usuário. O
banco estava íntegro: sobrara um `-wal` escrito três dias antes, e o SQLite
aplicava aquelas páginas velhas sobre o arquivo atual.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium


@pytest.fixture
def acervo(tmp_path, monkeypatch):
    """Banco com um dado dentro e o `-wal` já consolidado."""
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    monkeypatch.setattr(licitarium, "AVISO_ABERTURA", None)
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, ano, objeto)"
               " VALUES ('A', 2026, 'Merenda')")
    db.commit()
    db.close()
    licitarium.fechar_limpo()
    return tmp_path / "t.db"


def test_encerramento_limpo_nao_deixa_nada_pendurado_no_wal(acervo):
    """A defesa principal: sem `-wal` sobrando, não há órfão na volta.

    Uma conexão da thread de sync ainda viva no fechamento da janela é o
    caso que `fechar_limpo` cobre — quando todas fecham, o próprio SQLite
    consolida. O que se exige aqui é o efeito: o `.db` lido sem o `-wal`
    tem tudo.
    """
    pendente = sqlite3.connect(acervo)      # a conexão que não fechou
    db = licitarium.abrir_db()
    db.execute("INSERT INTO contratacoes (numero_controle, ano, objeto)"
               " VALUES ('B', 2026, 'Pneus')")
    db.commit()
    db.close()
    pendente.close()

    licitarium.fechar_limpo()
    wal = Path(str(acervo) + "-wal")
    assert not wal.exists() or wal.stat().st_size == 0
    lido = sqlite3.connect(f"file:{acervo}?mode=ro&immutable=1", uri=True)
    assert lido.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 2
    lido.close()


def test_wal_orfao_sai_da_frente_e_o_acervo_abre(acervo, monkeypatch):
    """O caso real: a abertura falha, mas o `.db` responde sozinho.

    O erro do SQLite depende de o `-wal` órfão ser da mesma linhagem do
    arquivo, o que não se fabrica de forma estável num teste — então o
    gatilho é simulado. O que se verifica é a reação: pôr o `-wal` de lado,
    reabrir e avisar.
    """
    wal = Path(str(acervo) + "-wal")
    shm = Path(str(acervo) + "-shm")
    wal.write_bytes(b"\x37\x7f\x06\x82" + b"\x00" * 60)   # lixo de outra época
    shm.write_bytes(b"\x00" * 32)

    real = sqlite3.connect
    chamadas = []

    class Quebrada(sqlite3.Connection):
        """Conexão que estoura na primeira leitura, como o WAL órfão faz."""
        def execute(self, *a, **k):
            raise sqlite3.DatabaseError("database disk image is malformed")

    def conectar(*a, **k):
        # só a primeira tentativa falha; a reabertura, depois do -wal sair
        # da frente, tem de funcionar
        if not chamadas and not any("immutable" in str(x) for x in a):
            chamadas.append(a)
            return real(*a, factory=Quebrada, **k)
        return real(*a, **k)

    monkeypatch.setattr(sqlite3, "connect", conectar)
    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT objeto FROM contratacoes").fetchone()[0] \
            == "Merenda"
    finally:
        db.close()

    assert not wal.exists() and not shm.exists()
    assert list(acervo.parent.glob("t.db-wal.orfao-*"))
    assert list(acervo.parent.glob("t.db-shm.orfao-*"))
    assert "inconsistente" in licitarium.AVISO_ABERTURA


def test_banco_mesmo_corrompido_e_guardado_e_o_programa_recomeca(
        acervo, monkeypatch):
    """Sem `.db` legível não há o que salvar — mas há o que preservar.

    O acervo se refaz sincronizando; o arquivo velho fica guardado para
    perícia, em vez de ser sobrescrito.
    """
    acervo.write_bytes(b"nao sou um banco de dados" * 500)
    monkeypatch.setattr(licitarium, "_confirmar_recomeco", lambda: True)

    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT COUNT(*) FROM contratacoes").fetchone()[0] == 0
    finally:
        db.close()

    guardado = list(acervo.parent.glob("t.db.corrompido-*"))
    assert len(guardado) == 1
    assert guardado[0].read_bytes().startswith(b"nao sou um banco")
    assert "corrompido" in licitarium.AVISO_ABERTURA


def test_erro_de_banco_que_nao_e_corrupcao_continua_estourando(
        acervo, monkeypatch):
    """Só corrupção justifica mexer nos arquivos do usuário."""
    def conectar(*a, **k):
        raise sqlite3.DatabaseError("database is locked")

    monkeypatch.setattr(sqlite3, "connect", conectar)
    with pytest.raises(sqlite3.DatabaseError):
        licitarium.abrir_db()
    assert not list(acervo.parent.glob("*.orfao-*"))
    assert not list(acervo.parent.glob("*.corrompido-*"))


def test_recomeco_recusado_nao_toca_no_arquivo(acervo, monkeypatch):
    """Perder um acervo de horas não pode ser decisão automática.

    O diagnóstico de corrupção pode estar errado — em 2026-08-05 um arquivo
    truncado pela metade por outra causa passou por banco corrompido. Se o
    usuário responde que não, o programa sai sem renomear nada.
    """
    acervo.write_bytes(b"nao sou um banco de dados" * 500)
    monkeypatch.setattr(licitarium, "_confirmar_recomeco", lambda: False)

    with pytest.raises(SystemExit):
        licitarium.abrir_db()
    assert not list(acervo.parent.glob("*.corrompido-*"))
    assert acervo.read_bytes().startswith(b"nao sou um banco")


def test_backfill_de_municipio_nao_repete_a_cada_abertura(acervo):
    """Migração que grava não pode rodar em toda conexão.

    O preenchimento de `municipio_ibge` varria `itens` inteira e abria
    transação de escrita a cada `abrir_db()` — ou seja, a cada chamada da
    ponte JS. Era o "database is locked" ao abrir o app (achado do usuário,
    v1.60.13). Depois de feito uma vez, uma linha zerada à mão tem de
    continuar zerada.
    """
    db = licitarium.abrir_db()
    db.execute("INSERT OR REPLACE INTO config (chave, valor)"
               " VALUES ('municipio_ibge', '3550308')")
    db.commit()
    db.close()
    db = licitarium.abrir_db()          # aqui o preenchimento acontece
    assert db.execute("SELECT municipio_ibge FROM contratacoes"
                      " WHERE numero_controle='A'").fetchone()[0] == "3550308"
    db.execute("UPDATE contratacoes SET municipio_ibge=NULL")
    db.commit()
    db.close()

    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT municipio_ibge FROM contratacoes"
                          " WHERE numero_controle='A'").fetchone()[0] is None
    finally:
        db.close()
