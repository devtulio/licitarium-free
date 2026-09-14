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

test("passo 3 mostra só os itens marcados, não a lista de candidatos inteira (achado do usuário)",
    async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-continuar").click();
  // marca só o 1º item, não todos
  await page.locator("#pr-lista input[data-item]").first().check();
  await page.locator("#pr-continuar").click();
  await page.waitForTimeout(150);
  await expect(page.locator("#pr-lista .linha:not(.cab)")).toHaveCount(1);
  // sem cabeçalho "selecionar tudo" no Passo 3 — não faz sentido aqui
  await expect(page.locator("#pr-selecionar-cabecalho")).toHaveCount(0);
  // desmarcar o único item marcado esvazia a seleção e volta pro Passo 2
  await page.locator("#pr-lista input[data-item]").first().uncheck();
  await page.waitForTimeout(150);
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Selecionar");
});

test("teto de renderização protege o DOM num recorte grande (achado do usuário: pico de 1.8GB de RAM)",
    async ({ page }) => {
  // sobrescreve listar() no próprio pywebview.api mockado, devolvendo 400
  // itens — recorte grande de verdade, sem depender dos dados fixos do
  // harness
  await page.evaluate(() => {
    window.pywebview.api.listar = async () => ({
      itens: Array.from({ length: 400 }, (_, i) => ({
        id: `EXTRA#${i}`, descricao: `PAPEL EXTRA ${i}`, unidade: "UN",
        quantidade_homologada: 1, valor_unitario_homologado: 10,
        fornecedor_nome: "Fornecedor Extra", municipio_nome: "Orindiúva",
        sequencial: 1, ano: 2026 })),
      total: 400, total_base: 400 });
  });
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await expect(page.locator("#pr-lista .linha:not(.cab)")).toHaveCount(300);
  await expect(page.locator("#pr-lista")).toContainText("Mostrando 300 de");
});

test("voltar do passo 2 pro 1 preserva a busca", async ({ page }) => {
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-continuar").click();
  await page.locator("#pr-voltar").click();
  await expect(page.locator(".passos-precos .passo.on")).toContainText("Buscar");
  await expect(page.locator("#pr-busca")).toHaveValue("papel");
});
