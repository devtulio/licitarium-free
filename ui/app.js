// Interface do Licitarium: fala com o Python pela ponte pywebview
// (window.pywebview.api), montada em licitarium.py:Api.
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl = new Intl.NumberFormat("pt-BR", {style:"currency", currency:"BRL"});
const dinheiro = v => v == null ? "–" : brl.format(v);
// preço de unidade-base costuma ter centavos de centavo: R$ 0,0466 por folha
const brlFino = new Intl.NumberFormat("pt-BR",
  {style: "currency", currency: "BRL", minimumFractionDigits: 4,
   maximumFractionDigits: 4});
const dinheiroFino = v =>
  v == null ? "–" : (v >= 1 ? brl.format(v) : brlFino.format(v));
const dataBr = s => {
  if (!s) return "–";
  const d = String(s).slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s;
};
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// A arte da marca vem de ui/marca.js (gerado de design/*.svg): era cópia
// mantida à mão aqui e em relatorios.py, com três chances de divergir.
const ESTANDARTE = MARCA.estandarte;

// selo oficial (design/icone-t1.svg): tabula ansata com L capitular
const SELO = MARCA.selo;

const estado = { tipo:"contratacoes", pagina:1, municipio:null,
                 ord:null, dir:"desc", objetosAlvo:null };
let api = null;

// ── splash ────────────────────────────────────────────────────────────────
// Composição por tema; o tema vem na URL (o Python já o lê do banco para
// abrir a janela), então a splash nasce na cor certa, sem piscar.
const SPLASH_POR_TEMA = {
  portal: () => `<div class="cx">${SELO_SVG(60)}
    <div><div class="mark">LICITARI<b>V</b>M</div>
      <div class="linha2" id="splash-muni">Contratações públicas</div>
      <div class="barra"><i id="splash-barra"></i></div></div></div>`,
  pergaminho: () => `<div class="cx diploma">${ESTANDARTE_SVG(86)}
    <div class="mark">LICITARI<b>V</b>M</div>
    <div class="linha2" id="splash-muni">Contratações públicas</div>
    <div class="barra" style="width:100%"><i id="splash-barra"></i></div></div>`,
  observatorio: () => `<div class="pilha">
    <div class="anel">${SELO_SVG(78)}<div class="giro"></div></div>
    <div class="mark">LICITARI<b>V</b>M</div>
    <div class="divisa">svb hasta pvblica</div>
    <div class="barra" style="width:150px"><i id="splash-barra"></i></div></div>`,
  // Rótulo Civil é o portal de serviço: composição empilhada e centrada,
  // com mais respiro e a barra larga — quem abre uma vez por semana lê
  // melhor o "está carregando" do que o Portal denso resolve num canto.
  civil: () => `<div class="cx civil">${SELO_SVG(64)}
    <div class="mark">LICITARI<b>V</b>M</div>
    <div class="linha2" id="splash-muni">Contratações públicas</div>
    <div class="barra"><i id="splash-barra"></i></div></div>`,
};
const SELO_SVG = t =>
  `<svg viewBox="0 0 64 64" aria-hidden="true" style="width:${t}px;height:${t}px;flex:none">${SELO}</svg>`;
const ESTANDARTE_SVG = t =>
  `<svg viewBox="0 0 64 64" aria-hidden="true" style="width:${t}px;height:${t}px">${ESTANDARTE}</svg>`;

const splashInicio = Date.now();

// o tema fica espelhado no localStorage só para a splash nascer na cor
// certa antes de qualquer consulta; o banco segue sendo a fonte da verdade
function temaSalvo() {
  // 1) tema.js escrito pelo Python (fonte da verdade, chega antes de tudo)
  // 2) parâmetro de URL, só em teste/depuração
  // 3) localStorage, última reserva
  if (window.__TEMA) return window.__TEMA;
  const daUrl = new URLSearchParams(location.search).get("tema");
  if (daUrl) return daUrl;
  try { return localStorage.getItem("tema") || "portal"; }
  catch { return "portal"; }
}

function montarSplash() {
  const tema = temaSalvo();
  document.documentElement.dataset.theme = tema;
  $("splash").innerHTML = (SPLASH_POR_TEMA[tema] || SPLASH_POR_TEMA.portal)();
}

// a barra acompanha as etapas reais do carregamento, não um tempo inventado
function progressoSplash(fracao, texto) {
  const barra = $("splash-barra");
  if (barra) barra.style.width = `${Math.round(fracao * 100)}%`;
  if (texto && $("splash-muni")) $("splash-muni").textContent = texto;
}

function esconderSplash() {
  const splash = $("splash");
  if (!splash) return;
  progressoSplash(1);
  // piso de tempo: sem isso a splash pisca quando o acervo abre rápido
  const espera = Math.max(0, 900 - (Date.now() - splashInicio));
  setTimeout(() => {
    splash.classList.add("saindo");
    setTimeout(() => splash.remove(), 400);
  }, espera);
}
montarSplash();

// Ponte com rede de proteção. O pywebview REJEITA a promise quando o
// Python levanta, e no exe sem console o traceback não vai a lugar nenhum:
// sem isto, uma chamada que falhava deixava os números VELHOS na tela —
// marcar "corrigir pelo IPCA", a chamada falhar, e o resumo seguir
// mostrando os valores não corrigidos com a caixa marcada (auditoria de
// falha silenciosa, 2026-08-09). Um ponto só, em vez de try/catch em ~50
// call sites. Relança: quem já trata (carregarPainel) segue tratando, e
// quem não trata pelo menos aborta em vez de seguir com dado velho.
function comRede(bruta) {
  return new Proxy(bruta, {
    get(alvo, nome) {
      const metodo = alvo[nome];
      // guardas do tipo `if (api.set_config)` precisam continuar valendo
      if (typeof metodo !== "function") return metodo;
      return async (...args) => {
        try {
          return await metodo.apply(alvo, args);
        } catch (e) {
          const aviso = $("sync-msg");
          if (aviso) aviso.textContent =
            `Falha em ${String(nome)}: ${(e && e.message) || e}`;
          throw e;
        }
      };
    },
  });
}

// Preenche os ícones dos botões escritos direto no HTML. O marcador
// `data-icone` evita uma cópia do SVG no index.html: a arte continua num
// lugar só (ui/icones.js), e o HTML só diz qual quer.
function preencherIcones(raiz = document) {
  raiz.querySelectorAll("[data-icone]").forEach(el => {
    const arte = ICONE[el.dataset.icone];
    if (arte) el.innerHTML = arte;
  });
}
preencherIcones();

// ── boot ──────────────────────────────────────────────────────────────────
window.addEventListener("pywebviewready", async () => {
  api = comRede(window.pywebview.api);
  document.querySelectorAll("#svg-estandarte-wiz, #svg-estandarte-sobre")
    .forEach(s => s.innerHTML = ESTANDARTE);
  $("svg-selo").innerHTML = SELO;
  progressoSplash(0.35);
  const e = await api.get_estado();
  const temaBanco = e.tema || "portal";
  // só remonta se o tema.js não chegou (fallback): com ele, a splash já
  // nasceu certa e remontar produziria a troca de composição no meio
  if (!window.__TEMA && temaBanco !== temaSalvo() && $("splash")) {
    try { localStorage.setItem("tema", temaBanco); } catch {}
    montarSplash();
  }
  aplicarTema(temaBanco, false);
  aplicarLargura(e.largura || "compacta", false);
  aplicarFonte(e.fonte || "normal", false);
  aplicarDensidade(e.densidade || "confortavel", false);
  try { larguras = JSON.parse(e.colunas || "{}"); } catch { larguras = {}; }
  $("cfg-maximizar").checked = (e.maximizar ?? "1") === "1";
  $("sobre-versao").textContent = e.versao;
  $("rodape-versao").textContent = `PNCP · dados públicos · v${e.versao}`;
  if (!e.ibge) { iniciarWizard(); return; }
  iniciarApp(e);
});

// Aba selecionada: a classe pinta, o aria-selected conta. Sem o segundo, o
// leitor de tela anuncia N abas e nenhuma marcada — achado da auditoria de
// acessibilidade (2026-08-09). Um ponto só para as abas de topo e as
// subabas do Painel, que erravam do mesmo jeito.
function marcarAba(botoes, selecionado) {
  botoes.forEach(b => {
    const ativo = selecionado(b);
    b.classList.toggle("on", ativo);
    b.setAttribute("aria-selected", String(ativo));
  });
}

function aplicarTema(tema, salvar = true) {
  document.documentElement.dataset.theme = tema;
  try { localStorage.setItem("tema", tema); } catch { /* sem storage: ok */ }
  document.querySelectorAll(".tcard").forEach(c =>
    c.classList.toggle("on", c.dataset.tema === tema));
  if (salvar && api) api.set_config("tema", tema);
}
document.querySelectorAll(".tcard").forEach(c =>
  c.addEventListener("click", () => aplicarTema(c.dataset.tema)));

function aplicarLargura(v, salvar = true) {
  document.documentElement.dataset.largura = v;
  $("cfg-largura").value = v;
  if (salvar && api) api.set_config("largura", v);
}
$("cfg-largura").addEventListener("change",
  () => aplicarLargura($("cfg-largura").value));

function aplicarFonte(v, salvar = true) {
  document.documentElement.dataset.fonte = v;
  $("cfg-fonte").value = v;
  if (salvar && api) api.set_config("fonte", v);
}
$("cfg-fonte").addEventListener("change",
  () => aplicarFonte($("cfg-fonte").value));

function aplicarDensidade(v, salvar = true) {
  document.documentElement.dataset.densidade = v;
  $("cfg-densidade").value = v;
  if (salvar && api) api.set_config("densidade", v);
}
$("cfg-densidade").addEventListener("change",
  () => aplicarDensidade($("cfg-densidade").value));
$("btn-restaurar-colunas").addEventListener("click", restaurarLarguras);
$("cfg-maximizar").addEventListener("change", () =>
  api.set_config("maximizar", $("cfg-maximizar").checked ? "1" : "0"));

// ── wizard ────────────────────────────────────────────────────────────────
let wizEscolha = null;
function iniciarWizard() {
  esconderSplash();
  $("wizard").classList.remove("oculto");
  $("app").classList.add("oculto");
  const sel = $("wiz-uf");
  if (sel.options.length === 1)
    UFS.forEach(uf => sel.add(new Option(uf, uf)));
}
$("wiz-busca").addEventListener("input", async () => {
  wizEscolha = null; $("wiz-ok").disabled = true;
  const texto = $("wiz-busca").value.trim();
  const caixa = $("wiz-sugestoes");
  if (texto.length < 2) { caixa.classList.add("oculto"); return; }
  const achados = await api.municipios(texto, $("wiz-uf").value || null);
  caixa.innerHTML = achados.map(m =>
    `<button role="option" data-c="${m.c}" data-n="${esc(m.n)}" data-uf="${m.uf}">
       ${esc(m.n)} — ${m.uf}</button>`).join("") ||
    `<button disabled>nenhum município encontrado</button>`;
  caixa.classList.remove("oculto");
  caixa.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", () => {
      wizEscolha = { c:+b.dataset.c, n:b.dataset.n, uf:b.dataset.uf };
      $("wiz-busca").value = `${b.dataset.n} — ${b.dataset.uf}`;
      caixa.classList.add("oculto");
      $("wiz-ok").disabled = false;
    }));
});
$("wiz-ok").addEventListener("click", async () => {
  if (!wizEscolha) return;
  $("wiz-ok").disabled = true;
  $("wiz-ok").textContent = "Preparando…";
  const trocando = !!estado.municipio;
  if (trocando) {
    const r = await api.trocar_municipio(wizEscolha.c, wizEscolha.n, wizEscolha.uf);
    if (!r?.ok) {
      $("wiz-ok").disabled = false;
      $("wiz-ok").textContent = "Confirmar";
      alert(r?.erro || "Não consegui trocar o município.");
      return;
    }
  } else {
    await api.configurar_municipio(wizEscolha.c, wizEscolha.n, wizEscolha.uf);
  }
  iniciarApp(await api.get_estado());
});

// Primeiro uso numa máquina nova: quem já tinha um acervo salvo não precisa
// escolher o município e esperar o download desde 2021 pra só depois lembrar
// que existe "Restaurar cópia…" em Configurações — o backup já traz o
// município junto (é o mesmo `licitarium.db` inteiro). Mesmo fluxo do botão
// de Configurações (`importar_acervo`, sem método novo na ponte).
$("wiz-restaurar").addEventListener("click", async () => {
  const msg = $("wiz-restaurar-msg");
  msg.textContent = "Conferindo o arquivo…";
  const r = await api.importar_acervo();
  if (!r.ok) { msg.textContent = r.erro ? `Falhou: ${r.erro}` : ""; return; }
  msg.textContent = `Acervo restaurado (${(r.itens || 0).toLocaleString("pt-BR")}`
    + ` itens). Feche e abra o Licitarium para usá-lo.`;
  alert("Acervo restaurado.\n\nFeche e abra o Licitarium para carregar o "
        + "acervo restaurado.");
});

// ── app ───────────────────────────────────────────────────────────────────
async function iniciarApp(e) {
  estado.municipio = e.municipio;
  $("wizard").classList.add("oculto");
  $("app").classList.remove("oculto");
  $("sub-edicao").textContent = `Versão gratuita (${e.versao})`;
  $("sub-municipio").textContent =
    `Contratações públicas de ${e.municipio} · ${e.uf}`;
  api.set_titulo(`Licitarium Free ${e.versao} — ${e.municipio}/${e.uf}`);
  progressoSplash(0.6, `${e.municipio} · ${e.uf}`);
  mostrarUltimaSync(e.sincronizado_em);
  renderKpis(e.kpis);
  await carregarFiltros();
  progressoSplash(0.85);
  await prepararPainel(e);
  const aba = ["painel", "contratacoes", "contratos", "atas", "pca", "precos"]
               .includes(e.aba) ? e.aba : "painel";
  document.querySelector(`nav.abas button[data-tipo="${aba}"]`).click();
  esconderSplash();
  // o programa consertou algo no banco para conseguir abrir: dizer, senão o
  // usuário só descobre pelo dado que faltou
  if (e.aviso_abertura) alert(`Licitarium\n\n${e.aviso_abertura}`);
  // quem decide sincronizar é o usuário, clicando — sem sync automático
  // ao abrir (2026-09-07, mesmo comportamento que o Pretiarium Free
  // sempre teve)
  api.checar_atualizacao().then(at => {
    if (!at) return;
    const alvo = $("rodape-versao");
    const rotulo = at.auto ? `Nova versão ${esc(at.nova)} — clique para atualizar`
                           : `Nova versão ${esc(at.nova)} disponível ↗`;
    alvo.innerHTML = `<a href="#" id="link-atualizacao"
      style="color:var(--accent)">${rotulo}</a>`;
    $("link-atualizacao").addEventListener("click", async ev => {
      ev.preventDefault();
      if (!at.auto) { api.abrir_atualizacao(); return; }
      if (!confirm(`Baixar e instalar a versão ${at.nova}?\n` +
                   `O Licitarium será fechado e reaberto sozinho.`)) return;
      alvo.textContent = "Baixando atualização…";
      const r = await api.instalar_atualizacao();
      if (!r.ok) alvo.textContent = `Falha na atualização: ${r.erro}`;
    });
  });
}

function mostrarUltimaSync(iso) {
  if (!iso) { $("sync-msg").textContent = "nunca sincronizado"; return; }
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
  const hoje = new Date().toDateString() === d.toDateString();
  $("sync-msg").textContent = hoje
    ? `Sincronizado hoje às ${hora}`
    : `Sincronizado em ${d.toLocaleDateString("pt-BR")} às ${hora}`;
}

function renderKpis(k) {
  $("kpi-contratacoes").textContent =
    new Intl.NumberFormat("pt-BR").format(k.contratacoes);
  $("kpi-homologado").textContent = k.homologado_ano >= 1e6
    ? "R$ " + (k.homologado_ano / 1e6).toLocaleString("pt-BR",
        {maximumFractionDigits:1}) + " mi"
    : dinheiro(k.homologado_ano);
  $("kpi-homologado-l").textContent =
    `homologado em ${new Date().getFullYear()}`;
  $("kpi-vigentes").textContent = k.vigentes;
  const alertas = [];
  // os mesmos conceitos aparecem nos chips do Painel; até a 1.32.0 cada
  // tela usava um emoji diferente pro mesmo alerta (vencimento era ⚠ aqui
  // e ⏱ lá; proposta era ⏱ aqui e 📄 lá). Agora saem do mesmo conjunto.
  if (k.vencendo_60_contratos > 0)
    alertas.push(`<button class="chip" id="chip-vencendo-contratos">${ICONE.prazo}
      ${k.vencendo_60_contratos} contrato(s) vence(m) nos próximos 60 dias
      </button>`);
  if (k.vencendo_60_atas > 0)
    alertas.push(`<button class="chip" id="chip-vencendo-atas">${ICONE.prazo}
      ${k.vencendo_60_atas} ata(s) vence(m) nos próximos 60 dias</button>`);
  if (k.propostas_abertas > 0)
    alertas.push(`<button class="chip info" id="chip-propostas">${ICONE.proposta}
      ${k.propostas_abertas} processo(s) com propostas abertas</button>`);
  $("alertas").innerHTML = alertas.join("");
  $("alertas").classList.toggle("oculto", alertas.length === 0);
  $("chip-vencendo-contratos")?.addEventListener("click",
    () => irPara("contratos", {vencendo: true, ord: "vigencia", dir: "asc"}));
  $("chip-vencendo-atas")?.addEventListener("click",
    () => irPara("atas", {vencendo: true, ord: "vigencia", dir: "asc"}));
  $("chip-propostas")?.addEventListener("click",
    () => irPara("contratacoes", {propostas: true}));
}

async function carregarFiltros() {
  const f = await api.filtros_disponiveis();
  const preencher = (sel, itens) => {
    const atual = sel.value;
    sel.length = 1;
    itens.forEach(i => sel.add(typeof i === "object"
      ? new Option(i.nome, i.id) : new Option(i, i)));
    sel.value = atual;
  };
  preencher($("f-ano"), f.anos);
  preencher($("f-modalidade"), f.modalidades);
  preencher($("f-situacao"), f.situacoes);
  preencher($("f-orgao"),
            f.orgaos.map(o => ({nome: o.nome ?? o.cnpj, id: o.cnpj})));
  preencher($("pr-ano"), f.anos);
  preencher($("pr-orgao"),
            f.orgaos.map(o => ({nome: o.nome ?? o.cnpj, id: o.cnpj})));
  preencher($("pr-unidade"), (f.unidades ?? []).map(
    u => ({nome: `${u.nome} (${u.n})`, id: u.nome})));
}

function filtrosAtuais() {
  return { ano: $("f-ano").value || null,
           modalidade: $("f-modalidade").value || null,
           situacao: $("f-situacao").value || null,
           orgao: $("f-orgao").value || null,
           propostas: $("f-propostas").checked || null,
           vigentes: $("f-vigentes").checked || null,
           vencendo: $("f-vence60").checked || null,
           parada: $("f-parada").checked || null,
           busca: $("f-busca").value.trim() || null,
           // vindo de um alerta do Painel: quais objetos, não qual caixa
           objetos: estado.objetosAlvo || null,
           ord: estado.ord, dir: estado.dir };
}

// [rótulo, chave de ordenação na whitelist do backend — null = não ordenável]
const CAMPOS_FILTRO = ["f-ano", "f-modalidade", "f-situacao", "f-orgao",
                       "f-busca"];
const CAIXAS_FILTRO = ["f-propostas", "f-vigentes", "f-vence60", "f-parada"];

function temFiltroAtivo() {
  return CAMPOS_FILTRO.some(id => $(id).value)
      || CAIXAS_FILTRO.some(id => $(id).checked)
      || !!estado.objetosAlvo;
}

function limparFiltros() {
  CAMPOS_FILTRO.forEach(id => $(id).value = "");
  CAIXAS_FILTRO.forEach(id => $(id).checked = false);
  estado.objetosAlvo = null;
  estado.pagina = 1;
  carregarLista();
}
$("btn-limpar").addEventListener("click", limparFiltros);

const COLUNAS = {
  contratacoes: [["Número","numero"], ["Modalidade","modalidade"],
                 ["Objeto","objeto"], ["Valor","valor"],
                 ["Situação","situacao"]],
  contratos:    [["Contrato","numero"], ["Objeto / Fornecedor","objeto"],
                 ["Vigência inicial","vigencia_inicio"],
                 ["Vigência final","vigencia_fim"], ["Status","status"],
                 ["Valor","valor"]],
  atas:         [["Ata","numero"], ["Contratação de origem","origem"],
                 ["Objeto","objeto"], ["Vigência inicial","vigencia_inicio"],
                 ["Vigência final","vigencia_fim"], ["Status","status"]],
  pca:          [["Item","item"], ["Descrição","descricao"],
                 ["Categoria","categoria"], ["Qtde","quantidade"],
                 ["Valor","valor"]],
};

// Sufixo societário não identifica ninguém e come metade da coluna:
// "STARMEDICAL ... LTDA -EPP" vira "STARMEDICAL ...". O nome íntegro fica
// no tooltip, no detalhe e nos relatórios.
const SUFIXO_SOCIETARIO =
  /[\s,.\-–]*\b(LTDA|LIMITADA|ME|EPP|EIRELI|MEI|S\/A|S\.?\s?A\.?|SA|CIA|EI)\b\.?\s*$/i;

function fornecedorCurto(nome) {
  if (!nome) return "–";
  let s = String(nome).trim();
  for (let i = 0; i < 4 && SUFIXO_SOCIETARIO.test(s); i++)
    s = s.replace(SUFIXO_SOCIETARIO, "").trim();
  return s || String(nome).trim();
}

// nº do contrato no padrão numero/ano (PNCP grava "0033/26" — normaliza
// para 33/2026 usando o ano de 4 dígitos)
function numContrato(d) {
  if (!d.numero_contrato) return d.numero_controle;
  const m = String(d.numero_contrato).match(/^0*(\d+)/);
  const n = m ? m[1] : d.numero_contrato;
  return d.ano_contrato ? `${n}/${d.ano_contrato}` : String(n);
}

function badgeSituacao(s) {
  if (!s) return `<span class="badge mut">–</span>`;
  const cl = /homolog/i.test(s) ? "ok" : /divulgad|aberta|andamento/i.test(s)
    ? "warn" : "mut";
  // "Divulgada no PNCP" -> "Divulgada" (o contexto todo é o PNCP)
  const curto = String(s).replace(/\s+no\s+PNCP$/i, "");
  return `<span class="badge ${cl}" title="${esc(s)}">${esc(curto)}</span>`;
}

// Situação da vigência de contratos e atas. O limiar de 60 dias é o mesmo
// do chip de alerta e do KPI do topo — dois números diferentes para "vence
// logo" na mesma tela confundiriam mais do que ajudariam.
const DIAS_VENCENDO = 60;

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    + `-${String(d.getDate()).padStart(2, "0")}`;
}

function statusVigencia(fim) {
  if (!fim) return null;              // registro sem vigência: nada a dizer
  const dia = String(fim).slice(0, 10);
  const hoje = hojeISO();
  // comparação entre datas ISO é textual de propósito: `new Date("2026-01-01")`
  // é lido como meia-noite UTC e, no nosso fuso, cai no dia anterior
  if (dia < hoje) return { cl: "err", txt: "Encerrado" };
  const dias = Math.round(
    (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 864e5);
  if (dias <= DIAS_VENCENDO)
    return { cl: "warn", txt: dias === 0 ? "Vence hoje" : `Vence em ${dias} d` };
  return { cl: "ok", txt: "Vigente" };
}

// a cor sozinha não informa (daltonismo, impressão em preto e branco): o selo
// leva sempre o texto do estado, e a data completa fica no title — coluna
// própria (achado 2026-08-12: vigência inicial/final e status separados)
function celulaStatusVigencia(d) {
  const s = statusVigencia(d.vigencia_fim);
  if (!s) return `<span class="dim">–</span>`;
  return `<span class="badge ${s.cl}" title="Vigência até `
    + `${dataBr(d.vigencia_fim)}">${s.txt}</span>`;
}

// valor da contratação: homologado é definitivo, estimado é estimativa —
// exibir os dois igual faria um processo em andamento parecer fechado
function valorContratacao(d) {
  if (d.valor_homologado != null) return dinheiro(d.valor_homologado);
  if (d.valor_estimado != null)
    return `<span class="est" title="Valor estimado — sem homologação
      registrada no PNCP">${dinheiro(d.valor_estimado)} <small>est.</small></span>`;
  return "–";
}

function renderLinha(tipo, d) {
  if (tipo === "contratacoes")
    return `<span class="dim">${d.sequencial ?? "–"}/${d.ano ?? ""}</span>
      <span class="dim">${esc(d.modalidade_nome ?? "–")}</span>
      <span class="obj">${esc(d.objeto ?? "–")}</span>
      <span class="num">${valorContratacao(d)}</span>
      <span style="justify-self:center">${badgeSituacao(d.situacao)}</span>`;
  if (tipo === "contratos")
    return `<span class="dim">${esc(numContrato(d))}</span>
      <span><span class="obj" title="${esc(d.objeto ?? "")}">${
        esc(d.objeto ?? "–")}</span><br>
        <span class="dim" title="${esc(d.fornecedor_nome ?? "")}">${
          esc(d.fornecedor_nome ?? "")}</span></span>
      <span class="dim">${dataBr(d.vigencia_inicio)}</span>
      <span class="dim">${dataBr(d.vigencia_fim)}</span>
      <span>${celulaStatusVigencia(d)}</span>
      <span class="num">${dinheiro(d.valor_global)}</span>`;
  if (tipo === "pca")
    return `<span class="dim">${esc(d.numero_item)}</span>
      <span class="obj">${esc(d.descricao ?? "–")}</span>
      <span class="dim">${esc(d.categoria ?? "–")}</span>
      <span class="num">${d.quantidade ?? "–"}</span>
      <span class="num">${dinheiro(d.valor_total)}</span>`;
  return `<span class="dim">${esc(d.numero_ata ?? "–")}/${esc(d.ano_ata ?? "")}</span>
    <span class="dim">${esc(d.contratacao_controle ?? "–")}</span>
    <span class="obj">${esc(d.objeto ?? "–")}</span>
    <span class="dim">${dataBr(d.vigencia_inicio)}</span>
    <span class="dim">${dataBr(d.vigencia_fim)}</span>
    <span>${celulaStatusVigencia(d)}</span>`;
}

// paleta fixa do papel — mesma paleta que relatorios.py usa no documento
// impresso (SERIE_DOCUMENTO), independente do tema ativo na tela. Achado
// 2026-08-13: gráfico ECharts capturado pro papel herdava o tema da tela
// (Pergaminho/Observatório nunca validados pra fundo branco do PDF).
const PALETA_PAPEL = {
  "--s1": "#2a78d6", "--s2": "#eb6834",
  "--erro": "#a6231b", "--warn": "#7a5c0e",
  "--muted": "#5b6066", "--border": "#d3d6da",
};
function _corTemaEchart(nome, fallback, paraImpressao) {
  if (paraImpressao) return PALETA_PAPEL[nome] || fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || fallback;
}

// Barra horizontal — mesmo contrato de relatorios.py:_grafico_barras /
// ui/painel.js:grafBarras: rótulo acima, valor (+ sub-rótulo opcional) no
// fim da barra, ordem de entrada preservada (quem ordena é dados_painel).
// Usado nos 4 gráficos de Economia e no "por modalidade" do Executivo —
// achado 2026-08-11: Economia/Executivo nunca tiveram vista na tela, iam
// direto do banco pro papel; ganham motor aqui como Preços já ganhou.
// Fonte declarada de propósito, e não herdada: o ECharts reserva espaço
// medindo o texto, e sem `fontFamily` ele mede com a sans-serif padrão e
// desenha com outra — a reserva saía curta e o rótulo era cortado pela
// borda. No caminho impresso ela ainda pina a fonte dentro do SVG
// capturado, que vai parar num documento com CSS próprio.
const FONTE_GRAFICO = "'Public Sans', system-ui, -apple-system, sans-serif";

function _larguraTextoGrafico(txt, px) {
  const ctx = (_larguraTextoGrafico._ctx ??=
    document.createElement("canvas").getContext("2d"));
  ctx.font = `${px}px ${FONTE_GRAFICO}`;
  return ctx.measureText(txt).width;
}

function desenharBarrasEcharts(el, itens, { valor, rotulo, sub }) {
  if (!window.echarts || !itens || !itens.length) { el.innerHTML = ""; return; }
  const s1 = _corTemaEchart("--s1", "#2a78d6", true), muted = _corTemaEchart("--muted", "#5b6066", true);
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  const chart = echarts.init(el, { textStyle: { fontFamily: FONTE_GRAFICO } },
                             { renderer: "svg" });
  el.__echart = chart;
  el.style.height = Math.max(120, itens.length * 36 + 30) + "px";
  const rotulosValor = itens.map(
    it => compacto(valor(it)) + (sub ? " · " + sub(it) : ""));
  // `containLabel` não conta o rótulo de série: a margem direita precisa
  // caber o mais largo deles, senão "· 4 processos" sai pela borda
  const folgaDireita = Math.ceil(Math.max(
    ...rotulosValor.map(t => _larguraTextoGrafico(t, 11)))) + 8;
  const larguraRotulo = Math.max(
    64, Math.floor((el.clientWidth - folgaDireita) * 0.62));
  chart.setOption({
    animation: false,
    grid: { left: 4, right: folgaDireita, top: 8, bottom: 8,
            containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: itens.map(it => rotulo(it) ?? "–"),
      axisLine: { show: false }, axisTick: { show: false },
      // sem teto, rótulo comprido engole a área de plotagem inteira
      axisLabel: { color: muted, fontSize: 11, width: larguraRotulo,
                   overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 17,
      data: itens.map((it, i) => ({ value: valor(it) || 0,
        _rotuloValor: rotulosValor[i],
        itemStyle: { color: s1, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: muted, fontSize: 11,
        formatter: p => p.data._rotuloValor } }]
  });
}

// Colunas pareadas estimado (claro) × homologado (cheio) por mês — mesmo
// contrato de relatorios.py:_grafico_meses / ui/painel.js:grafMeses.
function desenharColunasEcharts(el, meses, corVar) {
  if (!window.echarts || !meses) { el.innerHTML = ""; return; }
  const s1 = _corTemaEchart(corVar || "--s1", "#2a78d6", true),
    muted = _corTemaEchart("--muted", "#5b6066", true),
    border = _corTemaEchart("--border", "#d3d6da", true);
  const hoje = new Date().getMonth() + 1;
  let ultimo = 0;
  meses.forEach((m, i) => { if (m.valor || m.estimado) ultimo = i + 1; });
  const dados = meses.slice(0, Math.max(ultimo, hoje));
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  const chart = echarts.init(el, null, { renderer: "svg" });
  el.__echart = chart;
  el.style.height = "220px";
  chart.setOption({
    animation: false,
    grid: { left: 8, right: 8, top: 10, bottom: 26, containLabel: true },
    xAxis: { type: "category", data: dados.map(m => MES[m.mes - 1]),
      axisLine: { lineStyle: { color: border } },
      axisLabel: { color: muted, fontSize: 11 } },
    yAxis: { type: "value",
      axisLabel: { color: muted, fontSize: 11,
        formatter: v => compacto(v).replace("R$ ", "") },
      splitLine: { lineStyle: { color: border, opacity: .4 } } },
    tooltip: { trigger: "axis", backgroundColor: "#17181a", borderWidth: 0,
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: ps => {
        const m = dados[ps[0].dataIndex];
        return `<b>${MES[m.mes - 1]}</b><br/>Estimado ${compacto(m.estimado)}` +
          `<br/>Homologado ${compacto(m.valor)}`;
      } },
    series: [
      { name: "Estimado", type: "bar", data: dados.map(m => m.estimado || 0),
        itemStyle: { color: s1, opacity: .32, borderRadius: [4, 4, 0, 0] } },
      { name: "Homologado", type: "bar", data: dados.map(m => m.valor || 0),
        itemStyle: { color: s1, borderRadius: [4, 4, 0, 0] } }
    ]
  });
}

// ── largura das colunas: arrastar ajusta, duplo clique dá autofit ─────────
// A coluna elástica de cada aba (objeto/descrição) absorve a sobra e por
// isso não tem alça: alargar qualquer outra encolhe ela, que é o que se
// espera ao puxar "fornecedor" para ver o nome inteiro.
const COL_FLEX = { contratacoes:2, contratos:1, atas:2, pca:1 };
const LARGURA_MIN = 44;
const FLEX_MIN = 170;       // espaço que a coluna elástica nunca cede
let larguras = {};

function larguraAtualPx() {
  const cab = document.querySelector(".lista .cab");
  if (!cab) return [];
  return getComputedStyle(cab).gridTemplateColumns.split(" ").map(parseFloat);
}

function colunasDe(tipo) {
  return COLUNAS[tipo];
}

function chaveLarguras(tipo) {
  return tipo;
}

function aplicarLarguras(tipo) {
  const lista = $("lista");
  const chave = chaveLarguras(tipo);
  const mapa = larguras[chave];
  if (!mapa) { lista.style.removeProperty("--cols"); return; }
  const flex = COL_FLEX[tipo];
  const n = colunasDe(tipo).length;
  // larguras guardadas antes de a aba ganhar (ou perder) uma coluna não
  // servem: faltando uma, o grid receberia "NaNpx" e quebraria a lista
  for (let i = 0; i < n; i++)
    if (i !== flex && !(mapa[i] > 0)) {
      delete larguras[chave];
      lista.style.removeProperty("--cols");
      return;
    }
  const cols = [];
  for (let i = 0; i < n; i++)
    cols.push(i === flex ? "minmax(0,1fr)" : `${Math.round(mapa[i])}px`);
  lista.style.setProperty("--cols", cols.join(" "));
}

function guardarLarguras(tipo, px) {
  const flex = COL_FLEX[tipo];
  const chave = chaveLarguras(tipo);
  larguras[chave] = {};
  px.forEach((v, i) => { if (i !== flex) larguras[chave][i] = v; });
}

function autofit(tipo, i) {
  const celulas = [...document.querySelectorAll(".lista .linha:not(.cab)")]
    .map(l => l.children[i]).filter(Boolean);
  const desejada = Math.max(...celulas.map(c => c.scrollWidth),
                            LARGURA_MIN) + 26;   // respiro do padding
  const px = larguraAtualPx();
  const flex = COL_FLEX[tipo];
  // não deixar o autofit engolir a coluna elástica: ela guarda um mínimo
  // referência é a soma das colunas atuais (já desconta padding e vãos,
  // que o clientWidth do container incluiria por engano)
  const outras = px.reduce((s, v, j) => (j === i || j === flex) ? s : s + v, 0);
  const teto = px.reduce((s, v) => s + v, 0) - outras - FLEX_MIN;
  px[i] = Math.max(LARGURA_MIN, Math.min(desejada, teto));
  guardarLarguras(tipo, px);
  aplicarLarguras(tipo);
  api.set_config("colunas", JSON.stringify(larguras));
}

function ligarAlcas() {
  const tipo = estado.tipo;
  const flex = COL_FLEX[tipo];
  document.querySelectorAll(".lista .cab > span").forEach((cel, i) => {
    if (i === flex || i === colunasDe(tipo).length - 1) return;  // última não
    const alca = document.createElement("span");
    alca.className = "alca";
    alca.title = "Arraste para ajustar · duplo clique para caber no conteúdo";
    alca.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, px = larguraAtualPx(), inicial = px[i];
      document.body.classList.add("redimensionando");
      const flex = COL_FLEX[tipo];
      const outras = px.reduce(
        (s, v, j) => (j === i || j === flex) ? s : s + v, 0);
      const teto = px.reduce((s, v) => s + v, 0) - outras - FLEX_MIN;
      const mover = ev => {
        px[i] = Math.max(LARGURA_MIN,
                         Math.min(inicial + (ev.clientX - x0), teto));
        guardarLarguras(tipo, px);
        aplicarLarguras(tipo);
      };
      const soltar = () => {
        document.removeEventListener("mousemove", mover);
        document.removeEventListener("mouseup", soltar);
        document.body.classList.remove("redimensionando");
        api.set_config("colunas", JSON.stringify(larguras));
      };
      document.addEventListener("mousemove", mover);
      document.addEventListener("mouseup", soltar);
    });
    // o clique precisa morrer aqui: o cabeçalho ordena, e ordenar
    // re-renderiza a lista no meio do arrasto/duplo clique
    alca.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
    });
    alca.addEventListener("dblclick", e => {
      e.preventDefault(); e.stopPropagation();
      autofit(tipo, i);
    });
    cel.appendChild(alca);
  });
}

function restaurarLarguras() {
  larguras = {};
  aplicarLarguras(estado.tipo);
  if (api) api.set_config("colunas", "{}");
}

async function carregarLista() {
  const r = await api.listar(estado.tipo, filtrosAtuais(), estado.pagina);
  const g = `g-${estado.tipo}`;
  const cab = `<div class="linha cab ${g}">` +
    colunasDe(estado.tipo).map(([rotulo, chave]) => {
      const ativa = chave && estado.ord === chave;
      const seta = ativa ? `<span class="seta">${estado.dir === "asc" ? "▲" : "▼"}</span>` : "";
      const sort = chave ? ` data-ord="${chave}" role="button" tabindex="0"
        aria-sort="${ativa ? (estado.dir === "asc" ? "ascending" : "descending") : "none"}"` : "";
      return `<span${sort}>${rotulo} ${seta}</span>`;
    }).join("") + `</div>`;
  const linhas = r.itens.map(d => {
    const nc = esc(d.numero_controle ?? d.id);
    return `<button class="linha ${g}" data-nc="${nc}">`
      + renderLinha(estado.tipo, d) + `</button>`;
  }).join("");
  const comFiltro = temFiltroAtivo();
  $("btn-limpar").classList.toggle("oculto", !comFiltro);
  $("filtro-alerta").classList.toggle("oculto", !estado.objetosAlvo);
  const vazio = comFiltro
    ? `<div class="vazio"><svg viewBox="0 0 64 64" aria-hidden="true">${SELO}</svg>
        <p>Nenhum registro para estes filtros.</p>
        <button class="btn ghost" id="vazio-limpar">✕ Limpar filtros</button></div>`
    : `<div class="vazio"><svg viewBox="0 0 64 64" aria-hidden="true">${SELO}</svg>
        <p>Nada neste acervo ainda.<br>Sincronize para baixar o que o município
        publicou no PNCP.</p>
        <button class="btn" id="vazio-sync">Sincronizar agora</button></div>`;
  $("lista").innerHTML = cab + (linhas || vazio);
  aplicarLarguras(estado.tipo);
  ligarAlcas();
  $("vazio-limpar")?.addEventListener("click", limparFiltros);
  $("vazio-sync")?.addEventListener("click", () => api.sincronizar());
  $("lista").querySelectorAll(".linha[data-nc]").forEach(b =>
    b.addEventListener("click", () => abrirDetalhe(b.dataset.nc)));
  $("lista").querySelectorAll(".cab span[data-ord]").forEach(s => {
    const ordenar = () => {
      const chave = s.dataset.ord;
      if (estado.ord === chave) estado.dir = estado.dir === "asc" ? "desc" : "asc";
      else { estado.ord = chave; estado.dir = "asc"; }
      estado.pagina = 1;
      carregarLista();
    };
    s.addEventListener("click", ordenar);
    s.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ordenar(); }
    });
  });
  const paginas = Math.max(1, Math.ceil(r.total / 50));
  $("pag-info").textContent = `${estado.pagina}/${paginas} · ${r.total} registros`;
  $("pag-ant").disabled = estado.pagina <= 1;
  $("pag-prox").disabled = estado.pagina >= paginas;
}

// Estado de aba/visibilidade só, sem consultar o banco — quem chama decide
// se busca a lista ou o painel. Existir separado é o que permite ao clique
// num alerta do Painel montar o filtro inteiro ANTES da única consulta, em
// vez de duas chamadas concorrentes disputando qual pinta a tela por último
// (a de trás, sem filtro nenhum, ganhava a corrida às vezes).
function mudarAba(tipo) {
  marcarAba(document.querySelectorAll("nav.abas button"),
            x => x.dataset.tipo === tipo);
  estado.tipo = tipo;
  estado.pagina = 1;
  // Painel e Preços não são a lista genérica: cada um troca a tela inteira
  // em vez das colunas, e esconde o rodapé/filtros/KPIs da lista.
  const ehPainel = tipo === "painel";
  const ehPrecos = tipo === "precos";
  const semLista = ehPainel || ehPrecos;
  $("painel").classList.toggle("oculto", !ehPainel);
  $("tela-precos").classList.toggle("oculto", !ehPrecos);
  for (const id of ["filtros-lista", "lista", "rodape-lista", "kpis-topo"])
    $(id)?.classList.toggle("oculto", semLista);
  // os alertas do topo pertencem às listas: fora delas ficam escondidos
  if (semLista) $("alertas").classList.add("oculto");
  else if ($("alertas").innerHTML.trim()) $("alertas").classList.remove("oculto");
  if (api.set_config) api.set_config("aba", tipo);
  if (semLista) return;
  estado.ord = null; estado.dir = "desc";
  estado.objetosAlvo = null;
  const soContratacoes = tipo === "contratacoes";
  $("f-modalidade").classList.toggle("oculto", !soContratacoes);
  $("f-situacao").classList.toggle("oculto", !soContratacoes);
  $("cx-propostas").classList.toggle("oculto", !soContratacoes);
  $("cx-parada").classList.toggle("oculto", !soContratacoes);
  const ehVigencia = ["contratos", "atas"].includes(tipo);
  $("cx-vigentes").classList.toggle("oculto", !ehVigencia);
  $("cx-vence60").classList.toggle("oculto", !ehVigencia);
  $("f-busca").placeholder = "Buscar no objeto…";
  $("f-propostas").checked = false;
  $("f-vigentes").checked = false;
  $("f-vence60").checked = false;
  $("f-parada").checked = false;
}

document.querySelectorAll("nav.abas button").forEach(b =>
  b.addEventListener("click", () => {
    mudarAba(b.dataset.tipo);
    if (estado.tipo === "painel") carregarPainel();
    else if (estado.tipo === "precos") carregarPrecos();
    else carregarLista();
  }));
["f-propostas", "f-vigentes", "f-vence60", "f-parada"].forEach(id =>
  $(id).addEventListener("change",
    () => { estado.pagina = 1; carregarLista(); }));

// navegação programática (KPIs e alertas). Cada campo é sempre escrito, não
// só quando presente em `ajustes` — meio-termo já rendeu bug: o alerta de
// limite mandava a modalidade e ela nunca chegava a ser lida, porque o
// clique na aba resetava só propostas/vigentes e o resto ficava do jeito
// que a navegação anterior tinha deixado.
function irPara(tipo, ajustes = {}) {
  mudarAba(tipo);
  $("f-ano").value = ajustes.ano ?? "";
  $("f-modalidade").value = ajustes.modalidade ?? "";
  $("f-situacao").value = ajustes.situacao ?? "";
  $("f-orgao").value = ajustes.orgao ?? "";
  $("f-propostas").checked = !!ajustes.propostas;
  $("f-vigentes").checked = !!ajustes.vigentes;
  $("f-vence60").checked = !!ajustes.vencendo;
  $("f-parada").checked = !!ajustes.parada;
  estado.objetosAlvo = ajustes.objetos || null;
  if (ajustes.ord) { estado.ord = ajustes.ord; estado.dir = ajustes.dir || "asc"; }
  carregarLista();
}
$("kpi-card-contratacoes").addEventListener("click", () => irPara("contratacoes"));
$("kpi-card-homologado").addEventListener("click",
  () => irPara("contratacoes", {ano: String(new Date().getFullYear())}));
$("kpi-card-vigentes").addEventListener("click",
  () => irPara("contratos", {vigentes: true, ord: "vigencia", dir: "asc"}));
["f-ano","f-modalidade","f-situacao","f-orgao"].forEach(id =>
  $(id).addEventListener("change", () => { estado.pagina = 1; carregarLista(); }));
let buscaTimer;
$("f-busca").addEventListener("input", () => {
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(() => { estado.pagina = 1; carregarLista(); }, 300);
});
$("pag-ant").addEventListener("click", () => {
  estado.pagina--; carregarLista(); });
$("pag-prox").addEventListener("click", () => {
  estado.pagina++; carregarLista(); });

// ── detalhe ───────────────────────────────────────────────────────────────
const ROTULOS = {
  unidade:"Unidade", material_servico:"Tipo",
  valor_unitario_estimado:"Valor unitário estimado",
  valor_unitario_homologado:"Valor unitário homologado",
  valor_total_homologado:"Valor total homologado",
  quantidade_homologada:"Quantidade homologada",
  fornecedor_porte:"Porte do fornecedor", data_resultado:"Data do resultado",
  numero_ata:"Ata nº", ano_ata:"Ano da ata",
  numero_contrato:"Contrato nº", ano_contrato:"Ano do contrato",
  numero_item:"Item nº", categoria:"Categoria", grupo:"Grupo de contratação",
  quantidade:"Quantidade estimada", valor_total:"Valor total",
  id_pca:"Plano (id PNCP)", ano:"Ano",
  modalidade_nome:"Modalidade", situacao:"Situação", orgao_nome:"Órgão",
  valor_estimado:"Valor estimado",
  valor_homologado:"Valor homologado", valor_global:"Valor global",
  fornecedor_nome:"Fornecedor", fornecedor_ni:"CNPJ/CPF fornecedor",
  data_publicacao:"Publicação", data_atualizacao:"Última atualização",
  vigencia_inicio:"Início da vigência", vigencia_fim:"Fim da vigência",
  contratacao_controle:"Contratação de origem", orgao_cnpj:"CNPJ do órgão",
};
function jsonColorido(obj) {
  // escapa só &, < e > (aspas precisam sobreviver para o tokenizador)
  const json = JSON.stringify(obj, null, 2)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return json.replace(
    /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, chave, str, bool, nulo) => {
      const cls = chave ? "j-chave" : str ? "j-str" : bool ? "j-bool"
                : nulo ? "j-null" : "j-num";
      return `<span class="${cls}">${m}</span>`;
    });
}

// número de controle de uma contratação: CNPJ-1-SEQUENCIAL/ANO (mesmo
// formato que Api.abrir_pncp usa pro link de edital) — dá pra montar o
// link direto no JS, sem chamada nova à ponte pywebview
function linkPncpContratacao(numeroControle) {
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(numeroControle || "");
  if (!m) return null;
  const [, cnpj, seq, ano] = m;
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${parseInt(seq, 10)}`;
}

let detalheAtual = null;
let detalheDados = null;
async function abrirDetalhe(nc) {
  const d = await api.detalhe(estado.tipo, nc);
  if (!d) return;
  detalheAtual = nc;
  detalheDados = d;
  $("det-titulo").textContent = d.objeto || d.descricao || d.numero_controle || d.id;
  $("det-sub").textContent = d.numero_controle || d.id_pca || "";
  $("det-pncp").classList.toggle("oculto", estado.tipo === "pca");
  $("det-meta").innerHTML = Object.entries(ROTULOS)
    .filter(([campo]) => d[campo] != null && d[campo] !== "")
    .map(([campo, rotulo]) => {
      let v = d[campo];
      if (campo.startsWith("valor")) v = dinheiro(v);
      else if (campo === "numero_contrato") v = numContrato(d);
      else if (/^(data|vigencia)/.test(campo)) v = dataBr(v);
      return `<div><div class="k">${rotulo}</div><div class="v">${esc(v)}</div></div>`;
    }).join("");
  $("det-raw").innerHTML = jsonColorido(d.raw);
  abrirModal("veu-detalhe");
}
$("det-pncp").addEventListener("click", () =>
  api.abrir_pncp(estado.tipo, detalheAtual));
// pedido do usuário (2026-08-12): na ficha impressa, "Contratação de
// origem" vira link pro edital no PNCP — só na impressão, não na tela:
// um <a href> de verdade dentro da modal pywebview navegaria a própria
// janela do app pra fora dele (o padrão do resto do app é sempre abrir
// no navegador via Api.abrir_pncp, nunca um link cru na tela)
function metaParaImpressao() {
  const clone = $("det-meta").cloneNode(true);
  const link = linkPncpContratacao(detalheDados?.contratacao_controle);
  if (link) {
    const chave = [...clone.querySelectorAll(".k")]
      .find(k => k.textContent === "Contratação de origem");
    const valor = chave?.nextElementSibling;
    if (valor) valor.innerHTML = `<a href="${esc(link)}">${esc(valor.textContent)}</a>`;
  }
  return clone.innerHTML;
}
$("det-imprimir").addEventListener("click", () =>
  api.imprimir_detalhe(estado.tipo, detalheAtual,
    $("det-titulo").textContent, $("det-sub").textContent,
    metaParaImpressao(), $("det-raw").innerHTML));

// ── montador de minuta do PCA ─────────────────────────────────────────────
$("btn-pca").addEventListener("click", async () => {
  const anos = await api.anos_com_itens();
  const sel = $("pca-ano");
  if (!sel.options.length) {
    const proximo = (anos.length ? Math.max(...anos) : new Date().getFullYear()) + 1;
    for (let a = proximo; a >= proximo - 2; a--) sel.add(new Option(a, a));
  }
  if (!anos.length) {
    $("pca-status").textContent =
      "Sincronize os itens antes: a minuta vem do que já foi contratado.";
  }
  await carregarMinuta();
  abrirModal("veu-pca");
});

function parametrosPca() {
  return {
    base: $("pca-base").value,
    estatistica: $("pca-estatistica").value,
    margem: parseFloat($("pca-margem").value) || 0,
    palavras: +$("pca-palavras").value,
    so_recorrentes: $("pca-recorrentes").checked,
    corrigir_ipca: $("pca-ipca").checked,
  };
}

$("pca-gerar").addEventListener("click", async () => {
  $("pca-gerar").disabled = true;
  $("pca-status").textContent = "Consolidando o histórico…";
  const r = await api.gerar_minuta_pca(+$("pca-ano").value, parametrosPca());
  $("pca-gerar").disabled = false;
  $("pca-status").textContent = r.ok
    ? `${r.grupos} grupos gerados · ajustes manuais foram preservados`
    : `Falha: ${r.erro}`;
  await carregarMinuta();
});

$("pca-ano").addEventListener("change", carregarMinuta);

let familiaFiltro = null;      // família selecionada na revisão em 2 níveis
let selecionados = new Set();  // itens marcados para mesclar

// comparar às cegas com o ano passado é o jeito mais rápido de achar item
// fora da curva na revisão — mostrado só quando o desvio é relevante
function deltaPca(atual, anterior) {
  if (!anterior) return "";
  const variacao = (atual - anterior) / anterior;
  if (Math.abs(variacao) < 0.1) return "";
  const sinal = variacao > 0 ? "▲" : "▼";
  const classe = variacao > 0 ? "tag-alta" : "tag-baixa";
  return `<span class="tag-unico ${classe}" title="Era ${dinheiro(anterior)}
      no plano do ano passado">${sinal} ${Math.round(Math.abs(variacao) * 100)}%
      vs. ano passado</span>`;
}

async function carregarMinuta() {
  const dados = await api.listar_minuta_pca(+$("pca-ano").value);
  const t = dados.totais;
  // chips de família: revisar 1.500 linhas soltas é inviável; por família,
  // o gestor ataca PNEU, FILTRO, PAPEL… um bloco de cada vez
  const familias = dados.familias || [];
  $("pca-familias").innerHTML = familias.length > 1 ? [
    `<button data-familia="" class="${familiaFiltro ? "" : "on"}">Todas
       <small>${dados.itens.length}</small></button>`,
    ...familias.slice(0, 40).map(f =>
      `<button data-familia="${esc(f.familia)}"
        class="${familiaFiltro === f.familia ? "on" : ""}"
        title="${dinheiro(f.valor)}">${esc(f.familia)}
        <small>${f.itens}</small></button>`)].join("") : "";
  $("pca-familias").querySelectorAll("button").forEach(b =>
    b.addEventListener("click", () => {
      familiaFiltro = b.dataset.familia || null;
      carregarMinuta();
    }));
  const classeA = dados.itens.filter(i => i.abc === "A").length;
  const p = dados.parametros || {};
  $("pca-totais").innerHTML = dados.itens.length
    ? `<b>${t.grupos}</b> itens no plano · <b>${dinheiro(t.valor)}</b>
       ${classeA ? ` · <b>${classeA}</b> itens classe A concentram 80% do valor` : ""}
       ${t.excluidos ? ` · ${t.excluidos} excluído(s)` : ""}
       ${dados.gerado_em ? ` · gerado em ${dataBr(dados.gerado_em)}` : ""}
       ${p.ipca_ate ? ` · preços a valor de ${dataBr(p.ipca_ate + "-01")}
         pelo IPCA (${p.precos_corrigidos} de ${p.total_precos} corrigidos)`
         : (p.corrigir_ipca === false ? "" :
            " · sem série do IPCA sincronizada ainda: preços sem correção")}`
    : `Nenhuma minuta para este exercício — ajuste os parâmetros e clique em
       <b>Gerar</b>.`;
  const cab = `<div class="linha cab g-pca-minuta">
      <span title="Selecionar para mesclar">⚯</span>
      <span title="Incluir no plano">✓</span>
      <span title="Curva ABC: A concentra 80% do valor">ABC</span>
      <span>Descrição</span>
      <span>Unid.</span><span class="num">Quantidade</span>
      <span class="num">Unitário</span><span class="num">Margem</span>
      <span class="num">Total</span></div>`;
  const visiveis = familiaFiltro
    ? dados.itens.filter(i => i.familia === familiaFiltro) : dados.itens;
  const linhas = visiveis.map(i => `
    <div class="linha g-pca-minuta" data-id="${i.id}">
      <span><input type="checkbox" data-sel="${i.id}"
        ${selecionados.has(i.id) ? "checked" : ""}
        aria-label="Selecionar para mesclar"></span>
      <span><input type="checkbox" data-campo="incluir"
        ${i.incluir ? "checked" : ""} aria-label="Incluir"></span>
      <span><span class="abc abc-${i.abc || "C"}"
        title="Classe ${i.abc || "C"}">${i.abc || "C"}</span></span>
      <span><input type="text" data-campo="descricao"
        value="${esc(i.descricao ?? "")}">
        ${i.origem && i.origem.recorrente === false
          ? '<span class="tag-unico" title="Contratado uma única vez: confira se cabe no plano">OCORRÊNCIA ÚNICA</span>' : ""}
        ${i.origem && i.origem.preco_disperso
          ? `<span class="tag-unico" title="Preços do grupo variam de
              ${dinheiro(i.origem.preco_min)} a ${dinheiro(i.origem.preco_max)}:
              provável lote lançado como item">PREÇO DISPERSO</span>` : ""}
        ${i.ata_vigente
          ? `<span class="tag-unico" title="Ata ${esc(i.ata_vigente.numero_ata)}/${i.ata_vigente.ano_ata}
              vigente até ${dataBr(i.ata_vigente.vigencia_fim)}: talvez não precise
              entrar de novo no plano">COBERTO POR ATA</span>` : ""}
        ${i.valor_ano_anterior
          ? deltaPca(i.valor_total, i.valor_ano_anterior) : ""}
        ${i.mesclado
          ? '<button class="tag-mesclado" data-dividir="' + i.id + '" title="Desfazer a mesclagem">MESCLADO ⤢</button>' : ""}</span>
      <span><input type="text" data-campo="unidade" value="${esc(i.unidade ?? "")}">
        ${i.origem && i.origem.unidades_divergentes
          ? `<span class="aviso-un" title="O grupo tem unidades diferentes; confira">${ICONE.limite}</span>` : ""}</span>
      <span><input type="number" data-campo="quantidade" step="0.01"
        value="${i.quantidade ?? 0}"></span>
      <span><input type="number" data-campo="valor_unitario" step="0.01"
        value="${i.valor_unitario ?? 0}"></span>
      <span><input type="number" data-campo="margem" step="1"
        value="${i.margem ?? 0}"></span>
      <span class="num">${dinheiro(i.valor_total)}</span>
    </div>`).join("");
  $("pca-lista").innerHTML = cab + (linhas ||
    `<div class="vazio">Sem itens. Clique em <b>Gerar</b>.</div>`);
  // seleção para mesclagem
  $("pca-lista").querySelectorAll("[data-sel]").forEach(cx =>
    cx.addEventListener("change", () => {
      const id = +cx.dataset.sel;
      cx.checked ? selecionados.add(id) : selecionados.delete(id);
      $("pca-mesclar").disabled = selecionados.size < 2;
      $("pca-mesclar").textContent = selecionados.size > 1
        ? `⚯ Mesclar ${selecionados.size} itens` : "⚯ Mesclar selecionados";
    }));
  $("pca-lista").querySelectorAll("[data-dividir]").forEach(b =>
    b.addEventListener("click", async () => {
      const r = await api.dividir_item_minuta(+b.dataset.dividir);
      $("pca-status").textContent = r.ok
        ? `Mesclagem desfeita: ${r.itens} itens restaurados` : r.erro;
      await carregarMinuta();
    }));
  $("pca-lista").querySelectorAll("[data-campo]").forEach(campo =>
    campo.addEventListener("change", async () => {
      const linha = campo.closest(".linha");
      const valor = campo.type === "checkbox" ? (campo.checked ? 1 : 0)
                  : campo.type === "number" ? parseFloat(campo.value) || 0
                  : campo.value;
      await api.editar_item_minuta(+linha.dataset.id,
                                   { [campo.dataset.campo]: valor });
      await carregarMinuta();   // recalcula totais com o ajuste
    }));
}

$("pca-mesclar").addEventListener("click", async () => {
  const r = await api.mesclar_itens_minuta(+$("pca-ano").value,
                                           [...selecionados]);
  $("pca-status").textContent = r.ok
    ? `${r.itens} itens fundidos — quantidade somada e preço ponderado`
    : r.erro;
  selecionados.clear();
  $("pca-mesclar").disabled = true;
  $("pca-mesclar").textContent = "⚯ Mesclar selecionados";
  await carregarMinuta();
});

$("pca-csv").addEventListener("click", async () => {
  const r = await api.exportar_planilha("minuta_pca", { ano: +$("pca-ano").value });
  $("pca-status").textContent = r.ok
    ? `Planilha com ${r.linhas} itens em ${r.arquivo}` : (r.erro || "");
});
$("pca-relatorio").addEventListener("click", async () => {
  const r = await api.gerar_relatorio("minuta_pca", { ano: +$("pca-ano").value });
  $("pca-status").textContent = r.ok ? "Relatório aberto no navegador"
                                     : (r.erro || "Falha ao gerar");
});

// ── relatórios ────────────────────────────────────────────────────────────
async function montarOpcoesRelatorio() {
  const tipo = $("rel-tipo").value;
  const f = await api.filtros_disponiveis();
  const sel = $("rel-ano");
  sel.length = 0;
  const soExercicio = ["executivo", "fracionamento"].includes(tipo);
  // só a Pesquisa de Preços pede termo de busca
  $("rel-termo-caixa").classList.toggle("oculto", tipo !== "precos");
  if (!soExercicio) {
    if (tipo !== "contratacoes")
      sel.add(new Option("Vigentes hoje", "vigentes"));
    sel.add(new Option("Todo o período", "todos"));
  }
  f.anos.forEach(a => sel.add(new Option(`Exercício ${a}`, `ano:${a}`)));
  if (soExercicio && !f.anos.length)
    sel.add(new Option(`Exercício ${new Date().getFullYear()}`,
                       `ano:${new Date().getFullYear()}`));
  const modCaixa = $("rel-mod-caixa");
  modCaixa.classList.toggle("oculto", tipo !== "contratacoes");
  const modSel = $("rel-modalidade");
  modSel.length = 1;
  f.modalidades.forEach(m => modSel.add(new Option(m.nome, m.id)));
  const orgSel = $("rel-orgao");
  orgSel.length = 1;
  f.orgaos.forEach(o => orgSel.add(new Option(o.nome ?? o.cnpj, o.cnpj)));
}
$("btn-relatorios").addEventListener("click", async () => {
  await montarOpcoesRelatorio();
  $("rel-status").textContent = "";
  abrirModal("veu-relatorios");
});
$("rel-tipo").addEventListener("change", montarOpcoesRelatorio);
$("rel-gerar").addEventListener("click", async () => {
  const periodo = $("rel-ano").value;
  const params = {
    ano: periodo.startsWith("ano:") ? +periodo.slice(4) : null,
    vigentes: periodo === "vigentes",
    modalidade: $("rel-modalidade").value || null,
    orgao: $("rel-orgao").value || null,
    termo: $("rel-termo").value || null,
  };
  $("rel-gerar").disabled = true;
  $("rel-status").textContent = "Gerando…";
  // os dois relatórios que usam os gráficos do Painel —
  // api.painel() já devolve exatamente o que dados_painel() usaria, então
  // não precisa de método novo. Cada gráfico é desenhado no MESMO
  // contêiner oculto, um de cada vez, e capturado antes do próximo.
  if (["executivo", "economia"].includes($("rel-tipo").value) && api.painel) {
    const anoAlvo = params.ano || new Date().getFullYear();
    const dp = await api.painel(anoAlvo, params.orgao);
    if (dp) {
      params.graficos = {};
      const capturar = (chave, itens, opts) => {
        desenharBarrasEcharts($("grafico-oculto"), itens, opts);
        params.graficos[chave] = $("grafico-oculto").innerHTML;
      };
      if ($("rel-tipo").value === "executivo") {
        desenharColunasEcharts($("grafico-oculto"), dp.execucao.meses, "--s1");
        params.graficos.meses = $("grafico-oculto").innerHTML;
        capturar("modalidade", dp.execucao.modalidades.slice(0, 6), {
          valor: m => m.homologado || m.estimado || 0,
          rotulo: m => m.modalidade_nome || "–",
          sub: m => `${m.n} ${m.n === 1 ? "processo" : "processos"}` });
      } else {
        const item = n => n === 1 ? "item" : "itens";
        capturar("modalidade", dp.economia.por_modalidade, {
          valor: m => m.economizado || 0, rotulo: m => m.modalidade || "–",
          sub: m => `${m.n} ${m.n === 1 ? "processo" : "processos"}` });
        capturar("familia", dp.economia.por_familia, {
          valor: f => f.economizado || 0, rotulo: f => f.nome || "–",
          sub: f => `${f.n} ${item(f.n)}` });
        capturar("categoria", dp.economia.por_categoria, {
          valor: c => c.economizado || 0, rotulo: c => c.nome || "–",
          sub: c => `${c.n} ${item(c.n)}` });
        capturar("fornecedor", dp.economia.por_fornecedor, {
          valor: f => f.economizado || 0, rotulo: f => f.nome || "–",
          sub: f => `${f.n} ${item(f.n)} · ${(f.pct || 0).toFixed(0)}%` });
      }
    }
  }
  const r = await api.gerar_relatorio($("rel-tipo").value, params);
  $("rel-gerar").disabled = false;
  $("rel-status").textContent = r.ok
    ? "Aberto no navegador" + (r.xlsx ? " · planilha gerada ao lado" : "")
    : (r.erro || "Falha ao gerar");
});

// ── cópia do acervo ───────────────────────────────────────────────────────
// Restaurar troca o banco inteiro, então a confirmação diz o que entra e o
// que sai — e o programa precisa reabrir para ler o arquivo novo.
$("btn-exportar-acervo")?.addEventListener("click", async () => {
  const msg = $("acervo-msg");
  msg.textContent = "Salvando cópia…";
  const r = await api.exportar_acervo();
  if (!r.ok) { msg.textContent = r.erro ? `Falhou: ${r.erro}` : ""; return; }
  const c = r.contagens || {};
  msg.textContent = `Cópia salva (${r.mb} MB): ${c.contratacoes || 0}`
    + ` contratações e ${(c.itens || 0).toLocaleString("pt-BR")} itens.`;
});

$("btn-importar-acervo")?.addEventListener("click", async () => {
  const msg = $("acervo-msg");
  if (!confirm("Restaurar uma cópia substitui todo o acervo atual.\n\n"
               + "O banco de agora é guardado ao lado, renomeado, e o "
               + "programa precisa ser fechado e aberto de novo.\n\n"
               + "Escolher o arquivo?")) return;
  msg.textContent = "Conferindo o arquivo…";
  const r = await api.importar_acervo();
  if (!r.ok) { msg.textContent = r.erro ? `Falhou: ${r.erro}` : ""; return; }
  msg.textContent = `Acervo restaurado (${(r.itens || 0).toLocaleString("pt-BR")}`
    + ` itens). Feche e abra o Licitarium para usá-lo.`;
  alert("Acervo restaurado.\n\nFeche e abra o Licitarium para carregar o "
        + "acervo restaurado.");
});

// ── config ────────────────────────────────────────────────────────────────
// A modal demorava a abrir porque as ~5 chamadas à ponte pywebview
// (get_estado, brasao, listar_orgaos, referência, log) rodavam uma
// depois da outra — cada `await` soma o ida-e-volta da ponte, que sozinho
// já custa dezenas de ms. Duas mudanças (achado 2026-08-12): a modal abre
// já no clique, e as chamadas independentes disparam juntas (Promise.all)
// em vez de em fila — o tempo total vira o da mais lenta, não a soma.
$("btn-config").addEventListener("click", async () => {
  abrirModal("veu-config");
  const [e, brasao, orgaos, log, sync] = await Promise.all([
    api.get_estado(), api.brasao(), api.listar_orgaos(), api.ultimo_log(),
    api.status_sync?.() ?? {rodando: false}]);
  // abrir as Configurações no meio de uma coleta não recebe evento de
  // progresso retroativo: sem esta leitura, o botão de parar nasceria
  // desabilitado justo quando ele é necessário
  estadoDoParar(!!sync.rodando);
  $("cfg-municipio").innerHTML = `${esc(e.municipio)} — ${esc(e.uf)}
    <small class="dim">(IBGE ${esc(e.ibge)})</small>`;
  mostrarBrasao(brasao.dataurl);
  $("cfg-orgaos").innerHTML = orgaos.map(o =>
    `<div class="orgrow"><span>${esc(o.razao_social ?? o.cnpj)}
       <small>${esc(o.cnpj)} · ${o.origem === "manual" ? "adicionado manualmente"
         : "descoberto automaticamente"}</small></span>
     <input type="checkbox" data-cnpj="${esc(o.cnpj)}" ${o.ativo ? "checked" : ""}
       aria-label="Monitorar ${esc(o.razao_social ?? o.cnpj)}"></div>`)
    .join("") || `<div class="dim">Nenhum órgão ainda — sincronize primeiro.</div>`;
  $("cfg-orgaos").querySelectorAll("input[data-cnpj]").forEach(c =>
    c.addEventListener("change", () =>
      api.set_orgao_ativo(c.dataset.cnpj, c.checked)));
  aplicarLimCompras(parseFloat(e.limite_dispensa_compras) || 0);
  aplicarLimObras(parseFloat(e.limite_dispensa_obras) || 0);
  $("cfg-frac-janela").value = e.frac_janela || "exercicio";
  $("cfg-log").innerHTML = log.map(l =>
    `<div class="logline">${esc(l.iniciado_em?.slice(0,16).replace("T"," "))} ·
     ${esc(l.tipo)} · ${l.status === "ok" ? `${l.registros} registros`
       : `<span style="color:var(--warn)">erro: ${esc(l.erro)}</span>`}</div>`)
    .join("") || `<div class="dim">Nenhuma sincronização ainda.</div>`;
  carregarMunicipiosReferencia();
});
function mostrarBrasao(dataurl) {
  const preview = $("cfg-brasao-preview");
  preview.src = dataurl || "";
  preview.classList.toggle("oculto", !dataurl);
  $("btn-brasao-remover").classList.toggle("oculto", !dataurl);
}
$("btn-brasao-carregar").addEventListener("click", async () => {
  const botao = $("btn-brasao-carregar");
  botao.disabled = true;
  $("brasao-status").textContent = "";
  const r = await api.carregar_brasao();
  botao.disabled = false;
  if (r.ok) mostrarBrasao((await api.brasao()).dataurl);
  else if (r.erro) $("brasao-status").textContent = r.erro;
});
$("btn-brasao-remover").addEventListener("click", async () => {
  await api.remover_brasao();
  mostrarBrasao(null);
  $("brasao-status").textContent = "";
});
// máscara de dinheiro: digita só dígitos, exibe R$ formatado,
// salva o valor numérico puro (dataset.valor)
function mascaraDinheiro(input, aoSalvar) {
  const aplicar = v => {
    input.value = brl.format(v);
    input.dataset.valor = v;
  };
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "");
    aplicar((parseInt(digitos || "0", 10)) / 100);
  });
  input.addEventListener("change", () => aoSalvar(input.dataset.valor));
  return aplicar;
}
const aplicarLimCompras = mascaraDinheiro($("cfg-lim-compras"),
  v => api.set_config("limite_dispensa_compras", v));
const aplicarLimObras = mascaraDinheiro($("cfg-lim-obras"),
  v => api.set_config("limite_dispensa_obras", v));
$("cfg-frac-janela").addEventListener("change",
  () => api.set_config("frac_janela", $("cfg-frac-janela").value));
$("btn-trocar").addEventListener("click", () => {
  fecharModal("veu-config");
  iniciarWizard();
});
$("btn-add-orgao").addEventListener("click", async () => {
  const r = await api.add_orgao($("novo-cnpj").value, $("novo-nome").value);
  if (r.ok) { $("novo-cnpj").value = ""; $("novo-nome").value = "";
    $("btn-config").click(); }
  else if (r.erro) alert(r.erro);
});

// ── modais: trava o fundo, move o foco e prende o Tab ─────────────────────
const FOCAVEIS = 'button:not([disabled]), input, select, textarea, a[href],' +
                 ' summary, [tabindex]:not([tabindex="-1"])';
let focoAnterior = null;

function abrirModal(id) {
  focoAnterior = document.activeElement;
  const veu = $(id);
  veu.classList.remove("oculto");
  document.body.classList.add("travado");
  veu.querySelector(FOCAVEIS)?.focus();
}

function fecharModal(id) {
  $(id).classList.add("oculto");
  if (!document.querySelector(".veu:not(.oculto)"))
    document.body.classList.remove("travado");
  focoAnterior?.focus();
}

function fecharTodosModais() {
  document.querySelectorAll(".veu:not(.oculto)")
    .forEach(v => v.classList.add("oculto"));
  document.body.classList.remove("travado");
  focoAnterior?.focus();
}

document.querySelectorAll("[data-fecha]").forEach(b =>
  b.addEventListener("click", () => fecharModal(b.dataset.fecha)));

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { fecharTodosModais(); return; }
  if (e.key !== "Tab") return;
  const veu = document.querySelector(".veu:not(.oculto)");
  if (!veu) return;
  const itens = [...veu.querySelectorAll(FOCAVEIS)]
    .filter(el => el.offsetParent !== null);
  if (!itens.length) return;
  const primeiro = itens[0], ultimo = itens[itens.length - 1];
  if (e.shiftKey && document.activeElement === primeiro) {
    e.preventDefault(); ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault(); primeiro.focus();
  }
});

// ── sincronização ─────────────────────────────────────────────────────────
$("btn-sync").addEventListener("click", () => api.sincronizar());

// escopo (portado do Pretiarium Free, 2026-09-07): clique normal em
// Sincronizar continua disparando tudo, sem fricção nova — o ▾ ao lado é
// que abre esta modal pra quem quer restringir. Radios com o valor
// guardado em data-escopo; o campo de município só aparece quando esse é
// o escolhido.
$("btn-sync-opcoes")?.addEventListener("click", async () => {
  const d = await api.opcoes_sync();
  const pendentes = d.referencia.filter(m => m.nunca_sincronizado);
  $("opcoes-sync-lista").innerHTML = `
    <label class="opcao-sync">
      <input type="radio" name="escopo-sync" value="tudo" checked>
      <span><b>Tudo</b><br><span class="dim">Seu município + todos os
        ${d.referencia.length} de referência</span></span></label>
    <label class="opcao-sync">
      <input type="radio" name="escopo-sync" value="proprio">
      <span><b>Só o meu município</b><br><span class="dim">${esc(d.proprio_nome)}
        — pula os de referência</span></span></label>
    <label class="opcao-sync">
      <input type="radio" name="escopo-sync" value="pendentes"
        ${pendentes.length ? "" : "disabled"}>
      <span><b>Só quem nunca sincronizou</b><br><span class="dim">
        ${pendentes.length
          ? `${pendentes.length} município${pendentes.length === 1 ? "" : "s"} de referência ainda não visitado${pendentes.length === 1 ? "" : "s"} (+ seu município)`
          : "todos já sincronizaram alguma vez"}</span></span></label>
    <label class="opcao-sync">
      <input type="radio" name="escopo-sync" value="municipio">
      <span><b>Escolher um município</b></span></label>
    <select id="opcoes-sync-municipio" class="oculto" style="width:100%; margin-top:8px">
      <option value="${d.proprio_nome ? "proprio" : ""}">${esc(d.proprio_nome)} (seu município)</option>
      ${d.referencia.map(m => {
        // semáforo: vermelho nunca sincronizou, amarelo tem contratação
        // com item pendente, verde completo — <option> só aceita cor de
        // texto de verdade na maioria dos motores, daí a bolinha unicode
        // como reforço visual
        const COR = {vermelho: "#e05252", amarelo: "#c9972f", verde: "#3fae6a"};
        const ROTULO = {vermelho: " — nunca sincronizado",
          amarelo: " — itens pendentes", verde: ""};
        return `<option value="${esc(m.ibge)}" style="color:${COR[m.status]}">
          ● ${esc(m.nome)} — ${esc(m.uf)}${ROTULO[m.status]}</option>`;
      }).join("")}
    </select>`;
  $("opcoes-sync-lista").querySelectorAll('input[name="escopo-sync"]').forEach(r =>
    r.addEventListener("change", () =>
      $("opcoes-sync-municipio").classList.toggle(
        "oculto", r.value !== "municipio" || !r.checked)));
  abrirModal("veu-sync-opcoes");
});

$("btn-sync-opcoes-ir")?.addEventListener("click", () => {
  const escopo = document.querySelector(
    'input[name="escopo-sync"]:checked')?.value ?? "tudo";
  let ibgeEscolhido = null;
  if (escopo === "municipio") {
    const v = $("opcoes-sync-municipio").value;
    if (v && v !== "proprio") ibgeEscolhido = v;
    // "proprio" no seletor vira escopo "proprio" de verdade — não existe
    // ibge_escolhido pro município próprio no motor, ele já é implícito
    api.sincronizar(true, v === "proprio" ? "proprio" : "municipio", ibgeEscolhido);
  } else {
    api.sincronizar(true, escopo, null);
  }
  fecharModal("veu-sync-opcoes");
});

// O botão de parar só existe enquanto há o que parar — habilitado por
// evento de progresso, não por palpite de quem abre as Configurações.
$("btn-parar-sync").addEventListener("click", async () => {
  $("btn-parar-sync").disabled = true;
  const r = await api.parar_sync();
  $("parar-sync-status").textContent = r.rodando
    ? "Parando após o passo atual…"
    : "Não há sincronização em andamento.";
});
function estadoDoParar(rodando) {
  $("btn-parar-sync").disabled = !rodando;
  if (!rodando) $("parar-sync-status").textContent = "";
}

window.onSyncProgresso = st => {
  $("sync-dot").classList.toggle("rodando", st.rodando);
  if (st.rodando && st.msg) $("sync-msg").textContent = st.msg;
  $("btn-sync").disabled = st.rodando;
  estadoDoParar(st.rodando);
};
window.onSyncFim = async st => {
  $("sync-dot").classList.remove("rodando");
  $("btn-sync").disabled = false;
  estadoDoParar(false);
  if (st.cancelado) {
    // parada a pedido não é falha: o texto não pode sugerir erro, senão o
    // usuário acha que quebrou algo ao clicar em Parar
    $("sync-msg").textContent = "Sincronização interrompida. O que já foi "
      + "baixado está no acervo; a próxima retoma de onde faltou.";
  }
  else if (st.erro) { $("sync-msg").textContent = `Falha na sincronização: ${st.erro}`; }
  else {
    const r = st.resumo || {};
    const partes = Object.entries(r).map(([t, n]) =>
      n == null ? `${t}: falhou` : `${t}: ${n}`);
    $("sync-msg").textContent =
      `Sincronizado ${new Date().toLocaleTimeString("pt-BR",
        {hour:"2-digit",minute:"2-digit"})} · ` + partes.join(" · ");
  }
  const e = await api.get_estado();
  renderKpis(e.kpis);
  await carregarFiltros();
  // Atualiza a vista que está aberta. Chamava `carregarLista()` direto, e
  // `COLUNAS` não tem entrada para "painel": quando a coleta terminava com
  // o usuário no Painel — que é a aba inicial, ou seja, o caso mais comum
  // logo depois da sincronização de abertura — isso estourava dentro de um
  // handler assíncrono. Sem tela de erro: o Painel só não se atualizava.
  if (estado.tipo === "painel") await carregarPainel();
  else if (estado.tipo === "precos") await carregarPrecos();
  else await carregarLista();
};

// ── pesquisa de preços — aba Preços ─────────────────────────────────────
// Portado do Pretiarium Free (busca/estatística/seleção/descarte), com o
// visual simplificado ao padrão de lista do Licitarium: sem boxplot/série
// temporal, o resumo fica em cartões numéricos com os mesmos dados.
let precosSelecionados = new Set();
let ultimoTermoPrecos = "";
estado.paginaPrecos = 1;

function filtrosPrecosLista() {
  return { ano: $("pr-ano").value || null,
           orgao: $("pr-orgao").value || null,
           unidade: $("pr-unidade").value || null,
           so_homologados: $("pr-homologados").checked || null,
           busca: $("pr-busca").value.trim() || null };
}

async function carregarSelecaoPrecos(termo) {
  precosSelecionados = termo && api.selecionados
    ? new Set((await api.selecionados(termo)).map(String))
    : new Set();
}

async function carregarPrecos() {
  const termo = $("pr-busca").value.trim();
  if (termo !== ultimoTermoPrecos) {
    ultimoTermoPrecos = termo;
    await carregarSelecaoPrecos(termo);
  }
  const conteudo = $("pr-conteudo").checked;
  const corrigir = $("pr-ipca").checked;
  // mesmas classes/larguras que ui/estilo.css já reserva para a aba Preços
  // (.g-itens / .conteudo / .corrigido): a coluna extra de dinheiro entra
  // sempre entre o valor pago e o fornecedor.
  const g = "g-itens" + (conteudo ? " conteudo" : "") + (corrigir ? " corrigido" : "");
  const cab = `<div class="linha cab ${g}"><span></span><span>Descrição</span>
    <span>Unid.</span><span>Qtde</span><span>Valor unitário</span>
    ${corrigir ? "<span>Corrigido (IPCA)</span>" : ""}
    ${conteudo ? "<span>Por conteúdo</span>" : ""}
    <span>Fornecedor</span><span>Município</span><span>Processo</span></div>`;
  const r = await api.listar("itens", filtrosPrecosLista(), estado.paginaPrecos);
  const linhas = r.itens.map(d => {
    const id = String(d.id);
    const unit = d.valor_unitario_homologado != null
      ? dinheiro(d.valor_unitario_homologado)
      : `<span class="est">${dinheiro(d.valor_unitario_estimado)} <small>est.</small></span>`;
    return `<div class="linha ${g}" data-id="${esc(id)}">
      <span class="sel"><input type="checkbox" data-item="${esc(id)}"
        ${precosSelecionados.has(id) ? "checked" : ""}
        aria-label="Usar na pesquisa: ${esc(d.descricao ?? "item")}"></span>
      <span class="obj">${esc(d.descricao ?? "–")}</span>
      <span class="dim">${esc(d.unidade ?? "–")}</span>
      <span class="dim">${d.quantidade_homologada ?? d.quantidade ?? "–"}</span>
      <span class="num">${unit}</span>
      ${corrigir ? `<span class="num">${d.corrigido != null
          ? dinheiro(d.corrigido) : `<span class="dim">–</span>`}</span>` : ""}
      ${conteudo ? `<span class="num">${d.por_conteudo
          ? `${dinheiroFino(d.por_conteudo.valor)} <small>/${esc(d.por_conteudo.rotulo)}</small>`
          : `<span class="dim">–</span>`}</span>` : ""}
      <span class="dim" title="${esc(d.fornecedor_nome ?? "")}"
        >${esc(fornecedorCurto(d.fornecedor_nome))}</span>
      <span class="dim">${esc(d.municipio_nome ?? "–")}</span>
      <span class="dim">
        <button class="btn ghost" data-descartar="${esc(id)}"
          title="Descartar este item da pesquisa">✕</button>
        ${d.ano ?? ""}/${d.sequencial ?? ""}</span>
    </div>`;
  }).join("");
  $("pr-lista").innerHTML = cab + (linhas || `<div class="vazio"><p>${
    termo ? "Nenhum item para esta busca." : "Digite algo para pesquisar preços."
  }</p></div>`);
  $("pr-lista").querySelectorAll("input[data-item]").forEach(cb =>
    cb.addEventListener("change", async () => {
      const id = cb.dataset.item;
      if (cb.checked) { precosSelecionados.add(id); await api.selecionar_preco(termo, id); }
      else { precosSelecionados.delete(id); await api.desselecionar_preco(termo, id); }
      mostrarResumoPrecos();
    }));
  $("pr-lista").querySelectorAll("button[data-descartar]").forEach(b =>
    b.addEventListener("click", () => abrirDescarte(b.dataset.descartar)));
  const paginas = Math.max(1, Math.ceil(r.total / 50));
  $("pr-pag-info").textContent = `${estado.paginaPrecos}/${paginas} · ${r.total} registros`;
  $("pr-pag-ant").disabled = estado.paginaPrecos <= 1;
  $("pr-pag-prox").disabled = estado.paginaPrecos >= paginas;
  if (!r.itens.length && termo.length >= 3 && api.sugerir_termo) {
    const sug = await api.sugerir_termo(termo);
    $("pr-sugestao").classList.toggle("oculto", !sug);
    $("pr-sugestao").innerHTML = sug
      ? `Você quis dizer <button class="btn ghost" id="pr-usar-sugestao"
          style="padding:0 4px">${esc(sug)}</button>?` : "";
    $("pr-usar-sugestao")?.addEventListener("click", () => {
      $("pr-busca").value = sug; estado.paginaPrecos = 1;
      carregarPrecos(); mostrarResumoPrecos();
    });
  } else {
    $("pr-sugestao").classList.add("oculto");
  }
}

async function mostrarResumoPrecos() {
  const caixa = $("precos-resumo");
  const termo = $("pr-busca").value.trim();
  if (termo.length < 3 || !api.estatisticas_preco) {
    caixa.classList.add("oculto");
    return;
  }
  const ano = $("pr-ano").value ? +$("pr-ano").value : null;
  const s = await api.estatisticas_preco(termo, ano, null, null,
    $("pr-conteudo").checked, $("pr-ipca").checked, [...precosSelecionados]);
  if (!s) { caixa.classList.add("oculto"); return; }
  if (s.nada_selecionado) {
    caixa.innerHTML = `<h3>Preços pagos para "${esc(termo)}"</h3>
      <div class="dim" role="status">0 de ${s.total} selecionados</div>
      <div>Nenhum item selecionado ainda. Marque os que quer comparar na
        lista abaixo, ou
        <button class="btn ghost" id="pr-selecionar-todos-resumo"
          style="margin-left:4px">Selecionar todos</button></div>`;
    caixa.classList.remove("oculto");
    $("pr-selecionar-todos-resumo").addEventListener("click", () =>
      $("pr-selecionar-todos").click());
    return;
  }
  if (!s.n) {
    caixa.innerHTML = `<h3>Preços pagos para "${esc(termo)}"</h3>
      <div>Nenhum dos itens selecionados tem dado suficiente para o
        cálculo${s.sem_conversao
          ? " — nenhum diz quanto vem na embalagem" : ""}.</div>`;
    caixa.classList.remove("oculto");
    return;
  }
  const val = s.por_conteudo ? dinheiroFino : dinheiro;
  const cel = (v, r, destaque) =>
    `<div class="cel${destaque ? " destaque" : ""}">
       <div class="v">${v}</div><div class="r">${r}</div></div>`;
  const avisos = [];
  if (s.amostra_reduzida)
    avisos.push("Amostra reduzida — poucos preços para uma conclusão robusta.");
  if (s.fora_da_curva?.length)
    avisos.push(`${s.fora_da_curva.length} item(ns) fora da curva de preços —
      considere revisar ou descartar.`);
  if (s.alertas_concentracao?.length) avisos.push(...s.alertas_concentracao);
  caixa.innerHTML = `<h3>Preços pagos para "${esc(termo)}"</h3>
    <div class="dim" role="status">${s.n} de ${s.total} selecionados</div>
    <div class="grade">
      ${cel(val(s.minimo), "menor")}
      ${s.q1 != null ? cel(val(s.q1), "1º quartil") : ""}
      ${cel(val(s.mediana), "mediana", true)}
      ${s.q3 != null ? cel(val(s.q3), "3º quartil") : ""}
      ${cel(val(s.maximo), "maior")}
      ${cel(s.n, "itens")}
      ${cel(s.fornecedores, "fornecedores")}
    </div>
    ${avisos.map(a => `<div class="aviso">${esc(a)}</div>`).join("")}
    <button class="btn ghost" id="pr-relatorio" style="margin-top:8px">Relatório</button>`;
  caixa.classList.remove("oculto");
  $("pr-relatorio").addEventListener("click", async () => {
    await montarOpcoesRelatorio();
    $("rel-tipo").value = "precos";
    await montarOpcoesRelatorio();
    $("rel-termo").value = termo;
    $("rel-status").textContent = "";
    abrirModal("veu-relatorios");
  });
}

// razão do descarte, sempre exigida (pedido do usuário) — diferente do
// Pretiarium, que aceitava descartar sem motivo e cobrava só no relatório
let descarteAlvo = null;
async function abrirDescarte(id) {
  descarteAlvo = id;
  const motivos = api.motivos_descarte ? await api.motivos_descarte() : [];
  $("desc-motivo").innerHTML = motivos.map(m =>
    `<option value="${esc(m.id)}">${esc(m.texto)}</option>`).join("");
  abrirModal("veu-descarte");
}
$("desc-confirmar").addEventListener("click", async () => {
  if (!descarteAlvo) return;
  const motivo = $("desc-motivo").value;
  if (!motivo) return;
  await api.descartar_preco($("pr-busca").value.trim(), descarteAlvo, motivo);
  await api.desselecionar_preco($("pr-busca").value.trim(), descarteAlvo);
  precosSelecionados.delete(descarteAlvo);
  fecharModal("veu-descarte");
  descarteAlvo = null;
  carregarPrecos();
  mostrarResumoPrecos();
});

$("pr-selecionar-todos").addEventListener("click", async () => {
  const termo = $("pr-busca").value.trim();
  if (!termo || !api.selecionar_todos_precos) return;
  const ano = $("pr-ano").value ? +$("pr-ano").value : null;
  await api.selecionar_todos_precos(termo, ano, null);
  await carregarSelecaoPrecos(termo);
  carregarPrecos();
  mostrarResumoPrecos();
});
$("pr-csv").addEventListener("click", async () => {
  const r = await api.exportar_planilha("itens", filtrosPrecosLista());
  if (r.erro) alert(r.erro);
});
["pr-ano", "pr-orgao", "pr-unidade", "pr-homologados"].forEach(id =>
  $(id).addEventListener("change", () => {
    estado.paginaPrecos = 1; carregarPrecos(); mostrarResumoPrecos();
  }));
["pr-ipca", "pr-conteudo"].forEach(id =>
  $(id).addEventListener("change", () => { carregarPrecos(); mostrarResumoPrecos(); }));
let buscaPrecosTimer;
$("pr-busca").addEventListener("input", () => {
  clearTimeout(buscaPrecosTimer);
  buscaPrecosTimer = setTimeout(() => {
    estado.paginaPrecos = 1; carregarPrecos(); mostrarResumoPrecos();
  }, 300);
});
$("pr-pag-ant").addEventListener("click", () => {
  estado.paginaPrecos--; carregarPrecos(); });
$("pr-pag-prox").addEventListener("click", () => {
  estado.paginaPrecos++; carregarPrecos(); });

// ── situação do banco de preços (portado do Pretiarium Free, 2026-09-07) ──
let situacaoPrecosCarregada = false;
$("tela-precos")?.querySelectorAll(".subabas button[data-vista-precos]")
  .forEach(b => b.addEventListener("click", () => {
    const vista = b.dataset.vistaPrecos;
    marcarAba($("tela-precos").querySelectorAll(".subabas button"), x => x === b);
    $("precos-pesquisar").classList.toggle("oculto", vista !== "pesquisar");
    $("precos-situacao").classList.toggle("oculto", vista !== "situacao");
    if (vista === "situacao" && !situacaoPrecosCarregada) carregarSituacaoPrecos();
  }));

async function carregarSituacaoPrecos() {
  if (!api.painel_precos) return;
  const d = await api.painel_precos();
  situacaoPrecosCarregada = true;
  $("pk-itens").textContent = d.total.toLocaleString("pt-BR");
  $("pk-homologado").textContent = `${d.pct_homologado}%`;
  $("pk-municipios").textContent = d.municipios.length;
  $("pk-fornecedores").textContent = d.fornecedores.toLocaleString("pt-BR");
  desenharGraficoAnoPainel($("painel-grafico-ano"), d.por_ano);
  desenharGraficoTipoPainel($("painel-grafico-tipo"), d.material_servico);
  $("painel-municipios").innerHTML = listaPainelHtml("Municípios no banco",
    d.municipios.map(m => `<div class="linha">
      <span class="rot">${esc(m.nome)} · ${esc(m.uf)}${m.referencia
        ? ` <span class="dim">(referência)</span>` : ""}</span>
      <span class="dim">${m.itens.toLocaleString("pt-BR")} itens ·
        ${m.pct_homologado}% fechado</span></div>`));
  $("painel-top-itens").innerHTML = listaPainelHtml(
    "Itens mais frequentes", d.top_itens.map(it => `<div class="linha">
      <span class="rot" title="${esc(it.descricao)}">${esc(it.descricao)}</span>
      <span class="dim">${it.n.toLocaleString("pt-BR")}</span></div>`));
  $("painel-fornecedores").innerHTML = listaPainelHtml(
    "Fornecedores mais frequentes",
    d.fornecedores_top.map(f => `<div class="linha">
      <span class="rot" title="${esc(f.fornecedor)}">${esc(f.fornecedor)}</span>
      <span class="dim">${f.n.toLocaleString("pt-BR")}</span></div>`));
  $("painel-unidades").innerHTML = listaPainelHtml(
    "Unidades mais usadas", d.unidades.map(u => `<div class="linha">
      <span class="rot">${esc(u.unidade)}</span>
      <span class="dim">${u.n.toLocaleString("pt-BR")}</span></div>`));
  const sel = $("painel-concentracao-item");
  sel.innerHTML = d.top_itens.map(it =>
    `<option value="${esc(it.descricao)}">${esc(it.descricao)}</option>`).join("");
  if (sel.value) await carregarConcentracao(sel.value);
}

function listaPainelHtml(titulo, linhas) {
  return `<h3 class="tit-painel">${esc(titulo)}</h3>
    <div class="lista-painel">${linhas.length ? linhas.join("")
      : `<div class="dim">Nada no banco ainda.</div>`}</div>`;
}

$("painel-concentracao-item")?.addEventListener("change", e =>
  carregarConcentracao(e.target.value));

async function carregarConcentracao(descricao) {
  if (!api.concentracao_fornecedores) return;
  const d = await api.concentracao_fornecedores(descricao);
  const risco = d.corte !== null && d.corte + 1 <= d.fornecedores.length / 2;
  $("painel-concentracao-aviso").className =
    "aviso-concentracao " + (risco ? "risco" : d.fornecedores.length ? "ok" : "");
  $("painel-concentracao-aviso").innerHTML = !d.fornecedores.length
    ? "Sem fornecedor identificado nos preços coletados deste item."
    : d.corte !== null
      ? `<b>${d.corte + 1} de ${d.fornecedores.length} fornecedores</b> já somam` +
        ` <b>${d.fornecedores[d.corte].acumulado_pct}%</b> dos ${d.total}` +
        ` preços coletados.`
      : `Distribuição espalhada entre os ${d.fornecedores.length} fornecedores.`;
  desenharConcentracaoLorenz($("painel-concentracao-svg"), d);
  desenharConcentracaoLista($("painel-concentracao-lista"), d);
}

function desenharConcentracaoLorenz(el, d) {
  if (!window.echarts || !el) return;
  const linhas = d.fornecedores;
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  if (!linhas.length) { el.innerHTML = ""; return; }
  const accent = _corTemaEchart("--accent", "#1351b4");
  const muted = _corTemaEchart("--muted", "#5b6066");
  const n = linhas.length;
  const curva = [[0, 0], ...linhas.map((l, i) => [i + 1, l.acumulado_pct])];
  const igual = [[0, 0], [n, 100]];
  const chart = echarts.init(el, null, { renderer: "svg" });
  el.__echart = chart;
  chart.setOption({
    animation: false,
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: { type: "value", min: 0, max: n,
      axisLine: { lineStyle: { color: muted } },
      axisLabel: { color: muted } },
    yAxis: { type: "value", min: 0, max: 100,
      axisLabel: { color: muted, formatter: "{value}%" },
      splitLine: { lineStyle: { color: muted, opacity: .2 } } },
    tooltip: { trigger: "axis", axisPointer: { type: "line" },
      formatter: params => {
        const p = params.find(x => x.seriesName === "Concentração real");
        if (!p || p.dataIndex === 0) return "";
        const l = linhas[p.dataIndex - 1];
        return `<b>${esc(l.fornecedor)}</b><br>${l.n} preços (${l.pct}%)` +
          `<br>acumulado: <b>${l.acumulado_pct}%</b>`;
      } },
    series: [
      { name: "Distribuição igual", type: "line", data: igual,
        showSymbol: false, lineStyle: { color: muted, type: "dashed", width: 1.2 },
        tooltip: { show: false } },
      { name: "Concentração real", type: "line", data: curva,
        showSymbol: false, smooth: false,
        lineStyle: { color: accent, width: 2.5 },
        markPoint: d.corte === null ? undefined : {
          symbol: "circle", symbolSize: 8,
          itemStyle: { color: accent },
          label: { show: true, position: "top", color: muted, fontSize: 11,
            formatter: () => `${d.corte + 1} = ${linhas[d.corte].acumulado_pct}%` },
          data: [{ coord: [d.corte + 1, linhas[d.corte].acumulado_pct] }] } },
    ],
  });
  requestAnimationFrame(() => chart.resize());
}

function desenharConcentracaoLista(container, d) {
  container.innerHTML = d.fornecedores.map((l, i) => `
    <div class="barra-concentracao">
      <span class="nome-concentracao" title="${esc(l.fornecedor)}">${esc(l.fornecedor)}</span>
      <div class="fundo-concentracao">
        <i style="width:${l.pct}%"></i>${i === d.corte
          ? '<div class="limiar-concentracao"></div>' : ""}</div>
      <span class="acum-concentracao">${l.n} · ${l.acumulado_pct}%</span>
    </div>`).join("");
}

function desenharGraficoAnoPainel(el, porAno) {
  if (!window.echarts || !el || !porAno.length) { if (el) el.innerHTML = ""; return; }
  const s1 = _corTemaEchart("--s1", "#2a78d6");
  const muted = _corTemaEchart("--muted", "#5b6066");
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  const chart = echarts.init(el, null, { renderer: "svg" });
  el.__echart = chart;
  chart.setOption({
    animation: false,
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: { type: "category", data: porAno.map(p => p.ano),
      axisLine: { lineStyle: { color: muted } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: muted, opacity: .2 } } },
    tooltip: { trigger: "axis" },
    series: [{ type: "bar", data: porAno.map(p => p.n),
      itemStyle: { color: s1, borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 48 }],
  });
}

function desenharGraficoTipoPainel(el, materialServico) {
  if (!window.echarts || !el || !materialServico.length)
    { if (el) el.innerHTML = ""; return; }
  const s1 = _corTemaEchart("--s1", "#2a78d6");
  const s2 = _corTemaEchart("--s2", "#eb6834");
  const muted = _corTemaEchart("--muted", "#5b6066");
  const cores = [s1, s2, muted];
  if (el.__echart) { el.__echart.dispose(); el.__echart = null; }
  const chart = echarts.init(el, null, { renderer: "svg" });
  el.__echart = chart;
  chart.setOption({
    animation: false,
    tooltip: { formatter: p => `${p.name}: ${p.value.toLocaleString("pt-BR")}
      (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: muted, fontSize: 11 } },
    series: [{ type: "pie", radius: ["40%", "68%"], center: ["50%", "44%"],
      data: materialServico.map((m, i) => ({ name: m.tipo, value: m.n,
        itemStyle: { color: cores[i % cores.length] } })),
      label: { color: muted, fontSize: 11,
        formatter: p => `${p.name}\n${p.percent}%` },
      labelLine: { lineStyle: { color: muted } } }],
  });
}

// ── municípios de referência — card em Configurações ────────────────────
async function carregarMunicipiosReferencia() {
  if (!api.listar_municipios_referencia) return;
  const lista = await api.listar_municipios_referencia();
  $("cfg-referencia").innerHTML = lista.length ? lista.map(m =>
    `<div class="orgrow"><span><span class="bolinha-status status-${m.status}"
         title="${{vermelho: "nunca sincronizado", amarelo: "itens pendentes",
                  verde: "completo"}[m.status]}"></span>${esc(m.nome)} — ${esc(m.uf)}
       <small>${m.itens} preço(s) no banco · ${m.mb} MB</small></span>
     <button class="btn ghost" data-remover-ref="${esc(m.ibge)}">Remover</button>
     </div>`).join("")
    : `<div class="dim">Nenhum município de referência cadastrado.</div>`;
  $("cfg-referencia").querySelectorAll("button[data-remover-ref]").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Remover este município de referência? Os preços que "
        + "ele trouxe para o banco de preços serão apagados."))
        return;
      const r = await api.remover_municipio_referencia(b.dataset.removerRef);
      if (r.ok) carregarMunicipiosReferencia();
      else if (r.erro) alert(r.erro);
    }));
}
if ($("ref-uf").options.length <= 1)
  UFS.forEach(uf => $("ref-uf").add(new Option(uf, uf)));

let refEscolha = null;
$("ref-busca")?.addEventListener("input", async () => {
  refEscolha = null;
  const texto = $("ref-busca").value.trim();
  const caixa = $("ref-sugestoes");
  if (texto.length < 2 || !api.municipios) { caixa.classList.add("oculto"); return; }
  const achados = await api.municipios(texto, $("ref-uf").value || null);
  caixa.innerHTML = achados.map(m =>
    `<button data-c="${m.c}" data-n="${esc(m.n)}" data-uf="${m.uf}">
       ${esc(m.n)} — ${m.uf}</button>`).join("")
    || `<button disabled>nenhum município encontrado</button>`;
  caixa.classList.remove("oculto");
  caixa.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", async () => {
      caixa.classList.add("oculto");
      const codigo = b.dataset.c, nome = b.dataset.n, uf = b.dataset.uf;
      $("ref-busca").value = "";
      if (api.estimar_municipio_referencia) {
        const est = await api.estimar_municipio_referencia(codigo);
        if (est.erro) { alert(est.erro); return; }
        const ok = confirm(`${nome} tem cerca de `
          + `${(est.contratacoes ?? 0).toLocaleString("pt-BR")} contratações e `
          + `${(est.itens ?? 0).toLocaleString("pt-BR")} preços a coletar. `
          + `Adicionar como referência?`);
        if (!ok) return;
      }
      const r = await api.adicionar_municipio_referencia(codigo, nome, uf);
      if (r.ok) carregarMunicipiosReferencia();
      else if (r.erro) alert(r.erro);
    }));
});

// ── exportação ────────────────────────────────────────────────────────────
$("btn-csv").addEventListener("click", async () => {
  const r = await api.exportar_planilha(estado.tipo, filtrosAtuais());
  if (r.ok) $("sync-msg").textContent =
    `Planilha exportada: ${r.linhas} linhas em ${r.arquivo}`;
  else if (r.erro) alert(r.erro);
});
