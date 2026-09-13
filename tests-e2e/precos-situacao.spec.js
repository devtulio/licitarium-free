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
  await expect(page.locator("#painel-concentracao-svg svg").first()).toBeVisible();
  const temZoom = await page.locator("#painel-concentracao-svg").evaluate(
    el => el.__echart.getOption().dataZoom.length > 0);
  expect(temZoom).toBe(true);
});

test("cartões dos gráficos ficam lado a lado em 2 colunas",
    async ({ page }) => {
  // pedido do usuário (2026-09-13): volta atrás da mudança pra 1 coluna
  // (v2.12.3) — gráfico pareia com gráfico de novo.
  await page.locator('button[data-vista-precos="situacao"]').click();
  const anoBox = await page.locator("#painel-grafico-ano").boundingBox();
  const tipoBox = await page.locator("#painel-grafico-tipo").boundingBox();
  // em 2 colunas, o 2º cartão fica ao LADO do 1º (mesma linha, x maior)
  expect(Math.abs(tipoBox.y - anoBox.y)).toBeLessThan(5);
  expect(tipoBox.x).toBeGreaterThan(anoBox.x + anoBox.width - 5);
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
