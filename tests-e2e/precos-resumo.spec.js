const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

// pesquisar "papel" e selecionar tudo é o único caminho, no mock, que
// devolve o objeto de estatísticas completo (itens/fora_da_curva/
// por_municipio) — mesmo gatilho que os testes já existentes usam
async function buscarESelecionarTudo(page) {
  // fresca, sem nada marcado — o mock por padrão devolve "tudo
  // selecionado" (atalho pra não reescrever todo teste que não é sobre
  // seleção), então zera aqui pra exercitar o checkbox de cabeçalho de
  // verdade (senão ele já nasce marcado e .check() vira no-op)
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-selecionar-cabecalho").check();
  await page.waitForTimeout(100);
}

test("botão de descartar não tampa o número do processo (achado do usuário)",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const celula = page.locator("#pr-lista .linha:not(.cab) .col-processo").first();
  const botao = celula.locator(".btn-descartar-item");
  const numero = celula.locator("span");
  // o botão de descartar é compacto (não usa mais o .btn.ghost de padding
  // grande, que espremia o número do processo pra fora da coluna estreita)
  const largura = await botao.evaluate(el =>
    parseFloat(getComputedStyle(el).width));
  expect(largura).toBeLessThanOrEqual(24);
  await expect(numero).toHaveText(/\d+\/\d+/);
  await expect(numero).toBeVisible();
});

test("número do processo sai sequencial/ano, não ano/sequencial (achado do usuário)",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const numero = page.locator("#pr-lista .linha:not(.cab) .col-processo span").first();
  // X-3#1 no mock: sequencial 50, ano 2025 — sequencial vem primeiro,
  // igual ao mesmo dado em Contratações (achado do usuário, 2026-09-08:
  // estava saindo "2025/50")
  await expect(numero).toHaveText("50/2025");
});

test("clicar num item de preço abre a mesma ficha de detalhe de Contratações",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-lista .linha:not(.cab)").first().click();
  await expect(page.locator("#veu-detalhe")).toBeVisible();
  await expect(page.locator("#det-raw")).toContainText("exemplo");
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "detalhe").pop());
  expect(chamada.tipo).toBe("itens");
});

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
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  const larguraDe = i => page.evaluate(n => parseFloat(
    getComputedStyle(document.querySelector("#pr-lista .cab"))
      .gridTemplateColumns.split(" ")[n]), i);
  const antes = await larguraDe(2);   // coluna Unid.
  const alca = page.locator("#pr-lista .cab > span").nth(2).locator(".alca");
  // com a corrida do resumo corrigida (2026-09-07), "papel" agora conta
  // com seleção completa de verdade e a comparação com vizinhos acusa
  // sinal fora da curva — a tabela desce e a alça sai do viewport padrão
  await alca.scrollIntoViewIfNeeded();
  const cx = await alca.boundingBox();
  await page.mouse.move(cx.x + cx.width / 2, cx.y + cx.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx.x + cx.width / 2 + 40, cx.y + cx.height / 2,
                        { steps: 5 });
  await page.mouse.up();
  const depois = await larguraDe(2);
  // a coluna Unid. é estreita e o flex (Descrição) tem piso de 170px —
  // não cabem os 40px inteiros arrastados, mas tem que crescer de verdade
  expect(depois).toBeGreaterThan(antes + 10);
  const salvo = await page.evaluate(() => window.__chamadas.filter(
    c => c.metodo === "set_config" && c.k === "colunas").pop());
  expect(JSON.parse(salvo.v)["itens:8"][2]).toBeGreaterThan(antes + 10);
});

test("checkbox de cabeçalho marca tudo respeitando o filtro de unidade ativo",
    async ({ page }) => {
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-unidade").selectOption("Caixa");
  await page.waitForTimeout(100);
  await page.locator("#pr-selecionar-cabecalho").check();
  await page.waitForTimeout(100);
  const chamada = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "selecionar_todos_precos"));
  expect(chamada.unidade).toBe("Caixa");
});

test("desmarcar o checkbox de cabeçalho limpa só o recorte filtrado",
    async ({ page }) => {
  await buscarESelecionarTudo(page);
  await page.locator("#pr-unidade").selectOption("Caixa");
  await page.waitForTimeout(100);
  await page.locator("#pr-selecionar-cabecalho").uncheck();
  await page.waitForTimeout(100);
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "desselecionar_preco").pop());
  expect(chamada.item_id).toBeFalsy();
  expect(chamada.unidade).toBe("Caixa");
});

test("comparação com municípios de referência aparece já na busca, sem seleção",
    async ({ page }) => {
  // a comparação olha a pesquisa INTEIRA (incluidos=null), não só o que
  // está selecionado — "onde está mais barato" é uma pergunta diferente
  // da do resumo ("a minha seleção"), por isso aparece independente dela
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await expect(page.locator("#precos-resumo")).toBeVisible();
  await expect(page.locator("#precos-resumo")).toContainText("0 de");
  await expect(page.locator("#pr-sel-fornecedor")).toBeVisible();

  await expect(page.locator("#precos-vizinhos")).toBeVisible();
  await expect(page.locator("#precos-vizinhos")).toContainText(
    "Comparação com municípios de referência");
  await expect(page.locator("#precos-vizinhos-grafico svg")).toBeVisible();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "estatisticas_preco").pop());
  expect(chamada.incluidos).toBeNull();
});

test("limpar a busca esconde a comparação com vizinhos da pesquisa anterior",
    async ({ page }) => {
  // achado do usuário (2026-09-08): só o resumo escondia ao apagar a
  // busca — a comparação com vizinhos da pesquisa anterior ficava lá
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-selecionar-cabecalho").check();
  await page.waitForTimeout(100);
  await expect(page.locator("#precos-vizinhos")).toBeVisible();
  await page.locator("#pr-busca").fill("");
  await page.waitForTimeout(400);
  await expect(page.locator("#precos-resumo")).toBeHidden();
  await expect(page.locator("#precos-vizinhos")).toBeHidden();
});

test("descartar um sinal na comparação com vizinhos exige motivo",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);
  await page.locator("#pr-selecionar-cabecalho").check();
  await page.waitForTimeout(100);
  await expect(page.locator("#precos-vizinhos")).toContainText("preço destoa");
  await page.locator("#pr-descartar-sinal-vizinhos").click();
  await expect(page.locator("#veu-descarte")).toBeVisible();
  await page.locator("#desc-motivo").selectOption("erro");
  await page.locator("#desc-confirmar").click();
  const chamadas = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "descartar_preco"));
  expect(chamadas.map(c => c.item_id)).toEqual(["X-3#10"]);
  expect(chamadas[0].motivo).toBe("erro");
});
