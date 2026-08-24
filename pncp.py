"""Cliente da API de consulta do PNCP e motor de sincronização do Licitarium.

Só stdlib. Estratégia (DESIGN.md §3): sync em 2 fases —
  1) contratações por codigoMunicipioIbge (loop obrigatório por modalidade);
  2) contratos e atas por CNPJ dos órgãos descobertos na fase 1.
Endpoints /atualizacao permitem sync incremental por data de atualização.
O JSON bruto de cada registro é guardado na coluna `raw` (fonte da verdade);
as demais colunas são projeção para filtro/listagem.
"""
import collections
import concurrent.futures
import json
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

BASE = "https://pncp.gov.br/api/consulta"
# itens e resultados por item ficam na API interna do portal, não na de
# consulta; devolvem array puro (sem envelope data/totalPaginas)
BASE_PNCP = "https://pncp.gov.br/api/pncp"
USER_AGENT = "Licitarium/0.1 (repositorio local de contratacoes; open-source)"
DATA_INICIO_PNCP = date(2021, 1, 1)  # portal entrou no ar em ago/2021
# /v1/pca/atualizacao rejeita dataInicio anterior a 01/04/2021 (HTTP 422
# "Data inicial inválida ou anterior a 20210401" — verificado 2026-07-29)
DATA_INICIO_PCA = date(2021, 4, 1)
JANELA_MAX_DIAS = 364  # API limita o range de datas por consulta

# Tabela de domínio do PNCP — modalidades da Lei 14.133/2021.
# /v1/contratacoes/* exige codigoModalidadeContratacao, daí o loop.
MODALIDADES = {
    1: "Leilão eletrônico",
    2: "Diálogo competitivo",
    3: "Concurso",
    4: "Concorrência eletrônica",
    5: "Concorrência presencial",
    6: "Pregão eletrônico",
    7: "Pregão presencial",
    8: "Dispensa de licitação",
    9: "Inexigibilidade",
    10: "Manifestação de interesse",
    11: "Pré-qualificação",
    12: "Credenciamento",
    13: "Leilão presencial",
}


class PncpErro(Exception):
    """Falha de comunicação com o PNCP após esgotar as tentativas."""


class SyncCancelado(Exception):
    """O usuário pediu para parar a sincronização.

    **Não herda de PncpErro de propósito.** Os blocos `except PncpErro`
    espalhados por `sincronizar_tudo` existem para que a falha de um tipo
    não derrube os demais — se o cancelamento herdasse dele, seria
    engolido e a coleta seguiria para a fase seguinte, exatamente o
    contrário do pedido.

    Quem levanta é a própria função de progresso (ver `Api._progresso`):
    ela já é chamada em todos os pontos naturais da coleta e desce por
    toda a pilha, então o cancelamento não precisou de nenhuma bandeira
    nova aqui dentro. O preço é que a parada acontece no próximo ponto de
    progresso, não no meio de uma requisição em voo.

    Interromper é seguro porque nada aqui é gravado à meia-boca: o
    `last_sync_<tipo>` só avança quando o tipo termina inteiro, e as
    gravações são upsert — o que já entrou fica, e a próxima coleta
    refaz a janela pendente.
    """


class ItensIndisponiveis(PncpErro):
    """O portal respondeu 404 na listagem de itens de uma contratação.

    Não é o mesmo que "esta contratação não tem item nenhum". Um 404 sob
    carga é portal ocupado, e tratá-lo como ausência fazia `itens_versao`
    ser carimbado — a contratação nunca mais era revisitada e os preços
    dela sumiam do banco em silêncio (auditoria de falha silenciosa,
    2026-08-09; a mesma lição de "falha ≠ ausência" que já mordeu antes).
    """


_INTERVALO_MIN = 0.5  # s entre requisições — o PNCP tem throttling agressivo
_ultima_req = 0.0
_trava_pacing = threading.Lock()

# a latência do PNCP é de ~0,9 s por chamada e ele tolera conexões
# simultâneas: buscar os resultados de item em paralelo derruba a primeira
# carga de ~20 min para poucos minutos
CONEXOES_PARALELAS = 4
# Só contam os 429 RECENTES. Contador acumulado desde o início do processo não
# serve: a fase 1 costuma levar 3 bloqueios logo de saída (medido: 3 em 13
# requisições), e isso deixava a fase 3 sequencial para sempre — justo a fase
# que precisa do paralelismo. Com a janela, uma rajada antiga não pesa mais.
JANELA_BLOQUEIOS = 120  # s
_bloqueios = collections.deque()  # instantes dos 429 observados
_trava_bloqueios = threading.Lock()


def _registrar_bloqueio():
    with _trava_bloqueios:
        _bloqueios.append(time.monotonic())


def _bloqueios_recentes():
    limite = time.monotonic() - JANELA_BLOQUEIOS
    with _trava_bloqueios:
        while _bloqueios and _bloqueios[0] < limite:
            _bloqueios.popleft()
        return len(_bloqueios)


def _paralelismo_atual():
    """Recua por degraus e volta sozinho quando o portal para de reclamar."""
    n = _bloqueios_recentes()
    if n >= 3:
        return 1
    return 2 if n else CONEXOES_PARALELAS


# O PNCP não recusa: ele demora. No acervo do piloto, todos os erros de um
# dia inteiro foram "The read operation timed out" — nenhum 429, nenhum 502.
# Insistir com o mesmo prazo curto repete a falha; por isso cada tentativa
# espera mais que a anterior.
TIMEOUTS = (30, 45, 60, 75, 90)


def _timeout(tentativa):
    return TIMEOUTS[min(tentativa, len(TIMEOUTS) - 1)]


def _espera(tentativa):
    """Backoff com sorteio: 1, 2, 4, 8 s mais até meio segundo de desvio.

    Sem o desvio, as quatro conexões que falharam juntas voltam juntas — e
    o portal, que já estava sobrecarregado, leva a mesma rajada de novo.
    """
    return 2 ** tentativa + random.uniform(0, 0.5)


def _get(caminho, params, tentativas=5, base=None, pacing=True,
         erro_404=False, retry_404=False):
    """GET com pacing e retry/backoff. Dict do JSON, ou None quando sem dados.

    Com pacing=False a espera entre chamadas é dispensada: quem controla o
    ritmo passa a ser o número de conexões simultâneas.

    `retry_404=True` para LISTAGENS de consulta (contratações/itens): ali
    "sem registros" é 204/corpo vazio, nunca 404 — um 404 é falha
    transitória do portal, então retenta e, se persistir, levanta PncpErro
    em vez de devolver None. Sem isso um 404 passageiro viraria "janela
    vazia" e a marca d'água avançaria sobre dados não baixados (falha ≠
    ausência; sincronizado do Licitarium Pro 2026-08-16).
    """
    global _ultima_req
    url = f"{base or BASE}{caminho}?{urllib.parse.urlencode(params)}"
    for tentativa in range(tentativas):
        if pacing:
            with _trava_pacing:
                espera = _INTERVALO_MIN - (time.monotonic() - _ultima_req)
                if espera > 0:
                    time.sleep(espera)
                _ultima_req = time.monotonic()
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=_timeout(tentativa)) as resp:
                if resp.status == 204:
                    return None
                corpo = resp.read()
                # alguns endpoints (ex.: PCA) devolvem 200 com corpo vazio
                # quando não há registros na janela
                return json.loads(corpo) if corpo.strip() else None
        except urllib.error.HTTPError as e:
            if e.code == 404 and erro_404:
                # quem passa erro_404 não pode confundir "não achei" com
                # "não existe" — ver ItensIndisponiveis
                raise ItensIndisponiveis(f"HTTP 404 em {caminho}") from e
            if e.code == 404 and retry_404:
                # listagem de consulta: 404 é falha do portal, não "vazio"
                if tentativa < tentativas - 1:
                    _registrar_bloqueio()
                    time.sleep(_espera(tentativa))
                    continue
                raise PncpErro(
                    f"HTTP 404 persistente em {caminho} — listagem não "
                    "responde; abortando para não gravar a janela como "
                    "vazia") from e
            if e.code == 204 or e.code == 404:
                return None  # sem registros para o filtro
            if e.code == 429 and tentativa < tentativas - 1:
                _registrar_bloqueio()
                retry_after = e.headers.get("Retry-After")
                time.sleep(int(retry_after) if (retry_after or "").isdigit()
                           else 5 * (tentativa + 1))
                continue
            if e.code in (500, 502, 503, 504) and tentativa < tentativas - 1:
                # portal sobrecarregado conta como bloqueio: o paralelismo
                # cai sozinho na próxima leva, em vez de insistir a quatro
                # conexões contra um servidor que já está pedindo trégua
                _registrar_bloqueio()
                time.sleep(_espera(tentativa))
                continue
            raise PncpErro(f"HTTP {e.code} em {caminho}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if tentativa < tentativas - 1:
                _registrar_bloqueio()
                time.sleep(_espera(tentativa))
                continue
            # "sem conexão" fazia o usuário procurar defeito na internet
            # dele; o que costuma acontecer é o portal demorar demais
            if "timed out" in str(e).lower() or isinstance(e, TimeoutError):
                raise PncpErro(
                    f"o PNCP não respondeu em {_timeout(tentativa)}s — o "
                    "portal está lento ou fora do ar") from e
            raise PncpErro(f"sem conexão com o PNCP ({e})") from e


def _paginar(caminho, params, tamanho_pagina, pacing=True):
    """Itera todos os registros de todas as páginas de uma consulta."""
    pagina = 1
    while True:
        dados = _get(caminho, {**params, "pagina": pagina,
                               "tamanhoPagina": tamanho_pagina},
                     pacing=pacing, retry_404=True)
        if not dados or not dados.get("data"):
            return
        yield from dados["data"]
        if pagina >= dados.get("totalPaginas", 1):
            return
        pagina += 1


def _baixar(caminho, consultas, tamanho_pagina):
    """Baixa várias consultas independentes: (rótulo, registros, erro|None).

    Só as requisições vão para as threads — a gravação fica com quem chama,
    numa conexão só. Os lotes chegam fora de ordem, por isso o rótulo.

    A consulta que falha vem com `erro` preenchido em vez de derrubar as
    demais. O portal recusa em rajada — 13 de 60 requisições voltaram 429
    numa medição de 2026-08-14, e o mesmo endpoint alternou entre responder
    em 0,3 s e devolver 500 depois de 60 s —, e antes disso uma única janela
    ruim no meio das 78 da fase 1 jogava fora todas as outras.

    Quem chama decide o que fazer com a falha; o que **não** pode é dar a
    fase por completa, porque aí `last_sync_<tipo>` avança sobre uma janela
    que nunca foi baixada e o buraco fica no acervo para sempre.
    """
    # Em levas curtas de propósito: é ENTRE uma leva e outra que
    # `_paralelismo_atual` é relido, e portanto que o recuo por 429 tem chance
    # de valer. A fase 1 manda as 13 modalidades × N janelas de uma vez só —
    # com uma leva única, a escada 4 → 2 → 1 nunca era relida e a fase inteira
    # seguia a 4 conexões contra um portal que já estava recusando. O preço da
    # leva é uma barreira: a próxima só começa quando a atual fecha.
    pendentes = list(consultas)
    while pendentes:
        conexoes = min(_paralelismo_atual(), len(pendentes))
        leva, pendentes = pendentes[:4 * conexoes], pendentes[4 * conexoes:]
        if conexoes <= 1:
            for rotulo, params in leva:
                try:
                    lote, erro = list(_paginar(caminho, params,
                                               tamanho_pagina)), None
                except PncpErro as e:
                    lote, erro = [], e
                yield rotulo, lote, erro
            continue
        with concurrent.futures.ThreadPoolExecutor(conexoes) as ex:
            futuros = {ex.submit(lambda p=p: list(_paginar(
                caminho, p, tamanho_pagina, pacing=False))): rotulo
                for rotulo, p in leva}
            for f in concurrent.futures.as_completed(futuros):
                try:
                    lote, erro = f.result(), None
                except PncpErro as e:
                    lote, erro = [], e
                yield futuros[f], lote, erro


# servem para dizer ao usuário o tamanho da encrenca antes de ele mandar
# baixar o município. Recalibrados em 2026-08-02 sobre os cinco municípios de
# referência já coletados — 714 contratações, 12.587 itens, 25,5 MB de JSON e
# 45,4 MB de arquivo —, amostra bem maior que as 131 contratações de
# Orindiúva de onde saíram os primeiros números (20,4 itens e 2,4 KB).
ITENS_POR_CONTRATACAO = 17.6
KB_POR_ITEM = 2.1             # de JSON bruto; o disco cobra FATOR_DISCO a mais
FRACAO_COM_RESULTADO = 0.84   # 2.257 dos 2.674 itens têm preço homologado
# Razão entre o JSON que vem do portal e o espaço que ele ocupa depois de
# gravado: as colunas projetadas, os índices e o FTS custam quase o mesmo que
# o próprio JSON. Medida em 2026-08-02 removendo cada município de referência
# de uma cópia do acervo e comparando o arquivo depois de VACUUM — 14,57 /
# 11,60 / 11,33 / 6,62 / 1,28 MB reais contra 8,16 / 6,46 / 6,46 / 3,69 /
# 0,72 MB de JSON: a razão fica entre 1,75 e 1,80 nos cinco.
FATOR_DISCO = 1.78


def estimar_volume(codigo_ibge, inicio=DATA_INICIO_PNCP, fim=None):
    """Quantas contratações um município tem, sem baixar nenhuma.

    Lê `totalRegistros` do envelope da primeira página de cada consulta. O
    caminho ingênuo — paginar tudo para contar — custa centenas de
    requisições e, num município médio, não termina: Olímpia-SP tem 1.663
    dispensas só em 2025, contra 131 contratações de Orindiúva em cinco anos.
    """
    fim = fim or date.today()
    consultas = [((codigo, a), {"dataInicial": _amd(a), "dataFinal": _amd(b),
                                "codigoModalidadeContratacao": codigo,
                                "codigoMunicipioIbge": str(codigo_ibge),
                                "pagina": 1, "tamanhoPagina": 10})
                 for codigo in MODALIDADES
                 for a, b in _janelas(inicio, fim)]
    conexoes = min(_paralelismo_atual(), len(consultas))
    total = 0

    falhas = 0

    def uma(params):
        # consulta que não responde não pode derrubar a estimativa inteira:
        # é melhor avisar "pelo menos N" do que não avisar nada
        nonlocal falhas
        try:
            d = _get("/v1/contratacoes/atualizacao", params,
                     pacing=conexoes <= 1)
        except PncpErro:
            falhas += 1
            return 0
        return (d or {}).get("totalRegistros") or 0

    if conexoes <= 1:
        total = sum(uma(p) for _, p in consultas)
    else:
        with concurrent.futures.ThreadPoolExecutor(conexoes) as ex:
            total = sum(ex.map(lambda c: uma(c[1]), consultas))
    itens = round(total * ITENS_POR_CONTRATACAO)
    # a fase 3 custa uma requisição por contratação mais uma por item com
    # resultado — é ela que define se a coleta leva minutos ou uma noite
    requisicoes = total + itens * FRACAO_COM_RESULTADO
    minutos = round(requisicoes * 0.9 / max(CONEXOES_PARALELAS, 1) / 60)
    return {"contratacoes": total, "itens": itens,
            # o que o usuário quer saber é quanto o disco vai crescer, não
            # quanto JSON vem do portal
            "mb": round(itens * KB_POR_ITEM * FATOR_DISCO / 1024, 1),
            "minutos": minutos, "parcial": falhas > 0}


# ── correção monetária ──────────────────────────────────────────────────────
# Preço de 2022 não se compara com preço de 2026: no acervo do piloto há itens
# de 2022 a 2026 na mesma pesquisa, e a inflação do período passa de 20%. A
# série mensal do IPCA cabe em poucos KB e vem do Banco Central, que é fonte
# citável no processo.
SGS_IPCA = 433
URL_SGS = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados"
           "?formato=json&dataInicial={inicio}")


def sync_ipca(db, inicio=None):
    """Baixa a variação mensal do IPCA e guarda mês a mês.

    O índice do mês corrente não existe: o IBGE publica com semanas de
    atraso e o BCB republica depois. O programa corrige até o último mês
    disponível e diz até onde foi — melhor que projetar um número que
    ninguém publicou.
    """
    inicio = inicio or f"01/01/{DATA_INICIO_PNCP.year}"
    url = URL_SGS.format(serie=SGS_IPCA, inicio=inicio)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            dados = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        raise PncpErro(f"não consegui baixar o IPCA: {e}") from e
    gravados = 0
    for linha in dados:
        try:
            dia, mes, ano = linha["data"].split("/")
            variacao = float(linha["valor"])
        except (KeyError, ValueError):
            continue          # linha estranha não derruba a série inteira
        db.execute(
            "INSERT INTO ipca (competencia, variacao) VALUES (?,?)"
            " ON CONFLICT(competencia) DO UPDATE SET variacao=excluded.variacao",
            (f"{ano}-{mes}", variacao))
        gravados += 1
    db.commit()
    return gravados


def _janelas(inicio, fim, max_dias=JANELA_MAX_DIAS):
    """Fatia [inicio, fim] em janelas de no máximo max_dias."""
    atual = inicio
    while atual <= fim:
        ate = min(atual + timedelta(days=max_dias - 1), fim)
        yield atual, ate
        atual = ate + timedelta(days=1)


def _amd(d):
    return d.strftime("%Y%m%d")


def _primeiro(item, *chaves):
    """Primeiro valor não-nulo entre variantes de grafia de campo da API."""
    for chave in chaves:
        if item.get(chave) is not None:
            return item[chave]
    return None


def _num(v):
    """Campo numérico da API convertido, ou None se vier malformado.

    Sem isso, um valor que não seja número JSON limpo (string vazia,
    placeholder textual) fica gravado como TEXT numa coluna REAL — a
    afinidade do SQLite não converte, e a corrupção só se manifesta bem
    depois, em relatorios.py (formatação quebra, SUM em Python quebra,
    filtro `> 0` deixa a linha passar sem entrar no total)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ── upserts (raw sempre guardado; INSERT OR REPLACE é idempotente) ──────────

def _upsert_contratacao(db, item, ibge=None, referencia=0):
    numero = item.get("numeroControlePNCP")
    if not numero:
        return False
    orgao = item.get("orgaoEntidade") or {}
    unidade = item.get("unidadeOrgao") or {}
    db.execute(
        """INSERT OR REPLACE INTO contratacoes
           (numero_controle, ano, sequencial, orgao_cnpj, orgao_nome, unidade,
            modalidade_id, modalidade_nome, situacao, objeto,
            valor_estimado, valor_homologado, data_encerramento_proposta,
            data_publicacao, data_atualizacao,
            referencia, municipio_ibge, raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (numero, item.get("anoCompra"), item.get("sequencialCompra"),
         orgao.get("cnpj"), orgao.get("razaoSocial"), unidade.get("nomeUnidade"),
         item.get("modalidadeId"), item.get("modalidadeNome"),
         item.get("situacaoCompraNome"), item.get("objetoCompra"),
         _num(item.get("valorTotalEstimado")), _num(item.get("valorTotalHomologado")),
         item.get("dataEncerramentoProposta"),
         item.get("dataPublicacaoPncp"), item.get("dataAtualizacao"),
         referencia, ibge,
         json.dumps(item, ensure_ascii=False), datetime.now().isoformat()))
    return True


def _upsert_contrato(db, item):
    numero = item.get("numeroControlePNCP")
    if not numero:
        return False
    orgao = item.get("orgaoEntidade") or {}
    db.execute(
        """INSERT OR REPLACE INTO contratos
           (numero_controle, contratacao_controle, orgao_cnpj,
            numero_contrato, ano_contrato, sequencial_contrato,
            fornecedor_ni, fornecedor_nome, objeto, valor_global,
            vigencia_inicio, vigencia_fim, data_publicacao, data_atualizacao,
            raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (numero,
         _primeiro(item, "numeroControlePncpCompra", "numeroControlePNCPCompra"),
         orgao.get("cnpj"),
         item.get("numeroContratoEmpenho"), item.get("anoContrato"),
         item.get("sequencialContrato"),
         item.get("niFornecedor"), item.get("nomeRazaoSocialFornecedor"),
         item.get("objetoContrato"), _num(item.get("valorGlobal")),
         _primeiro(item, "dataVigenciaInicio", "vigenciaInicio"),
         _primeiro(item, "dataVigenciaFim", "vigenciaFim"),
         item.get("dataPublicacaoPncp"), item.get("dataAtualizacao"),
         json.dumps(item, ensure_ascii=False), datetime.now().isoformat()))
    return True


def _upsert_ata(db, item):
    numero = _primeiro(item, "numeroControlePNCPAta", "numeroControlePNCP")
    if not numero:
        return False
    db.execute(
        """INSERT OR REPLACE INTO atas
           (numero_controle, contratacao_controle, orgao_cnpj,
            numero_ata, ano_ata, objeto,
            vigencia_inicio, vigencia_fim, data_atualizacao, raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (numero,
         _primeiro(item, "numeroControlePNCPCompra", "numeroControlePncpCompra"),
         _primeiro(item, "cnpjOrgao", "cnpj"),
         item.get("numeroAtaRegistroPreco"), item.get("anoAta"),
         item.get("objetoContratacao"),
         _primeiro(item, "vigenciaInicio", "dataVigenciaInicio"),
         _primeiro(item, "vigenciaFim", "dataVigenciaFim"),
         _primeiro(item, "dataAtualizacao", "dataAtualizacaoGlobal"),
         json.dumps(item, ensure_ascii=False), datetime.now().isoformat()))
    return True


# ── fases de sincronização ──────────────────────────────────────────────────

def sync_contratacoes(db, codigo_ibge, inicio, fim, progresso=None,
                      referencia=0):
    """Fase 1: contratações do município, por modalidade e janela de datas.

    São 13 modalidades × janelas de data, todas independentes — a API exige
    o loop por modalidade mesmo quando a maioria não devolve nada para um
    município pequeno. Baixadas em paralelo; a gravação segue sequencial.
    """
    consultas = [(nome, {"dataInicial": _amd(a), "dataFinal": _amd(b),
                         "codigoModalidadeContratacao": codigo,
                         "codigoMunicipioIbge": codigo_ibge})
                 for codigo, nome in MODALIDADES.items()
                 for a, b in _janelas(inicio, fim)]
    total, falhas = 0, []
    for feitas, (nome, lote, erro) in enumerate(
            _baixar("/v1/contratacoes/atualizacao", consultas, 50), 1):
        if progresso:
            progresso(f"Contratações — {nome} ({feitas}/{len(consultas)})…")
        if erro:
            falhas.append(f"{nome}: {erro}")
            continue
        for item in lote:
            total += _upsert_contratacao(db, item, codigo_ibge,
                                         referencia)
        db.commit()  # transação curta por lote: não segurar trava
    if falhas:
        # O que baixou já está gravado (upsert é idempotente); levantar aqui
        # é o que impede `last_sync_contratacoes` de avançar sobre a janela
        # que faltou — sem isso a falha viraria buraco silencioso no acervo.
        # O contador vai na mensagem porque o `sync_log` grava 0 registros
        # quando o tipo falha, e a tela de Configurações daria a entender que
        # a passada inteira não serviu para nada.
        raise PncpErro(f"{len(falhas)} de {len(consultas)} consultas "
                       f"falharam ({total} registros gravados assim mesmo) "
                       f"— {falhas[0]}")
    return total


def consultar_orgao(cnpj):
    """Registro do CNPJ no PNCP (razão social, esfera) — None se o CNPJ não
    existe no portal. Usado para conferir um órgão antes de adicioná-lo à
    mão, já que a API de contratações não filtra por CNPJ isolado."""
    return _get(f"/v1/orgaos/{cnpj}", {}, base=BASE_PNCP)


def descobrir_orgaos(db):
    """CNPJs distintos das contratações viram órgãos monitorados."""
    db.execute(
        """INSERT OR IGNORE INTO orgaos (cnpj, razao_social, ativo, origem)
           SELECT DISTINCT orgao_cnpj, orgao_nome, 1, 'descoberto'
           FROM contratacoes
           WHERE referencia=0 AND orgao_cnpj IS NOT NULL""")
    db.commit()


def sync_contratos(db, cnpj, inicio, fim, progresso=None):
    """Fase 2: contratos de um órgão (API não filtra por município)."""
    return _sync_por_janela(db, "/v1/contratos/atualizacao", _upsert_contrato,
                            {"cnpjOrgao": cnpj}, inicio, fim)


def sync_atas(db, cnpj, inicio, fim, progresso=None):
    """Fase 2: atas de registro de preços de um órgão."""
    return _sync_por_janela(db, "/v1/atas/atualizacao", _upsert_ata,
                            {"cnpj": cnpj}, inicio, fim)


def _sync_por_janela(db, caminho, upsert, params, inicio, fim,
                     chaves_data=("dataInicial", "dataFinal")):
    """Baixa as janelas de data em paralelo e grava sequencialmente."""
    ini, fi = chaves_data
    consultas = [(a, {**params, ini: _amd(a), fi: _amd(b)})
                 for a, b in _janelas(inicio, fim)]
    total, falhas = 0, []
    for _, lote, erro in _baixar(caminho, consultas, 500):
        if erro:
            falhas.append(erro)
            continue
        for item in lote:
            total += upsert(db, item)
        db.commit()  # transação curta por lote
    if falhas:
        # mesma regra da fase 1: grava o que veio, mas não deixa o tipo ser
        # dado por sincronizado (quem chama já trata a exceção por CNPJ)
        raise PncpErro(f"{len(falhas)} de {len(consultas)} janelas falharam "
                       f"({total} registros gravados assim mesmo) — {falhas[0]}")
    return total


def _upsert_pca(db, plano):
    """Achata os itens de um plano (PCA) — contexto do plano vai em cada linha."""
    id_pca = plano.get("idPcaPncp")
    if not id_pca:
        return 0
    agora = datetime.now().isoformat()
    n = 0
    for item in plano.get("itens") or []:
        numero = item.get("numeroItem")
        if numero is None:
            continue
        db.execute(
            """INSERT OR REPLACE INTO pca_itens
               (id, id_pca, ano, orgao_cnpj, unidade, numero_item, descricao,
                categoria, grupo, quantidade, valor_total, data_atualizacao,
                raw, sync_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (f"{id_pca}#{numero}", id_pca, plano.get("anoPca"),
             plano.get("orgaoEntidadeCnpj"), plano.get("nomeUnidade"), numero,
             item.get("descricaoItem"), item.get("nomeClassificacaoCatalogo"),
             item.get("grupoContratacaoNome"), _num(item.get("quantidadeEstimada")),
             _num(item.get("valorTotal")), item.get("dataAtualizacao"),
             json.dumps(item, ensure_ascii=False), agora))
        n += 1
    return n


def sync_pca(db, cnpj, inicio, fim, progresso=None):
    """Fase 2: itens do Plano de Contratações Anual de um órgão.

    Atenção: este endpoint usa dataInicio/dataFim — os demais usam
    dataInicial/dataFinal (verificado contra a API real em 2026-07-29).
    """
    inicio = max(inicio, DATA_INICIO_PCA)  # endpoint rejeita datas anteriores
    if inicio > fim:
        return 0
    return _sync_por_janela(db, "/v1/pca/atualizacao", _upsert_pca,
                            {"cnpj": cnpj}, inicio, fim,
                            chaves_data=("dataInicio", "dataFim"))


def _itens_da_compra(cnpj, ano, sequencial):
    """Itens de uma contratação (endpoint devolve array puro, paginado)."""
    pagina = 1
    while True:
        lote = _get(f"/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens",
                    {"pagina": pagina, "tamanhoPagina": 100}, base=BASE_PNCP,
                    erro_404=True)
        if not lote:
            return
        yield from lote
        if len(lote) < 100:
            return
        pagina += 1


def _resultado_do_item(cnpj, ano, sequencial, numero_item, pacing=True):
    """Resultado homologado de um item: vencedor e valor unitário fechado."""
    lote = _get(
        f"/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numero_item}"
        f"/resultados", {}, base=BASE_PNCP, pacing=pacing)
    if not lote:
        return None
    # o mais recente não cancelado é o que vale
    validos = [r for r in lote if not r.get("dataCancelamento")]
    return (validos or lote)[0]


def _upsert_item(db, contratacao, item, resultado):
    numero = item.get("numeroItem")
    if numero is None:
        return 0
    r = resultado or {}
    db.execute(
        """INSERT OR REPLACE INTO itens
           (id, contratacao_controle, orgao_cnpj, ano, sequencial, numero_item,
            descricao, material_servico, categoria, unidade, quantidade,
            valor_unitario_estimado, valor_total_estimado, tem_resultado,
            valor_unitario_homologado, valor_total_homologado,
            quantidade_homologada, fornecedor_ni, fornecedor_nome,
            fornecedor_porte, data_resultado, situacao, data_atualizacao,
            referencia, municipio_ibge, raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (f"{contratacao['numero_controle']}#{numero}",
         contratacao["numero_controle"], contratacao["orgao_cnpj"],
         contratacao["ano"], contratacao["sequencial"], numero,
         item.get("descricao"), item.get("materialOuServicoNome"),
         item.get("itemCategoriaNome"), item.get("unidadeMedida"),
         _num(item.get("quantidade")), _num(item.get("valorUnitarioEstimado")),
         _num(item.get("valorTotal")), 1 if item.get("temResultado") else 0,
         _num(r.get("valorUnitarioHomologado")), _num(r.get("valorTotalHomologado")),
         _num(r.get("quantidadeHomologada")), r.get("niFornecedor"),
         r.get("nomeRazaoSocialFornecedor"), r.get("porteFornecedorNome"),
         r.get("dataResultado"), item.get("situacaoCompraItemNome"),
         item.get("dataAtualizacao"),
         contratacao["referencia"], contratacao["municipio_ibge"],
         json.dumps({"item": item, "resultado": r}, ensure_ascii=False),
         datetime.now().isoformat()))
    return 1


def _itens_pendentes(db, contratacao, itens):
    """Filtra os itens que realmente precisam ser (re)gravados.

    O PNCP mexe na dataAtualizacao da *contratação* por motivo cosmético e
    isso devolvia a compra inteira para a fila: medido no acervo real,
    1.815 requisições de resultado para zero item alterado. A listagem de
    itens já traz a dataAtualizacao de cada um — comparar com a gravada
    reduz isso à requisição da própria listagem.

    Item inalterado é pulado por completo, e não regravado sem resultado:
    `_upsert_item` faz INSERT OR REPLACE, então regravar com resultado nulo
    apagaria o preço homologado.
    """
    gravados = {r["numero_item"]: r for r in db.execute(
        """SELECT numero_item, data_atualizacao, valor_unitario_homologado
           FROM itens WHERE contratacao_controle=?""",
        (contratacao["numero_controle"],))}

    def pendente(item):
        antigo = gravados.get(item.get("numeroItem"))
        if antigo is None or antigo["data_atualizacao"] != item.get("dataAtualizacao"):
            return True
        # resultado que ficou faltando (coleta interrompida antes dele) não
        # se conserta sozinho: a dataAtualizacao do item não muda por isso
        return bool(item.get("temResultado")) and \
            antigo["valor_unitario_homologado"] is None

    return [i for i in itens if pendente(i)]


def sync_itens(db, progresso=None, limite=None):
    """Fase 3: itens e resultados das contratações — o banco de preços.

    Custa uma requisição por contratação mais uma por item *alterado* que
    tenha resultado, e por isso só visita contratação nova ou alterada desde
    a última coleta (itens_versao guarda a dataAtualizacao vigente naquele
    momento) — e, dentro dela, só os itens que mudaram (_itens_pendentes).
    """
    pendentes = [dict(r) for r in db.execute(
        """SELECT numero_controle, orgao_cnpj, ano, sequencial,
                  data_atualizacao, referencia, municipio_ibge
           FROM contratacoes
           WHERE orgao_cnpj IS NOT NULL AND sequencial IS NOT NULL
             AND (itens_versao IS NULL OR itens_versao <> data_atualizacao)
           ORDER BY data_publicacao DESC""")]
    if limite:
        pendentes = pendentes[:limite]
    total, sem_listagem = 0, 0
    for i, c in enumerate(pendentes, 1):
        if progresso:
            progresso(f"Itens — contratação {i} de {len(pendentes)}…")
        try:
            itens = _itens_pendentes(
                db, c, _itens_da_compra(c["orgao_cnpj"], c["ano"],
                                        c["sequencial"]))
            # os resultados são independentes entre si: buscar em paralelo
            com_resultado = [i for i in itens if i.get("temResultado")]
            resultados = {}
            if com_resultado:
                conexoes = min(_paralelismo_atual(), len(com_resultado))
                paralelo = conexoes > 1
                with concurrent.futures.ThreadPoolExecutor(conexoes) as ex:
                    futuros = {
                        ex.submit(_resultado_do_item, c["orgao_cnpj"],
                                  c["ano"], c["sequencial"], i["numeroItem"],
                                  not paralelo): i["numeroItem"]
                        for i in com_resultado}
                    for f in concurrent.futures.as_completed(futuros):
                        resultados[futuros[f]] = f.result()
            for item in itens:
                total += _upsert_item(db, c, item,
                                      resultados.get(item.get("numeroItem")))
            db.execute("UPDATE contratacoes SET itens_versao=?,"
                       " itens_sync_em=? WHERE numero_controle=?",
                       (c["data_atualizacao"], datetime.now().isoformat(),
                        c["numero_controle"]))
            db.commit()
        except ItensIndisponiveis:
            # NÃO carimba `itens_versao`: a contratação continua pendente e
            # volta na próxima coleta. Carimbar aqui era o que fazia os
            # preços dela sumirem do banco calados.
            sem_listagem += 1
            db.commit()
            continue
        except PncpErro:
            db.commit()  # preserva o que já entrou; tenta de novo na próxima
            raise
    if sem_listagem:
        # o usuário vê isso em Configurações → Sincronizações recentes
        hoje = date.today()
        _log(db, "itens", hoje, hoje, total, "aviso",
             f"{sem_listagem} contratações sem listagem de itens (404 do "
             f"portal) — ficaram pendentes para a próxima sincronização")
    return total


def _config(db, chave, valor=None):
    if valor is None:
        linha = db.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
        return linha[0] if linha else None
    db.execute("INSERT OR REPLACE INTO config (chave, valor) VALUES (?,?)", (chave, valor))
    db.commit()


def _log(db, tipo, inicio, fim, registros, status, erro=None):
    db.execute(
        """INSERT INTO sync_log (iniciado_em, tipo, janela_ini, janela_fim,
                                 registros, status, erro)
           VALUES (?,?,?,?,?,?,?)""",
        (datetime.now().isoformat(), tipo, inicio.isoformat(), fim.isoformat(),
         registros, status, erro))
    db.commit()


# Abrir o programa dispara uma sincronização. Abrir cinco vezes numa hora
# disparava cinco coletas completas contra um portal que já estava lento —
# e nada muda no PNCP em dez minutos.
INTERVALO_MINIMO = 600      # segundos


def sincronizar_tudo(db, codigo_ibge, progresso=None, forcado=True):
    """Sync completo incremental. Falha em um tipo não bloqueia os demais.

    Com `forcado=False` (a sincronização automática da abertura), desiste
    se a última execução foi há menos de `INTERVALO_MINIMO`.

    Retorna resumo {tipo: registros | None se falhou}.
    """
    if not forcado:
        ultima = _config(db, "ultimo_sync_em")
        if ultima:
            try:
                idade = (datetime.now()
                         - datetime.fromisoformat(ultima)).total_seconds()
            except ValueError:
                idade = INTERVALO_MINIMO
            if idade < INTERVALO_MINIMO:
                return {"pulado": True,
                        "faltam": int(INTERVALO_MINIMO - idade)}
    _config(db, "ultimo_sync_em", datetime.now().isoformat())
    hoje = date.today()
    resumo = {}

    def janela_de(tipo):
        ultimo = _config(db, f"last_sync_{tipo}")
        if not ultimo:
            return DATA_INICIO_PNCP
        # 1 dia de sobreposição: garante pegar registros atualizados no
        # exato dia da última sincronização (upsert torna a repetição inócua)
        return date.fromisoformat(ultimo) - timedelta(days=1)

    # fase 0 — índice de correção monetária: leve (poucos KB) e usado pela
    # aba Preços; falhar aqui não pode impedir a coleta do acervo
    try:
        resumo["ipca"] = sync_ipca(db)
    except PncpErro as e:
        _log(db, "ipca", hoje, hoje, 0, "erro", str(e))
        resumo["ipca"] = None

    # fase 1 — contratações por município
    inicio = janela_de("contratacoes")
    try:
        n = sync_contratacoes(db, codigo_ibge, inicio, hoje, progresso)
        _config(db, "last_sync_contratacoes", hoje.isoformat())
        _log(db, "contratacoes", inicio, hoje, n, "ok")
        resumo["contratacoes"] = n
    except PncpErro as e:
        _log(db, "contratacoes", inicio, hoje, 0, "erro", str(e))
        resumo["contratacoes"] = None

    descobrir_orgaos(db)

    # fase 2 — contratos e atas por CNPJ de órgão ativo
    orgaos = [r[0] for r in db.execute(
        "SELECT cnpj FROM orgaos WHERE ativo=1").fetchall()]
    for tipo, func in (("contratos", sync_contratos), ("atas", sync_atas),
                       ("pca", sync_pca)):  # fase 2, por CNPJ de órgão
        inicio = janela_de(tipo)
        total, falhou = 0, False
        for cnpj in orgaos:
            if progresso:
                progresso(f"{tipo.capitalize()} — órgão {cnpj}…")
            try:
                total += func(db, cnpj, inicio, hoje, progresso)
            except PncpErro as e:
                falhou = True
                _log(db, tipo, inicio, hoje, total, "erro", f"{cnpj}: {e}")
        if not falhou:
            _config(db, f"last_sync_{tipo}", hoje.isoformat())
            _log(db, tipo, inicio, hoje, total, "ok")
            resumo[tipo] = total
        else:
            resumo[tipo] = None

    # fase 3 — itens das contratações; é a mais custosa,
    # então vem no fim: se falhar, o resto do acervo já está gravado
    try:
        n = sync_itens(db, progresso)
        _config(db, "last_sync_itens", hoje.isoformat())
        _log(db, "itens", hoje, hoje, n, "ok")
        resumo["itens"] = n
    except PncpErro as e:
        _log(db, "itens", hoje, hoje, 0, "erro", str(e))
        resumo["itens"] = None

    # Devolve ao disco o espaço que as regravações deixaram para trás. O
    # VACUUM **bloqueia toda leitura** enquanto roda — 0,62 s num acervo de
    # 114 MB —, e o limiar antigo (200 páginas ≈ 0,8 MB) disparava em quase
    # toda sincronização: quem estivesse no Painel via a tela congelar sem
    # motivo aparente. Agora só vale a pena quando há desperdício de verdade.
    livres = db.execute("PRAGMA freelist_count").fetchone()[0]
    total = db.execute("PRAGMA page_count").fetchone()[0]
    if livres > 2000 and livres > total * 0.05:
        if progresso:
            progresso("Compactando o acervo…")
        db.execute("VACUUM")
    return resumo
