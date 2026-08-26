const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test("salvar cópia relata o que foi guardado", async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator("#btn-exportar-acervo").click();
  const msg = page.locator("#acervo-msg");
  await expect(msg).toContainText("Cópia salva (12.3 MB)");
  await expect(msg).toContainText("2.674 itens");
});

test("restaurar pede confirmação e avisa que precisa reabrir",
    async ({ page }) => {
  await page.locator("#btn-config").click();

  // recusando, nada é chamado: trocar o acervo inteiro não pode ser acidente
  page.once("dialog", d => d.dismiss());
  await page.locator("#btn-importar-acervo").click();
  expect(await page.evaluate(() => window.__chamadas
    .some(c => c.metodo === "importar_acervo"))).toBe(false);

  page.on("dialog", d => d.accept());
  await page.locator("#btn-importar-acervo").click();
  await expect(page.locator("#acervo-msg"))
    .toContainText("Feche e abra o Licitarium");
});

test("arquivo recusado explica o motivo e não some com o aviso",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__respostaImportar = { ok: false,
      erro: "o banco dentro do arquivo está corrompido" };
  });
  await page.locator("#btn-config").click();
  page.on("dialog", d => d.accept());
  await page.locator("#btn-importar-acervo").click();
  await expect(page.locator("#acervo-msg"))
    .toContainText("Falhou: o banco dentro do arquivo está corrompido");
});

test("wizard (1ª execução) oferece restaurar cópia, sem pedir confirmação",
    async ({ page }) => {
  // quem já tinha o acervo salvo (troca de máquina, reinstalação) não
  // precisa escolher município e esperar o download desde 2021 pra só
  // depois lembrar que "Restaurar cópia…" existe em Configurações — o
  // backup já traz o município junto, é o mesmo licitarium.db inteiro.
  await page.evaluate(() => iniciarWizard());
  await expect(page.locator("#wizard")).toBeVisible();
  const restaurar = page.locator("#wiz-restaurar");
  await expect(restaurar).toBeVisible();

  // ao contrário de Configurações, aqui não há acervo prévio em risco —
  // o 1º diálogo tem de ser o aviso final (`alert`), não um `confirm` que
  // bloqueie o clique antes de restaurar
  let tipoPrimeiroDialogo = null;
  page.once("dialog", d => { tipoPrimeiroDialogo = d.type(); d.accept(); });
  await restaurar.click();
  await expect(page.locator("#wiz-restaurar-msg"))
    .toContainText("Feche e abra o Licitarium");
  expect(tipoPrimeiroDialogo).toBe("alert");
  expect(await page.evaluate(() => window.__chamadas
    .some(c => c.metodo === "importar_acervo"))).toBe(true);
});
