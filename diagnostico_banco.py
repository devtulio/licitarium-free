"""Mede o tamanho real do licitarium.db e quanto disso é espaço livre
(fragmentação) ainda não devolvido ao sistema operacional.

Uso: feche o Licitarium Free e rode
    python diagnostico_banco.py
Abre em modo somente-leitura — não altera nada no banco.
"""
import sqlite3
from pathlib import Path

ARQUIVO_DB = Path.home() / "AppData" / "Local" / "Licitarium" / "licitarium.db"


def principal():
    if not ARQUIVO_DB.exists():
        print(f"Banco não encontrado em {ARQUIVO_DB}")
        return

    db = sqlite3.connect(f"file:{ARQUIVO_DB}?mode=ro", uri=True)
    try:
        page_size = db.execute("PRAGMA page_size").fetchone()[0]
        page_count = db.execute("PRAGMA page_count").fetchone()[0]
        freelist_count = db.execute("PRAGMA freelist_count").fetchone()[0]
        auto_vacuum = db.execute("PRAGMA auto_vacuum").fetchone()[0]

        tamanho_total = page_size * page_count
        tamanho_livre = page_size * freelist_count
        tamanho_util = tamanho_total - tamanho_livre
        pct_livre = (tamanho_livre / tamanho_total * 100) if tamanho_total else 0

        n_itens = db.execute("SELECT COUNT(*) FROM itens").fetchone()[0]

        print(f"Arquivo:            {ARQUIVO_DB}")
        print(f"Tamanho no disco:   {tamanho_total / 1_048_576:.1f} MB")
        print(f"Espaço em uso:      {tamanho_util / 1_048_576:.1f} MB")
        print(f"Espaço livre:       {tamanho_livre / 1_048_576:.1f} MB"
              f"  ({pct_livre:.1f}% do arquivo)")
        print(f"auto_vacuum atual:  {['NONE', 'FULL', 'INCREMENTAL'][auto_vacuum]}")
        print(f"Itens no banco:     {n_itens:,}".replace(",", "."))
        print()
        if pct_livre >= 15:
            print("Espaço livre alto — VACUUM provavelmente compensa.")
        elif pct_livre >= 5:
            print("Espaço livre moderado — VACUUM ajuda um pouco, não é urgente.")
        else:
            print("Espaço livre baixo — VACUUM não traria ganho perceptível agora.")
    finally:
        db.close()


if __name__ == "__main__":
    principal()
