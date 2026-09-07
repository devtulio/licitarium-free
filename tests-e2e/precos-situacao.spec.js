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

test("voltar pra Pesquisar mantém a busca de preços intacta",
    async ({ page }) => {
  await page.locator('button[data-vista-precos="situacao"]').click();
  await page.locator('button[data-vista-precos="pesquisar"]').click();
  await expect(page.locator("#precos-pesquisar")).not.toHaveClass(/oculto/);
  await expect(page.locator("#precos-situacao")).toHaveClass(/oculto/);
});
