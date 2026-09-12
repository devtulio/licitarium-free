const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test("o Painel é a tela inicial e não mostra a lista", async ({ page }) => {
  await expect(page.locator("#painel")).toBeVisible();
  await expect(page.locator('nav.abas button[data-tipo="painel"]'))
    .toHaveClass(/on/);
  await expect(page.locator("#lista")).toBeHidden();
  await expect(page.locator("#filtros-lista")).toBeHidden();
  // os KPIs do topo repetiriam o hero: somem no painel
  await expect(page.locator("#kpis-topo")).toBeHidden();

  await page.locator('nav.abas button[data-tipo="contratacoes"]').click();
  await expect(page.locator("#painel")).toBeHidden();
  await expect(page.locator("#lista")).toBeVisible();
  await expect(page.locator("#kpis-topo")).toBeVisible();
});

// ECharts (renderer SVG) desenha barra como <path>, não <rect>, e sempre
// põe um <rect fill="none"> de fundo antes de qualquer marca — por isso a
// marca real é ":is(rect, path) sem fill=none", não só "rect"
const MARCA_REAL = '#p-execucao svg :is(rect, path):not([fill="none"])';

test("a marca sob o cursor acende e as irmãs recuam", async ({ page }) => {
  const barras = page.locator(MARCA_REAL);
  const alvo = barras.first();
  // a série "estimado" já nasce com fill-opacity .32 (dado, não estado de
  // hover) — pega uma marca sem opacidade própria pra testar o realce
  const irma = page.locator(`${MARCA_REAL}:not([fill-opacity])`).first();

  // em repouso ninguém está esmaecido nem aceso
  await expect(irma).toHaveCSS("fill-opacity", "1");
  await expect(alvo).toHaveCSS("filter", "none");

  await alvo.hover();
  await expect(alvo).toHaveCSS("filter", "brightness(1.16)");
  await expect(irma).toHaveCSS("fill-opacity", "0.38");

  // saindo do gráfico, tudo volta — realce não é estado, é resposta
  await page.locator(".painel-topo").hover();
  await expect(irma).toHaveCSS("fill-opacity", "1");
  await expect(alvo).toHaveCSS("filter", "none");
});

test("barra não muda de tamanho ao ser realçada", async ({ page }) => {
  /* A barra vale o número que representa: crescer no hover faria a marca
     mentir sobre o valor. Quem cresce é o ponto, onde tamanho não é dado. */
  const barra = page.locator(MARCA_REAL).first();
  const antes = await barra.boundingBox();
  await barra.hover();
  await expect(barra).toHaveCSS("filter", "brightness(1.16)");
  const depois = await barra.boundingBox();
  expect(depois.width).toBeCloseTo(antes.width, 1);
  expect(depois.height).toBeCloseTo(antes.height, 1);
});

test("o tooltip próprio aparece na hora, com o valor em destaque",
    async ({ page }) => {
  // gráficos ECharts não carregam data-tip-v (o tooltip é ligado por
  // evento do próprio motor, não por delegação em atributo) — a marca
  // real já basta pra disparar o mostrarTt compartilhado
  const barra = page.locator(MARCA_REAL).first();
  const tt = page.locator(".graf-tt");
  await expect(tt).toBeHidden();

  await barra.hover();
  await expect(tt).toBeVisible();
  // o valor é o elemento forte; o rótulo (mês/série) é secundário — a
  // hierarquia que a skill dataviz pede para tooltip (valor lidera). O balão
  // de coluna mostra as duas séries (estimado + homologado), daí o first()
  await expect(tt.locator(".v").first()).toHaveText(/R\$/);
  await expect(tt.locator(".l")).not.toHaveCount(0);

  // sai do gráfico, some — não é um painel que fica aberto
  await page.locator(".painel-topo").hover();
  await expect(tt).toBeHidden();
});

test("o balão dispara na faixa toda do item, não só na barra fina",
    async ({ page }) => {
  // a barra é um alvo estreito; passar o mouse na coluna/linha inteira (longe
  // da barra) já mostra o item — como o calendário e as linhas. Sem isso, o
  // usuário precisava mirar a barra fina e achava que "não tinha tooltip".
  const tt = page.locator(".graf-tt");
  // coluna do gráfico de meses: hover num ponto da coluna longe da barra
  // (`position` é determinístico e dispara mousemove — mouse.move teleporta)
  const g = page.locator('#p-execucao [data-graf="meses"] .graf-echart');
  const box = await g.boundingBox();
  await g.hover({ position: { x: box.width * 0.25, y: box.height * 0.5 } });
  await expect(tt).toBeVisible();
  await expect(tt).toContainText("R$");

  // barra horizontal: hover na área do RÓTULO (esquerda), longe da barra
  await page.locator('.subabas button[data-vista="economia"]').click();
  const bar = page.locator('#p-economia [data-graf="economia_modalidade"]');
  const bb = await bar.boundingBox();
  await bar.hover({ position: { x: bb.width * 0.12, y: bb.height * 0.3 } });
  await expect(tt).toBeVisible();

  // funil (análise): hover à direita da barra curta, na faixa da etapa
  await page.locator('.subabas button[data-vista="analise"]').click();
  const funil = page.locator('#p-analise [data-graf="funil"]');
  const bf = await funil.boundingBox();
  await funil.hover({ position: { x: bf.width * 0.75, y: bf.height * 0.72 } });
  await expect(tt).toBeVisible();

  // heatmap (análise): hover numa célula vazia — a grade toda resolve a célula
  const calor = page.locator('#p-analise [data-graf="calor"]');
  const bh = await calor.boundingBox();
  await calor.hover({ position: { x: bh.width * 0.24, y: bh.height * 0.4 } });
  await expect(tt).toBeVisible();
  await expect(tt).toContainText("processo");
});

test("o corte vertical lê todos os anos no mês apontado", async ({ page }) => {
  await page.locator('.subabas button[data-vista="analise"]').click();
  const cartao = page.locator('#p-analise .card:has([data-graf="series"])');
  const hit = cartao.locator("svg [data-cross-hit]");
  const guia = cartao.locator("svg [data-cross-guia]");
  const padrao = cartao.locator("svg [data-serie-padrao]").first();

  // em repouso, só o ponto do mês corrente aparece — é o direto-label que
  // vale sem hover nenhum
  await expect(guia).toHaveAttribute("opacity", "0");
  await expect(padrao).toHaveAttribute("opacity", "1");

  // o cartão fica abaixo da dobra (viewport padrão 720px, altura mínima
  // de gráfico subiu pra 350px em 2026-09-12); sem isso o alvo do
  // mouse.move cai fora da tela e o evento não chega no SVG
  await hit.scrollIntoViewIfNeeded();
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);

  await expect(guia).toHaveAttribute("opacity", "1");
  await expect(padrao).toHaveAttribute("opacity", "0");
  // três anos no acervo de exemplo: o tooltip lista os três, um por linha
  const tt = page.locator(".graf-tt");
  await expect(tt.locator(".cab")).toBeVisible();
  await expect(tt.locator(".linha")).toHaveCount(3);
  await expect(tt).toContainText("2026");
  await expect(tt).toContainText("2025");
  await expect(tt).toContainText("2024");

  // sai da área do gráfico: o corte some, o padrão volta
  await page.mouse.move(10, 10);
  await expect(guia).toHaveAttribute("opacity", "0");
  await expect(padrao).toHaveAttribute("opacity", "1");
  await expect(tt).toBeHidden();
});

test("mudar o mês apontado muda os valores mostrados", async ({ page }) => {
  await page.locator('.subabas button[data-vista="analise"]').click();
  const hit = page.locator(
    '#p-analise .card:has([data-graf="series"]) svg [data-cross-hit]');
  await hit.scrollIntoViewIfNeeded();
  const box = await hit.boundingBox();
  const tt = page.locator(".graf-tt");

  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  const cedo = await tt.locator(".cab").textContent();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  const tarde = await tt.locator(".cab").textContent();
  expect(cedo).not.toBe(tarde);
});

test("o corte vertical da concentração segue o cursor pela curva",
    async ({ page }) => {
  await page.locator('.subabas button[data-vista="analise"]').click();
  const cartao = page.locator(
    '#p-analise .card:has([data-graf="concentracao"])');
  // achado da auditoria (2026-09-12): a curva não tinha eixo Y — só os
  // extremos "1"/total em texto, sem escala nenhuma pra ler um valor
  // no meio da curva sem passar o mouse
  await expect(cartao.locator("svg text").filter({ hasText: "%" }).first())
    .toBeVisible();
  const hit = cartao.locator("svg [data-cross-hit]");
  const ponto = cartao.locator("svg [data-cross-pt]");
  const padrao = cartao.locator("svg [data-serie-padrao]").first();

  await expect(ponto).toHaveAttribute("opacity", "0");
  // o cartão fica abaixo da dobra (viewport padrão 720px); sem isso o
  // alvo do mouse.move cai fora da tela e o evento não chega no SVG
  await hit.scrollIntoViewIfNeeded();
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);

  await expect(ponto).toHaveAttribute("opacity", "1");
  await expect(padrao).toHaveAttribute("opacity", "0");
  const tt = page.locator(".graf-tt");
  await expect(tt).toContainText("do valor");
  await expect(tt).toContainText("fornecedor");
});

test("as três vistas trocam e ficam lembradas", async ({ page }) => {
  await expect(page.locator("#p-execucao")).toBeVisible();
  await expect(page.locator("#p-analise")).toBeHidden();

  await page.locator('.subabas button[data-vista="analise"]').click();
  await expect(page.locator("#p-analise")).toBeVisible();
  await expect(page.locator("#p-execucao")).toBeHidden();
  const salvo = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "set_config" && c.k === "painel_vista"));
  expect(salvo.v).toBe("analise");
});

// "Registrado por ata" mudou da lista de Atas pro Painel · Execução
// (pedido do usuário, 2026-09-12) — mesmo dado de sempre (`top_atas_saldo`),
// só que embutido em `dados_executivo`, sem ida própria ao banco.
test("execução traz o gráfico de registrado por ata",
    async ({ page }) => {
  const v = page.locator("#p-execucao");
  await expect(v).toContainText("Registrado por ata");
  // a ata de maior registrado (Z-3, R$ 610 mil) aparece — não é a página
  // atual de uma lista, é o topo por valor direto do fixture
  const graf = v.locator('[data-graf="atas_saldo"]');
  await expect(graf).toContainText("610");
  // ata sem contrato decorrente (Z-4) aparece com "0 contratos", não
  // escondida como se não existisse
  await expect(graf).toContainText("0 contratos");
});

test("execução mostra hero, colunas mensais e modalidades",
    async ({ page }) => {
  const v = page.locator("#p-execucao");
  await expect(v).toContainText("Homologado em 2026");
  await expect(v).toContainText("contratações");
  await expect(v).toContainText("deságio médio");
  // colunas do mês: duas séries, com legenda (cor nunca sozinha)
  await expect(v.locator("svg rect").first()).toBeVisible();
  await expect(v).toContainText("Estimado");
  await expect(v).toContainText("Homologado");
  await expect(v).toContainText("Por modalidade");
});

// achado do usuário (2026-09-12): o changelog da fase 3 do handoff dizia
// "uma coluna, largura total, seguindo o mockup 1a", mas o código nunca
// tirou o grid de 2 colunas herdado do Painel antigo (.faixa.f-21/.f-11)
// — mockup 1a é explícito: "cada gráfico e cada tabela ocupa a largura
// inteira". Mesmo desvio existia em Análise (fase 4, mockup 3a) no par
// Deságio/Concentração — mantendo os dois gráficos, só tirando o par.
test("execução e análise não têm mais gráficos/tabelas pareados em 2 colunas",
    async ({ page }) => {
  await expect(page.locator("#p-execucao .faixa.f-21")).toHaveCount(0);
  await expect(page.locator("#p-execucao .faixa.f-11")).toHaveCount(0);
  await page.locator('.subabas button[data-vista="analise"]').click();
  await expect(page.locator("#p-analise .faixa.f-11")).toHaveCount(0);
  // os dois gráficos continuam na tela, só que cada um em largura total
  const v = page.locator("#p-analise");
  await expect(v).toContainText("Deságio por modalidade");
  await expect(v).toContainText("Concentração de fornecedores");
});

test("fornecedor truncado carrega o nome completo no title",
    async ({ page }) => {
  // achado da auditoria de design (2026-08-08): a tabela corta o nome com
  // CSS ellipsis, mas sem title o nome completo não aparecia nem passando
  // o mouse — a aba Preços já fazia certo, faltava aqui.
  const v = page.locator("#p-execucao");
  const linhaVencendo = v.locator("table").first().locator("td").first();
  await expect(linhaVencendo).toHaveAttribute("title",
    /RHC PRODUTOS E SERVIÇO LTDA/);
});

test("análise traz as três séries e o mapa de calor", async ({ page }) => {
  await page.locator('.subabas button[data-vista="analise"]').click();
  const v = page.locator("#p-analise");
  await expect(v).toContainText("Valor homologado acumulado");
  await expect(v).toContainText("Deságio por modalidade");
  await expect(v).toContainText("Concentração de fornecedores");
  await expect(v).toContainText("processos por mês e modalidade");
  // uma linha por exercício comparado — ECharts (renderer SVG) desenha
  // linha como <path stroke-width="...">, não <polyline>; o atributo
  // stroke-width (só nas linhas de dado, nunca nas grades do eixo) separa
  // as séries reais do resto do SVG
  expect(await v.locator('[data-graf="series"] svg path[stroke-width]').count())
    .toBeGreaterThanOrEqual(3);
});

test("economia mostra o total do ano e os quatro KPIs", async ({ page }) => {
  // handoff Claude Design (2026-09-11, fase 6, tela 3b): "Economia
  // acumulada" e "Economia por fornecedor" saíram da tela — a nota do
  // mockup fecha em só 3 cortes (modalidade/família/categoria) e um
  // número; "por categoria" virou tabela, não gráfico de barras
  await page.locator('.subabas button[data-vista="economia"]').click();
  const v = page.locator("#p-economia");
  await expect(v).toContainText("Economizado em 2026");
  await expect(v).toContainText("deságio médio");
  await expect(v).toContainText("economia a mais que 2025");
  await expect(v).toContainText("processos no cálculo");
  await expect(v).toContainText("Economia por modalidade");
  await expect(v).toContainText("Economia por família de item");
  await expect(v).toContainText("Por categoria do PNCP");
  await expect(v.locator("svg rect").first()).toBeVisible();
  await expect(v.locator('[data-graf="economia_series"]')).toHaveCount(0);
  await expect(v.locator('[data-graf="economia_fornecedor"]')).toHaveCount(0);
});

test("economia: quando economizou MENOS que o ano anterior, o rótulo diz \"a menos\"",
    async ({ page }) => {
  // achado ao testar o exe real (2026-09-12): com economizado <
  // economizado_anterior, o delta é negativo, mas o rótulo fixo
  // "economia a mais que" ficava lendo "-R$ ... a mais que" — o valor e
  // a palavra se contradiziam. Bug introduzido na própria fase 6.
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      economia: { ...window.PAINEL_DADOS.economia,
        economizado: 3910082.29, economizado_anterior: 23578654.86 } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  await page.locator('.subabas button[data-vista="economia"]').click();
  const v = page.locator("#p-economia");
  await expect(v).toContainText("economia a menos que 2025");
  await expect(v).not.toContainText("a mais que");
  // valor mostrado é a diferença em módulo, não negativo — o sinal já
  // está dito pela palavra "menos"
  await expect(v).toContainText("R$ 19.668.572,57");
  await expect(v).not.toContainText("-R$");
});

test("economia fica lembrada como as outras subabas", async ({ page }) => {
  await page.locator('.subabas button[data-vista="economia"]').click();
  const salvo = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "set_config" && c.k === "painel_vista"));
  expect(salvo.v).toBe("economia");
});

test("a vista economia não repete o botão de relatório", async ({ page }) => {
  // o atalho saiu do painel a pedido do usuário; o relatório continua
  // inteiro na aba Relatórios, e é essa saída que não pode sumir junto
  await page.locator('.subabas button[data-vista="economia"]').click();
  await expect(page.locator("#economia-relatorio")).toHaveCount(0);
  await page.locator("#btn-relatorios").click();
  await expect(page.locator('.rel-cartao[data-tipo="economia"]'))
    .toHaveCount(1);
});

test("vigilância mostra medidor e agenda", async ({ page }) => {
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const v = page.locator("#p-vigilancia");
  await expect(v).toContainText("Limite anual de dispensa");
  await expect(v).toContainText("Agenda dos próximos 90 dias");
});

test("análise mostra o funil do edital ao contrato", async ({ page }) => {
  // handoff Claude Design (2026-09-11, fase 4): funil saiu de Vigilância
  // e foi pra Análise, com 3 etapas em vez de 4
  await page.locator('.subabas button[data-vista="analise"]').click();
  const a = page.locator("#p-analise");
  await expect(a).toContainText("Do edital ao contrato");
  await expect(a).toContainText("Publicadas");
  await expect(a).toContainText("Com propostas");
  await expect(a).toContainText("Com resultado");
});

test("publicidade fora do prazo: sem achado, explica em vez de sumir",
    async ({ page }) => {
  // PAINEL_DADOS não tem atraso_publicidade — estado padrão é "sem achado"
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const v = page.locator("#p-vigilancia");
  await expect(v).toContainText("Publicidade fora do prazo — art. 94");
  await expect(v).toContainText("Nenhum contrato ou ata fora do prazo");
});

test("publicidade fora do prazo: lista achado com dias de atraso",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      vigilancia: { ...window.PAINEL_DADOS.vigilancia,
        atraso_publicidade: [
          { tipo: "contratos", numero_controle: "C1", numero: "0033/26",
            dias: 35, prazo: 20, atraso: 15 },
          { tipo: "atas", numero_controle: "A1", numero: "07/26",
            dias: 18, prazo: 10, atraso: 8 }] } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const v = page.locator("#p-vigilancia");
  await expect(v).toContainText("Publicidade fora do prazo — art. 94 (2)");
  await expect(v).toContainText("Contrato 0033/26");
  await expect(v).toContainText("15 d");
  await expect(v).toContainText("Ata 07/26");
  await expect(v).toContainText("8 d");
});

test("publicidade fora do prazo: muitos achados rolam dentro do card,"
    + " não empurram a Agenda (achado do usuário — banco real com 90)",
    async ({ page }) => {
  const muitos = Array.from({ length: 90 }, (_, i) => ({
    tipo: "contratos", numero_controle: `C${i}`, numero: `${i}/26`,
    dias: 30 + i, prazo: 20, atraso: 10 + i }));
  await page.evaluate((lista) => {
    window.__painel = { ...window.PAINEL_DADOS,
      vigilancia: { ...window.PAINEL_DADOS.vigilancia,
        atraso_publicidade: lista } };
  }, muitos);
  await page.locator("#p-ano").selectOption({ index: 0 });
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const v = page.locator("#p-vigilancia");
  await expect(v).toContainText("Publicidade fora do prazo — art. 94 (90)");
  const caixa = v.locator(".lista-atraso");
  const altura = await caixa.evaluate(el => el.getBoundingClientRect().height);
  expect(altura).toBeLessThanOrEqual(221);   // 220px do padrão já usado
  const estouraAltura = await caixa.evaluate(
    el => el.scrollHeight > el.clientHeight);
  expect(estouraAltura).toBe(true);          // tem o que rolar
});

test("publicidade fora do prazo: indisponível não parece \"tudo em dia\""
    + " (achado do usuário — database is locked derrubava o Painel)",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      vigilancia: { ...window.PAINEL_DADOS.vigilancia,
        atraso_publicidade: [],
        atraso_publicidade_indisponivel: "database is locked" } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const v = page.locator("#p-vigilancia");
  await expect(v).toContainText("Não foi possível conferir agora");
  await expect(v).not.toContainText("Nenhum contrato ou ata fora do prazo");
});

test("limite anual de dispensa: barra na largura do cartão, texto abaixo",
    async ({ page }) => {
  // pedido do usuário (2026-09-04): o gráfico de ECharts (barra estreita
  // ao lado do rótulo) virou HTML puro — barra ocupa a largura do
  // cartão, texto vem abaixo. Mede geometria real, não confia no olho.
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  const graf = page.locator('#p-vigilancia [data-graf="limites"]');
  const itens = graf.locator(".lim-item");
  await expect(itens.first()).toBeVisible();
  const geo = await itens.evaluateAll(els => els.map(el => {
    const trilho = el.querySelector(".lim-trilho").getBoundingClientRect();
    const barra = el.querySelector(".lim-barra").getBoundingClientRect();
    const legenda = el.querySelector(".lim-legenda").getBoundingClientRect();
    return { larguraCartao: trilho.width, larguraBarra: barra.width,
             pctBarra: barra.width / trilho.width,
             legendaAbaixo: legenda.top >= trilho.bottom };
  }));
  // barra usa a largura inteira do cartão (a faixa cinza de fundo), não
  // uma coluna estreita reservada pro rótulo do lado
  for (const g of geo) {
    expect(g.larguraCartao).toBeGreaterThan(300);
    expect(g.legendaAbaixo).toBe(true);
  }
  // achado da auditoria (2026-09-12): antes TODAS as barras achatavam no
  // teto de 100% (fixture: 263,9%, 239,3%...) — o card que existe pra
  // ranquear severidade não ranqueava nada visualmente, todas idênticas.
  // Agora escala pelo maior % da lista: o pior vira barra cheia, os
  // outros ficam proporcionais — nunca estoura o cartão (pctBarra<=1),
  // e a ordem das barras acompanha a ordem (decrescente) dos itens.
  expect(geo[0].pctBarra).toBeGreaterThan(0.95);   // pior caso, quase 100%
  for (const g of geo) expect(g.pctBarra).toBeLessThanOrEqual(1);
  const larguras = geo.map(g => g.larguraBarra);
  for (let i = 1; i < larguras.length; i++)
    expect(larguras[i]).toBeLessThanOrEqual(larguras[i - 1] + 0.5);
});

test("os alertas viram chips clicáveis acima das subabas",
    async ({ page }) => {
  const chips = page.locator("#painel-chips .chip");
  expect(await chips.count()).toBeGreaterThan(0);
  await expect(chips.first()).toContainText("limite anual de dispensa");
  await chips.nth(1).click();          // vencimentos levam aos contratos
  await expect(page.locator("#lista")).toBeVisible();
  const ultima = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(ultima.tipo).toBe("contratos");
});

test("chip de vencimento de contratos do Painel filtra pela janela de 60 dias",
    async ({ page }) => {
  await page.locator("#painel-chips .chip", { hasText: "contratos vencem" })
    .click();
  await expect(page.locator('nav.abas button[data-tipo="contratos"]'))
    .toHaveClass(/on/);
  await expect(page.locator("#f-vence60")).toBeChecked();
  await expect(page.locator("#f-vigentes")).not.toBeChecked();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(chamada.tipo).toBe("contratos");
  expect(chamada.filtros.vencendo).toBe(true);
  expect(chamada.filtros.vigentes).toBeNull();
});

test("chip de vencimento de atas do Painel leva à aba de atas",
    async ({ page }) => {
  await page.locator("#painel-chips .chip", { hasText: "atas vencem" })
    .click();
  await expect(page.locator('nav.abas button[data-tipo="atas"]'))
    .toHaveClass(/on/);
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(chamada.tipo).toBe("atas");
  expect(chamada.filtros.vencendo).toBe(true);
});

test("chip de limite filtra por modalidade, exercício e os objetos exatos",
    async ({ page }) => {
  await page.locator("#painel-chips .chip").first().click();
  const chamadas = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar"));
  // um clique, uma consulta — não a corrida entre o reset da aba e o filtro
  expect(chamadas.length).toBe(1);
  const [c] = chamadas;
  expect(c.tipo).toBe("contratacoes");
  expect(c.filtros.modalidade).toBe("8");
  expect(c.filtros.ano).toBe("2026");
  // não é "toda dispensa do ano": é só o que o alerta apontou
  expect(c.filtros.objetos).toEqual(
    ["MATERIAL LIMPEZA", "MEDICAMENTOS BÁSICOS", "SERVIÇOS TRANSPORTE",
     "PNEUS CÂMARAS", "MATERIAL ESCRITÓRIO", "COMBUSTÍVEL"]);
  await expect(page.locator("#f-modalidade")).toHaveValue("8");
  // sem caixa própria — o aviso é o que diz que o filtro está ativo
  await expect(page.locator("#filtro-alerta")).toBeVisible();
  await expect(page.locator("#filtro-alerta")).toContainText("limite anual");
});

test("chip de processo parado liga o filtro dedicado, sem corrida",
    async ({ page }) => {
  // não é nth(3): "propostas" está zerado neste acervo de exemplo e o chip
  // some da lista, deslocando os índices — pega pelo texto, não pela posição
  await page.locator("#painel-chips .chip", { hasText: "sem resultado" })
    .click();
  const chamadas = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar"));
  expect(chamadas.length).toBe(1);
  const [c] = chamadas;
  expect(c.tipo).toBe("contratacoes");
  expect(c.filtros.parada).toBe(true);
  expect(c.filtros.ano).toBe("2026");
  await expect(page.locator("#f-parada")).toBeChecked();
});

test("limpar filtros também derruba o filtro de objetos do alerta",
    async ({ page }) => {
  await page.locator("#painel-chips .chip").first().click();
  await expect(page.locator("#btn-limpar")).toBeVisible();
  await page.locator("#btn-limpar").click();
  await expect(page.locator("#filtro-alerta")).toBeHidden();
  await expect(page.locator("#f-modalidade")).toHaveValue("");
  const ultima = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(ultima.filtros.objetos).toBeNull();
  expect(ultima.filtros.modalidade).toBeNull();
});

test("trocar de aba depois do alerta não carrega o filtro do alerta junto",
    async ({ page }) => {
  await page.locator("#painel-chips .chip").first().click();
  await page.locator('nav.abas button[data-tipo="contratos"]').click();
  await expect(page.locator("#filtro-alerta")).toBeHidden();
  const ultima = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(ultima.filtros.objetos).toBeNull();
});

test("trocar o exercício recarrega o painel inteiro", async ({ page }) => {
  await page.locator("#p-ano").selectOption("2025");
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "painel").pop());
  expect(chamada.ano).toBe("2025");
});

test("imprimir manda as quatro vistas ao documento", async ({ page }) => {
  await page.locator("#btn-imprimir-painel").click();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_painel").pop());
  expect(chamada.tamanhos.map(t => t[0]))
    .toEqual(["execucao", "analise", "vigilancia", "economia"]);
  // as quatro vão com conteúdo, mesmo as que não estavam à vista
  expect(chamada.tamanhos.every(([, tamanho]) => tamanho > 500)).toBe(true);
});

test("os gráficos são desenhados na largura do espaço, não esticados",
    async ({ page }) => {
  // na largura "compacta" o conteúdo tem teto fixo: quem varia é o modo
  // expandido, que é onde a faixa morta aparecia
  await page.evaluate(() =>
    document.documentElement.dataset.largura = "expandida");
  const svg = page.locator('#p-execucao [data-graf="meses"] svg');
  await expect(svg).toBeVisible();
  await page.waitForTimeout(300);
  // ECharts (renderer SVG) sai com width/height absolutos, não viewBox —
  // ao contrário do SVG à mão que o resto do Painel ainda desenha
  const antes = await svg.getAttribute("width");

  // tela mais larga: o SVG acompanha, em vez de escalar com faixa morta
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.waitForTimeout(300);
  const depois = await svg.getAttribute("width");
  expect(depois).not.toBe(antes);
  const larguraSvg = Number(depois);
  const caixa = await page.locator('#p-execucao [data-graf="meses"]')
    .boundingBox();
  expect(Math.abs(larguraSvg - caixa.width)).toBeLessThan(3);
});

test("vista oculta desenha ao aparecer", async ({ page }) => {
  // com display:none o contêiner tem largura zero; sem redesenhar, a vista
  // abriria vazia
  await page.locator('.subabas button[data-vista="analise"]').click();
  const svg = page.locator('#p-analise [data-graf="funil"] svg');
  await expect(svg).toBeVisible();
  // ECharts (renderer SVG) sai com width absoluto, não viewBox
  const larg = Number(await svg.getAttribute("width"));
  expect(larg).toBeGreaterThan(200);
});

test("chips concordam em número", async ({ page }) => {
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      alertas: { perto_do_limite: 1, acima_do_limite: 0,
                 vencendo_contratos: 1, vencendo_atas: 1,
                 propostas: 1, paradas: 1 } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  const chips = page.locator("#painel-chips .chip");
  await expect(chips.nth(0)).toContainText("objeto perto do limite");
  await expect(chips.nth(1)).toContainText("contrato vence");
  await expect(chips.nth(2)).toContainText("ata vence");
  await expect(chips.nth(3)).toContainText("processo com proposta aberta");
  await expect(chips.nth(4)).toContainText("processo sem resultado");
});

test("chip de processo parado não usa o mesmo ícone dos de vencimento",
    async ({ page }) => {
  // achado da auditoria de design (2026-08-08): relógio (vencendo) e
  // ampulheta (parado) liam como a mesma família — "tempo passando" — pra
  // conceitos opostos. Desde a 1.33.0 os ícones são SVG desenhado, então a
  // comparação é do desenho, não mais do caractere de emoji.
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      alertas: { perto_do_limite: 0, acima_do_limite: 0,
                 vencendo_contratos: 1, vencendo_atas: 0,
                 propostas: 0, paradas: 1 } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  const desenho = (texto) => page.locator("#painel-chips .chip")
    .filter({ hasText: texto }).locator("svg.ico").first()
    .evaluate(el => el.innerHTML.replace(/\s+/g, " ").trim());
  const iconeVencendo = await desenho("contrato vence");
  const iconeParado = await desenho("sem resultado");
  expect(iconeVencendo).not.toBe("");
  expect(iconeParado).not.toBe(iconeVencendo);
});

test("chips ficam com a mesma altura mesmo quando o texto quebra linha",
    async ({ page }) => {
  // "5 objetos acima do limite anual de dispensa" quebra em duas linhas
  // dentro da largura de 200px; "1 processo com proposta aberta" cabe numa
  // só. .chip é <button> — elemento de formulário, resiste a esticar em
  // flex/grid por padrão (min-height:min-content da UA stylesheet ignora
  // align-items:stretch do pai); sem height:100% explícito, os chips de
  // uma linha ficavam mais baixos que os de duas.
  const chips = page.locator("#painel-chips .chip");
  const alturas = await chips.evaluateAll(
    els => els.map(el => el.getBoundingClientRect().height));
  const [primeira] = alturas;
  for (const h of alturas) expect(h).toBeCloseTo(primeira, 0);
});

test("número do hero cabe numa linha, em qualquer largura de janela",
    async ({ page }) => {
  // achado da auditoria (m1, 2026-08-08): a 900px (min_size do pywebview,
  // licitarium.py) "R$ 19,6 mi" quebrava em duas linhas dentro do card.
  // fonte virou clamp() — mas o `boundingBox()` que este teste usava mede a
  // área PINTADA, não o conteúdo: `.n` não tem overflow:hidden nenhum, então
  // um número mais largo que o card não é cortado por CSS — ele transborda
  // e é pintado POR BAIXO do card vizinho no grid (ordem do DOM), o que
  // parece corte na tela mas o boundingBox() não via nada de errado.
  // Estourou de verdade na v1.44.5 (valor completo, "R$ 19.609.957,57",
  // 17 caracteres — bem mais longo que o "R$ 19,6 mi" original) em
  // qualquer largura ACIMA de 900px: o `clamp()` antigo escalava a fonte
  // por `vw` (largura da JANELA), e o card para de crescer bem antes da
  // fonte parar de crescer. Virou `cqw` (largura do CARD) — por isso este
  // teste confere em várias larguras, não só na mínima, e mede
  // `scrollWidth` contra `clientWidth` (overflow de verdade), não a caixa
  // pintada.
  const cabe = async (seletor) => {
    const numero = page.locator(seletor);
    const info = await numero.evaluate(el => ({
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      linhas: el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(info.scrollW).toBeLessThanOrEqual(info.clientW);
    expect(info.linhas).toBeLessThan(1.5);
  };
  for (const largura of [900, 1024, 1180, 1440]) {
    await page.setViewportSize({ width: largura, height: 700 });
    await cabe("#p-execucao .card.hero .n");
    await page.locator('.subabas button[data-vista="economia"]').click();
    await cabe("#p-economia .card.hero .n");
    await page.locator('.subabas button[data-vista="execucao"]').click();
  }
});

test("chip.aviso não herda margin-top da classe .aviso genérica",
    async ({ page }) => {
  // achado real (usuário, 2026-08-08, segunda rodada sobre o mesmo print):
  // existe uma classe .aviso solta no CSS (texto de aviso sob campo de
  // formulário) com margin-top:8px. Os dois chips de vencimento têm
  // class="chip aviso" e herdavam essa margem por colisão de nome — 8px
  // mais baixos que os irmãos "grave"/plano, com a MESMA altura (por
  // isso o teste de altura, sozinho, não pegava isto).
  // os rótulos são frases longas ("1 objeto perto do limite anual de
  // dispensa"...) — com a faixa em flex-wrap (regra de redesenho
  // 2026-09-10), 4 alertas + "ocultar até mudar" de frase inteira não
  // cabem numa linha só em nenhuma largura razoável, e não precisam mais
  // caber. O que este teste sempre caçou é mais específico: o 1º chip
  // (sem classe extra) e o 2º (".chip.aviso", que colidia com a classe
  // .aviso genérica de formulário) são sempre vizinhos na MESMA linha —
  // o início da faixa nunca quebra sozinho — então continuam o bom par
  // pra flagrar a folga de 8px se ela voltar.
  await page.evaluate(() => {
    window.__painel = { ...window.PAINEL_DADOS,
      alertas: { perto_do_limite: 1, acima_do_limite: 0,
                 vencendo_contratos: 1, vencendo_atas: 0,
                 propostas: 0, paradas: 0 } };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  const chips = page.locator("#painel-chips .chip");
  await expect(chips).toHaveCount(2);
  const ys = await chips.evaluateAll(
    els => els.map(el => Math.round(el.getBoundingClientRect().y)));
  expect(ys[1]).toBe(ys[0]);
});

test("trocar de subaba não vai ao banco de novo", async ({ page }) => {
  const antes = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "painel").length);
  await page.locator('.subabas button[data-vista="analise"]').click();
  await page.locator('.subabas button[data-vista="vigilancia"]').click();
  await page.locator('.subabas button[data-vista="execucao"]').click();
  const depois = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "painel").length);
  expect(depois).toBe(antes);           // as três vistas já estão montadas
});

test("falha na consulta explica em vez de deixar a tela muda",
    async ({ page }) => {
  await page.evaluate(() => {
    window.pywebview.api.painel = async () => {
      throw new Error("database is locked");
    };
  });
  await page.locator("#p-ano").selectOption({ index: 0 });
  await expect(page.locator("#p-execucao")).toContainText("Não consegui montar");
  await expect(page.locator("#p-execucao")).toContainText("database is locked");
  await expect(page.locator("#painel")).not.toHaveClass(/carregando/);
});

test("nenhum rótulo de gráfico escapa do cartão, nas quatro vistas",
    async ({ page }) => {
  // O ECharts reserva espaço medindo o texto; sem `fontFamily` declarado ele
  // media com a sans-serif padrão e desenhava com a fonte do tema, mais
  // larga — "Concorrência - Eletrônica" perdia o "C" e "· 4 processos"
  // saía pela direita, na tela E no PDF do painel, que captura o mesmo SVG.
  const transbordos = () => page.evaluate(() => {
    const fora = [];
    document.querySelectorAll(".vista:not(.oculto) .graf[data-graf]")
      .forEach(el => {
        const cx = el.getBoundingClientRect();
        el.querySelectorAll("text").forEach(t => {
          const r = t.getBoundingClientRect();
          if (cx.left - r.left > 0.5 || r.right - cx.right > 0.5)
            fora.push(`${el.dataset.graf}: ${t.textContent.slice(0, 24)}`);
        });
      });
    return fora;
  });

  for (const v of ["execucao", "analise", "vigilancia", "economia"]) {
    if (v !== "execucao")
      await page.locator(`.subabas button[data-vista="${v}"]`).click();
    await expect.poll(transbordos, { message: `vista ${v}` }).toEqual([]);
  }
});

test("a barra fica com o grosso do cartão, não o texto em volta",
    async ({ page }) => {
  // A marca é o dado; rótulo e valor são legenda. Reservar a margem direita
  // pela medida certa, sem piso, derrubou a barra mais longa para 14% do
  // cartão nos cartões estreitos da Economia — o texto ficava com 4/5.
  const proporcoes = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".vista:not(.oculto) .graf[data-graf]")
      .forEach(el => {
        const svg = el.querySelector("svg");
        // só os que usam grafBarras — "por categoria" virou tabela e
        // "por fornecedor"/"acumulada" saíram da tela (handoff Claude
        // Design, fase 6); `modalidades` virou dumbbell (Fase 6, pesquisa
        // de dashboard 2026-09-10), marca é ponto pequeno, não barra longa
        if (!svg || !["economia_modalidade", "economia_familia"]
                     .includes(el.dataset.graf)) return;
        const larg = el.getBoundingClientRect().width;
        const marcas = [...svg.querySelectorAll("path")]
          .filter(p => (p.getAttribute("fill") || "none") !== "none")
          .map(p => p.getBoundingClientRect().width);
        if (marcas.length)
          out[el.dataset.graf] = Math.round(Math.max(...marcas) / larg * 100);
      });
    return out;
  });
  const conferir = async (vista) => {
    const p = await proporcoes();
    expect(Object.keys(p).length, `${vista} sem gráfico de barras`)
      .toBeGreaterThan(0);
    for (const [graf, pct] of Object.entries(p))
      expect(pct, `${graf}: barra mais longa com só ${pct}% do cartão`)
        .toBeGreaterThanOrEqual(30);
  };
  // Execução não tem mais gráfico de barras puro (modalidades virou
  // dumbbell, Fase 6) — só Economia entra nesta checagem agora
  await page.locator('.subabas button[data-vista="economia"]').click();
  await page.waitForTimeout(400);
  await conferir("economia");
});

test("o que vai ao papel tem SVG que sabe encolher", async ({ page }) => {
  // O ECharts entrega SVG com largura FIXA em pixels e sem viewBox: ele
  // desenha para a medida da tela e não se ajusta. Colado num cartão de
  // papel mais estreito, era cortado — em A3 a página escondia o defeito,
  // em A4 ele apareceu em quase todos os gráficos (PDF real, 2026-08-14).
  await page.locator("#btn-imprimir-painel").click();
  const html = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_painel").pop().html);
  const abrindo = html.match(/<svg[^>]*>/g) || [];
  expect(abrindo.length).toBeGreaterThan(5);
  const semViewBox = abrindo.filter(t => !/viewBox=/.test(t));
  expect(semViewBox, "SVG sem viewBox não encolhe no papel").toEqual([]);
  // `width="100%"` também começa com dígito: o que não pode é largura em
  // número puro, que é a que trava o desenho no tamanho da tela.
  // `(?<!-)` exclui `stroke-width="1.75"` — atributo de espessura de
  // traço, não da largura do elemento; os ícones dos alertas (fase 5 do
  // handoff, fila de triagem) têm um e são falso positivo sem isto.
  const comLarguraFixa = abrindo.filter(t => /(?<!-)width="\d+(\.\d+)?"/.test(t));
  expect(comLarguraFixa, "largura em pixels trava o desenho").toEqual([]);
});

test("imprimir sem abrir as vistas leva os gráficos mesmo assim",
    async ({ page }) => {
  // Vista escondida tem largura 0 e `desenharGraficos` pula quem mede 0:
  // quem imprimisse logo depois de abrir mandava três das quatro vistas com
  // cartão vazio — título e nota, e nada dentro. Não aparecia porque quem
  // imprime costuma ter navegado antes (achado 2026-08-14).
  await page.locator("#btn-imprimir-painel").click();
  const html = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_painel").pop().html);
  expect((html.match(/<svg/g) || []).length,
         "vista escondida foi ao papel sem desenho").toBeGreaterThan(12);
});

test("o gráfico é capturado na largura do papel, não na da tela larga",
    async ({ page }) => {
  // O ECharts desenha o SVG na largura em pixels do contêiner e crava essa
  // medida no viewBox. Capturado na tela do usuário (um monitor ultrawide dá
  // ~2664 px), o gráfico não cabia no cartão A4 de ~480 px e invadia o
  // vizinho no PDF real (concentração por cima do deságio, 2026-08-16). O
  // `paraPapel` passou a redesenhar num palco fora da tela na largura do
  // papel: o viewBox nasce na proporção do papel, não importa quão larga
  // esteja a janela. Aqui a janela é forçada bem larga e mesmo assim nenhum
  // viewBox de gráfico pode chegar perto da largura da tela.
  await page.setViewportSize({ width: 2600, height: 1000 });
  await page.locator("#btn-imprimir-painel").click();
  const larguras = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_painel").pop().html
    .match(/viewBox="0 0 (\d+(?:\.\d+)?) /g)
    ?.map(m => parseFloat(m.replace(/viewBox="0 0 /, ""))) || []);
  expect(larguras.length, "nenhum viewBox capturado").toBeGreaterThan(5);
  // o palco de captura é fixo (~1400 px); com folga, longe dos 2600 da tela.
  // O que se prova aqui é o desacoplamento da janela, não a medida exata.
  expect(Math.max(...larguras),
         "gráfico capturado na largura da tela, não do papel")
    .toBeLessThanOrEqual(1450);
});

test("a PRIMEIRA impressão já leva o gráfico de barras, e não apaga o da tela",
    async ({ page }) => {
  // `cloneNode` copiava o atributo `_echarts_instance_`; como o gráfico de
  // barras inicia o ECharts no próprio `.graf`, o clone reusava a instância
  // viva em vez de criar nova — desenhava na tela, o papel saía em branco, e o
  // dispose no fim matava o gráfico vivo. Só na 1ª impressão (a 2ª já achava o
  // atributo limpo): "por modalidade" vazio no PDF real (2026-08-16). O
  // gráfico vivo sobrevivia porque… não sobrevivia: some da tela até redesenho.
  const vivoAntes = await page.locator(
    '#p-execucao .graf[data-graf="modalidades"] svg').count();
  expect(vivoAntes, "o gráfico já devia estar na tela").toBe(1);

  const temBarras = await page.evaluate(() => {
    const html = window.paraPapel("p-execucao");   // a PRIMEIRA chamada
    const i = html.indexOf('data-graf="modalidades"');
    return i >= 0 && html.slice(i, i + 1200).includes("<svg");
  });
  expect(temBarras, "1ª impressão saiu sem o gráfico de barras").toBe(true);

  const vivoDepois = await page.locator(
    '#p-execucao .graf[data-graf="modalidades"] svg').count();
  expect(vivoDepois, "imprimir apagou o gráfico da tela").toBe(1);
});
