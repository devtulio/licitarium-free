const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test("abrir o app sozinho não dispara sincronização — decide o usuário",
    async ({ page }) => {
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.some(c => c.metodo === "sincronizar")).toBe(false);
});

test("clique normal em Sincronizar não abre a modal", async ({ page }) => {
  await page.locator("#btn-sync").click();
  await expect(page.locator("#veu-sync-opcoes")).toHaveClass(/oculto/);
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual(
    [{ metodo: "sincronizar", forcado: undefined, escopo: undefined,
       ibge_escolhido: undefined }]);
});

test("▾ abre a modal com as opções de escopo", async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await expect(page.locator("#veu-sync-opcoes")).not.toHaveClass(/oculto/);
  const opcoes = page.locator('input[name="escopo-sync"]');
  await expect(opcoes).toHaveCount(4);
  await expect(page.locator("#opcoes-sync-lista")).toContainText("Olímpia");
  await expect(page.locator("#opcoes-sync-lista"))
    .toContainText("São José do Rio Preto");
});

test("escolher município revela o seletor, outro escopo esconde",
    async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  const select = page.locator("#opcoes-sync-municipio");
  await expect(select).toHaveClass(/oculto/);
  await page.locator('input[name="escopo-sync"][value="municipio"]').check();
  await expect(select).not.toHaveClass(/oculto/);
  await page.locator('input[name="escopo-sync"][value="tudo"]').check();
  await expect(select).toHaveClass(/oculto/);
});

test("submeter com escopo tudo chama sincronizar(true, 'tudo')",
    async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await page.locator("#btn-sync-opcoes-ir").click();
  await expect(page.locator("#veu-sync-opcoes")).toHaveClass(/oculto/);
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual(
    [{ metodo: "sincronizar", forcado: true, escopo: "tudo",
       ibge_escolhido: null }]);
});

test("submeter com escopo próprio chama sincronizar(true, 'proprio')",
    async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await page.locator('input[name="escopo-sync"][value="proprio"]').check();
  await page.locator("#btn-sync-opcoes-ir").click();
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual(
    [{ metodo: "sincronizar", forcado: true, escopo: "proprio",
       ibge_escolhido: null }]);
});

test("submeter com um município específico manda o ibge escolhido",
    async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await page.locator('input[name="escopo-sync"][value="municipio"]').check();
  await page.locator("#opcoes-sync-municipio").selectOption("3548500");
  await page.locator("#btn-sync-opcoes-ir").click();
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual(
    [{ metodo: "sincronizar", forcado: true, escopo: "municipio",
       ibge_escolhido: "3548500" }]);
});

test("submeter com 'município' apontando pro próprio vira escopo proprio",
    async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await page.locator('input[name="escopo-sync"][value="municipio"]').check();
  await page.locator("#opcoes-sync-municipio").selectOption("proprio");
  await page.locator("#btn-sync-opcoes-ir").click();
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual(
    [{ metodo: "sincronizar", forcado: true, escopo: "proprio",
       ibge_escolhido: null }]);
});

test("fechar sem sincronizar não dispara sincronizar", async ({ page }) => {
  await page.locator("#btn-sync-opcoes").click();
  await page.locator('#veu-sync-opcoes button:has-text("Fechar")').click();
  await expect(page.locator("#veu-sync-opcoes")).toHaveClass(/oculto/);
  const chamadas = await page.evaluate(() => window.__chamadas);
  expect(chamadas.filter(c => c.metodo === "sincronizar")).toEqual([]);
});
