const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

// pesquisar "papel" e selecionar tudo é o único caminho, no mock, que
// devolve o objeto de estatísticas completo (itens/fora_da_curva/
// por_municipio) — mesmo gatilho que os testes já existentes usam
async function buscarESelecionarTudo(page) {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-selecionar-todos").click();
  await page.waitForTimeout(100);
}

test("gráficos de preço desenham: boxplot, série temporal e por município",
    async ({ page }) => {
  await buscarESelecionarTudo(page);
  await expect(page.locator("#precos-boxplot svg")).toBeVisible();
  await expect(page.locator("#precos-serie svg")).toBeVisible();
  await expect(page.locator("#precos-municipio svg")).toBeVisible();
  await expect(page.locator("#precos-resumo")).toContainText("Por município");
  await expect(page.locator("#precos-resumo")).toContainText("Ao longo do tempo");
});

test("preço fora da curva vira aviso com botão de descarte em lote",
    async ({ page }) => {
  await buscarESelecionarTudo(page);
  await expect(page.locator("#precos-resumo")).toContainText("preço destoa");
  page.on("dialog", d => d.accept());
  await page.locator("#pr-descartar-fora").click();
  await expect(page.locator("#veu-descarte")).toBeVisible();
  await page.locator("#desc-motivo").selectOption("erro");
  await page.locator("#desc-confirmar").click();
  const chamadas = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "descartar_preco"));
  expect(chamadas.map(c => c.item_id)).toEqual(["X-3#10"]);
  expect(chamadas[0].motivo).toBe("erro");
});

test("seleção em lote: fornecedor, faixa de valor e texto na descrição",
    async ({ page }) => {
  await buscarESelecionarTudo(page);
  await page.locator("#pr-sel-fornecedor").selectOption("11.111.111/0001-11");
  await expect.poll(() => page.evaluate(() => window.__chamadas
    .some(c => c.metodo === "selecionar_por_fornecedor"))).toBe(true);

  await page.locator("#pr-sel-valor-min").fill("10");
  await page.locator("#pr-sel-valor-max").fill("50");
  await page.locator("#pr-btn-selecionar-faixa").click();
  const faixa = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "selecionar_por_faixa"));
  expect(faixa.minimo).toBe(10);
  expect(faixa.maximo).toBe(50);

  await page.locator("#pr-sel-texto").fill("sulfite");
  await page.locator("#pr-btn-selecionar-texto").click();
  const texto = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "selecionar_por_texto"));
  expect(texto.contendo).toBe("sulfite");
});

test("escolher uma unidade classifica a pesquisa, não só filtra",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-unidade").selectOption({ index: 1 });
  await expect.poll(() => page.evaluate(() => window.__chamadas
    .some(c => c.metodo === "classificar_por_unidade"))).toBe(true);
});

test("ordenar a lista de preços por clique manda ord/dir à ponte",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const cabFornecedor = page.locator('#pr-lista .cab span[data-ord="fornecedor"]');
  await cabFornecedor.click();
  await expect(cabFornecedor).toHaveAttribute("aria-sort", "ascending");
  await cabFornecedor.click();
  await expect(cabFornecedor).toHaveAttribute("aria-sort", "descending");
  const chamadas = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar" && c.tipo === "itens").slice(-2));
  expect(chamadas[0].filtros.ord).toBe("fornecedor");
  expect(chamadas[0].filtros.dir).toBe("asc");
  expect(chamadas[1].filtros.dir).toBe("desc");
});

test("arrastar a alça redimensiona a coluna de preços e persiste",
    async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const larguraDe = i => page.evaluate(n => parseFloat(
    getComputedStyle(document.querySelector("#pr-lista .cab"))
      .gridTemplateColumns.split(" ")[n]), i);
  const antes = await larguraDe(2);   // coluna Unid.
  const alca = page.locator("#pr-lista .cab > span").nth(2).locator(".alca");
  const cx = await alca.boundingBox();
  await page.mouse.move(cx.x + cx.width / 2, cx.y + cx.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx.x + cx.width / 2 + 40, cx.y + cx.height / 2,
                        { steps: 5 });
  await page.mouse.up();
  const depois = await larguraDe(2);
  expect(depois).toBeGreaterThan(antes + 30);
  const salvo = await page.evaluate(() => window.__chamadas.filter(
    c => c.metodo === "set_config" && c.k === "colunas").pop());
  expect(JSON.parse(salvo.v)["itens:8"][2]).toBeGreaterThan(antes + 30);
});
