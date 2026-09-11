// Achados da auditoria de acessibilidade (2026-08-09). Estes travam o que
// um leitor de tela recebe — coisa que nenhum teste anterior olhava.
const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test("aba selecionada é anunciada, não só pintada", async ({ page }) => {
  // a classe .on pinta; sem aria-selected o leitor de tela anuncia N abas
  // e nenhuma marcada
  const painel = page.locator('nav.abas button[data-tipo="painel"]');
  await expect(painel).toHaveAttribute("aria-selected", "true");
  await page.locator('nav.abas button[data-tipo="contratacoes"]').click();
  await expect(painel).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('nav.abas button[data-tipo="contratacoes"]'))
    .toHaveAttribute("aria-selected", "true");
});

test("subaba do Painel também anuncia a seleção", async ({ page }) => {
  const execucao = page.locator('.subabas button[data-vista="execucao"]');
  await expect(execucao).toHaveAttribute("aria-selected", "true");
  await page.locator('.subabas button[data-vista="economia"]').click();
  await expect(execucao).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('.subabas button[data-vista="economia"]'))
    .toHaveAttribute("aria-selected", "true");
});

test("todo gráfico tem nome acessível e não esconde os rótulos",
    async ({ page }) => {
  // Análise tem a maior variedade de gráficos hoje (funil, série, deságio,
  // concentração, calor) — Economia perdeu "acumulada" e "por fornecedor"
  // na fase 6 do handoff (2026-09-11) e "por categoria" virou tabela
  await page.locator('.subabas button[data-vista="analise"]').click();
  await page.waitForTimeout(250);
  // [data-overlay] é a camada de corte vertical/rótulo por cima do SVG do
  // ECharts (ver painel.js:grafSeries) — decorativa, aria-hidden, e o
  // gráfico de baixo já carrega o nome acessível
  const graficos = await page.evaluate(() =>
    [...document.querySelectorAll("#p-analise svg:not([data-overlay])")]
      .map(s => ({
        // o nome acessível é `aria-label`, não <title>: o <title> desenhava o
        // balão preto nativo por cima do tooltip próprio (trocado por todos os
        // gráficos, mesma correção do calendário na 1.40.1)
        nome: s.getAttribute("aria-label") ?? "",
        temTitle: !!s.querySelector(":scope > title"),
        papel: s.getAttribute("role"),
      })));
  expect(graficos.length).toBeGreaterThanOrEqual(4);
  for (const g of graficos) {
    expect(g.nome.length).toBeGreaterThan(3);   // aria-label = nome acessível
    expect(g.temTitle).toBe(false);             // nada de balão preto nativo
    // role="img" tornaria os <text> de dentro apresentacionais, e é neles
    // que moram os números — ver comentário em painel.js:svg()
    expect(g.papel).toBeNull();
  }
});

test("as mensagens dinâmicas são regiões vivas", async ({ page }) => {
  // são o único canal de retorno, inclusive dos erros
  for (const id of ["sync-msg", "brasao-status", "pca-status"])
    await expect(page.locator(`#${id}`)).toHaveAttribute("role", "status");
});
