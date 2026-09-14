# PyInstaller spec — gera dist/"Licitarium vX.Y.Z.exe" (onefile, sem console)
# Uso: pyinstaller --clean Licitarium.spec
import re
from pathlib import Path

# a versão vem do próprio código, não de uma cópia aqui: o nome do arquivo
# baixado carrega a versão, no mesmo padrão dos manuais da família
VERSAO = re.search(r'^VERSAO = "([^"]+)"',
                   Path('licitarium.py').read_text(encoding='utf-8'),
                   re.M).group(1)

a = Analysis(
    ['licitarium.py'],
    # icone-preview-256.png: ICONE_NOTIFICACAO precisa de arquivo em disco
    # dentro do bundle — o .ico do EXE (abaixo) não é acessível em runtime,
    # só embutido no binário pelo próprio PyInstaller
    datas=[('ui', 'ui'), ('design/icone-preview-256.png', 'design')],
    hiddenimports=[],
    excludes=[],
)
pyz = PYZ(a.pure)
# sem Splash() do PyInstaller de propósito: a imagem estática é fixa (não
# acompanha o tema) e aparecia antes da tela de abertura do app, dando a
# impressão de duas aberturas em sequência. Só a splash temática ficou.
#
# TENTATIVA em 2026-09-14 (pedido do usuário: mensagem "Preparando
# ambiente…" durante os 2-4s de extração do onefile) — REVERTIDA: o
# ambiente de build local tem um Tcl/Tk incompleto (falta scaling.tcl —
# instalação Python via winget/MS Store, mais enxuta que o instalador
# oficial python.org), e o PyInstaller avisou "behavior of the splash
# screen is undefined". No teste real (exe compilado, duplo-clique), a
# splash simplesmente não apareceu — sem crash, mas sem o efeito também.
# Não dava pra confirmar se a CI (ambiente Python diferente) teria o
# mesmo problema sem arriscar um release. Ativo `design/splash_boot.png`
# + `design/gerar_splash_boot.py` prontos pra quando isso for retestado
# (Python completo local, ou aceitar o risco na CI).
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name=f'Licitarium Free v{VERSAO}',
    icon='design/licitarium.ico',
    console=False,
    upx=False,
)
