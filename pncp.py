"""Orquestração do sync do Licitarium sobre o motor_pncp compartilhado.

HTTP resiliente contra o portal (retry, paralelismo adaptativo, disjuntor)
saiu para o pacote `motor_pncp` (extraído do Pretiarium Free em 2026-09-05
e compartilhado com Licitarium Free/Pro — ver
`relatorio_correcoes_motor_sync_pncp.md`, que este arquivo fecha por
inteiro ao adotar o motor: nenhum dos bugs documentados lá existe aqui,
porque o código que os continha foi embora). Este arquivo cuida só do que
é específico do Licitarium: schema/upsert, orquestração das fases e
escopo de sincronização. `motor_pncp` não conhece banco nenhum — devolve
registros tipados com `.raw` como fonte da verdade (ver `tipos.py` do
pacote); quem decide schema e o que já tem gravado é este arquivo.

Estratégia (DESIGN.md §3): sync em 3 fases —
  1) contratações por codigoMunicipioIbge (loop obrigatório por modalidade);
  2) contratos, atas e PCA por CNPJ dos órgãos descobertos na fase 1;
  3) itens e resultados das contratações (banco de preços).
Endpoints /atualizacao permitem sync incremental por data de atualização.
O JSON bruto de cada registro é guardado na coluna `raw` (fonte da verdade);
as demais colunas são projeção para filtro/listagem.
"""
import json
from datetime import date, datetime, timedelta

from motor_pncp import (
    DATA_INICIO_PNCP,
    Config,
    ItensIndisponiveis,
    Motor,
    PncpErro,
    SyncCancelado,  # noqa: F401 — reexportado, usado como pncp.SyncCancelado
    ipca,
)

USER_AGENT = "Licitarium/0.1 (repositorio local de contratacoes; open-source)"
# conexoes_paralelas=1, não o padrão 4 (achado do usuário, 2026-09-09):
# medido contra o PNCP real, sync completa de contratações de Orindiúva
# (13 modalidades, ~5 anos de janela) — 4 paralelas: 58% de 429 (83/143),
# disjuntor abortou com 28/78 consultas perdidas, ~25 min sem terminar;
# 2 paralelas: 31% (31/99), 10/78 perdidas, ~21 min, também não terminou.
# 1 (sequencial): 35% de 429 em retry (42/120) — parecido com o de 2 —
# mas ZERO consulta perdida (disjuntor nunca dispara, cada requisição
# retenta sem brigar com as irmãs pelo mesmo limite de taxa) e terminou
# em 4,8 min, mais rápido que as outras duas que nem terminaram. Sem
# paralelismo, o backoff sempre ganha. Ver [[reference_pncp_429_waf]].
CONFIG_MOTOR = Config(conexoes_paralelas=1)


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


def estimar_volume(codigo_ibge, inicio=DATA_INICIO_PNCP, fim=None, motor=None):
    """Quantas contratações um município tem, sem baixar nenhuma.

    `Motor.contar_contratacoes` já lê `totalRegistros` do envelope da
    primeira página de cada consulta em vez de paginar tudo — ver docstring
    do método no pacote.
    """
    fim = fim or date.today()
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    r = motor.contar_contratacoes(codigo_ibge, inicio, fim)
    total = r["total"]
    itens = round(total * ITENS_POR_CONTRATACAO)
    # a fase 3 custa uma requisição por contratação mais uma por item com
    # resultado — é ela que define se a coleta leva minutos ou uma noite
    requisicoes = total + itens * FRACAO_COM_RESULTADO
    minutos = round(requisicoes * 0.9 / max(CONFIG_MOTOR.conexoes_paralelas, 1) / 60)
    return {"contratacoes": total, "itens": itens,
            # o que o usuário quer saber é quanto o disco vai crescer, não
            # quanto JSON vem do portal
            "mb": round(itens * KB_POR_ITEM * FATOR_DISCO / 1024, 1),
            "minutos": minutos, "parcial": r["parcial"]}


# ── correção monetária ──────────────────────────────────────────────────────
# Preço de 2022 não se compara com preço de 2026: no acervo do piloto há itens
# de 2022 a 2026 na mesma pesquisa, e a inflação do período passa de 20%. A
# série mensal do IPCA cabe em poucos KB e vem do Banco Central, que é fonte
# citável no processo.

def _ipca_desde(db):
    """Data de início pro sync do IPCA — 60 dias antes do último sync, não
    a série inteira desde 2021. Sem isso, `sincronizar_tudo` rebaixava a
    série completa toda vez que rodava, sem ganho nenhum (mesmo achado que
    motivou a extração do motor — ver `relatorio_correcoes_motor_sync_pncp.md`).
    60 dias (não 1, como as outras janelas) porque o BCB revisa o índice
    do mês corrente por semanas depois da publicação original — overlap
    curto perderia a correção.
    """
    ultimo = _config(db, "last_sync_ipca")
    if not ultimo:
        return None  # ipca() usa o início da série (2021) como default
    return (date.fromisoformat(ultimo) - timedelta(days=60)).strftime("%d/%m/%Y")


def sync_ipca(db, inicio=None):
    """Baixa a variação mensal do IPCA e guarda mês a mês.

    O índice do mês corrente não existe: o IBGE publica com semanas de
    atraso e o BCB republica depois. O programa corrige até o último mês
    disponível — melhor que projetar um número que ninguém publicou.

    Função de módulo `motor_pncp.ipca` (não `Motor.ipca`, deprecado desde
    a v1.2.0 do motor): tem cliente HTTP próprio, então falha do BCB não
    conta mais como bloqueio do PNCP no paralelismo da coleta.
    """
    gravados = 0
    for linha in ipca(inicio, user_agent=USER_AGENT):
        db.execute(
            "INSERT INTO ipca (competencia, variacao) VALUES (?,?)"
            " ON CONFLICT(competencia) DO UPDATE SET variacao=excluded.variacao",
            (linha["competencia"], linha["variacao"]))
        gravados += 1
    db.commit()
    return gravados


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
            vigencia_inicio, vigencia_fim, data_assinatura,
            data_publicacao, data_atualizacao,
            raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (numero,
         _primeiro(item, "numeroControlePncpCompra", "numeroControlePNCPCompra"),
         orgao.get("cnpj"),
         item.get("numeroContratoEmpenho"), item.get("anoContrato"),
         item.get("sequencialContrato"),
         item.get("niFornecedor"), item.get("nomeRazaoSocialFornecedor"),
         item.get("objetoContrato"), _num(item.get("valorGlobal")),
         _primeiro(item, "dataVigenciaInicio", "vigenciaInicio"),
         _primeiro(item, "dataVigenciaFim", "vigenciaFim"),
         item.get("dataAssinatura"),
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
            vigencia_inicio, vigencia_fim, data_assinatura, data_publicacao,
            data_atualizacao, raw, sync_em)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (numero,
         _primeiro(item, "numeroControlePNCPCompra", "numeroControlePncpCompra"),
         _primeiro(item, "cnpjOrgao", "cnpj"),
         item.get("numeroAtaRegistroPreco"), item.get("anoAta"),
         item.get("objetoContratacao"),
         _primeiro(item, "vigenciaInicio", "dataVigenciaInicio"),
         _primeiro(item, "vigenciaFim", "dataVigenciaFim"),
         item.get("dataAssinatura"), item.get("dataPublicacaoPncp"),
         _primeiro(item, "dataAtualizacao", "dataAtualizacaoGlobal"),
         json.dumps(item, ensure_ascii=False), datetime.now().isoformat()))
    return True


# ── fases de sincronização ──────────────────────────────────────────────────

def sync_contratacoes(db, codigo_ibge, inicio, fim, motor=None, referencia=0):
    """Fase 1: contratações do município, por modalidade e janela de datas.

    `Motor.contratacoes` já cuida do loop de 13 modalidades, do
    paralelismo adaptativo e do disjuntor — aqui só sobra ler o gerador e
    gravar. `referencia=1` grava como município de referência (só preço,
    nunca entra nos relatórios oficiais — todos filtram `WHERE referencia=0`).
    """
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    total = 0
    try:
        for contratacao in motor.contratacoes(codigo_ibge, inicio, fim):
            total += _upsert_contratacao(db, contratacao.raw, codigo_ibge,
                                         referencia)
    finally:
        # o que já veio fica gravado mesmo se PncpErro/SyncCancelado escapar
        # do gerador no meio — upsert é idempotente, a próxima passada
        # incremental refaz só o que faltou (falha ≠ ausência)
        db.commit()
    return total


def consultar_orgao(cnpj, motor=None):
    """Registro do CNPJ no PNCP (razão social, esfera) — None se o CNPJ não
    existe no portal. Usado para conferir um órgão antes de adicioná-lo à
    mão, já que a API de contratações não filtra por CNPJ isolado.

    Devolve o dict cru (`.raw`), não o tipo do motor — quem chama
    (`licitarium.py`) já espera o formato bruto do PNCP (`razaoSocial`,
    `esferaId`), e trocar isso é risco maior que o ganho de tipagem aqui.
    """
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    orgao = motor.consultar_orgao(cnpj)
    return orgao.raw if orgao else None


def descobrir_orgaos(db):
    """CNPJs distintos das contratações viram órgãos monitorados."""
    db.execute(
        """INSERT OR IGNORE INTO orgaos (cnpj, razao_social, ativo, origem)
           SELECT DISTINCT orgao_cnpj, orgao_nome, 1, 'descoberto'
           FROM contratacoes
           WHERE referencia=0 AND orgao_cnpj IS NOT NULL""")
    db.commit()


def sync_contratos(db, cnpj, inicio, fim, motor=None):
    """Fase 2: contratos de um órgão (API não filtra por município)."""
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    total = 0
    try:
        for contrato in motor.contratos(cnpj, inicio, fim):
            total += _upsert_contrato(db, contrato.raw)
    finally:
        db.commit()
    return total


def sync_atas(db, cnpj, inicio, fim, motor=None):
    """Fase 2: atas de registro de preços de um órgão."""
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    total = 0
    try:
        for ata in motor.atas(cnpj, inicio, fim):
            total += _upsert_ata(db, ata.raw)
    finally:
        db.commit()
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


def sync_pca(db, cnpj, inicio, fim, motor=None):
    """Fase 2: itens do Plano de Contratações Anual de um órgão.

    `Motor.pca` já cuida da regra de data mínima do endpoint (rejeita
    início anterior a 01/04/2021) — não precisa repetir aqui.
    """
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR)
    total = 0
    try:
        for plano in motor.pca(cnpj, inicio, fim):
            total += _upsert_pca(db, plano.raw)
    finally:
        db.commit()
    return total


# separador dos fornecedores concatenados em atas.fornecedor_ni/fornecedor_nome
# (SEPARADOR_FORNECEDOR): "\x1f" (unit separator) — nunca aparece em texto
# digitado, ao contrário de vírgula (comum em razão social). A exportação
# refaz uma linha por fornecedor a partir daqui (licitarium.Api._separar_
# fornecedores_ata); a busca por LIKE continua funcionando (substring).
SEPARADOR_FORNECEDOR = "\x1f"


def separar_fornecedores(linhas, chave_ni="fornecedor_ni", chave_nome="fornecedor_nome"):
    """Desfaz o agregado de `_atualizar_fornecedor_ata` — uma linha por
    fornecedor, mesmo padrão de Contratos (que já tem 1 fornecedor por
    linha, sem precisar disso). Pedido do usuário (2026-08-30): "separar
    cada ata com seu respectivo fornecedor". Linha sem fornecedor (item
    sem resultado ainda) passa direto, sem duplicar."""
    resultado = []
    for linha in linhas:
        nis = linha.get(chave_ni)
        if not nis:
            resultado.append(linha)
            continue
        nomes = (linha.get(chave_nome) or "").split(SEPARADOR_FORNECEDOR)
        for ni, nome in zip(nis.split(SEPARADOR_FORNECEDOR), nomes):
            copia = dict(linha)
            copia[chave_ni] = ni
            copia[chave_nome] = nome
            resultado.append(copia)
    return resultado


def _atualizar_fornecedor_ata(db, contratacao_controle):
    """A ata (ARP) não traz fornecedor no próprio JSON do PNCP — só o
    resultado dos itens da contratação de origem tem. Depois de gravar os
    itens, agrega os fornecedores homologados (pode haver mais de um numa
    ata com vários itens) na(s) ata(s) vinculada(s) a essa contratação, pra
    aparecer na planilha exportada (pedido do usuário, 2026-08-30).

    `fornecedor_ni` e `fornecedor_nome` precisam ficar pareados por posição
    (o N-ésimo NI é do N-ésimo nome) — os dois GROUP_CONCAT leem da MESMA
    subconsulta materializada uma vez, com ORDER BY determinístico, então a
    ordem bate nos dois; ler de duas subconsultas DISTINCT separadas não
    garantiria isso (cada uma dedupa/ordena por conta própria).
    """
    par = ("SELECT DISTINCT fornecedor_ni ni, fornecedor_nome nome FROM itens"
          " WHERE contratacao_controle=? AND tem_resultado=1"
          " AND fornecedor_ni IS NOT NULL ORDER BY fornecedor_ni")
    db.execute(
        f"""UPDATE atas SET
             fornecedor_ni = (SELECT GROUP_CONCAT(ni, '{SEPARADOR_FORNECEDOR}') FROM ({par})),
             fornecedor_nome = (SELECT GROUP_CONCAT(nome, '{SEPARADOR_FORNECEDOR}') FROM ({par}))
           WHERE contratacao_controle=?""",
        (contratacao_controle, contratacao_controle, contratacao_controle))


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


def sync_itens(db, progresso=None, limite=None, motor=None, municipios_ibge=None):
    """Fase 3: itens e resultados das contratações — o banco de preços.

    Custa uma requisição por contratação mais uma por item *alterado* que
    tenha resultado, e por isso só visita contratação nova ou alterada desde
    a última coleta (itens_versao guarda a dataAtualizacao vigente naquele
    momento) — e, dentro dela, só os itens que mudaram (`pendente` abaixo).
    `Motor.itens_e_resultados` cuida do paralelismo dos resultados e do
    disjuntor (uma contratação quebrada não trava as demais); aqui só
    sobra decidir o que já temos gravado e persistir o que vem novo.

    `municipios_ibge` (iterável de códigos, ou None pra sem filtro) recorta
    a fila pro escopo escolhido em `sincronizar_tudo` — sem isso, "só meu
    município" ainda varreria itens pendentes de todo mundo.
    """
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR, progresso=progresso)
    where = ["orgao_cnpj IS NOT NULL", "sequencial IS NOT NULL",
            "(itens_versao IS NULL OR itens_versao <> data_atualizacao)"]
    args = []
    if municipios_ibge:
        alvos = list(municipios_ibge)
        where.append(f"municipio_ibge IN ({','.join('?' * len(alvos))})")
        args.extend(alvos)
    pendentes = [dict(r) for r in db.execute(
        f"""SELECT numero_controle, orgao_cnpj, ano, sequencial,
                  data_atualizacao, referencia, municipio_ibge
           FROM contratacoes
           WHERE {' AND '.join(where)}
           ORDER BY data_publicacao DESC""", args)]
    if limite:
        pendentes = pendentes[:limite]

    total, sem_listagem, falhas = 0, 0, []
    # cache de 1 contratação: `pendente` é chamado item a item, mas todos os
    # itens de uma mesma contratação chegam em sequência — sem isso, cada
    # item pagaria a própria consulta de "o que já tenho gravado" (medido no
    # acervo real: 1.815 requisições de resultado para zero item alterado,
    # antes desta mesma ideia existir por contratação)
    cache = {}

    def pendente(contratacao, item):
        numero_controle = contratacao["numero_controle"]
        if numero_controle not in cache:
            cache.clear()
            cache[numero_controle] = {r["numero_item"]: r for r in db.execute(
                "SELECT numero_item, data_atualizacao, valor_unitario_homologado"
                " FROM itens WHERE contratacao_controle=?", (numero_controle,))}
        gravados = cache[numero_controle]
        antigo = gravados.get(item.numero_item)
        if antigo is None or antigo["data_atualizacao"] != item.data_atualizacao:
            return True
        # resultado que ficou faltando (coleta interrompida antes dele) não
        # se conserta sozinho: a dataAtualizacao do item não muda por isso
        return item.tem_resultado and antigo["valor_unitario_homologado"] is None

    def on_erro(contratacao, excecao):
        # uma contratação quebrada (404 na listagem, ou qualquer outra
        # falha) não pode derrubar as demais pendentes — o motor já
        # decide sozinho quando desistir da fase inteira (disjuntor,
        # PncpErro escapa do gerador abaixo); aqui só registra pro log
        nonlocal sem_listagem
        if isinstance(excecao, ItensIndisponiveis):
            # NÃO carimba itens_versao: a contratação continua pendente e
            # volta na próxima coleta (falha ≠ ausência)
            sem_listagem += 1
        else:
            falhas.append(f"{contratacao['numero_controle']}: {excecao}")

    try:
        for contratacao, pares in motor.itens_e_resultados(
                pendentes, pendente=pendente, on_erro=on_erro):
            for item, resultado in pares:
                total += _upsert_item(db, contratacao, item.raw,
                                      resultado.raw if resultado else None)
            db.execute("UPDATE contratacoes SET itens_versao=?,"
                       " itens_sync_em=? WHERE numero_controle=?",
                       (contratacao["data_atualizacao"], datetime.now().isoformat(),
                        contratacao["numero_controle"]))
            _atualizar_fornecedor_ata(db, contratacao["numero_controle"])
            db.commit()
    except PncpErro:
        db.commit()  # preserva o que já entrou; tenta de novo na próxima
        raise
    if sem_listagem:
        # o usuário vê isso em Configurações → Sincronizações recentes
        hoje = date.today()
        _log(db, "itens", hoje, hoje, total, "aviso",
             f"{sem_listagem} contratações sem listagem de itens (404 do "
             f"portal) — ficaram pendentes para a próxima sincronização")
    if falhas:
        hoje = date.today()
        _log(db, "itens", hoje, hoje, total, "aviso",
             f"{len(falhas)} contratações falharam e ficaram pendentes "
             f"para a próxima sincronização — {falhas[0]}")
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


ESCOPOS_SYNC = ("tudo", "proprio", "pendentes", "municipio")


def sincronizar_tudo(db, codigo_ibge, progresso=None, forcado=True,
                     escopo="tudo", ibge_escolhido=None, motor=None):
    """Sync completo incremental. Falha em um tipo não bloqueia os demais.

    `motor`, se passado, substitui o `Motor` real — só existe pra teste
    injetar um dublê sem precisar de rede nenhuma (ver `tests/test_pncp.py`).

    Com `forcado=False` (a sincronização automática da abertura), desiste
    se a última execução foi há menos de `INTERVALO_MINIMO`.

    `escopo` restringe o que roda (portado do Pretiarium Free, pedido do
    usuário depois de ver a fila de itens crescer de uma vez com muitos
    municípios de referência): "tudo" é o comportamento de sempre;
    "proprio" pula a fase 1 dos municípios de referência (só o seu, mais
    barato); "pendentes" só visita referência que nunca sincronizou nem
    uma vez (`last_sync_ref_<ibge>` ausente); "municipio" restringe a um
    único ibge (`ibge_escolhido`), seja o seu ou um de referência. Em
    todos os casos a fase de itens (a mais cara) segue o mesmo recorte.
    Municípios de referência só passam pela fase 1 (contratações) e pela
    fase 3 (itens/preços) — contratos, atas e PCA são gestão do próprio
    acervo e não têm uso pra pesquisa de preço de vizinho.

    Uma única instância de `Motor` cobre a coleta inteira (ipca + todas as
    contratações + contratos/atas/pca + itens): o estado adaptativo
    (bloqueios/sucessos recentes) é por instância, então a fase de itens
    já começa sabendo se o portal estava recusando nas fases anteriores.

    Retorna resumo {tipo: registros | None se falhou}.
    """
    if escopo not in ESCOPOS_SYNC:
        raise ValueError(f"escopo inválido: {escopo!r}")
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
    motor = motor or Motor(user_agent=USER_AGENT, config=CONFIG_MOTOR, progresso=progresso)
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
        resumo["ipca"] = sync_ipca(db, _ipca_desde(db))
        _config(db, "last_sync_ipca", hoje.isoformat())
    except PncpErro as e:
        _log(db, "ipca", hoje, hoje, 0, "erro", str(e))
        resumo["ipca"] = None

    # escopo decide quem roda na fase 1 e, adiante, quem entra no recorte
    # da fase 3 — "municipio" pode escolher o próprio (aí não há
    # referência nenhuma) ou um de referência (aí o próprio nem roda,
    # pedido explícito de "só essa cidade")
    ibge_proprio_no_escopo = escopo != "municipio" or ibge_escolhido == codigo_ibge
    alvos_itens = set()

    # fase 1 — contratações do município próprio
    if ibge_proprio_no_escopo:
        inicio = janela_de("contratacoes")
        try:
            n = sync_contratacoes(db, codigo_ibge, inicio, hoje, motor=motor)
            _config(db, "last_sync_contratacoes", hoje.isoformat())
            _log(db, "contratacoes", inicio, hoje, n, "ok")
            resumo["contratacoes"] = n
        except PncpErro as e:
            _log(db, "contratacoes", inicio, hoje, 0, "erro", str(e))
            resumo["contratacoes"] = None
        descobrir_orgaos(db)
        alvos_itens.add(codigo_ibge)

        # fase 2 — contratos, atas e PCA por CNPJ de órgão ativo (só do
        # acervo próprio — descobrir_orgaos já filtra WHERE referencia=0;
        # municípios de referência não têm uso pra isso, só preço)
        orgaos = [r[0] for r in db.execute(
            "SELECT cnpj FROM orgaos WHERE ativo=1").fetchall()]
        for tipo, func in (("contratos", sync_contratos), ("atas", sync_atas),
                           ("pca", sync_pca)):
            total, falhou, inicios = 0, False, []
            for cnpj in orgaos:
                # janela POR CNPJ: uma chave só por tipo fazia um órgão birrento
                # travar a data de corte de todos os outros para sempre — cada
                # sync recomeçava a janela inteira de todo mundo até aquele CNPJ
                # se resolver sozinho (achado 2026-08-24)
                chave = f"{tipo}_{cnpj}"
                inicio = janela_de(chave)
                inicios.append(inicio)
                try:
                    total += func(db, cnpj, inicio, hoje, motor=motor)
                    _config(db, f"last_sync_{chave}", hoje.isoformat())
                except PncpErro as e:
                    falhou = True
                    _log(db, tipo, inicio, hoje, total, "erro", f"{cnpj}: {e}")
            if not falhou:
                _log(db, tipo, min(inicios) if inicios else hoje, hoje, total, "ok")
                resumo[tipo] = total
            else:
                resumo[tipo] = None

    # municípios de referência: só a fase 1, e sem a fase 2 — contratos e
    # atas alheios não têm uso aqui. Os itens deles saem na fase 3, junto
    # com os nossos, numa passada só.
    referencia = [dict(r) for r in db.execute(
        "SELECT ibge, nome FROM municipios_referencia ORDER BY nome")]
    if escopo == "proprio":
        referencia = []
    elif escopo == "pendentes":
        referencia = [m for m in referencia
                     if not _config(db, f"last_sync_ref_{m['ibge']}")]
    elif escopo == "municipio":
        referencia = [m for m in referencia if m["ibge"] == ibge_escolhido]
    for m in referencia:
        chave = f"last_sync_ref_{m['ibge']}"
        inicio = janela_de(f"ref_{m['ibge']}")
        try:
            if progresso:
                progresso(f"Preços de referência — {m['nome']}…")
            n = sync_contratacoes(db, m["ibge"], inicio, hoje, motor=motor,
                                  referencia=1)
            _config(db, chave, hoje.isoformat())
            _log(db, f"referencia:{m['nome']}", inicio, hoje, n, "ok")
        except PncpErro as e:
            # um município de referência fora do ar não pode derrubar o sync
            _log(db, f"referencia:{m['nome']}", inicio, hoje, 0, "erro", str(e))
        alvos_itens.add(m["ibge"])

    # fase 3 — itens das contratações (banco de preços); é a mais custosa,
    # então vem no fim: se falhar, o resto do acervo já está gravado.
    # `escopo="tudo"` não filtra (None): restringir aos alvos aqui daria
    # o mesmo resultado, mas manter None documenta que é o caso sem
    # recorte, e evita um IN(...) com muitos parâmetros à toa.
    try:
        n = sync_itens(db, motor=motor,
                       municipios_ibge=None if escopo == "tudo" else alvos_itens)
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
