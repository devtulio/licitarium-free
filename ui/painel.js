// ══ Painel: gráficos do acervo, desenhados aqui mesmo ══════════════════════
// SVG escrito à mão, sem biblioteca: o programa roda offline dentro de um exe,
// e uma dependência de gráfico custaria mais que estas funções. As mesmas
// marcas vão para a tela e para a impressão — uma fonte de desenho só.
//
// Convenções que valem para todos os gráficos daqui (design/DASHBOARD.md):
//   · um eixo só, nunca dois; escala sempre a partir do zero;
//   · cor nunca sozinha — toda série tem rótulo direto ou legenda;
//   · <title> em cada marca, que o navegador mostra ao passar o mouse;
//   · o que não tem dado aparece como "–", nunca como zero inventado.

const P = {                      // estado do painel
  vista: "execucao",
  dados: null,
};

const esconde = (v) => v == null || Number.isNaN(v);
const compacto = (v) => esconde(v) ? "–"
  : Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toFixed(1).replace(".", ",")} mi`
  : Math.abs(v) >= 1e3 ? `R$ ${(v / 1e3).toFixed(0)} mil`
  : dinheiro(v);
const pct = (v, casas = 1) => esconde(v) ? "–"
  : `${v.toFixed(casas).replace(".", ",")}%`;
const MES = ["jan", "fev", "mar", "abr", "mai", "jun",
             "jul", "ago", "set", "out", "nov", "dez"];

// Escala com números que se leem: o passo é 1, 2, 2,5 ou 5 vezes uma
// potência de dez, e o topo é um múltiplo inteiro do passo. Sem isso o eixo
// sai com marcas em "1,7 mi" e "3,3 mi", que ninguém compara de cabeça.
function escala(maximo) {
  if (!(maximo > 0)) return { topo: 1, passo: 0.25 };
  const p = Math.pow(10, Math.floor(Math.log10(maximo / 3)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const passo = m * p;
    if (maximo / passo <= 4.2)
      return { topo: Math.ceil(maximo / passo) * passo, passo };
  }
  return { topo: maximo, passo: maximo / 4 };
}

// Sem role="img", de propósito (auditoria de acessibilidade, 2026-08-09):
// role="img" torna os filhos apresentacionais, e estes gráficos põem o
// rótulo direto DENTRO do desenho — é regra do projeto, ver
// design/DASHBOARD.md ("cor nunca sozinha: toda série tem rótulo direto").
// Com role="img" o leitor de tela ouvia um nome e perdia justamente os
// números. O nome acessível entra como `aria-label` em `desenharGraficos`
// (era <title>, que desenhava o balão preto nativo por cima do tooltip
// próprio — trocado em toda parte, mesma correção do calendário na 1.40.1),
// que é o ponto único por onde todo gráfico passa.
function svg(largura, altura, dentro) {
  return `<svg viewBox="0 0 ${largura} ${altura}" width="100%"
    height="${altura}" preserveAspectRatio="xMidYMid meet"
    >${dentro}</svg>`;
}

// ══ interação: um tooltip só, para todos os gráficos ═══════════════════════
// Substitui o <title> nativo — que o navegador demora ~1s para mostrar e não
// segue o cursor — por um rótulo próprio, instantâneo. Cada marca carrega
// data-tip-v (o número, sempre) e data-tip-l (o resto da frase, quando há).
// Só mouse por enquanto: nenhuma marca daqui era navegável por teclado antes
// (o <title> também dependia de foco que elas nunca tiveram).
const dtip = (v, l) =>
  `data-tip-v="${esc(v)}"${l ? ` data-tip-l="${esc(l)}"` : ""}`;

let ttEl;
function tt() {
  if (!ttEl) {
    ttEl = document.createElement("div");
    ttEl.className = "graf-tt";
    ttEl.setAttribute("role", "tooltip");
    ttEl.hidden = true;
    document.body.appendChild(ttEl);
  }
  return ttEl;
}

// linhas: [{ v, l, cor }] — v é sempre mostrado; l e cor são opcionais.
// titulo (opcional) é o cabeçalho, usado pelo corte vertical para nomear o
// mês apontado, já que ali a mesma marca não basta — são vários pontos.
function mostrarTt(clientX, clientY, linhas, titulo) {
  const el = tt();
  el.innerHTML = "";
  if (titulo) {
    const cab = document.createElement("div");
    cab.className = "cab";
    cab.textContent = titulo;
    el.appendChild(cab);
  }
  linhas.forEach(({ v, l, cor }) => {
    const linha = document.createElement("div");
    linha.className = "linha";
    if (cor) {
      const chave = document.createElement("i");
      chave.style.background = cor;
      linha.appendChild(chave);
    }
    if (l) {
      const rot = document.createElement("span");
      rot.className = "l";
      rot.textContent = l;         // textContent: rótulo é dado, não HTML
      linha.appendChild(rot);
    }
    const val = document.createElement("span");
    val.className = "v";
    val.textContent = v;
    linha.appendChild(val);
    el.appendChild(linha);
  });
  el.hidden = false;
  posicionarTt(clientX, clientY);
}

function posicionarTt(clientX, clientY) {
  const el = tt();
  const pad = 14;
  let x = clientX + pad, y = clientY + pad;
  const r = el.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = clientY - r.height - pad;
  el.style.transform = `translate(${x}px, ${y}px)`;
}

function esconderTt() { if (ttEl) ttEl.hidden = true; }

// Tooltip das marcas "simples" (barra, célula, ponto sem corte vertical):
// um listener só, delegado no #painel — sobrevive a cada redesenho, que
// troca o innerHTML dos cartões mas nunca o #painel em si. Gráficos com
// corte vertical (grafSeries, grafConcentracao) têm seu próprio listener,
// que dá stopPropagation para não competir com este.
function ligarTooltips() {
  const raiz = $("painel");
  raiz.addEventListener("pointermove", (evt) => {
    const marca = evt.target.closest("[data-tip-v]");
    if (!marca) { esconderTt(); return; }
    mostrarTt(evt.clientX, evt.clientY,
      [{ v: marca.dataset.tipV, l: marca.dataset.tipL || null }]);
  });
  raiz.addEventListener("pointerleave", esconderTt);
}

// ── ECharts: estilos de texto compartilhados, mesmos valores das classes
// .rot/.val/.eixo de estilo.css — o SVG do ECharts não carrega classe CSS
// (sai com style="" inline), então o valor precisa ir explícito aqui.
// A família **precisa** ir junto: o ECharts mede o texto para reservar
// espaço (é o que `containLabel` usa) com a fonte que ele acha que vale, e
// sem `fontFamily` explícito ele calcula sobre a sans-serif padrão enquanto
// o SVG desenha com a `--font-ui` do tema, mais larga. A reserva saía menor
// que o rótulo e o "C" de "Concorrência - Eletrônica" era comido pela borda
// do cartão — na tela e no PDF do painel, que captura o mesmo SVG.
// Lida na hora de desenhar, não no carregamento: trocar de tema troca a
// fonte, e o painel se redesenha inteiro nessa troca.
const _fonteUI = () => getComputedStyle(document.body).fontFamily;
const ROT_TXT = { fontSize: 10.5, color: "var(--muted)" };
const VAL_TXT = { fontSize: 11, color: "var(--text)" };
const COR_EIXO = "var(--border)";

// Largura real de um texto, para dimensionar margem que `containLabel` não
// cobre: rótulo de série (`label.position`) fica FORA da conta dele, então
// `grid.right` fixo é chute — e chute errado corta "…· 4 processos".
function _larguraTexto(txt, px) {
  const ctx = (_larguraTexto._ctx ??=
    document.createElement("canvas").getContext("2d"));
  ctx.font = `${px}px ${_fonteUI()}`;
  return ctx.measureText(txt).width;
}

// x/y do evento nativo do ECharts — mesma assinatura que mostrarTt já espera
// (clientX, clientY), pra reusar o tooltip único sem reescrevê-lo.
function _ptEvento(params) {
  const nativo = params.event?.event;
  return [nativo?.clientX ?? 0, nativo?.clientY ?? 0];
}

// Balão próprio disparado pela FAIXA inteira do eixo, não só pela marca fina.
// Barra de coluna/linha é um alvo estreito; passar o mouse na coluna toda (não
// só na barra) mostra o item — como o calendário e os gráficos de linha já
// fazem. Feito à mão para NÃO desenhar overlay: o `axisPointer` do ECharts põe
// um retângulo por cima das barras que rouba o `:hover` do realce por marca.
// Aqui só leio o índice da categoria sob o cursor (`convertFromPixel`) no
// mousemove — sem tocar em nada do desenho. `dimCategoria`: 0 quando a
// categoria é o eixo X (colunas), 1 quando é o eixo Y (barras horizontais).
function ligarBaloEixo(chart, alvo, linhasDe, dimCategoria = 0) {
  alvo.addEventListener("mousemove", (e) => {
    const r = alvo.getBoundingClientRect();
    const pt = chart.convertFromPixel("grid",
      [e.clientX - r.left, e.clientY - r.top]);
    const linhas = pt ? linhasDe(Math.round(pt[dimCategoria])) : null;
    if (!linhas || !linhas.length) return esconderTt();
    mostrarTt(e.clientX, e.clientY, linhas);
  });
  alvo.addEventListener("mouseleave", esconderTt);
}

// instância presa ao elemento (não a uma variável de módulo): vários
// cartões desenham ao mesmo tempo (ver desenharBoxplotPreco em app.js) —
// uma só variável faria o dispose() de um derrubar o outro
function _iniciarEchart(el) {
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  // A família entra como tema (ponto único), não gráfico a gráfico — ver o
  // comentário de _fonteUI: sem ela o ECharts reserva espaço medindo com a
  // sans-serif padrão e desenha com a fonte do tema, que é mais larga.
  const chart = echarts.init(el, { textStyle: { fontFamily: _fonteUI() } },
                             { renderer: "svg" });
  el.__echart = chart;
  return chart;
}

// ── colunas pareadas: estimado (claro) × homologado (cheio) ────────────────
function grafMeses(el, meses, larg = 660) {
  // Mês sem contratação é informação: filtrá-lo comprimia o eixo e escondia
  // o buraco — no acervo do piloto, março sumia entre fevereiro e abril.
  if (!meses.some(m => m.valor || m.estimado)) {
    el.innerHTML = `<div class="vazio">Sem contratações no exercício.</div>`;
    return;
  }
  const ultimo = meses.reduce(
    (u, m, i) => (m.valor || m.estimado) ? i : u, 0);
  const dados = meses.slice(0, Math.max(ultimo + 1, new Date().getMonth() + 1));
  el.innerHTML = `<div class="graf-echart" style="height:196px"></div>
    <div class="leg"><span><i style="background:var(--s1);opacity:.32"></i>Estimado</span>
    <span><i style="background:var(--s1)"></i>Homologado</span></div>`;
  const alvo = el.querySelector(".graf-echart");
  const chart = _iniciarEchart(alvo);
  chart.setOption({
    animation: false,
    grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: dados.map(m => MES[m.mes - 1]),
      axisLine: { lineStyle: { color: COR_EIXO } }, axisTick: { show: false },
      axisLabel: ROT_TXT },
    yAxis: { type: "value", min: 0, axisLabel: { ...ROT_TXT,
        formatter: v => compacto(v).replace("R$ ", "") },
      splitLine: { lineStyle: { color: COR_EIXO, opacity: .55 } } },
    series: [
      { name: "Estimado", type: "bar", data: dados.map(m => m.estimado || 0),
        itemStyle: { color: "var(--s1)", opacity: .32, borderRadius: [4, 4, 0, 0] },
        emphasis: { disabled: true } },
      { name: "Homologado", type: "bar", data: dados.map(m => m.valor || 0),
        itemStyle: { color: "var(--s1)", borderRadius: [4, 4, 0, 0] },
        emphasis: { disabled: true } }
    ]
  });
  // a coluna inteira do mês mostra os dois valores (estimado + homologado)
  ligarBaloEixo(chart, alvo, (i) => {
    const m = dados[i];
    if (!m) return null;
    return [
      { v: compacto(m.valor || 0), cor: "var(--s1)",
        l: `homologado · ${m.n} ${m.n === 1 ? "processo" : "processos"}` },
      { v: compacto(m.estimado || 0), l: "estimado" },
    ];
  });
}

// ── barras horizontais, uma série, rótulo direto ──────────────────────────
// Mesmo layout de app.js:desenharBarrasEcharts (rótulo como eixo à
// esquerda, valor ao final da barra) — os dois motores usam a mesma
// convenção agora, onde antes o Painel desenhava o rótulo acima da barra.
function grafBarras(el, itens, {valor, rotulo, sub, cor = "var(--s1)"}, larg = 360) {
  if (!itens.length) {
    el.innerHTML = `<div class="vazio">Sem dados no exercício.</div>`;
    return;
  }
  el.style.height = Math.max(120, itens.length * 36 + 20) + "px";
  const chart = _iniciarEchart(el);
  // A barra É o dado: rótulo e valor são legenda em volta dela. Reservar a
  // margem direita pela medida certa (correto) sem piso nenhum encolheu a
  // marca para 14% do cartão nos cartões estreitos da vista Economia — o
  // texto passou a ocupar 4/5 do gráfico. Daí o chão abaixo.
  const CHAO_BARRA = 0.38;
  const largura = el.clientWidth;
  const medir = (rs) => Math.ceil(Math.max(
    ...rs.map(t => _larguraTexto(t, VAL_TXT.fontSize)))) + 8;  // 5 do gap + 3
  let rotulosValor = itens.map(
    it => compacto(valor(it)) + (sub ? " · " + sub(it) : ""));
  let folgaDireita = medir(rotulosValor);
  // cartão apertado: o sufixo ("· 29 processos") sai do gráfico antes da
  // barra encolher — ele continua inteiro no tooltip
  if (largura - folgaDireita < largura * (CHAO_BARRA + 0.3)) {
    rotulosValor = itens.map(it => compacto(valor(it)));
    folgaDireita = medir(rotulosValor);
  }
  // teto do rótulo do eixo: ele nunca come o que sobrou para a barra
  const larguraRotulo = Math.max(56, Math.floor(Math.min(
    largura * 0.42, largura - folgaDireita - largura * CHAO_BARRA)));
  chart.setOption({
    animation: false,
    grid: { left: 4, right: folgaDireita, top: 8, bottom: 8,
            containLabel: true },
    // max no dado, não no "número redondo": o eixo é invisível, então o
    // arredondamento só encurtava a barra mais longa sem informar nada
    xAxis: { type: "value", show: false, max: "dataMax" },
    yAxis: { type: "category", inverse: true, data: itens.map(it => rotulo(it) ?? "–"),
      axisLine: { show: false }, axisTick: { show: false },
      // Teto no rótulo do eixo: "Serviços de Terceiros - Pessoa Jurídica"
      // sozinho comia 201 px de um cartão de 294 e não sobrava área de
      // plotagem nenhuma — as barras sumiam e os valores caíam fora do
      // cartão. O texto inteiro continua no tooltip do hover.
      axisLabel: { ...ROT_TXT, width: larguraRotulo, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 17,
      data: itens.map((it, i) => ({ value: valor(it) || 0,
        _rotuloValor: rotulosValor[i],
        itemStyle: { color: cor, borderRadius: [0, 4, 4, 0] } })),
      emphasis: { disabled: true },
      label: { show: true, position: "right", ...VAL_TXT,
        formatter: p => p.data._rotuloValor } }]
  });
  // a linha inteira do item (não só a barra) mostra o valor
  ligarBaloEixo(chart, el, (i) => {
    const it = itens[i];
    return it ? [{ v: compacto(valor(it)), l: rotulo(it), cor }] : null;
  }, 1);
}

// ── linhas do acumulado: ano corrente em destaque, anteriores em contexto ──
// O ponto e o rótulo do mês corrente ficam sempre visíveis — é o direto que
// vale sem hover nenhum. Passar o mouse troca para um corte vertical: a
// pergunta deixa de ser "quanto o ano atual acumulou" e vira "o que os três
// anos valiam neste mês", com uma linha só no tooltip por ano.
// A linha em si vem do ECharts; o corte vertical (crosshair) continua
// desenhado à mão, num SVG-overlay por cima do <div> do ECharts — mesmo
// contrato de dados de antes (data-cross-hit/guia/pt/serie-padrao), só
// que as coordenadas agora vêm de chart.convertToPixel/FromPixel em vez
// de fórmula própria, pra nunca descolar da grade que o ECharts desenhou.
function grafSeries(el, series, anoAtual) {
  const anos = Object.keys(series).sort();
  const todos = anos.flatMap(a => series[a]);
  if (!todos.some(v => v)) {
    el.innerHTML = `<div class="vazio">Sem histórico para comparar.</div>`;
    return;
  }
  const ultimoMesAtual = Math.min(new Date().getMonth(), 11);
  el.innerHTML = `<div class="graf-par" style="position:relative">
    <div class="graf-echart" style="height:220px"></div>
    <svg data-overlay aria-hidden="true"
      style="position:absolute;inset:0"></svg></div>`;
  const alvoChart = el.querySelector(".graf-echart");
  const overlay = el.querySelector("svg[data-overlay]");
  const chart = _iniciarEchart(alvoChart);
  const cores = {};
  chart.setOption({
    animation: false,
    grid: { left: 8, right: 92, top: 12, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: MES, boundaryGap: false,
      axisLine: { lineStyle: { color: COR_EIXO } }, axisTick: { show: false },
      axisLabel: ROT_TXT },
    yAxis: { type: "value", min: 0, axisLabel: { ...ROT_TXT,
        formatter: v => compacto(v).replace("R$ ", "") },
      splitLine: { lineStyle: { color: COR_EIXO, opacity: .55 } } },
    series: anos.map((ano, k) => {
      const atual = ano === String(anoAtual);
      cores[ano] = atual ? "var(--s1)" : "var(--muted)";
      // o ano em curso só tem pontos até o mês corrente; os outros, o ano todo
      return { name: ano, type: "line", symbol: "none", silent: true,
        data: series[ano].map((v, i) => (atual && i > ultimoMesAtual) ? null : v),
        lineStyle: { color: cores[ano], width: atual ? 2.5 : 2 },
        opacity: atual ? 1 : (0.4 + k * 0.18) };
    })
  });
  const larguraPx = alvoChart.clientWidth, alturaPx = alvoChart.clientHeight;
  overlay.setAttribute("width", larguraPx);
  overlay.setAttribute("height", alturaPx);
  const pxCoord = (i, v) => chart.convertToPixel({ gridIndex: 0 }, [i, v]);

  let g = "";
  anos.forEach(ano => {
    if (ano === String(anoAtual)) {
      const [cx, cy] = pxCoord(ultimoMesAtual, series[ano][ultimoMesAtual]);
      g += `<circle data-serie-padrao cx="${cx}" cy="${cy}" r="4" fill="var(--s1)"
              stroke="var(--surface)" stroke-width="2" opacity="1"/>
            <text data-serie-padrao class="val" opacity="1"
              x="${cx + 10}" y="${cy - 2}"
              fill="var(--s1)" font-weight="600">${esc(ano)} · ${
                compacto(series[ano][ultimoMesAtual])}</text>`;
    } else {
      const [ex, ey] = pxCoord(11, series[ano][11]);
      g += `<text class="rot" x="${ex + 10}" y="${ey + 4}">${esc(ano)}</text>`;
    }
  });
  // corte vertical: começa invisível (opacity 0), a camada de interação
  // abaixo é quem liga. O retângulo de captura vem por último — precisa
  // estar por cima de tudo para nunca perder o ponteiro para uma linha.
  g += `<line data-cross-guia x1="0" y1="4" x2="0" y2="${alturaPx - 22}"
          stroke="var(--border)" stroke-width="1" opacity="0"/>`;
  anos.forEach(ano => g += `<circle data-cross-pt="${esc(ano)}" r="4"
    fill="${cores[ano]}" stroke="var(--surface)" stroke-width="2" opacity="0"/>`);
  g += `<rect data-cross-hit x="0" y="0" width="${larguraPx}" height="${alturaPx}"
          fill="none" pointer-events="all"/>`;
  overlay.innerHTML = g;

  const hit = overlay.querySelector("[data-cross-hit]");
  const guia = overlay.querySelector("[data-cross-guia]");
  const pontosPadrao = overlay.querySelectorAll("[data-serie-padrao]");
  const pontosCorte = {};
  overlay.querySelectorAll("[data-cross-pt]").forEach(c =>
    pontosCorte[c.dataset.crossPt] = c);
  function mover(evt) {
    // sem isto, o listener delegado de tooltip em #painel (ligarTooltips)
    // via bolha o mesmo evento, não acha data-tip-v no alvo e chama
    // esconderTt() por cima do que este handler acabou de mostrar
    evt.stopPropagation();
    const r = overlay.getBoundingClientRect();
    const [iBruto] = chart.convertFromPixel({ gridIndex: 0 },
      [evt.clientX - r.left, evt.clientY - r.top]);
    const i = Math.max(0, Math.min(11, Math.round(iBruto)));
    const [gx] = pxCoord(i, 0);
    guia.setAttribute("x1", gx);
    guia.setAttribute("x2", gx);
    guia.setAttribute("opacity", "1");
    pontosPadrao.forEach(pt => pt.setAttribute("opacity", "0"));
    const linhas = [];
    anos.forEach(ano => {
      const ponto = pontosCorte[ano];
      if (ano === String(anoAtual) && i > ultimoMesAtual) {
        ponto.setAttribute("opacity", "0");
        return;
      }
      const v = series[ano][i];
      const [cx, cy] = pxCoord(i, v);
      ponto.setAttribute("cx", cx);
      ponto.setAttribute("cy", cy);
      ponto.setAttribute("opacity", "1");
      linhas.push({ v: compacto(v), l: ano, cor: cores[ano] });
    });
    // ano corrente primeiro: é o que o leitor veio comparar
    linhas.sort((a, b) => (b.l === String(anoAtual)) - (a.l === String(anoAtual)));
    mostrarTt(evt.clientX, evt.clientY, linhas, MES[i]);
  }
  hit.addEventListener("pointermove", mover);
  hit.addEventListener("pointerleave", () => {
    guia.setAttribute("opacity", "0");
    Object.values(pontosCorte).forEach(pt => pt.setAttribute("opacity", "0"));
    pontosPadrao.forEach(pt => pt.setAttribute("opacity", "1"));
    esconderTt();
  });
}

// ── deságio: economia à direita, estouro à esquerda do zero ───────────────
function grafDesagio(el, desagios, larg = 500) {
  if (!desagios.length) {
    el.innerHTML = `<div class="vazio">Nenhuma contratação com valor estimado e
            homologado no exercício.</div>`;
    return;
  }
  // O eixo era fixo em [-max, +max]: com todas as modalidades economizando
  // — o caso comum — metade do cartão ficava vazia e as barras nasciam no
  // meio, longe dos nomes. Este gráfico passou a destoar dos irmãos, que
  // alinham a barra ao rótulo. Agora o zero fica onde o dado põe: sem
  // nenhum estouro ele encosta à esquerda e o desenho vira uma barra comum;
  // havendo estouro, o eixo abre para o lado negativo e a divergência
  // aparece — que é quando ela informa alguma coisa.
  const pcts = desagios.map(d => d.pct);
  const menor = Math.min(0, ...pcts), maior = Math.max(0, ...pcts);
  const diverge = menor < 0;
  el.innerHTML = `<div class="graf-echart" style="height:${
    Math.max(120, desagios.length * 34 + 10)}px"></div>` + (diverge
    ? `<div class="leg" style="justify-content:space-between">
         <span>acima do estimado</span><span>economia</span></div>` : "");
  const chart = _iniciarEchart(el.querySelector(".graf-echart"));
  const rotulos = pcts.map(v => pct(v));
  const folgaDireita = Math.ceil(Math.max(
    ...rotulos.map(t => _larguraTexto(t, VAL_TXT.fontSize)))) + 8;
  const larguraRotulo = Math.max(56, Math.floor(Math.min(
    el.clientWidth * 0.42, el.clientWidth - folgaDireita - el.clientWidth * 0.38)));
  chart.setOption({
    animation: false,
    grid: { left: 4, right: folgaDireita, top: 8, bottom: 4,
            containLabel: true },
    xAxis: { type: "value", min: menor, max: maior, axisLabel: { show: false },
      axisLine: { show: false }, splitLine: { show: false } },
    yAxis: { type: "category", inverse: true,
      data: desagios.map(d => d.modalidade ?? "–"),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { ...ROT_TXT, width: larguraRotulo, overflow: "truncate" } },
    series: [
      { name: "economia", type: "bar", barWidth: 17,
        data: desagios.map(d => d.pct >= 0 ? d.pct : null),
        itemStyle: { color: "var(--s3)", borderRadius: [0, 4, 4, 0] },
        emphasis: { disabled: true },
        label: { show: true, position: "right", ...VAL_TXT,
          formatter: p => pct(p.value) } },
      { name: "estouro", type: "bar", barWidth: 17,
        data: desagios.map(d => d.pct < 0 ? d.pct : null),
        itemStyle: { color: "var(--s2)", borderRadius: [4, 0, 0, 4] },
        emphasis: { disabled: true },
        label: { show: true, position: "left", ...VAL_TXT,
          formatter: p => pct(p.value) } }
    ]
  });
  // a linha inteira da modalidade mostra o deságio
  ligarBaloEixo(chart, el.querySelector(".graf-echart"), (i) => {
    const d = desagios[i];
    return d ? [{ v: pct(d.pct), l: `${d.modalidade} · ${
      d.pct >= 0 ? "de deságio" : "acima do estimado"} · ${d.n} ${
      d.n === 1 ? "processo" : "processos"}` }] : null;
  }, 1);
}

// ── concentração: curva do valor acumulado por fornecedor ─────────────────
// O ponto e o rótulo padrão (10º fornecedor) valem em repouso; passar o
// mouse troca para o fornecedor apontado, em qualquer posição da curva.
function grafConcentracao(el, curva, total) {
  if (curva.length < 3) {
    el.innerHTML = `<div class="vazio">Poucos fornecedores para medir
             concentração.</div>`;
    return;
  }
  // destacar o último ponto seria dizer "todos os fornecedores = 100%", que
  // não informa nada — e o rótulo cairia em cima do fim da curva
  const dez = Math.min(9, Math.max(0, curva.length - 2));
  el.innerHTML = `<div class="graf-par" style="position:relative">
    <div class="graf-echart" style="height:190px"></div>
    <svg data-overlay aria-hidden="true"
      style="position:absolute;inset:0"></svg></div>`;
  const alvoChart = el.querySelector(".graf-echart");
  const overlay = el.querySelector("svg[data-overlay]");
  const chart = _iniciarEchart(alvoChart);
  chart.setOption({
    animation: false,
    grid: { left: 8, right: 12, top: 8, bottom: 30, containLabel: true },
    xAxis: { type: "value", min: 0, max: curva.length - 1, show: false },
    yAxis: { type: "value", min: 0, max: 100, show: false },
    series: [
      { type: "line", symbol: "none", silent: true,
        data: [[0, 0], [curva.length - 1, 100]],
        lineStyle: { color: "var(--muted)", width: 1.5, type: "dashed",
          opacity: .6 } },
      { type: "line", symbol: "none", silent: true,
        data: curva.map((v, i) => [i, v]),
        lineStyle: { color: "var(--s1)", width: 2.5 } }
    ]
  });
  const larguraPx = alvoChart.clientWidth, alturaPx = alvoChart.clientHeight;
  overlay.setAttribute("width", larguraPx);
  overlay.setAttribute("height", alturaPx);
  const pxCoord = (i, v) => chart.convertToPixel({ gridIndex: 0 }, [i, v]);

  const [px0] = pxCoord(0, 0), [pxN] = pxCoord(curva.length - 1, 0);
  const [dx, dy] = pxCoord(dez, curva[dez]);
  const aDireita = dx < px0 + (pxN - px0) * 0.7;
  let g = `<text class="rot" x="0" y="${alturaPx - 6}">1</text>
    <text class="rot" x="${larguraPx}" y="${alturaPx - 6}" text-anchor="end"
      >${total}</text>
    <text class="rot" x="${larguraPx / 2}" y="${alturaPx - 6}" text-anchor="middle"
      >fornecedores, do maior para o menor</text>
    <circle data-serie-padrao cx="${dx}" cy="${dy}" r="4" fill="var(--s1)"
      stroke="var(--surface)" stroke-width="2" opacity="1"/>
    <text data-serie-padrao class="val" opacity="1"
      x="${dx + (aDireita ? 10 : -10)}" y="${dy + 20}"
      text-anchor="${aDireita ? "start" : "end"}"
      >${dez + 1} ${dez ? "fornecedores" : "fornecedor"} = ${
        pct(curva[dez], 0)} do valor</text>
    <line data-cross-guia x1="0" y1="4" x2="0" y2="${alturaPx - 22}"
      stroke="var(--border)" stroke-width="1" opacity="0"/>
    <circle data-cross-pt r="4" fill="var(--s1)" stroke="var(--surface)"
      stroke-width="2" opacity="0"/>
    <rect data-cross-hit x="0" y="0" width="${larguraPx}" height="${alturaPx}"
      fill="none" pointer-events="all"/>`;
  overlay.innerHTML = g;

  const hit = overlay.querySelector("[data-cross-hit]");
  const guia = overlay.querySelector("[data-cross-guia]");
  const ponto = overlay.querySelector("[data-cross-pt]");
  const padrao = overlay.querySelectorAll("[data-serie-padrao]");
  function mover(evt) {
    evt.stopPropagation();
    const r = overlay.getBoundingClientRect();
    const [iBruto] = chart.convertFromPixel({ gridIndex: 0 },
      [evt.clientX - r.left, evt.clientY - r.top]);
    const i = Math.max(0, Math.min(curva.length - 1, Math.round(iBruto)));
    const [cx, cy] = pxCoord(i, curva[i]);
    guia.setAttribute("x1", cx);
    guia.setAttribute("x2", cx);
    guia.setAttribute("opacity", "1");
    ponto.setAttribute("cx", cx);
    ponto.setAttribute("cy", cy);
    ponto.setAttribute("opacity", "1");
    padrao.forEach(pt => pt.setAttribute("opacity", "0"));
    mostrarTt(evt.clientX, evt.clientY, [{
      v: `${pct(curva[i], 0)} do valor`,
      l: `${i + 1} ${i ? "fornecedores" : "fornecedor"}` }]);
  }
  hit.addEventListener("pointermove", mover);
  hit.addEventListener("pointerleave", () => {
    guia.setAttribute("opacity", "0");
    ponto.setAttribute("opacity", "0");
    padrao.forEach(pt => pt.setAttribute("opacity", "1"));
    esconderTt();
  });
}

// ── calor: processos por mês e modalidade, rampa de uma cor só ────────────
function grafCalor(el, calor, meses) {
  const linhas = Object.entries(calor);
  const todos = linhas.flatMap(([, v]) => v);
  if (!todos.some(v => v)) {
    el.innerHTML = `<div class="vazio">Sem processos no exercício.</div>`;
    return;
  }
  const max = Math.max(...todos);
  const nivel = (v) => !v ? 1 : Math.min(5, 1 + Math.ceil((v / max) * 4));
  // legenda alinhada à direita: em cima ela disputava espaço com a última
  // coluna de meses e saía cortada
  el.innerHTML = `<div class="graf-echart" style="height:${
    linhas.length * 34 + 50}px"></div>
    <div class="leg" style="justify-content:flex-end;align-items:center;gap:5px">
      <span>menos</span>${[1, 2, 3, 4, 5].map(n =>
        `<i style="width:22px;height:13px;border-radius:2px;background:var(--seq${n})"></i>`
      ).join("")}<span>mais processos</span></div>`;
  const alvo = el.querySelector(".graf-echart");
  const chart = _iniciarEchart(alvo);
  const data = [];
  linhas.forEach(([, valores], i) => valores.forEach((v, m) => {
    const n = nivel(v);
    data.push({ value: [m, i, v || 0],
      itemStyle: { color: `var(--seq${n})` },
      // O número dentro da célula poupa o hover para ler a contagem. A tinta
      // sai de `--seq{n}-ink`, definida junto de cada rampa: escolher pelo
      // nível ("alto = claro") seria falso no Observatório, cuja rampa é
      // invertida. Célula zerada fica só com o tom de fundo — imprimir "0"
      // doze vezes por linha vira ruído.
      label: { show: !!v, formatter: String(v), fontSize: 11, fontWeight: 600,
               color: `var(--seq${n}-ink)` } });
  }));
  chart.setOption({
    animation: false,
    grid: { left: 4, right: 8, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: meses.map(m => MES[m - 1]),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: ROT_TXT },
    yAxis: { type: "category", inverse: true, data: linhas.map(([nome]) => nome),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: ROT_TXT },
    series: [{ type: "heatmap", data,
      itemStyle: { borderColor: "var(--surface)", borderWidth: 2, borderRadius: 3 },
      emphasis: { disabled: true } }]
  });
  // qualquer ponto da grade resolve a célula sob o cursor — não só a marca:
  // a borda de 2px entre células e os cantos deixavam buracos onde o balão
  // não vinha. `convertFromPixel` devolve [coluna, linha] do heatmap.
  alvo.addEventListener("mousemove", (e) => {
    const r = alvo.getBoundingClientRect();
    const pt = chart.convertFromPixel("grid", [e.clientX - r.left, e.clientY - r.top]);
    const m = pt ? Math.round(pt[0]) : -1, i = pt ? Math.round(pt[1]) : -1;
    if (!linhas[i] || m < 0 || m >= meses.length) return esconderTt();
    const v = linhas[i][1][m] || 0;
    mostrarTt(e.clientX, e.clientY, [{ v: `${v} ${v === 1 ? "processo" : "processos"}`,
      l: `${MES[meses[m] - 1]} · ${linhas[i][0]}` }]);
  });
  alvo.addEventListener("mouseleave", esconderTt);
}

// ── medidores do limite anual de dispensa ─────────────────────────────────
// HTML puro, não ECharts (2026-09-04, pedido do usuário): a barra ocupa a
// largura inteira do cartão e o texto (objeto + status) fica ABAIXO dela —
// o layout anterior (barra estreita ao lado do rótulo, herdado do ECharts
// horizontal-bar) desperdiçava a largura do cartão nisso.
function grafLimites(el, objetos, limite) {
  if (!objetos.length) {
    el.innerHTML = `<div class="vazio">Nenhuma dispensa registrada no exercício.</div>`;
    return;
  }
  el.style.height = "";                 // altura fixa era só do modo ECharts
  const cor = (o) => o.pct >= 90 ? "var(--erro)" : o.pct >= 75 ? "var(--warn)"
                                                                : "var(--s3)";
  // barra cheia diz "chegou ao limite"; passar dele é outra informação, e
  // "874%" numa barra igual à de 100% esconde justamente a gravidade — o
  // valor em R$ (mais largo, variável) fica só no tooltip; o rótulo
  // sempre visível é curto de propósito
  const rotuloStatus = (o) => {
    const vezes = (o.pct / 100).toFixed(1).replace(".", ",");
    return o.pct > 100 ? `${vezes}× o limite` : `${pct(o.pct, 0)} do limite`;
  };
  el.innerHTML = objetos.map(o => `
    <div class="lim-item">
      <div class="lim-trilho">
        <div class="lim-barra" style="width:${Math.min(100, o.pct || 0)}%;
             background:${cor(o)}"></div>
        ${o.pct > 100 ? `<span class="lim-estouro" style="color:${cor(o)}"
             aria-hidden="true">▸</span>` : ""}
      </div>
      <div class="lim-legenda">
        <span class="lim-obj">${esc(o.objeto)} · ${o.n}
          ${o.n === 1 ? "dispensa" : "dispensas"}</span>
        <span class="lim-val" style="color:${cor(o)}">${rotuloStatus(o)}</span>
      </div>
    </div>`).join("");
  // a linha inteira do objeto mostra o total contra o limite
  el.querySelectorAll(".lim-item").forEach((item, i) => {
    const o = objetos[i];
    item.addEventListener("mousemove", e => mostrarTt(e.clientX, e.clientY,
      [{ v: dinheiro(o.total), l: `${o.objeto} · de ${dinheiro(limite)}` }]));
    item.addEventListener("mouseleave", esconderTt);
  });
}

// ── funil: onde os processos do exercício pararam ─────────────────────────
function grafFunil(el, f, larg = 500) {
  const etapas = [["Publicadas", f.publicadas], ["Com resultado", f.com_resultado],
                  ["Com contrato", f.com_contrato], ["Vigentes hoje", f.vigentes]];
  const max = etapas[0][1] || 1;
  el.style.height = (etapas.length * 40 + 10) + "px";
  const chart = _iniciarEchart(el);
  chart.setOption({
    animation: false,
    grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
    xAxis: { type: "value", max, show: false },
    yAxis: { type: "category", inverse: true, data: etapas.map(([nome]) => nome),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: VAL_TXT },
    series: [{ type: "bar", barWidth: 26,
      data: etapas.map(([, v], i) => ({ value: v,
        itemStyle: { color: "var(--s1)", opacity: 0.85 - i * 0.15,
                     borderRadius: [0, 4, 4, 0] } })),
      emphasis: { disabled: true },
      label: { show: true, position: "right", ...VAL_TXT } }]
  });
  // a linha inteira da etapa (não só a barra) mostra o valor
  ligarBaloEixo(chart, el, (i) => {
    const et = etapas[i];
    return et ? [{ v: et[1], l: et[0] }] : null;
  }, 1);
}

// ── agenda dos próximos 90 dias ───────────────────────────────────────────
// Vencimentos se amontoam: numa prefeitura pequena, meia dúzia de contratos
// termina no mesmo dia. Por isso a marca é o DIA, não o contrato — o tamanho
// dela conta quantos, e o rótulo nomeia o primeiro.
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MES_EXT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
                 "julho", "agosto", "setembro", "outubro", "novembro",
                 "dezembro"];

// Chave de dia montada à mão. `toISOString()` converte para UTC e, depois
// das 21h no fuso de Brasília, devolve o dia seguinte — o mesmo defeito que
// já mordeu a família inteira (`_isoLocal` no esqueleto do SGx).
const _chaveDia = (d) => `${d.getFullYear()}-${
  String(d.getMonth() + 1).padStart(2, "0")}-${
  String(d.getDate()).padStart(2, "0")}`;

// ── agenda: calendário de três meses ──────────────────────────────────────
// Era uma linha do tempo de 90 dias com um ponto por vencimento, e não
// funcionava porque vencimento não se espalha: ele se amontoa em cinco ou
// seis datas. Quarenta registros disputavam o primeiro terço da linha, os
// rótulos colidiam (havia lógica de corte por caractere só para isso) e dois
// terços do cartão ficavam vazios. No calendário o amontoado cai onde ele
// pertence — na data — e vira informação em vez de estorvo.
// Escolha do usuário entre quatro desenhos propostos, 2026-08-14.
//
// O dia fica SEMPRE visível e a contagem vai num selo à parte: no protótipo
// a célula acesa mostrava só a quantidade, e "3" tanto podia ser o dia 3
// quanto três vencimentos.
function grafAgenda(el, itens) {
  if (!itens.length) {
    el.innerHTML = `<div class="vazio">Nada vence nos próximos 90 dias.</div>`;
    return;
  }
  const porData = new Map();
  itens.forEach(it => {
    const k = (it.vigencia_fim || "").slice(0, 10);
    if (!k) return;
    (porData.get(k) ?? porData.set(k, []).get(k)).push(it);
  });
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const kHoje = _chaveDia(hoje);

  const meses = [0, 1, 2].map(salto => {
    const base = new Date(hoje.getFullYear(), hoje.getMonth() + salto, 1);
    const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const celulas = [];
    for (let i = 0; i < base.getDay(); i++)
      celulas.push(`<div class="cal-dia fora" aria-hidden="true"></div>`);
    for (let d = 1; d <= ultimo; d++) {
      const k = _chaveDia(new Date(base.getFullYear(), base.getMonth(), d));
      const grupo = porData.get(k);
      const marca = k === kHoje ? " hoje" : "";
      if (!grupo) {
        celulas.push(`<div class="cal-dia${marca}">${d}</div>`);
        continue;
      }
      const prazo = grupo[0].dias ?? 0;
      const faixa = prazo <= 15 ? "u" : prazo <= 60 ? "a" : "t";
      const quem = grupo.map(i => `${i.tipo}: ${i.nome ?? "–"}`).join(" · ");
      const quantos = `${grupo.length} vencimento${grupo.length > 1 ? "s" : ""}`;
      // `aria-label` e não `title`: o title desenha o balão preto nativo do
      // navegador em cima do tooltip próprio, com atraso — dois balões
      // dizendo a mesma coisa. O aria-label só fala, não desenha.
      celulas.push(`<div class="cal-dia venc ${faixa}${marca}" role="img"
        aria-label="${esc(quantos)} em ${esc(dataBr(k))}: ${esc(quem)}"
        data-tip-v="${esc(quantos)} em ${esc(dataBr(k))}"
        data-tip-l="${esc(quem)}"
        >${d}<b>${grupo.length}</b></div>`);
    }
    // o ano só aparece quando a janela de 90 dias vira o calendário
    const ano = base.getFullYear() !== hoje.getFullYear()
      ? ` de ${base.getFullYear()}` : "";
    return `<div class="cal-mes"><h4>${MES_EXT[base.getMonth()]}${ano}</h4>
      <div class="cal-sem" aria-hidden="true">${
        SEMANA.map(s => `<span>${s}</span>`).join("")}</div>
      <div class="cal-grade">${celulas.join("")}</div></div>`;
  });
  el.innerHTML = `<div class="cal">${meses.join("")}</div>
    <div class="leg">
      <span><i style="background:var(--erro)"></i>vence em até 15 dias</span>
      <span><i style="background:var(--warn)"></i>16 a 60 dias</span>
      <span><i style="background:var(--s3)"></i>61 a 90 dias</span></div>`;
}

// ══ montagem das três vistas ══════════════════════════════════════════════

function cartao(titulo, corpo, nota) {
  return `<div class="card"><h3>${titulo}</h3>${corpo}${
    nota ? `<div class="nota">${nota}</div>` : ""}</div>`;
}

// Cartão cujo gráfico só é desenhado depois de saber a largura do espaço.
// Com viewBox fixo o SVG escalava mantendo proporção e sobrava faixa vazia
// dos dois lados — em tela larga, metade do cartão era espaço morto.
function cartaoGraf(titulo, chave, nota) {
  // data-titulo vira o <title> do SVG em `desenharGraficos` — o título do
  // cartão já é a melhor descrição do gráfico, não vale repetir à mão
  return cartao(titulo, `<div class="graf" data-graf="${chave}"
    data-titulo="${esc(titulo)}"></div>`, nota);
}

// Cada chave sabe se desenhar em qualquer largura. O redesenho acontece
// depois da montagem e a cada mudança de tamanho da janela.
const DESENHO = {
  meses: (el, l) => grafMeses(el, P.dados.execucao.meses, l),
  modalidades: (el, l) => grafBarras(el, P.dados.execucao.modalidades.slice(0, 6), {
    valor: m => m.homologado || m.estimado || 0,
    rotulo: m => m.modalidade_nome ?? "–",
    sub: m => `${m.n} ${m.n === 1 ? "processo" : "processos"}`}, l),
  series: (el, l) => grafSeries(el, P.dados.analise.series, P.dados.ano),
  desagio: (el, l) => grafDesagio(el, P.dados.analise.desagios, l),
  concentracao: (el, l) => grafConcentracao(el, P.dados.analise.curva,
                                        P.dados.analise.fornecedores_total),
  calor: (el, l) => grafCalor(el, P.dados.analise.calor, P.dados.analise.meses_calor),
  limites: (el, l) => grafLimites(el, P.dados.vigilancia.limites,
                              P.dados.vigilancia.limite_compras),
  funil: (el, l) => grafFunil(el, P.dados.vigilancia.funil, l),
  agenda: (el, l) => grafAgenda(el, P.dados.vigilancia.agenda),
  economia_modalidade: (el, l) => grafBarras(el, P.dados.economia.por_modalidade, {
    valor: m => m.economizado || 0, rotulo: m => m.modalidade ?? "–",
    sub: m => `${m.n} ${m.n === 1 ? "processo" : "processos"}`}, l),
  economia_familia: (el, l) => grafBarras(el, P.dados.economia.por_familia, {
    valor: f => f.economizado || 0, rotulo: f => f.nome ?? "–",
    sub: f => `${f.n} ${f.n === 1 ? "item" : "itens"}`}, l),
  economia_categoria: (el, l) => grafBarras(el, P.dados.economia.por_categoria, {
    valor: c => c.economizado || 0, rotulo: c => c.nome ?? "–",
    sub: c => `${c.n} ${c.n === 1 ? "item" : "itens"}`}, l),
  economia_series: (el, l) => grafSeries(el, P.dados.economia.series, P.dados.ano),
  economia_fornecedor: (el, l) => grafBarras(el, P.dados.economia.por_fornecedor, {
    valor: f => f.economizado || 0,
    rotulo: f => fornecedorCurto(f.nome) ?? "–",
    sub: f => `${f.n} ${f.n === 1 ? "item" : "itens"} · ${pct(f.pct, 0)}`}, l),
};

function desenharGraficos(raiz) {
  if (!P.dados) return;
  (raiz ?? $("painel")).querySelectorAll(".graf[data-graf]").forEach(el => {
    const largura = Math.round(el.clientWidth);
    if (!largura) return;               // vista oculta: desenha ao aparecer
    if (el.dataset.largura === String(largura)) return;
    el.dataset.largura = String(largura);
    // três contratos possíveis: string (HTML pronto), { html, ligar } (corte
    // vertical) ou nada — gráficos ECharts recebem o próprio elemento e
    // desenham direto nele (echarts.init precisa do nó real, não de uma
    // string), então não há o que atribuir de volta aqui
    const saida = DESENHO[el.dataset.graf](el, largura);
    if (typeof saida === "string") {
      el.innerHTML = saida;
    } else if (saida && saida.html) {
      el.innerHTML = saida.html;
      saida.ligar?.(el);
    }
    // nome acessível do gráfico, num ponto só: sem isto o SVG entrava sem
    // nenhum nome (auditoria de acessibilidade, 2026-08-09). Vai como
    // `aria-label`, NÃO como <title>: o <title> desenhava o balão preto nativo
    // do navegador (~1s de atraso, não segue o cursor) por cima do tooltip
    // próprio — mesma praga que já tirei do calendário na 1.40.1. `aria-label`
    // fala pro leitor de tela e não desenha; e, sem `role="img"`, os rótulos
    // diretos DENTRO do desenho (os números) continuam acessíveis.
    const desenho = el.querySelector("svg");
    if (desenho && el.dataset.titulo) {
      const antigo = desenho.querySelector(":scope > title");
      if (antigo) antigo.remove();          // limpa <title> de captura anterior
      desenho.setAttribute("aria-label", el.dataset.titulo);
    }
  });
}

function vistaExecucao(d) {
  const c = d.execucao.cards, ano = d.ano;
  const varValor = c.homologado && d.execucao.homologado_anterior
    ? (c.homologado / d.execucao.homologado_anterior - 1) * 100 : null;
  const varN = c.n - (d.execucao.n_anterior || 0);
  const spark = d.execucao.meses.filter(m => m.valor);
  const maxS = Math.max(...spark.map(m => m.valor), 1);
  const linha = spark.map((m, i) =>
    `${8 + i * (224 / Math.max(1, spark.length - 1))},${38 - (m.valor / maxS) * 32}`
  ).join(" ");
  return `
  <div class="faixa f-4">
    <div class="card hero">
      <h3>Homologado em ${ano}</h3>
      <div class="n">${dinheiro(c.homologado)}</div>
      <div class="r">${varValor == null ? `sem ${ano - 1} para comparar`
        : `<span class="dir">${
            varValor >= 0 ? "▲" : "▼"} ${pct(Math.abs(varValor), 0)}</span>
           sobre ${ano - 1}${d.comparacao_parcial ? " no mesmo período" : ""}`}</div>
      ${spark.length > 1 ? svg(240, 44, `<polyline fill="none" stroke="var(--s1)"
        stroke-width="2" stroke-linejoin="round" points="${linha}"/>`) : ""}
    </div>
    <div class="card kpiv"><div class="v">${c.n}</div>
      <div class="r">contratações</div>
      <div class="r" style="margin-top:8px">${varN >= 0 ? "▲" : "▼"} ${
        Math.abs(varN)} vs. ${ano - 1}${
        d.comparacao_parcial ? " até hoje" : ""}</div></div>
    <div class="card kpiv"><div class="v">${
        c.desagio == null ? "–" : pct(c.desagio)}</div>
      <div class="r">deságio médio</div>
      <div class="r" style="margin-top:8px">${
        c.estimado && c.homologado
          ? `${dinheiro(c.estimado - c.homologado)} economizados` : ""}</div></div>
    <div class="card kpiv"><div class="v">${c.contratos_vigentes}</div>
      <div class="r">contratos vigentes</div>
      <div class="r" style="margin-top:8px">${c.atas_vigentes} atas vigentes</div>
    </div>
  </div>
  <div class="faixa f-21">
    ${cartaoGraf(`Contratações por mês — estimado × homologado`, "meses")}
    ${cartaoGraf("Por modalidade — valor homologado", "modalidades")}
  </div>
  <div class="faixa f-11">
    ${cartao("Vence nos próximos 90 dias", tabelaVencendo(d.execucao.vencendo),
             `<span class="so-tela">Clicar leva à aba correspondente.</span>`)}
    ${cartao(`Onde o dinheiro foi — fornecedores de ${ano}`,
             tabelaFornecedores(d.execucao.fornecedores))}
  </div>`;
}

function tabelaVencendo(itens) {
  if (!itens.length) return `<div class="vazio">Nada vence em 90 dias.</div>`;
  return `<table><tr><th>Fornecedor / ata</th><th>Objeto</th>
    <th class="num">Vence</th></tr>` + itens.slice(0, 6).map(v => {
      const cls = (v.dias ?? 0) <= 15 ? "b" : (v.dias ?? 0) <= 60 ? "a" : "c";
      return `<tr><td title="${esc(v.nome ?? "")}">${
        esc(fornecedorCurto(v.nome) ?? "–")}</td>
        <td title="${esc(v.objeto ?? "")}">${
          esc((v.objeto ?? "–").slice(0, 40))}</td>
        <td class="num"><span class="badge ${cls === "b" ? "err"
          : cls === "a" ? "warn" : "ok"}">${v.dias} dias</span></td></tr>`;
    }).join("") + `</table>`;
}

function tabelaFornecedores(itens) {
  if (!itens.length) return `<div class="vazio">Sem contratos no exercício.</div>`;
  const total = itens.reduce((s, f) => s + (f.total || 0), 0);
  const topo4 = itens.slice(0, 4).reduce((s, f) => s + (f.total || 0), 0);
  return `<table><tr><th>Fornecedor</th><th class="num">Contratos</th>
    <th class="num">Total</th></tr>` + itens.slice(0, 5).map(f =>
    `<tr><td title="${esc(f.fornecedor_nome ?? "")}">${
      esc(fornecedorCurto(f.fornecedor_nome) ?? "–")}</td>
      <td class="num">${f.n}</td><td class="num">${compacto(f.total)}</td></tr>`
  ).join("") + `</table>` + (total ? `<div class="nota">Os quatro primeiros
    somam ${pct(topo4 / total * 100, 0)} do valor contratado.</div>` : "");
}

function vistaAnalise(d) {
  const a = d.analise;
  return `
  ${cartaoGraf(`Valor homologado acumulado — ${d.ano - 2} a ${d.ano}`, "series",
           `O ano corrente em destaque; os anteriores ficam como contexto — a
            comparação é com o mesmo mês, não com o total do ano.`)}
  <div class="faixa f-11">
    ${cartaoGraf("Deságio por modalidade — quanto o certame economizou",
                 "desagio")}
    ${cartaoGraf(`Concentração de fornecedores — ${d.ano}`, "concentracao",
             `A linha tracejada é a distribuição perfeitamente igual — quanto
              mais a curva se afasta dela, mais concentrado é o mercado.`)}
  </div>
  ${cartaoGraf("Quando o município compra — processos por mês e modalidade",
               "calor")}`;
}

function vistaVigilancia(d) {
  const v = d.vigilancia;
  return `
  <div class="faixa f-11">
    ${cartaoGraf(`Limite anual de dispensa — art. 75, II (${
               dinheiro(v.limite_compras)})`, "limites",
             `A soma é por <b>objeto</b>, agrupado pelas duas primeiras
              palavras significativas da descrição — o critério do art. 75 é
              objeto de mesma natureza, e o enquadramento final é juízo do
              gestor. Este medidor é termômetro, não veredito.`)}
    ${cartaoGraf("Do edital ao contrato — onde os processos estão", "funil",
             `${v.funil.publicadas - v.funil.com_resultado} publicadas ainda sem
              resultado registrado no PNCP.`)}
  </div>
  ${cartaoGraf("Agenda dos próximos 90 dias", "agenda",
           `O número no canto do dia é quantos contratos ou atas vencem nele
            — passe o mouse para ver quais. Vencimento se concentra em
            poucas datas, e é isso que o calendário mostra melhor que uma
            linha do tempo.`)}`;
}

function vistaEconomia(d) {
  const e = d.economia, ano = d.ano;
  const varEcon = e.economizado_anterior
    ? (e.economizado / e.economizado_anterior - 1) * 100 : null;
  // o card de homologado ficava com duas linhas contra as três dos irmãos, e
  // a fileira perdia a linha de base comum — a comparação com o ano anterior
  // preenche a lacuna com informação, não com espaço em branco
  const varHom = e.homologado_anterior
    ? (e.homologado / e.homologado_anterior - 1) * 100 : null;
  return `
  <div class="faixa f-3">
    <div class="card hero">
      <h3>Economizado em ${ano}</h3>
      <div class="n">${dinheiro(e.economizado)}</div>
      <div class="r">${varEcon == null ? `sem ${ano - 1} para comparar`
        : `<span class="${varEcon >= 0 ? "up" : "down"}">${
            varEcon >= 0 ? "▲" : "▼"} ${pct(Math.abs(varEcon), 0)}</span>
           sobre ${ano - 1}${d.comparacao_parcial ? " no mesmo período" : ""}`}</div>
    </div>
    <div class="card kpiv"><div class="v">${pct(e.pct)}</div>
      <div class="r">deságio médio</div>
      <div class="r" style="margin-top:8px">${dinheiro(e.estimado)} estimados</div>
    </div>
    <div class="card kpiv"><div class="v">${dinheiro(e.homologado)}</div>
      <div class="r">homologado no ano</div>
      <div class="r" style="margin-top:8px">${
        varHom == null ? `sem ${ano - 1} para comparar`
          : `<span class="dir">${varHom >= 0 ? "▲" : "▼"} ${
              pct(Math.abs(varHom), 0)}</span> sobre ${ano - 1}`}</div></div>
  </div>
  ${cartaoGraf(`Economia acumulada — ${ano - 2} a ${ano}`, "economia_series",
           `O ano corrente em destaque; os anteriores ficam como contexto —
            a comparação é com o mesmo mês, não com o total do ano.`)}
  <div class="faixa f-3">
    ${cartaoGraf("Economia por modalidade", "economia_modalidade")}
    ${cartaoGraf("Economia por família de item", "economia_familia",
             `Mesmo agrupamento do medidor de limite — radical de duas
              palavras da descrição.`)}
    ${cartaoGraf("Economia por categoria (PNCP)", "economia_categoria",
             `Categoria como o próprio PNCP classificou o item.`)}
  </div>
  ${cartaoGraf("Economia por fornecedor — quem fechou abaixo do estimado",
           "economia_fornecedor",
           `Agrupado pelo CNPJ/CPF, não pelo nome — a mesma empresa aparece
            com grafias diferentes entre processos. Deságio alto não é
            atestado de bom fornecedor: pode ser estimativa inflada na
            origem. Leia junto com a pesquisa de preços.`)}`;
}

// ══ ciclo de vida ═════════════════════════════════════════════════════════

const VISTAS = { execucao: "p-execucao", analise: "p-analise",
                 vigilancia: "p-vigilancia", economia: "p-economia" };

function mostrarVista() {
  for (const id of Object.values(VISTAS))
    $(id).classList.toggle("oculto", VISTAS[P.vista] !== id);
  // vista oculta tem largura zero: ao aparecer, os gráficos são desenhados
  desenharGraficos($(VISTAS[P.vista]));
}

async function carregarPainel() {
  mostrarVista();
  if (!api.painel) return;
  // a consulta é rápida, mas o banco pode estar compactando depois de uma
  // sincronização: sem sinal na tela, a espera parece travamento
  const painel = $("painel");
  painel.setAttribute("aria-busy", "true");
  painel.classList.add("carregando");
  let dados;
  try {
    dados = await api.painel($("p-ano").value || null,
                             $("p-orgao").value || null);
  } catch (e) {
    painel.classList.remove("carregando");
    painel.removeAttribute("aria-busy");
    $("painel-chips").classList.add("oculto");
    $(VISTAS[P.vista]).innerHTML =
      `<div class="card"><div class="vazio">Não consegui montar o painel:
        ${esc(String(e && e.message || e))}</div></div>`;
    return;
  }
  painel.classList.remove("carregando");
  painel.removeAttribute("aria-busy");
  P.dados = dados;
  mostrarChips(dados.alertas);
  $("p-execucao").innerHTML = vistaExecucao(dados);
  $("p-analise").innerHTML = vistaAnalise(dados);
  $("p-vigilancia").innerHTML = vistaVigilancia(dados);
  $("p-economia").innerHTML = vistaEconomia(dados);
  desenharGraficos();
}

// Redesenhar em vez de esticar: o SVG é gerado na medida do espaço, então
// mudar a largura da janela (ou o modo compacta/expandida) refaz as marcas
// no tamanho certo, sem faixa morta nem texto deformado.
let redesenhoPendente;
new ResizeObserver(() => {
  clearTimeout(redesenhoPendente);
  redesenhoPendente = setTimeout(() => desenharGraficos(), 120);
}).observe($("painel"));

// Os alertas ficam acima das subabas de propósito: alerta que só aparece
// depois de escolher a subaba certa não alerta ninguém.
function mostrarChips(a) {
  // o alerta é calculado sobre o exercício e o órgão do Painel — o clique
  // tem de levar os dois, senão a lista mostra "todos os anos/órgãos" e
  // deixa de bater com o número que o usuário acabou de ver
  const orgao = $("p-orgao").value || undefined;
  const chips = [];
  if (a.perto_do_limite) chips.push(["grave", ICONE.limite, a.perto_do_limite,
    `objeto${a.perto_do_limite > 1 ? "s" : ""} ${a.acima_do_limite
      ? "acima do" : "perto do"} limite anual de dispensa`,
    () => irPara("contratacoes", {ano: P.dados.ano, orgao, modalidade: "8",
                                  objetos: a.objetos_perto_do_limite})]);
  if (a.vencendo_contratos) chips.push(["aviso", ICONE.prazo, a.vencendo_contratos,
    a.vencendo_contratos === 1 ? "contrato vence em 60 dias"
                               : "contratos vencem em 60 dias",
    () => irPara("contratos",
                {orgao, vencendo: true, ord: "vigencia", dir: "asc"})]);
  if (a.vencendo_atas) chips.push(["aviso", ICONE.prazo, a.vencendo_atas,
    a.vencendo_atas === 1 ? "ata vence em 60 dias" : "atas vencem em 60 dias",
    () => irPara("atas",
                {orgao, vencendo: true, ord: "vigencia", dir: "asc"})]);
  if (a.propostas) chips.push(["", ICONE.proposta, a.propostas,
    a.propostas === 1 ? "processo com proposta aberta"
                      : "processos com proposta aberta",
    () => irPara("contratacoes", {orgao, propostas: true})]);
  // achado da auditoria de design (2026-08-08): ampulheta e relógio (usado
  // nos dois chips de vencimento acima) lêem como "tempo passando" a um
  // olhar rápido, mas dizem coisas opostas — prazo chegando vs processo
  // parado. A pausa lê como "parado" de propósito, sem competir com relógio.
  if (a.paradas) chips.push(["", ICONE.parado, a.paradas,
    a.paradas === 1 ? "processo sem resultado há mais de 90 dias"
                    : "processos sem resultado há mais de 90 dias",
    () => irPara("contratacoes", {ano: P.dados.ano, orgao, parada: true})]);
  const caixa = $("painel-chips");
  caixa.classList.toggle("oculto", !chips.length);
  caixa.innerHTML = chips.map(([cls, icone, n, texto], i) =>
    `<button class="chip ${cls}" data-chip="${i}">${icone} <b>${n}</b> ${texto}</button>`
  ).join("");
  caixa.querySelectorAll("[data-chip]").forEach(b =>
    b.addEventListener("click", () => chips[+b.dataset.chip][4]()));
}


// ── ligações da tela ──────────────────────────────────────────────────────
ligarTooltips();

$("painel").querySelectorAll(".subabas button").forEach(b =>
  b.addEventListener("click", () => {
    P.vista = b.dataset.vista;
    marcarAba($("painel").querySelectorAll(".subabas button"), x => x === b);
    // a subaba fica lembrada: quem usa o painel para vigiar abre nela
    // (a chave ficou fora da allowlist por versões a fio e isso passava em
    // silêncio — ver tests/test_config.py)
    api.set_config("painel_vista", P.vista);
    // as três vistas já estão montadas: trocar é mostrar, não recarregar —
    // antes cada clique refazia a consulta inteira ao banco
    mostrarVista();
  }));

["p-ano", "p-orgao"].forEach(id =>
  $(id).addEventListener("change", carregarPainel));

// Preenche os filtros do painel com os mesmos valores da lista — anos vindos
// do acervo, órgãos monitorados.
async function prepararPainel(estadoInicial) {
  const vista = estadoInicial?.painel_vista;
  if (vista && VISTAS[vista]) {          // VISTAS é a lista, não uma cópia
    P.vista = vista;
    marcarAba($("painel").querySelectorAll(".subabas button"),
              b => b.dataset.vista === vista);
  }
  const f = await api.filtros_disponiveis();
  const ano = $("p-ano");
  ano.length = 0;
  (f.anos ?? []).forEach(a => ano.add(new Option(`Exercício ${a}`, a)));
  if (!ano.length) ano.add(new Option(`Exercício ${new Date().getFullYear()}`, ""));
  const orgao = $("p-orgao");
  orgao.length = 1;
  (f.orgaos ?? []).forEach(o =>
    orgao.add(new Option(o.nome ?? o.cnpj, o.cnpj)));
}

// O SVG que o ECharts produz sai com largura e altura FIXAS em pixels e
// **sem viewBox** — ele desenha para a medida da tela e não sabe encolher.
// Colado num cartão de papel mais estreito, o desenho não se ajusta: ele é
// cortado. Em A3 a página era larga o bastante para o corte não aparecer;
// em A4 apareceu em quase todos os gráficos (achado no PDF real, 2026-08-14).
//
// Aqui cada SVG capturado ganha o viewBox que faltava, calculado da própria
// medida com que foi desenhado, e passa a pedir 100% da largura disponível.
// A partir daí o papel escolhe o tamanho e o vetor acompanha — que é o que
// já valia para os SVG desenhados à mão (`_svg` em relatorios.py), sempre
// nascidos com viewBox.
// Vista escondida tem largura 0, e `desenharGraficos` pula o que mede 0 —
// ela só ganha os gráficos quando o usuário a abre. Quem imprimisse logo
// depois de abrir o programa mandava três das quatro vistas SEM desenho
// nenhum: cartão com título e nota, e nada dentro. Passava despercebido
// porque quem imprime costuma ter navegado antes (achado 2026-08-14, ao
// escrever a guarda do que viaja para o papel).
//
// O ECharts desenha o SVG na largura em pixels do contêiner na hora e crava
// essa medida num `<div>` interno (`width:1625px`), que o SVG herda com
// `width:100%`. Se a captura é na tela larga do usuário (um monitor ultrawide
// dá viewBox de 2664 px) e o papel é um cartão A4 de ~480 px, o desenho não
// encolhe — o `<div>` fixo estoura o cartão e um gráfico invade o vizinho
// (PDF real, 2026-08-16: concentração por cima do deságio). Só injetar viewBox
// não resolve: `width:100%` de um pai de largura indefinida vira a largura
// intrínseca do viewBox, não a do cartão.
//
// A raiz é a LARGURA DE CAPTURA. Aqui a vista é clonada para um contêiner fora
// da tela numa largura FIXA e os gráficos são REDESENHADOS ali — o ECharts
// nasce na proporção do papel, sem herança de pixel da tela do usuário. Nada
// pisca (o clone é offscreen) e a vista visível fica intacta. O viewBox ainda
// é injetado para o vetor acompanhar a impressora.
//
// `LARGURA_PAPEL` é a largura de referência para a qual o painel foi desenhado
// (~janela de desktop comum), NÃO a largura útil do papel: nela os contêineres
// de altura fixa dos gráficos (196/220 px) rendem a proporção em que cada
// vista cabe numa página A4 paisagem. Capturar na largura exata do papel
// (~1017) deixa os gráficos altos demais e cada vista transborda para uma
// segunda página (medido 2026-08-16: 1017→9 páginas, 1400→6). O que importa é
// ser um valor FIXO, independente da janela — foi a tela ultrawide do usuário
// que gerou viewBox de 2664 e o gráfico invadiu o vizinho.
const LARGURA_PAPEL = 1400;
function paraPapel(id) {
  const palco = document.createElement("div");
  palco.style.cssText =
    `position:fixed; left:-99999px; top:0; width:${LARGURA_PAPEL}px;`;
  const copia = $(id).cloneNode(true);
  copia.classList.remove("oculto");         // precisa medir largura > 0
  copia.style.width = "100%";
  palco.appendChild(copia);
  document.body.appendChild(palco);
  try {
    // `cloneNode` copia o atributo `_echarts_instance_` que o ECharts crava no
    // elemento. Os gráficos de barra iniciam o ECharts no PRÓPRIO `.graf`
    // (não num filho novo), então o clone chega com esse atributo e o
    // `echarts.init` reusa a instância VIVA em vez de criar uma nova: desenha
    // na tela, o clone fica em branco, e pior — o `dispose` no fim mata o
    // gráfico vivo. Só acontecia na 1ª impressão (o dispose limpava o atributo
    // e a 2ª já criava instância nova): "por modalidade" saía vazio no papel
    // (PDF real, 2026-08-16). Tirar o atributo faz cada init nascer do zero,
    // preso ao clone, sem nunca tocar a tela.
    copia.querySelectorAll("[_echarts_instance_]").forEach(
      el => el.removeAttribute("_echarts_instance_"));
    copia.querySelectorAll(".graf[data-graf]").forEach(el => {
      delete el.dataset.largura;            // força o redesenho na nova largura
      el.innerHTML = "";                    // some o SVG capturado na tela
    });
    desenharGraficos(copia);                // ECharts redesenha na medida do papel
    copia.querySelectorAll("svg[width]").forEach(svg => {
      if (svg.getAttribute("viewBox")) return;      // os à mão já têm
      const l = parseFloat(svg.getAttribute("width"));
      const a = parseFloat(svg.getAttribute("height"));
      if (!l || !a) return;
      svg.setAttribute("viewBox", `0 0 ${l} ${a}`);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.setAttribute("width", "100%");
      svg.removeAttribute("height");                // a altura sai do viewBox
    });
    return copia.innerHTML;
  } finally {
    // cada instância do ECharts prende um listener de resize na window; o
    // `_iniciarEchart` guarda a instância em vários nós (`.graf`,
    // `.graf-echart`, o alvo do corte), então varre-se tudo para não vazar
    copia.querySelectorAll("*").forEach(el => el.__echart?.dispose());
    palco.remove();
  }
}

// A impressão leva as quatro vistas, cada uma numa página A4 deitada: o SVG é
// vetorial, então sai na resolução da impressora, não na da tela.
$("btn-imprimir-painel").addEventListener("click", async () => {
  if (!P.dados || !api.imprimir_painel) return;
  const botao = $("btn-imprimir-painel");
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Gerando…";
  try {
    const vistas = [["execucao", paraPapel("p-execucao")],
                    ["analise", paraPapel("p-analise")],
                    ["vigilancia", paraPapel("p-vigilancia")],
                    ["economia", paraPapel("p-economia")]];
    await api.imprimir_painel(vistas, P.dados.ano);
  } finally {
    botao.disabled = false;
    botao.textContent = rotulo;
  }
});
