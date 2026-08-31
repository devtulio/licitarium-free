"""Montagem de minuta do Plano de Contratações Anual (PCA).

Consolida os itens efetivamente contratados pelo município — que o
Licitarium já coleta do PNCP — em grupos, projeta o quantitativo do próximo
exercício e estima o preço. A saída é uma **minuta para revisão**: os itens
publicados no PNCP não trazem código de catálogo (CATMAT/CATSER), exigido no
PCA oficial, então a classificação final é sempre do gestor.
"""
import json
import re
import statistics
import unicodedata
from datetime import datetime

# palavras que não ajudam a identificar o item
IRRELEVANTES = {"DE", "DA", "DO", "DAS", "DOS", "EM", "PARA", "COM", "E", "A",
                "O", "AS", "OS", "NA", "NO", "AO", "POR", "SEM", "SOB"}
# lotes lançados como item único não representam consumo de nada
PADRAO_LOTE = re.compile(r"TODOS\s+OS\s+ITENS|LOTE\s+[ÚU]NICO", re.IGNORECASE)
# abertura burocrática que aparece em metade dos editais e não identifica nada
PREFIXOS_VAZIOS = re.compile(
    r"^(?:(?:AQUISI[ÇC][ÃA]O|CONTRATA[ÇC][ÃA]O|PRESTA[ÇC][ÃA]O|FORNECIMENTO|"
    r"LOCA[ÇC][ÃA]O|REGISTRO)\s+(?:DE\s+)?(?:PRE[ÇC]OS?\s+(?:PARA\s+)?)?"
    r"(?:EMPRESA\s+)?(?:ESPECIALIZADA\s+)?(?:PARA\s+)?(?:A\s+)?)+")
# preço muito disperso dentro do grupo denuncia lote disfarçado de item
DISPERSAO_SUSPEITA = 10
# grupos de radical diferente cujas descrições ainda assim se sobrepõem muito
# (ex.: "FILTRO DE OLEO MOTOR DIESEL" vs "FILTRO OLEO PARA MOTOR A DIESEL",
# que um corte fixo de N palavras não junta) — mesmo limiar do Fracionamento
LIMIAR_SIMILARIDADE = 0.6
_STOPWORDS_SIM = {"de", "da", "do", "das", "dos", "em", "para", "com", "e",
                  "a", "o", "as", "os", "na", "no", "ao", "por", "sem", "sob"}

PALAVRAS_CHAVE_PADRAO = 3
MARGEM_PADRAO = 10.0
BASES = ("media", "ultimo", "maior", "soma", "tendencia")
ESTATISTICAS = ("mediana", "media", "recente", "menor")


def chave_agrupamento(descricao, palavras=PALAVRAS_CHAVE_PADRAO):
    """Radical da descrição: maiúsculas, sem pontuação e sem palavras vazias.

    Prefixos de praxe ("AQUISIÇÃO DE", "CONTRATAÇÃO DE EMPRESA PARA") são
    descartados: eles abrem metade dos editais e nada dizem sobre o item.
    """
    limpo = re.sub(r"[^0-9A-ZÁÂÃÉÊÍÓÔÕÚÇ ]", " ", (descricao or "").upper())
    limpo = PREFIXOS_VAZIOS.sub("", limpo.strip(), count=1)
    termos = [t for t in limpo.split() if t not in IRRELEVANTES]
    # quantidade na FRENTE da descrição não é produto: "12 TENDAS" e
    # "06 TENDAS" são a mesma família, e o número virava radical — inflava a
    # contagem de famílias e, pior, DIVIDIA o acumulado do fracionamento em
    # grupos que deveriam somar contra o mesmo teto (auditoria do Licitarium
    # Pro 2026-08-13, sincronizada para cá 2026-08-16). Só o prefixo
    # puramente numérico cai; número no meio fica — "PNEU 295" precisa do 295.
    while len(termos) > 1 and termos[0].isdigit():
        termos.pop(0)
    return " ".join(termos[:palavras])


def familia(chave):
    """Primeiro termo da chave: PNEU 295 80R22 e PNEU 275 80R22 são itens
    diferentes no plano, mas o gestor revisa melhor vendo-os juntos."""
    return (chave or "").split(" ")[0] if chave else ""


# ── correção monetária (IPCA) ────────────────────────────────────────────────
# Comparar um preço de 2024 com um de 2026 sem corrigir subestima o custo
# real do próximo exercício — a mediana mistura reais de anos diferentes.
# Portado do motor de pesquisa de preços (removido do Free na v1.44.0,
# preservado em relatorios.py até aqui) — mesma lógica, mesma fonte (IPCA
# série 433 do Banco Central, já sincronizada em `pncp.sync_ipca`).

def fatores_ipca(db):
    """Quanto multiplicar um preço de cada mês para chegar a valor de hoje.

    O índice do mês da compra já está embutido no preço pago, então a
    correção acumula os meses SEGUINTES. O último mês disponível manda: o
    IBGE publica com semanas de atraso, projetar o que falta poria no plano
    um número que ninguém publicou.
    """
    linhas = [(r[0], r[1]) for r in db.execute(
        "SELECT competencia, variacao FROM ipca ORDER BY competencia")]
    if not linhas:
        return {"ate": None, "fatores": {}}
    fatores, acumulado = {}, 1.0
    for competencia, variacao in reversed(linhas):
        fatores[competencia] = acumulado
        acumulado *= 1 + (variacao or 0) / 100
    return {"ate": linhas[-1][0], "fatores": fatores}


def _competencia(data):
    texto = str(data or "")[:7]
    return texto if len(texto) == 7 and texto[4] == "-" else None


def corrigir_ipca(valor, data, ipca):
    """Traz `valor` a preço do último mês disponível do índice.

    Devolve o próprio `valor` (sem corrigir) quando não há como — sem data,
    sem série, ou preço posterior ao último índice: preço mais novo que o
    índice não é corrigido "para trás".
    """
    if valor is None:
        return None, False
    mes = _competencia(data)
    if not mes or not ipca["fatores"]:
        return valor, False
    fator = ipca["fatores"].get(mes)
    if fator is None:
        # antes da série, corrige desde o primeiro mês conhecido; depois
        # dela, não há o que corrigir
        primeiro = min(ipca["fatores"])
        if mes < primeiro:
            fator = ipca["fatores"][primeiro]
        else:
            return valor, False
    return valor * fator, True


# ── agrupamento por similaridade ─────────────────────────────────────────────
# O radical de N palavras (chave_agrupamento) já junta a maioria dos casos e
# é barato — mantido como primeira passada. Mas "FILTRO DE OLEO MOTOR" e
# "FILTRO OLEO PARA MOTOR DIESEL" têm radicais diferentes (a palavra 3 já
# diverge) e são o MESMO item — uma segunda passada funde grupos cujas
# descrições representativas se sobrepõem muito (Jaccard de tokens), mesma
# técnica do Fracionamento (relatorios._frac_similaridade), só que comparando
# GRUPOS já reduzidos pelo radical, não item a item (união por componente
# conexo sobre uma dúzia de grupos, não milhares de itens).

def _tokenizar(texto):
    limpo = unicodedata.normalize("NFD", (texto or "")) \
        .encode("ascii", "ignore").decode("ascii").lower()
    limpo = re.sub(r"[^a-z0-9\s]", " ", limpo)
    return {t for t in limpo.split() if len(t) > 2 and t not in _STOPWORDS_SIM}


def _similaridade(a, b):
    ta, tb = _tokenizar(a), _tokenizar(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return inter / (len(ta) + len(tb) - inter)


def _fundir_grupos_similares(grupos):
    """`grupos`: dict chave->dados (mesmo formato do 1º passo de `consolidar`).
    Devolve a mesma estrutura, com grupos parecidos fundidos num só."""
    chaves = list(grupos)
    n = len(chaves)
    pai = list(range(n))

    def acha(i):
        while pai[i] != i:
            pai[i] = pai[pai[i]]
            i = pai[i]
        return i

    def une(i, j):
        ri, rj = acha(i), acha(j)
        if ri != rj:
            pai[ri] = rj

    representantes = [statistics.mode(grupos[k]["descricoes"]) for k in chaves]
    for i in range(n):
        for j in range(i + 1, n):
            if _similaridade(representantes[i], representantes[j]) \
                    >= LIMIAR_SIMILARIDADE:
                une(i, j)

    fundidos = {}
    for i, k in enumerate(chaves):
        fundidos.setdefault(acha(i), []).append(k)
    resultado = {}
    for membros in fundidos.values():
        if len(membros) == 1:
            resultado[membros[0]] = grupos[membros[0]]
            continue
        # o radical do grupo com mais itens dá nome ao grupo fundido
        principal = max(membros, key=lambda k: grupos[k]["itens"])
        base = {"chave": principal, "descricoes": [], "unidades": [],
               "categorias": [], "por_ano": {}, "precos": [], "datas": [],
               "itens": 0}
        for k in membros:
            g = grupos[k]
            base["descricoes"] += g["descricoes"]
            base["unidades"] += g["unidades"]
            base["categorias"] += g["categorias"]
            base["precos"] += g["precos"]
            base["datas"] += g["datas"]
            base["itens"] += g["itens"]
            for ano, qtd in g["por_ano"].items():
                base["por_ano"][ano] = base["por_ano"].get(ano, 0) + qtd
        resultado[principal] = base
    return resultado


def classificar_abc(itens):
    """Curva ABC por valor: A concentra 80% do total, B 15%, C o resto.

    Diz ao gestor onde vale gastar o tempo de revisão — normalmente poucos
    itens respondem pela maior parte do plano.
    """
    validos = [i for i in itens if (i.get("valor_total") or 0) > 0]
    total = sum(i["valor_total"] for i in validos)
    for i in itens:
        i["abc"] = "C"
    if not total:
        return itens
    acumulado = 0.0
    for i in sorted(validos, key=lambda x: -x["valor_total"]):
        acumulado += i["valor_total"]
        fatia = acumulado / total
        i["abc"] = "A" if fatia <= 0.8 else ("B" if fatia <= 0.95 else "C")
    return itens


def _preco(valores, datas, estatistica):
    if not valores:
        return None
    if estatistica == "media":
        return statistics.mean(valores)
    if estatistica == "menor":
        return min(valores)
    if estatistica == "recente":
        # o mais recente pelo par (data, valor); data ausente vai para o fim
        return max(zip(datas, valores), key=lambda dv: (dv[0] or ""))[1]
    return statistics.median(valores)


def _quantidade(por_ano, base, ano_alvo=None):
    anos = sorted(por_ano)
    if not anos:
        return 0.0
    if base == "ultimo":
        return por_ano[anos[-1]]
    if base == "maior":
        return max(por_ano.values())
    if base == "soma":
        return sum(por_ano.values())
    if base == "tendencia" and len(anos) >= 2 and ano_alvo:
        # regressão linear simples sobre (ano, quantidade): item em consumo
        # CRESCENTE ano a ano fica mal servido pela média plana — projeta a
        # reta pro ano do plano. Nunca sai negativo (consumo não é dívida).
        try:
            inclinacao, base_ = statistics.linear_regression(
                anos, [por_ano[a] for a in anos])
            return max(0.0, base_ + inclinacao * ano_alvo)
        except statistics.StatisticsError:
            pass                            # cai pra média abaixo
    return sum(por_ano.values()) / len(anos)          # média dos anos


def consolidar(db, anos=None, palavras=PALAVRAS_CHAVE_PADRAO,
               base="media", estatistica="mediana", margem=MARGEM_PADRAO,
               orgao=None, so_recorrentes=False, ano_alvo=None,
               corrigir_precos=True):
    """Agrupa os itens contratados e projeta o próximo exercício.

    Só itens do próprio município: o plano é do que ESTE órgão vai contratar,
    e item de município de referência (que existe só para consulta de preço)
    inflaria o quantitativo com compra alheia.

    Devolve `(grupos, meta)` — `meta` traz o resumo da correção monetária
    (até que mês, quantos preços não puderam ser corrigidos).
    """
    where = ["referencia=0", "valor_unitario_homologado IS NOT NULL"]
    args = []
    if anos:
        where.append("ano IN (%s)" % ",".join("?" * len(anos)))
        args += list(anos)
    if orgao:
        where.append("orgao_cnpj=?")
        args.append(orgao)
    linhas = db.execute(
        f"""SELECT descricao, unidade, material_servico, ano,
                   COALESCE(quantidade_homologada, quantidade) qtd,
                   valor_unitario_homologado unit, data_resultado
            FROM itens WHERE {' AND '.join(where)}""", args).fetchall()

    ipca = fatores_ipca(db) if corrigir_precos else {"ate": None, "fatores": {}}
    n_corrigidos = 0

    grupos = {}
    for l in linhas:
        if PADRAO_LOTE.search(l["descricao"] or ""):
            continue                      # lote inteiro como item único
        k = chave_agrupamento(l["descricao"], palavras)
        if not k:
            continue
        g = grupos.setdefault(k, {
            "chave": k, "descricoes": [], "unidades": [], "categorias": [],
            "por_ano": {}, "precos": [], "datas": [], "itens": 0})
        g["descricoes"].append(l["descricao"])
        g["unidades"].append(l["unidade"])
        g["categorias"].append(l["material_servico"])
        g["por_ano"][l["ano"]] = g["por_ano"].get(l["ano"], 0) + (l["qtd"] or 0)
        preco, corrigido = corrigir_ipca(l["unit"], l["data_resultado"], ipca)
        n_corrigidos += corrigido
        g["precos"].append(preco)
        g["datas"].append(l["data_resultado"])
        g["itens"] += 1

    grupos = _fundir_grupos_similares(grupos)
    meta = {"ipca_ate": ipca["ate"], "total_precos": len(linhas),
           "precos_corrigidos": n_corrigidos}

    resultado = []
    for g in grupos.values():
        qtd_base = _quantidade(g["por_ano"], base, ano_alvo)
        unit = _preco(g["precos"], g["datas"], estatistica)
        qtd = round(qtd_base * (1 + margem / 100.0), 2)
        # descrição mais frequente representa o grupo melhor que a primeira
        descricao = statistics.mode(g["descricoes"])
        # obra/serviço contratado uma única vez não é consumo recorrente:
        # projetar "reforma do prédio X" para o ano seguinte seria errado
        recorrente = len(g["por_ano"]) > 1 or g["itens"] > 2
        resultado.append({
            "recorrente": recorrente,
            "chave": g["chave"],
            "familia": familia(g["chave"]),
            "descricao": descricao,
            "unidade": statistics.mode(g["unidades"]) if any(g["unidades"]) else None,
            "categoria": statistics.mode(g["categorias"]) if any(g["categorias"]) else None,
            "quantidade_base": round(qtd_base, 2),
            "quantidade": qtd,
            "margem": margem,
            "valor_unitario": round(unit, 2) if unit is not None else None,
            "valor_total": round(qtd * unit, 2) if unit is not None else None,
            "itens": g["itens"],
            "anos": sorted(g["por_ano"]),
            "por_ano": g["por_ano"],
            "unidades_divergentes": len({u for u in g["unidades"] if u}) > 1,
            "preco_min": min(g["precos"]),
            "preco_max": max(g["precos"]),
            "preco_disperso": (min(g["precos"]) > 0
                               and max(g["precos"]) / min(g["precos"])
                               >= DISPERSAO_SUSPEITA),
        })
    if so_recorrentes:
        resultado = [r for r in resultado if r["recorrente"]]
    resultado.sort(key=lambda r: -(r["valor_total"] or 0))
    return resultado, meta


# ── minuta persistida ───────────────────────────────────────────────────────

def gerar_minuta(db, ano_alvo, params, orgao=None):
    """Gera (ou regenera) a minuta do exercício, preservando o que foi editado."""
    params = dict(params or {})
    palavras = int(params.get("palavras") or PALAVRAS_CHAVE_PADRAO)
    base = params.get("base") if params.get("base") in BASES else "media"
    est = params.get("estatistica")
    est = est if est in ESTATISTICAS else "mediana"
    margem = float(params.get("margem", MARGEM_PADRAO))
    anos = params.get("anos") or None
    so_recorrentes = bool(params.get("so_recorrentes"))
    corrigir_precos = params.get("corrigir_ipca", True) not in (False, 0, "0")

    editados = {r["chave"]: r for r in db.execute(
        "SELECT * FROM pca_minuta_itens WHERE ano_alvo=? AND editado=1",
        (ano_alvo,))}
    db.execute("DELETE FROM pca_minuta_itens WHERE ano_alvo=?", (ano_alvo,))

    grupos, meta = consolidar(db, anos, palavras, base, est, margem, orgao,
                              so_recorrentes, ano_alvo=ano_alvo,
                              corrigir_precos=corrigir_precos)
    for g in grupos:
        antigo = editados.get(g["chave"])
        if antigo:   # edição manual prevalece sobre o recálculo
            db.execute(
                """INSERT INTO pca_minuta_itens
                   (ano_alvo, chave, descricao, unidade, categoria, quantidade,
                    valor_unitario, margem, incluir, editado, origem)
                   VALUES (?,?,?,?,?,?,?,?,?,1,?)""",
                (ano_alvo, g["chave"], antigo["descricao"], antigo["unidade"],
                 antigo["categoria"], antigo["quantidade"],
                 antigo["valor_unitario"], antigo["margem"], antigo["incluir"],
                 json.dumps(g, ensure_ascii=False, default=str)))
        else:
            db.execute(
                """INSERT INTO pca_minuta_itens
                   (ano_alvo, chave, descricao, unidade, categoria, quantidade,
                    valor_unitario, margem, incluir, editado, origem)
                   VALUES (?,?,?,?,?,?,?,?,1,0,?)""",
                (ano_alvo, g["chave"], g["descricao"], g["unidade"],
                 g["categoria"], g["quantidade"], g["valor_unitario"],
                 g["margem"], json.dumps(g, ensure_ascii=False, default=str)))
    db.execute(
        "INSERT OR REPLACE INTO pca_minuta (ano_alvo, parametros, gerado_em)"
        " VALUES (?,?,?)",
        (ano_alvo, json.dumps({"palavras": palavras, "base": base,
                               "estatistica": est, "margem": margem,
                               "anos": anos, "orgao": orgao,
                               "so_recorrentes": so_recorrentes,
                               "corrigir_ipca": corrigir_precos, **meta},
                              ensure_ascii=False),
         datetime.now().isoformat()))
    db.commit()
    return len(grupos)


def _valores_ano_anterior(db, ano_alvo):
    """chave -> valor_total da minuta do exercício anterior (só incluídos),
    pra mostrar o quanto cada item cresceu/encolheu — comparar às cegas com
    o ano passado é o jeito mais rápido do gestor pegar item fora da curva."""
    return {r["chave"]: (r["quantidade"] or 0) * (r["valor_unitario"] or 0)
           for r in db.execute(
               "SELECT chave, quantidade, valor_unitario FROM pca_minuta_itens"
               " WHERE ano_alvo=? AND incluir=1", (ano_alvo - 1,))}


def _atas_vigentes_por_chave(db, palavras):
    """chave -> {numero_ata, ano_ata, vigencia_fim} da ata VIGENTE mais
    distante no tempo que cobre aquela chave — se já tem registro de preço
    valendo, o item pode não precisar entrar de novo no plano."""
    linhas = db.execute(
        """SELECT a.numero_ata, a.ano_ata, a.vigencia_fim, i.descricao
           FROM atas a JOIN itens i ON i.contratacao_controle = a.contratacao_controle
           WHERE date(a.vigencia_fim) >= date('now','localtime')
             AND a.numero_ata IS NOT NULL""")
    cobertura = {}
    for l in linhas:
        k = chave_agrupamento(l["descricao"], palavras)
        if not k:
            continue
        atual = cobertura.get(k)
        if not atual or (l["vigencia_fim"] or "") > (atual["vigencia_fim"] or ""):
            cobertura[k] = {"numero_ata": l["numero_ata"],
                            "ano_ata": l["ano_ata"],
                            "vigencia_fim": l["vigencia_fim"]}
    return cobertura


def listar_minuta(db, ano_alvo, so_incluidos=False):
    sql = "SELECT * FROM pca_minuta_itens WHERE ano_alvo=?"
    if so_incluidos:
        sql += " AND incluir=1"
    sql += " ORDER BY (quantidade * COALESCE(valor_unitario,0)) DESC"
    cfg = db.execute("SELECT parametros FROM pca_minuta WHERE ano_alvo=?",
                     (ano_alvo,)).fetchone()
    palavras = (json.loads(cfg["parametros"]).get("palavras")
               if cfg else None) or PALAVRAS_CHAVE_PADRAO
    valores_anteriores = _valores_ano_anterior(db, ano_alvo)
    atas_vigentes = _atas_vigentes_por_chave(db, palavras)

    itens = []
    for r in db.execute(sql, (ano_alvo,)):
        d = dict(r)
        d["origem"] = json.loads(d["origem"]) if d.get("origem") else {}
        d["valor_total"] = round((d["quantidade"] or 0)
                                 * (d["valor_unitario"] or 0), 2)
        d["familia"] = d["origem"].get("familia") or familia(d["chave"])
        d["mesclado"] = bool(d.get("mesclado_de"))
        anterior = valores_anteriores.get(d["chave"])
        d["valor_ano_anterior"] = round(anterior, 2) if anterior is not None else None
        d["ata_vigente"] = atas_vigentes.get(d["chave"])
        itens.append(d)
    return classificar_abc(itens)


def resumo_familias(itens):
    """Agrupa a minuta por família para a revisão em dois níveis."""
    familias = {}
    for i in itens:
        f = familias.setdefault(i["familia"] or "—",
                                {"familia": i["familia"] or "—",
                                 "itens": 0, "valor": 0.0, "excluidos": 0})
        f["itens"] += 1
        if i.get("incluir", 1):
            f["valor"] += i["valor_total"]
        else:
            f["excluidos"] += 1
    return sorted(familias.values(), key=lambda f: -f["valor"])


def mesclar(db, ano_alvo, ids):
    """Funde itens num só: soma quantidades e pondera o preço pelo volume."""
    if len(ids) < 2:
        return {"ok": False, "erro": "selecione ao menos dois itens"}
    marcas = ",".join("?" * len(ids))
    linhas = [dict(r) for r in db.execute(
        f"SELECT * FROM pca_minuta_itens WHERE ano_alvo=? AND id IN ({marcas})",
        [ano_alvo] + list(ids))]
    if len(linhas) < 2:
        return {"ok": False, "erro": "itens não encontrados"}
    unidades = {l["unidade"] for l in linhas if l["unidade"]}
    if len(unidades) > 1:
        # somar quantidade sem isso é fantasma: 300 PCT viram 300 KG na
        # unidade do item "principal" — consolidar() só sinaliza
        # unidades_divergentes porque é automático; mesclar() é ação
        # manual do usuário e recusa em vez de corromper o dado.
        return {"ok": False,
                "erro": "itens com unidades diferentes ("
                        + ", ".join(sorted(unidades))
                        + ") não podem ser mesclados"}
    qtd = sum(l["quantidade"] or 0 for l in linhas)
    valor = sum((l["quantidade"] or 0) * (l["valor_unitario"] or 0)
                for l in linhas)
    unit = (valor / qtd) if qtd else max(
        (l["valor_unitario"] or 0) for l in linhas)
    principal = max(linhas, key=lambda l: (l["quantidade"] or 0)
                    * (l["valor_unitario"] or 0))
    db.execute(f"DELETE FROM pca_minuta_itens WHERE id IN ({marcas})", list(ids))
    db.execute(
        """INSERT INTO pca_minuta_itens
           (ano_alvo, chave, descricao, unidade, categoria, quantidade,
            valor_unitario, margem, incluir, editado, origem, mesclado_de)
           VALUES (?,?,?,?,?,?,?,?,1,1,?,?)""",
        (ano_alvo, principal["chave"], principal["descricao"],
         principal["unidade"], principal["categoria"], round(qtd, 2),
         round(unit, 2), principal["margem"], principal["origem"],
         json.dumps(linhas, ensure_ascii=False, default=str)))
    db.commit()
    return {"ok": True, "itens": len(linhas)}


def dividir(db, item_id):
    """Desfaz uma mesclagem, devolvendo os itens como estavam."""
    linha = db.execute("SELECT * FROM pca_minuta_itens WHERE id=?",
                       (item_id,)).fetchone()
    if not linha or not linha["mesclado_de"]:
        return {"ok": False, "erro": "este item não veio de uma mesclagem"}
    originais = json.loads(linha["mesclado_de"])
    db.execute("DELETE FROM pca_minuta_itens WHERE id=?", (item_id,))
    for o in originais:
        db.execute(
            """INSERT INTO pca_minuta_itens
               (ano_alvo, chave, descricao, unidade, categoria, quantidade,
                valor_unitario, margem, incluir, editado, origem, mesclado_de)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (o["ano_alvo"], o["chave"], o["descricao"], o["unidade"],
             o["categoria"], o["quantidade"], o["valor_unitario"], o["margem"],
             o["incluir"], o["editado"], o["origem"], o.get("mesclado_de")))
    db.commit()
    return {"ok": True, "itens": len(originais)}


def totais(itens):
    incluidos = [i for i in itens if i.get("incluir", 1)]
    return {"grupos": len(incluidos),
            "valor": round(sum(i["valor_total"] for i in incluidos), 2),
            "excluidos": len(itens) - len(incluidos)}
