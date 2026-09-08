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
  await page.evaluate(() => { window.__selecionados = {}; });
  await page.locator('nav.abas button[data-tipo="precos"]').click();
  await page.locator("#pr-busca").fill("papel");
  await page.waitForTimeout(400);   // debounce da busca
  await expect(page.locator("#pr-lista .linha:not(.cab)").first())
    .toBeVisible();
  await expect(page.locator("#precos-resumo")).toBeVisible();
  await expect(page.locator("#precos-resumo")).toContainText("selecionados");

  await page.locator("#pr-selecionar-cabecalho").check();
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
  // semáforo de status (portado do Pretiarium Free): verde = já sincronizou
  await expect(page.locator("#cfg-referencia .bolinha-status"))
    .toHaveClass(/status-verde/);
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

test("estimar município de referência mostra sinal de carregamento (achado do usuário)",
  async ({ page }) => {
  // consulta real ao PNCP sem sinal nenhum parecia travada — achado do
  // usuário, 2026-09-08
  await page.evaluate(() => { window.__delayEstimar = 80; });
  await page.locator("#btn-config").click();
  await page.locator("#ref-uf").selectOption("SP");
  await page.locator("#ref-busca").fill("Olímpia");
  await expect(page.locator("#ref-sugestoes button[data-c]").first())
    .toBeVisible();
  page.on("dialog", d => d.accept());
  await page.locator("#ref-sugestoes button[data-c]").first().click();
  await expect(page.locator("#ref-sugestoes")).toContainText("Estimando");
  await expect
    .poll(() => page.evaluate(() => window.__chamadas
      .some(c => c.metodo === "adicionar_municipio_referencia")))
    .toBe(true);
});

test("relatório de cobertura da coleta abre pela ponte",
  async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator("#btn-cobertura").click();
  const chamada = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "gerar_relatorio" && c.tipo === "cobertura"));
  expect(chamada).toBeTruthy();
});

test("Municípios de referência: ordenar e persistir a escolha",
  async ({ page }) => {
  await page.evaluate(() => {
    window.__municipiosReferencia = [
      { ibge: "3533908", nome: "Olímpia", uf: "SP", itens: 5, mb: 1,
        status: "verde" },
      { ibge: "3548500", nome: "Zebra", uf: "SP", itens: 50, mb: 9,
        status: "verde" },
      { ibge: "3550308", nome: "Ábaco", uf: "SP", itens: 0, mb: 0,
        status: "vermelho" },
      { ibge: "3500204", nome: "Adolfo", uf: "SP", itens: 0, mb: 0,
        status: "verde" },
    ];
  });
  await page.locator("#btn-config").click();
  const nomes = () => page.locator("#cfg-referencia .orgrow")
    .allTextContents();
  // padrão: tamanho em disco, maior primeiro
  await expect.poll(nomes).toEqual(
    expect.arrayContaining([expect.stringContaining("Zebra")]));
  await expect((await nomes())[0]).toContain("Zebra");
  await expect(page.locator("#cfg-referencia")).toContainText(
    "ainda sem preços — aguardando sincronização");
  // coleta completa (verde) mas sem homologação ainda: mensagem não pode
  // confundir "sincronizou tudo" com "já tem preço pronto"
  await expect(page.locator("#cfg-referencia")).toContainText(
    "coleta completa, mas nenhum item homologado ainda no PNCP");
  // trocar pra nome (A-Z)
  await page.locator("#ref-ordem").selectOption("nome");
  await expect((await nomes())[0]).toContain("Ábaco");
  const chamada = await page.evaluate(() => window.__chamadas
    .find(c => c.metodo === "set_config" && c.k === "ref_ordem"));
  expect(chamada.v).toBe("nome");
  // trocar pra preços no banco (mais primeiro)
  await page.locator("#ref-ordem").selectOption("itens");
  await expect((await nomes())[0]).toContain("Zebra");
});
