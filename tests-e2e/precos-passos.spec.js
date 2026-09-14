// Sequência guiada de 3 passos da pesquisa de preços (2026-09-14):
// Buscar → Selecionar → Comparar. Screenshots em tests-e2e/screens/
// servem de conferência visual — não são asserção.
const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => {
  await abrirApp(page);
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
});

test("passo 1: lista só leitura, sem checkbox", async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Buscar");
  await expect(page.locator("#pr-lista .linha:not(.cab) input[type=checkbox]"))
    .toHaveCount(0);
  await expect(page.locator("#pr-continuar")).toBeEnabled();
  await page.screenshot({ path: "tests-e2e/screens/passo1-buscar.png",
    fullPage: true });
});

test("passo 2: continuar mostra checkbox por linha e barra de seleção em lote",
    async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-continuar").click();
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Selecionar");
  await expect(page.locator("#pr-lista .linha:not(.cab) input[type=checkbox]")
    .first()).toBeVisible();
  await expect(page.locator("#pr-sel-fornecedor")).toBeVisible();
  await page.screenshot({ path: "tests-e2e/screens/passo2-selecionar.png",
    fullPage: true });
});

test("passo 3: marcar tudo e comparar mostra o resumo escopado pela seleção",
    async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-continuar").click();
  await page.locator("#pr-selecionar-cabecalho").check();
  await page.waitForTimeout(100);
  await page.locator("#pr-continuar").click();
  await page.waitForTimeout(150);
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Comparar");
  await expect(page.locator("#precos-resumo")).toBeVisible();
  await expect(page.locator("#precos-resumo")).toContainText("mediana");
  await page.screenshot({ path: "tests-e2e/screens/passo3-comparar.png",
    fullPage: true });
});

test("voltar do passo 2 pro 1 preserva a busca", async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-continuar").click();
  await page.locator("#pr-voltar").click();
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Buscar");
  await expect(page.locator("#pr-busca")).toHaveValue("papel");
});
