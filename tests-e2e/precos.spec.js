const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test("abrir a aba Preços esconde as outras telas", async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await expect(page.locator("#tela-precos")).toBeVisible();
  await expect(page.locator("#painel")).toBeHidden();
  await expect(page.locator("#lista")).toBeHidden();
  await expect(page.locator("#kpis-topo")).toBeHidden();
});

test("buscar um termo lista os itens e mostra o resumo estatístico",
  async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);   // debounce da busca
  await expect(page.locator("#pr-lista .linha:not(.cab)").first())
    .toBeVisible();
  await expect(page.locator("#precos-resumo")).toBeVisible();
  await expect(page.locator("#precos-resumo")).toContainText("selecionados");

  await page.locator("#pr-selecionar-todos").click();
  await page.waitForTimeout(100);
  await expect(page.locator("#precos-resumo")).toContainText("mediana");
});

test("marcar um item chama selecionar_preco e atualiza o resumo",
  async ({ page }) => {
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const caixa = page.locator("#pr-lista input[data-item]").first();
  await caixa.check();
  await expect
    .poll(() => page.evaluate(() => window.__chamadas
      .some(c => c.metodo === "selecionar_preco")))
    .toBe(true);
});

test("descartar um item exige motivo antes de confirmar",
  async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-lista button[data-descartar]").first().click();
  await expect(page.locator("#veu-descarte")).toBeVisible();
  await expect(page.locator("#desc-motivo option")).toHaveCount(4);
  await page.locator("#desc-motivo").selectOption("servico");
  await page.locator("#desc-confirmar").click();
  await expect(page.locator("#veu-descarte")).toBeHidden();
  const chamada = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "descartar_preco"));
  expect(chamada.motivo).toBe("servico");
});

test("Municípios de referência: listar, estimar e adicionar",
  async ({ page }) => {
  await page.locator("#btn-config").click();
  await expect(page.locator("#cfg-referencia")).toContainText("Olímpia");
  await page.locator("#ref-uf").selectOption("SP");
  await page.locator("#ref-busca").fill("Olímpia");
  await expect(page.locator("#ref-sugestoes button[data-c]").first())
    .toBeVisible();
  page.on("dialog", d => d.accept());
  await page.locator("#ref-sugestoes button[data-c]").first().click();
  await expect
    .poll(() => page.evaluate(() => window.__chamadas
      .some(c => c.metodo === "adicionar_municipio_referencia")))
    .toBe(true);
});
