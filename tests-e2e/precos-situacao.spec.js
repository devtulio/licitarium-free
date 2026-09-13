const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => {
  await abrirApp(page);
  await page.locator('nav.abas button[data-tipo="precos"]').click();
});

test("subaba Situação do banco carrega KPIs, gráficos e rankings",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await expect(page.locator("#precos-situacao")).not.toHaveClass(/oculto/);
  await expect(page.locator("#precos-pesquisar")).toHaveClass(/oculto/);
  await expect(page.locator("#pk-itens")).toHaveText("12");
  await expect(page.locator("#pk-homologado")).toHaveText("75%");
  await expect(page.locator("#pk-municipios")).toHaveText("2");
  await expect(page.locator("#pk-fornecedores")).toHaveText("3");
  await expect(page.locator("#painel-municipios")).toContainText("Orindiúva");
  await expect(page.locator("#painel-municipios")).toContainText("Olímpia");
  await expect(page.locator("#painel-top-itens")).toContainText("PAPEL SULFITE A4");
  await expect(page.locator("#painel-fornecedores")).toContainText("Fornecedor A");
  await expect(page.locator("#painel-unidades")).toContainText("UN");
  // gráficos ECharts renderizam um <svg> dentro do container
  await expect(page.locator("#painel-grafico-ano svg")).toBeVisible();
  await expect(page.locator("#painel-grafico-tipo svg")).toBeVisible();
});

test("concentração de fornecedores desenha curva e lista pro item selecionado",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await expect(page.locator("#painel-concentracao-svg svg")).toBeVisible();
  await expect(page.locator("#painel-concentracao-aviso"))
    .toContainText("1 de 2 fornecedores");
  await expect(page.locator(".barra-concentracao")).toHaveCount(2);
});

test("concentração com muitos fornecedores (>30) ganha zoom (achado do usuário, 2026-09-13 — comparação com o Licitarium Pro)",
    async ({ page }) => {
  await page.evaluate(() => {
    const fornecedores = [];
    let acumulado = 0;
    for (let i = 0; i < 40; i++) {
      acumulado += 1;
      fornecedores.push({ fornecedor: `Fornecedor ${i + 1}`, n: 1,
        pct: 2.5, acumulado_pct: Math.round(acumulado / 40 * 1000) / 10 });
    }
    window.__concentracaoFornecedores = {
      descricao: "PAPEL SULFITE A4", total: 40, fornecedores, corte: 30 };
  });
  await page.locator('button[data-vista-precos="situacao"]').click();
  await expect(page.locator("#painel-concentracao-svg svg")).toBeVisible();
  const temZoom = await page.locator("#painel-concentracao-svg").evaluate(
    el => el.__echart.getOption().dataZoom.length > 0);
  expect(temZoom).toBe(true);
});

test("cartões dos gráficos ficam empilhados em 1 coluna, não lado a lado",
    async ({ page }) => {
  // achado do usuário (2026-09-12): esta tela ainda usava o grid de 2
  // colunas antigo (.grade-painel) enquanto o resto do app (Painel) já
  // tinha virado 1 coluna — mesmo espírito da correção de Execução/
  // Análise, mesmo dia.
  await page.locator('button[data-vista-precos="situacao"]').click();
  const anoBox = await page.locator("#painel-grafico-ano").boundingBox();
  const tipoBox = await page.locator("#painel-grafico-tipo").boundingBox();
  // em 1 coluna, o 2º cartão fica ABAIXO do 1º (mesmo x, y maior), não
  // ao lado (mesmo y, x maior)
  expect(tipoBox.y).toBeGreaterThan(anoBox.y + anoBox.height - 5);
  expect(anoBox.width).toBeGreaterThan(600);   // largura cheia, não metade
});

test("trocar largura da página redesenha os gráficos no tamanho novo (achado do usuário, 2026-09-13)",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await expect(page.locator("#painel-grafico-ano svg")).toBeVisible();
  const larguraAntes = (await page.locator("#painel-grafico-ano svg")
    .boundingBox()).width;
  await page.locator("#btn-config").click();
  await page.locator("#cfg-largura").selectOption("compacta");
  await page.locator('button[data-fecha="veu-config"]').click();
  await expect.poll(async () =>
    (await page.locator("#painel-grafico-ano svg").boundingBox()).width)
    .toBeLessThan(larguraAntes - 20);
});

test("voltar pra Pesquisar mantém a busca de preços intacta",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await page.locator('button[data-vista-precos="pesquisar"]').click();
  await expect(page.locator("#precos-pesquisar")).not.toHaveClass(/oculto/);
  await expect(page.locator("#precos-situacao")).toHaveClass(/oculto/);
});
