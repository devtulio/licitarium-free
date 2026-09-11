// Gera os screenshots do README (docs/screenshots/*.png) com dados de exemplo.
const path = require("path");
const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

const DESTINO = path.resolve(__dirname, "..", "docs", "screenshots");

for (const tema of ["portal", "pergaminho", "observatorio", "civil"]) {
  test(`screenshot tema ${tema}`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 860 });
    await abrirApp(page);
    await page.evaluate(t => {
      document.documentElement.dataset.theme = t;
    }, tema);
    // a tela inicial é o Painel: o retrato do README mostra os gráficos
    await expect(page.locator("#p-execucao .card")).not.toHaveCount(0);
    // a splash tem piso de 900 ms: sem esperar, o retrato sai dela
    await expect(page.locator("#splash")).toBeHidden();
    await page.screenshot({ path: path.join(DESTINO, `${tema}.png`) });
  });
}

// docs/screenshots/montar-pca.png ficava órfão (não gerado por nenhum
// teste, nunca usado no README) e desatualizado — mostrava "Exportar CSV",
// trocado por "Exportar planilha" na v1.45.2. Gerado aqui de propósito, na
// mesma rodada dos outros, e passa a ilustrar a seção "Montar PCA" do
// README (achado 2026-08-30: texto sem nenhum retrato).
test("screenshot montar PCA", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 860 });
  await abrirApp(page);
  await expect(page.locator("#splash")).toBeHidden();
  await page.locator("#btn-pca").click();
  await expect(page.locator("#veu-pca")).toBeVisible();
  await page.locator("#pca-gerar").click();
  await expect(page.locator("#pca-lista .linha:not(.cab)")).not.toHaveCount(0);
  await page.screenshot({ path: path.join(DESTINO, "montar-pca.png") });
});
