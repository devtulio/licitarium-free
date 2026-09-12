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

test("voltar pra Pesquisar mantém a busca de preços intacta",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await page.locator('button[data-vista-precos="pesquisar"]').click();
  await expect(page.locator("#precos-pesquisar")).not.toHaveClass(/oculto/);
  await expect(page.locator("#precos-situacao")).toHaveClass(/oculto/);
});
