"""Testes da ponte Api (listar/ordenação/detalhe) com banco temporário."""
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import licitarium


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "t.db")
    db = licitarium.abrir_db()
    db.executemany(
        "INSERT INTO contratacoes (numero_controle, ano, objeto,"
        " valor_estimado, valor_homologado, data_publicacao)"
        " VALUES (?,?,?,?,?,?)",
        [("A", 2026, "Zebra", 10.0, None, "2026-01-01"),
         ("B", 2026, "Arroz", 30.0, 25.0, "2026-02-01"),
         ("C", 2025, "Milho", 20.0, 15.0, "2025-06-01")])
    db.execute("UPDATE contratacoes SET orgao_cnpj='111' WHERE"
               " numero_controle IN ('A','B')")
    db.execute("UPDATE contratacoes SET orgao_cnpj='222' WHERE"
               " numero_controle='C'")
    db.executemany(
        "INSERT INTO pca_itens (id, id_pca, ano, numero_item, descricao,"
        " valor_total) VALUES (?,?,?,?,?,?)",
        [("P#1", "P", 2026, 1, "Papel", 100.0),
         ("P#2", "P", 2026, 2, "Toner", 900.0)])
    db.commit()
    db.close()
    return licitarium.Api()


def test_ordenacao_por_coluna(api):
    r = api.listar("contratacoes", {"ord": "objeto", "dir": "asc"})
    assert [i["objeto"] for i in r["itens"]] == ["Arroz", "Milho", "Zebra"]
    r = api.listar("contratacoes", {"ord": "valor", "dir": "desc"})
    # valor = COALESCE(homologado, estimado): B=25, C=15, A=10
    assert [i["numero_controle"] for i in r["itens"]] == ["B", "C", "A"]
    r = api.listar("contratacoes", {"ord": "numero", "dir": "asc"})
    # cronológico: 1/2025, 1/2026, 2/2026 (fixture: C=1/2025? A e B são 2026)
    assert [i["numero_controle"] for i in r["itens"]][0] == "C"


def test_ordenacao_invalida_cai_no_padrao(api):
    r = api.listar("contratacoes", {"ord": "raw; DROP TABLE config", "dir": "asc"})
    # coluna fora da whitelist é ignorada -> padrão data_publicacao DESC
    assert [i["numero_controle"] for i in r["itens"]] == ["B", "A", "C"]


def test_listar_e_detalhe_pca(api):
    r = api.listar("pca", {"ord": "valor", "dir": "desc"})
    assert [i["descricao"] for i in r["itens"]] == ["Toner", "Papel"]
    d = api.detalhe("pca", "P#1")
    assert d["descricao"] == "Papel"


def test_abrir_pncp_ata_monta_url_da_ata(api, monkeypatch):
    db = licitarium.abrir_db()
    db.execute(
        "INSERT INTO atas (numero_controle, raw) VALUES (?, '{}')",
        ("45148970000177-1-000030/2026-000010",))
    db.commit()
    db.close()
    urls = []
    monkeypatch.setattr(licitarium.webbrowser, "open", urls.append)
    assert api.abrir_pncp("atas", "45148970000177-1-000030/2026-000010")
    assert urls == ["https://pncp.gov.br/app/atas/45148970000177/2026/30/10"]
    # número fora do padrão não abre link errado
    db = licitarium.abrir_db()
    db.execute("INSERT INTO atas (numero_controle, raw) VALUES ('X', '{}')")
    db.commit()
    db.close()
    assert not api.abrir_pncp("atas", "X")
    assert len(urls) == 1


def test_auto_update_desligado_com_sac(api, monkeypatch):
    """Smart App Control ativo: não oferecer troca automática do exe."""
    monkeypatch.setattr(licitarium.sys, "frozen", True, raising=False)
    monkeypatch.setattr(licitarium.Api, "_sac_ativo", staticmethod(lambda: True))
    api._asset_url = "https://exemplo/Licitarium.exe"
    r = api.instalar_atualizacao()
    assert r["ok"] is False and "Smart App Control" in r["erro"]


def test_validar_exe_recusa_quando_nao_abre(api, monkeypatch):
    chamadas = []

    def falha(cmd, **kw):
        chamadas.append(cmd)
        raise licitarium.subprocess.TimeoutExpired(cmd, 90)
    monkeypatch.setattr(licitarium.subprocess, "run", falha)
    monkeypatch.setattr(licitarium.time, "sleep", lambda s: None)
    assert api._validar_exe("C:/x/novo.exe") is False
    assert len(chamadas) == 3                      # tentou 3 vezes
    assert chamadas[0][1] == "--verificar"


def test_assets_da_ui_existem_ao_lado_do_index():
    """CSS e JS saíram do index.html (1.1.0) e viraram arquivos vizinhos.

    O pywebview abre o index por caminho de arquivo: href/src relativo que
    não exista no disco vira tela sem estilo, ou sem app, e sem erro visível.
    """
    ui = licitarium.DIR_APP / "ui"
    html = (ui / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'(?:href|src)="([^":]+)"', html)
    assert {"estilo.css", "app.js", "tema.js"} <= set(refs)
    for ref in refs:
        assert (ui / ref).exists() or ref == "tema.js", ref  # tema.js é gerado
    # nada de CSS/JS solto sobrando no HTML
    assert "<style>" not in html and "<script>" not in html


def test_fontes_vendorizadas_existem_ao_lado_do_estilo():
    """@font-face falha em silêncio (cai pro fallback, sem erro visível) —
    o arquivo referenciado precisa existir de verdade, não só o @font-face."""
    ui = licitarium.DIR_APP / "ui"
    css = (ui / "estilo.css").read_text(encoding="utf-8")
    refs = re.findall(r"url\('(fonts/[^']+)'\)", css)
    assert len(refs) >= 4          # EB Garamond, Public Sans, Lato regular/bold
    for ref in refs:
        assert (ui / ref).exists(), ref


def test_manual_segue_o_padrao_de_nome_da_familia():
    """O navegador usa o <title> como nome do PDF ao salvar/imprimir.

    O padrão da família é "Manual Operacional — SIGLA vX.Y.Z", para os
    manuais dos cinco sistemas ficarem juntos e ordenados na pasta. Este
    teste também pega bump de versão esquecido no manual.

    Aqui a sigla é "Licitarium Free" desde a 1.35.0 (decisão do usuário
    em 2026-08-14): o nome do produto ganhou o "Free", e o manual segue o
    produto. A ordenação alfabética na pasta continua valendo, já que o
    prefixo "Licitarium" não mudou.
    """
    man = (licitarium.DIR_APP / "MANUAL.html").read_text(encoding="utf-8")
    esperado = f"Manual Operacional — Licitarium Free v{licitarium.VERSAO}"
    assert f"<title>{esperado}</title>" in man
    # cabeçalho de cada página impressa: mesma ordem dos irmãos
    cabecalho = f'"Licitarium Free v{licitarium.VERSAO} — Manual Operacional"'
    assert f"content: {cabecalho}" in man
    assert f"VERSÃO {licitarium.VERSAO}" in man        # capa


def test_url_da_janela_e_caminho_simples(tmp_path, monkeypatch):
    """Dentro do exe o pywebview resolve o caminho pelo _MEIPASS.

    URI file:// (ainda mais com query string) faz o WebView2 procurar um
    arquivo chamado "index.html?tema=..." e falhar com ERR_FILE_NOT_FOUND.
    """
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "j.db")
    # não escrever ui/tema.js de verdade: sujaria a árvore do projeto
    temas = []
    monkeypatch.setattr(licitarium, "_escrever_tema_da_splash", temas.append)
    capturado = {}

    def falso_create_window(titulo, url, **kw):
        capturado.update(titulo=titulo, url=url, kw=kw)
        return object()
    monkeypatch.setattr(licitarium.webview, "create_window", falso_create_window)
    monkeypatch.setattr(licitarium.webview, "start",
                        lambda **kw: capturado.update(start=kw))
    licitarium.main()

    url = capturado["url"]
    assert "?" not in url and "#" not in url and not url.startswith("file:")
    assert url.endswith("index.html")
    assert Path(url).exists()          # o arquivo tem de existir de verdade
    assert capturado["kw"]["maximized"] is True
    # armazenamento próprio: sem isso o WebView2 esquece o tema a cada
    # execução e a splash volta sempre ao padrão
    assert capturado["start"]["private_mode"] is False
    assert str(tmp_path) in capturado["start"]["storage_path"]
    # o tema é entregue à página antes de a janela abrir
    assert temas == ["portal"]


def test_tema_da_splash_gravado_e_validado(tmp_path, monkeypatch):
    monkeypatch.setattr(licitarium, "DIR_APP", tmp_path)
    (tmp_path / "ui").mkdir()
    licitarium._escrever_tema_da_splash("pergaminho")
    assert (tmp_path / "ui" / "tema.js").read_text(encoding="utf-8") \
        == 'window.__TEMA = "pergaminho";\n'
    licitarium._escrever_tema_da_splash("civil")
    assert (tmp_path / "ui" / "tema.js").read_text(encoding="utf-8") \
        == 'window.__TEMA = "civil";\n'
    # valor fora da lista vira o padrão (o arquivo entra na página como JS)
    licitarium._escrever_tema_da_splash("'; alert(1); //")
    assert '"portal"' in (tmp_path / "ui" / "tema.js").read_text(encoding="utf-8")


def test_script_atualizacao():
    from pathlib import PureWindowsPath
    s = licitarium._script_atualizacao(
        PureWindowsPath(r"C:\App\Licitarium.exe"),
        PureWindowsPath(r"C:\d\novo.exe"))
    assert r'del "C:\App\Licitarium.exe"' in s
    assert r'move /y "C:\d\novo.exe" "C:\App\Licitarium.exe"' in s
    assert "goto espera" in s
    # troca → folga → start único (retry por tasklist daria falso positivo:
    # bootloader travado na caixa de erro ainda aparece como processo vivo)
    assert s.count('start "" "C:\\App\\Licitarium.exe"') == 1
    assert "tasklist" not in s
    assert s.index("move /y") < s.index("timeout /t 3") < s.index('start ""')


def test_migracao_atas_reprojeta_do_raw(tmp_path, monkeypatch):
    """Banco 0.2.0 (atas sem numero_ata) ganha as colunas preenchidas do raw."""
    import json
    import sqlite3 as sq
    monkeypatch.setattr(licitarium, "DIR_DADOS", tmp_path)
    monkeypatch.setattr(licitarium, "ARQUIVO_DB", tmp_path / "m.db")
    con = sq.connect(tmp_path / "m.db")
    con.execute("CREATE TABLE atas (numero_controle TEXT PRIMARY KEY,"
                " contratacao_controle TEXT, orgao_cnpj TEXT,"
                " vigencia_inicio TEXT, vigencia_fim TEXT,"
                " data_atualizacao TEXT, raw TEXT, sync_em TEXT)")
    con.execute("INSERT INTO atas (numero_controle, raw) VALUES ('X', ?)",
                (json.dumps({"numeroAtaRegistroPreco": "13", "anoAta": 2026,
                             "objetoContratacao": "RP de teste"}),))
    con.commit()
    con.close()
    con = sq.connect(tmp_path / "m.db")
    con.execute("CREATE TABLE contratos (numero_controle TEXT PRIMARY KEY,"
                " contratacao_controle TEXT, orgao_cnpj TEXT,"
                " fornecedor_ni TEXT, fornecedor_nome TEXT, objeto TEXT,"
                " valor_global REAL, vigencia_inicio TEXT, vigencia_fim TEXT,"
                " data_publicacao TEXT, data_atualizacao TEXT, raw TEXT,"
                " sync_em TEXT)")
    con.execute("INSERT INTO contratos (numero_controle, raw) VALUES ('Y', ?)",
                (json.dumps({"numeroContratoEmpenho": "0033/26",
                             "anoContrato": 2026, "sequencialContrato": 35}),))
    con.commit()
    con.close()
    db = licitarium.abrir_db()
    r = db.execute("SELECT numero_ata, ano_ata, objeto FROM atas").fetchone()
    c = db.execute("SELECT numero_contrato, ano_contrato, sequencial_contrato"
                   " FROM contratos").fetchone()
    db.close()
    assert (r["numero_ata"], r["ano_ata"]) == ("13", 2026)
    assert r["objeto"] == "RP de teste"
    assert (c["numero_contrato"], c["ano_contrato"],
            c["sequencial_contrato"]) == ("0033/26", 2026, 35)


def test_filtro_por_orgao(api):
    assert api.listar("contratacoes", {"orgao": "111"})["total"] == 2
    assert api.listar("contratacoes", {"orgao": "222"})["total"] == 1
    assert api.listar("contratacoes", {"orgao": "999"})["total"] == 0






def test_indice_de_busca_reconstruido_em_banco_antigo(api, tmp_path):
    db = licitarium.abrir_db()
    db.execute("INSERT INTO itens (id, contratacao_controle, ano, sequencial,"
               " numero_item, descricao) VALUES ('i9','A',2026,1,1,'MOUSE')")
    # banco anterior ao FTS: dados nos itens, índice inexistente
    db.execute("DROP TABLE itens_fts")
    for t in ("ins", "del", "upd"):
        db.execute(f"DROP TRIGGER tg_itens_fts_{t}")
    db.commit()
    db.close()
    assert api.listar("itens", {"busca": "mouse"})["total"] == 1


def test_filtro_ano_pca(api):
    assert api.listar("pca", {"ano": 2026})["total"] == 2
    assert api.listar("pca", {"ano": 2024})["total"] == 0


def test_asset_do_auto_update_aceita_todos_os_nomes_ja_publicados():
    """O nome do exe mudou duas vezes: ganhou a versão (1.2.4) e o "Free"
    (1.35.0). O casamento é por padrão porque a checagem roda contra
    releases de qualquer época — inclusive as antigas, que continuam no
    GitHub com o nome de então.
    """
    padrao = re.compile(r"Licitarium([ .]Free)?([ .]v[\d.]+)?\.exe")
    # o GitHub troca espaço por ponto no nome do anexo: o arquivo sobe como
    # "Licitarium Free v1.35.0.exe" e a release publica
    # "Licitarium.Free.v1.35.0.exe"
    assert padrao.fullmatch("Licitarium.Free.v1.35.0.exe")
    assert padrao.fullmatch("Licitarium Free v1.35.0.exe")
    assert padrao.fullmatch("Licitarium.v1.2.4.exe")   # 1.2.4 até 1.34.0
    assert padrao.fullmatch("Licitarium v1.2.4.exe")
    assert padrao.fullmatch("Licitarium.exe")          # releases até a 1.2.3
    for fora in ("licitarium.exe", "OutroLicitarium.exe",
                 "Licitarium.v1.2.4.zip", "Licitarium.exe.txt",
                 "LicitariumFree.exe"):   # sem separador não é o nosso
        assert not padrao.fullmatch(fora), fora
    # e é o mesmo padrão que o código usa
    fonte = (licitarium.DIR_APP / "licitarium.py").read_text(encoding="utf-8")
    assert padrao.pattern in fonte


def test_spec_nomeia_o_exe_com_a_versao_do_codigo():
    spec = (licitarium.DIR_APP / "Licitarium.spec").read_text(encoding="utf-8")
    assert "name=f'Licitarium Free v{VERSAO}'" in spec
    # a versão é lida de licitarium.py; cópia fixa aqui sairia de sincronia
    assert "licitarium.py" in spec and "re.search" in spec


def test_verificador_antigo_nao_reconhece_o_nome_novo():
    """Registra o custo, de uma vez só, da renomeação do exe (1.35.0).

    Quem está na 1.34.0 ou antes tem embutido o padrão SEM o "Free": vai
    continuar avisando que há versão nova, mas cai no download manual em
    vez de instalar sozinho. É consequência inevitável de renomear — o
    verificador viaja dentro do exe já instalado. Este teste existe para
    que isso seja um fato conhecido e datado, não uma surpresa.
    """
    antigo = re.compile(r"Licitarium([ .]v[\d.]+)?\.exe")
    assert not antigo.fullmatch("Licitarium.Free.v1.35.0.exe")
    # e o inverso vale: o verificador novo acha o que as releases antigas
    # publicaram, então quem atualizar a partir da 1.35.0 fica coberto
    novo = re.compile(r"Licitarium([ .]Free)?([ .]v[\d.]+)?\.exe")
    assert novo.fullmatch("Licitarium.v1.34.0.exe")


def test_troca_do_exe_assume_o_nome_da_versao_nova():
    """Trocar só o conteúdo deixaria "Licitarium v1.2.3.exe" rodando a 1.2.4."""
    atual = Path("C:/Users/x/Desktop/Licitarium v1.2.3.exe")
    baixado = Path("C:/tmp/Licitarium.novo.exe")
    final = Path("C:/Users/x/Desktop/Licitarium v1.2.4.exe")
    bat = licitarium._script_atualizacao(atual, baixado, final)
    assert f'move /y "{baixado}" "{final}"' in bat
    assert f'start "" "{final}"' in bat
    # o app espera o arquivo ANTIGO ser liberado antes de mover
    assert f'del "{atual}"' in bat
    # caminho com espaço sempre entre aspas, senão o cmd quebra o comando
    for linha in bat.splitlines():
        if "Licitarium" in linha:
            assert linha.count('"') >= 2, linha
    # sem destino informado, troca no lugar (comportamento das versões antigas)
    velho = licitarium._script_atualizacao(atual, baixado)
    assert f'move /y "{baixado}" "{atual}"' in velho


# ── troca de acervo não pode correr por baixo de uma sync em andamento ──────
# a thread de _rodar_sync captura o ibge numa variável local (licitarium.py,
# _rodar_sync) antes de rodar; trocar o município ou importar um acervo
# enquanto ela ainda está no meio contaminava o banco novo com dados do
# antigo, sem erro nenhum visível (auditoria 2026-08-11).

def test_trocar_municipio_recusa_com_sync_em_andamento(api):
    api._sync_ativo.acquire()
    try:
        r = api.trocar_municipio("3536604", "Paulo de Faria", "SP")
        assert r == {"ok": False, "erro": licitarium.MSG_SYNC_ATIVO}
        # nada foi apagado nem trocado
        assert api.listar("contratacoes", {})["total"] == 3
    finally:
        api._sync_ativo.release()
    # destravado, a troca funciona normalmente
    assert api.trocar_municipio("3536604", "Paulo de Faria", "SP")["ok"]
    assert api.listar("contratacoes", {})["total"] == 0


def test_trocar_municipio_limpa_itens_e_pca_itens(api):
    """`itens`/`pca_itens` ficavam de fora do DELETE — órfãs do município
    antigo (contratacao_controle/orgao_cnpj já apagados), nunca mais
    revisitadas, lixo permanente a cada troca (achado 2026-08-24)."""
    db = licitarium.abrir_db()
    db.execute("INSERT INTO itens (id, contratacao_controle, numero_item,"
               " descricao) VALUES ('A#1', 'A', 1, 'Papel')")
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM pca_itens").fetchone()[0] == 2
    db.close()

    assert api.trocar_municipio("3536604", "Paulo de Faria", "SP")["ok"]

    db = licitarium.abrir_db()
    try:
        assert db.execute("SELECT COUNT(*) FROM itens").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM pca_itens").fetchone()[0] == 0
    finally:
        db.close()


def test_importar_acervo_recusa_com_sync_em_andamento(api, monkeypatch):
    chamou = []
    monkeypatch.setattr(api, "_importar_acervo", lambda: chamou.append(1))
    api._sync_ativo.acquire()
    try:
        r = api.importar_acervo()
        assert r == {"ok": False, "erro": licitarium.MSG_SYNC_ATIVO}
        assert not chamou   # nem chegou a abrir o diálogo de arquivo
    finally:
        api._sync_ativo.release()
