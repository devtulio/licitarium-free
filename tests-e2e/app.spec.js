const { test, expect } = require("@playwright/test");
const { abrirApp, abrirLista } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

test.describe("splash", () => {
  test.use({ }); // testes que precisam da splash antes do app pronto

  test("aparece no tema da URL e some quando o acervo abre",
      async ({ page }) => {
    // já montada pelo beforeEach: some sozinha ao fim do carregamento
    // sem timeout próprio: o global (10s) existe justamente porque o
    // primeiro teste do CI paga o aquecimento da máquina — com 5s aqui,
    // este assert já falhou em run frio enquanto passava em 1,8s local
    await expect(page.locator("#splash")).toHaveCount(0);
  });

  test("sem tema.js (reserva): assume o do banco e remonta a splash",
      async ({ page }) => {
    // cenário de fallback — o arquivo do Python não chegou; a splash nasce
    // no padrão e é remontada quando o tema do banco é lido
    // sem tema.js algum: cenário de reserva
    await page.route("**/tema.js", r => r.fulfill({ status: 404, body: "" }));
    await page.addInitScript(() => {
      delete window.__TEMA;
      try { localStorage.clear(); } catch {}
    });
    await abrirApp(page, { temaBanco: "pergaminho" });
    await expect(page.locator("#splash .cx.diploma")).toBeVisible();
    await expect(page.locator("html"))
      .toHaveAttribute("data-theme", "pergaminho");
    // e fica guardado para a próxima abertura já nascer certa
    expect(await page.evaluate(() => localStorage.getItem("tema")))
      .toBe("pergaminho");
  });

  for (const [tema, marca] of [["portal", ".cx"],
                               ["pergaminho", ".cx.diploma"],
                               ["observatorio", ".anel .giro"],
                               ["civil", ".cx.civil"]]) {
    test(`composição do tema ${tema}`, async ({ page }) => {
      // serve o tema.js como o Python o escreve (interceptar o arquivo, e
      // não injetar a variável: o próprio arquivo do app a sobrescreveria)
      await page.route("**/tema.js", r =>
        r.fulfill({ contentType: "application/javascript",
                    body: `window.__TEMA = "${tema}";` }));
      await page.goto(require("./harness").URL_UI);
      await expect(page.locator("#splash")).toBeVisible();
      await expect(page.locator(`#splash ${marca}`)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", tema);
    });
  }
});

test("boot: app abre com município, KPIs e alertas", async ({ page }) => {
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#wizard")).toBeHidden();
  await expect(page.locator("#sub-municipio"))
    .toContainText("Orindiúva · SP");
  await expect(page.locator("#kpi-contratacoes")).toHaveText("131");
  // contrato e ata são alertas separados — cada um vai a uma tela diferente
  await expect(page.locator("#chip-vencendo-contratos")).toContainText("7");
  await expect(page.locator("#chip-vencendo-atas")).toContainText("2");
  await expect(page.locator("#chip-propostas")).toContainText("2");
});

test("lista renderiza e ordenação por clique manda ord/dir à ponte",
    async ({ page }) => {
  await abrirLista(page);   // a tela inicial agora é o Painel
  await expect(page.locator(".linha:not(.cab)")).toHaveCount(3);
  const cabObjeto = page.locator('.cab span[data-ord="objeto"]');
  await cabObjeto.click();
  await expect(cabObjeto).toHaveAttribute("aria-sort", "ascending");
  await cabObjeto.click();
  await expect(cabObjeto).toHaveAttribute("aria-sort", "descending");
  const chamadas = await page.evaluate(() =>
    window.__chamadas.filter(c => c.metodo === "listar").slice(-2));
  expect(chamadas[0].filtros.ord).toBe("objeto");
  expect(chamadas[0].filtros.dir).toBe("asc");
  expect(chamadas[1].filtros.dir).toBe("desc");
});

test("fileira de filtros tem folga vertical maior que a horizontal",
    async ({ page }) => {
  // achado da auditoria de design (2026-08-08): quando a barra quebra em
  // duas linhas (Contratações, Preços — muitos filtros), a segunda linha
  // colava na primeira e parecia um acidente de largura, não uma fileira
  // deliberada. row-gap maior que column-gap separa as duas visualmente.
  await abrirLista(page, "contratacoes");
  const gap = await page.locator("#filtros-lista").evaluate(el => {
    const s = getComputedStyle(el);
    return { linha: parseFloat(s.rowGap), coluna: parseFloat(s.columnGap) };
  });
  expect(gap.linha).toBeGreaterThan(gap.coluna);
});

test("checkbox de filtro tem alvo de clique maior que a linha de texto",
    async ({ page }) => {
  // achado da auditoria de design (2026-08-08): a área clicável seguia a
  // altura da linha de texto (13px de fonte, ~16-18px de área) — não é
  // bloqueio WCAG AA (alvo de 44px é AAA), mas incomodava no trackpad
  await abrirLista(page, "contratacoes");
  const altura = await page.locator("#cx-propostas").evaluate(
    el => el.getBoundingClientRect().height);
  expect(altura).toBeGreaterThanOrEqual(24);
});

test("fornecedor da lista de contratos carrega o nome completo no title",
    async ({ page }) => {
  // achado da auditoria de design (2026-08-08) — mesmo padrão do Painel
  await page.locator('nav.abas button[data-tipo="contratos"]').click();
  // .dim aparece 3x por linha (nº do contrato, fornecedor, vigência) — o
  // fornecedor é o segundo, dentro do mesmo span que o objeto
  const fornecedor = page.locator(".linha:not(.cab)").first()
    .locator(".dim").nth(1);
  await expect(fornecedor).toHaveAttribute("title",
    "DANILO HENRIQUE NUNES CONSULTORIA");
});

test("abas trocam colunas e detalhe abre ao clicar na linha",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="contratos"]').click();
  await expect(page.locator(".cab")).toContainText("Contrato");
  await expect(page.locator(".linha:not(.cab)").first())
    .toContainText("33/2026");   // "0033/26" normalizado para numero/ano
  await page.locator(".linha:not(.cab)").first().click();
  await expect(page.locator("#veu-detalhe")).toBeVisible();
  // JSON bruto formatado e colorido (chave + booleano do mock)
  await expect(page.locator("#det-raw .j-chave").first()).toContainText("exemplo");
  await expect(page.locator("#det-raw .j-bool")).toHaveText("true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#veu-detalhe")).toBeHidden();
});

test("contratos e atas separam vigência inicial/final e status em colunas próprias",
    async ({ page }) => {
  // pedido do usuário (2026-08-12): "Vigência" combinada (duas datas + selo
  // espremidos numa célula) virou 3 colunas — vig. inicial, vig. final, status
  await page.locator('nav.abas button[data-tipo="contratos"]').click();
  const cabecalho = page.locator(".cab > *");
  await expect(cabecalho).toHaveText(["Contrato", "Objeto / Fornecedor",
    "Vigência inicial", "Vigência final", "Status", "Valor"]);
  const primeira = page.locator(".linha:not(.cab)").first();
  const celulas = primeira.locator("> *");
  await expect(celulas.nth(2)).toHaveText("28/05/2026");   // vigência inicial
  await expect(celulas.nth(3)).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/);  // final
  await expect(celulas.nth(4).locator(".badge")).toBeVisible();  // status

  await page.locator('nav.abas button[data-tipo="atas"]').click();
  await expect(page.locator(".cab > *")).toHaveText(["Ata",
    "Contratação de origem", "Objeto", "Vigência inicial", "Vigência final",
    "Status"]);
});

test("Configurações abre no clique e busca os dados em paralelo, não em fila",
    async ({ page }) => {
  // achado 2026-08-12 (relatado pelo usuário): a modal só aparecia depois
  // de 5 idas-e-voltas sequenciais à ponte pywebview — cada `await` soma o
  // ida-e-volta, então o atraso total era a SOMA, não o maior dos cinco.
  // Cronometrado dentro da página (performance.now()): o round-trip
  // Node↔navegador do Playwright some do meio, senão os limiares abaixo
  // não têm folga nenhuma pra variação normal do CI.
  const ATRASO = 200;
  const { tAbriu, tCompletou } = await page.evaluate(async (ms) => {
    const lenta = (fn) => (...a) => new Promise(r =>
      setTimeout(() => r(fn(...a)), ms));
    const api = window.pywebview.api;
    for (const m of ["get_estado", "brasao", "listar_orgaos", "ultimo_log"])
      api[m] = lenta(api[m].bind(api));
    const t0 = performance.now();
    document.querySelector("#btn-config").click();
    while (document.querySelector("#veu-config").classList.contains("oculto"))
      await new Promise(r => setTimeout(r, 1));
    const tAbriu = performance.now() - t0;
    while (!document.querySelector("#cfg-municipio").textContent.trim())
      await new Promise(r => setTimeout(r, 1));
    return { tAbriu, tCompletou: performance.now() - t0 };
  }, ATRASO);
  // a modal abre antes mesmo da primeira chamada lenta responder — não
  // espera resposta nenhuma pra aparecer
  expect(tAbriu).toBeLessThan(ATRASO);
  // 5 chamadas de 200ms em paralelo terminam perto de 200ms; em fila
  // seriam ~1000ms — a folga de 2x cobre a variação normal do CI
  expect(tCompletou).toBeLessThan(ATRASO * 2);
});

test("ficha impressa: objeto no corpo (não no cabeçalho) e origem vira link do PNCP",
    async ({ page }) => {
  // pedido do usuário (2026-08-12): cabeçalho = brasão + município;
  // objeto desce pro corpo; "Contratação de origem" vira link no papel
  await page.locator('nav.abas button[data-tipo="atas"]').click();
  await page.locator(".linha:not(.cab)").first().click();
  await expect(page.locator("#veu-detalhe")).toBeVisible();
  await page.locator("#det-imprimir").click();

  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_detalhe").pop());
  // "Contratação de origem" (45148970000177-1-000061/2025 na 1ª ata do
  // mock) veio como link pro edital, com o mesmo texto de antes
  expect(chamada.meta_html).toContain(
    '<a href="https://pncp.gov.br/app/editais/45148970000177/2025/61">'
    + '45148970000177-1-000061/2025</a>');
  // na TELA (não na impressão) segue texto puro — nunca um <a href> cru
  // dentro da modal do pywebview, que navegaria a janela do app pra fora
  const metaTela = await page.locator("#det-meta").innerHTML();
  expect(metaTela).not.toContain("<a href");
});

test("botão Imprimir do modal de detalhe manda o que a tela já mostra",
    async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="contratos"]').click();
  await page.locator(".linha:not(.cab)").first().click();
  await expect(page.locator("#veu-detalhe")).toBeVisible();
  const titulo = await page.locator("#det-titulo").textContent();
  await page.locator("#det-imprimir").click();

  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "imprimir_detalhe").pop());
  expect(chamada.tipo).toBe("contratos");
  expect(chamada.titulo).toBe(titulo);
  // o mesmo HTML já formatado (moeda/data) que está em #det-meta na tela —
  // não reimplementa rótulo por rótulo no Python
  expect(chamada.meta_html).toContain('class="k"');
  expect(chamada.meta_html).toContain('class="v"');
  // achado 2026-08-12: faltava o JSON completo (mesmo que o modal mostra
  // em "Dados completos") — a ficha impressa ficava sem ele
  expect(chamada.raw_html).toContain('class="j-chave"');
});

test("tema troca via configurações e persiste via set_config",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator('.tcard[data-tema="observatorio"]').click();
  await expect(page.locator("html"))
    .toHaveAttribute("data-theme", "observatorio");
  const salvo = await page.evaluate(() =>
    window.__chamadas.find(c => c.metodo === "set_config" && c.k === "tema"));
  expect(salvo.v).toBe("observatorio");
});

test("arrastar a alça redimensiona a coluna e persiste", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.locator('nav.abas button[data-tipo="contratacoes"]').click();
  const larguraDe = i => page.evaluate(n => parseFloat(
    getComputedStyle(document.querySelector(".lista .cab"))
      .gridTemplateColumns.split(" ")[n]), i);
  const antes = await larguraDe(1);                 // coluna Modalidade
  const alca = page.locator(".cab > span").nth(1).locator(".alca");
  const cx = await alca.boundingBox();
  await page.mouse.move(cx.x + cx.width / 2, cx.y + cx.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx.x + cx.width / 2 + 40, cx.y + cx.height / 2,
                        { steps: 5 });
  await page.mouse.up();
  const depois = await larguraDe(1);
  expect(depois).toBeGreaterThan(antes + 30);
  // a coluna elástica (Objeto, índice 2) cedeu espaço, mas não abaixo do mínimo
  expect(await larguraDe(2)).toBeGreaterThanOrEqual(160);
  // largura salva para voltar na próxima abertura
  const salvo = await page.evaluate(() => window.__chamadas.filter(
    c => c.metodo === "set_config" && c.k === "colunas").pop());
  expect(JSON.parse(salvo.v)["contratacoes"][1]).toBeGreaterThan(antes + 30);
  // ordenação não dispara ao arrastar sobre o cabeçalho
  const chamadas = await page.evaluate(() => window.__chamadas.filter(
    c => c.metodo === "listar" && c.filtros && c.filtros.ord));
  expect(chamadas).toEqual([]);
});

test("restaurar larguras volta ao padrão", async ({ page }) => {
  await page.locator('nav.abas button[data-tipo="contratacoes"]').click();
  await page.locator(".cab > span").nth(1).locator(".alca").dblclick();
  await expect(page.locator("#lista")).toHaveAttribute("style", /--cols/);
  await page.locator("#btn-config").click();
  await page.locator("#btn-restaurar-colunas").click();
  const style = await page.locator("#lista").getAttribute("style");
  expect(style || "").not.toContain("--cols");
});

test("relatório executivo manda os gráficos do Painel já desenhados pro papel",
    async ({ page }) => {
  await page.locator("#btn-relatorios").click();
  await expect(page.locator("#veu-relatorios")).toBeVisible();
  await page.locator("#rel-tipo").selectOption("executivo");
  await page.locator("#rel-gerar").click();

  const previa = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "painel").pop());
  expect(previa).toBeTruthy();

  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "gerar_relatorio").pop());
  expect(chamada.tipo).toBe("executivo");
  expect(chamada.params.graficos.meses).toContain("<svg");
  expect(chamada.params.graficos.modalidade).toContain("<svg");
  // prova que é o desenho de verdade (dado do mock), não um SVG à parte
  expect(chamada.params.graficos.modalidade).toContain("Pregão eletrônico");
});

test("relatório de economia manda os quatro gráficos já desenhados pro papel",
    async ({ page }) => {
  await page.locator("#btn-relatorios").click();
  await page.locator("#rel-tipo").selectOption("economia");
  await page.locator("#rel-gerar").click();

  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "gerar_relatorio").pop());
  expect(chamada.tipo).toBe("economia");
  for (const chave of ["modalidade", "familia", "categoria", "fornecedor"])
    expect(chamada.params.graficos[chave]).toContain("<svg");
  expect(chamada.params.graficos.familia).toContain("MATERIAL LIMPEZA");
  expect(chamada.params.graficos.fornecedor).toContain("RHC PRODUTOS");
});

// achado 2026-08-12: a captura acontece no MESMO tick do setOption — sem
// animation:false, o SVG pego é o 1º frame da animação padrão do ECharts
// (barra crescendo de zero), então o relatório saía com as barras
// "zeradas" mesmo com <svg> e texto presentes (os testes acima não pegam
// isso — checam conteúdo, não geometria).
test("barras dos gráficos capturados vêm no tamanho final, não no frame zerado da animação",
    async ({ page }) => {
  await page.locator("#btn-relatorios").click();
  await page.locator("#rel-tipo").selectOption("executivo");
  await page.locator("#rel-gerar").click();
  const html = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "gerar_relatorio").pop().params.graficos.modalidade);
  const m = html.match(/<path d="M([\d.]+)\s[\d.]+L([\d.]+)/);
  expect(m).not.toBeNull();
  const largura = Math.abs(parseFloat(m[2]) - parseFloat(m[1]));
  // barra zerada teria início e fim quase no mesmo x (poucos px de raio
  // do cantinho arredondado); a maior modalidade real passa de 600px
  expect(largura).toBeGreaterThan(100);
});

test("montador de PCA gera, edita e recalcula os totais", async ({ page }) => {
  await page.locator("#btn-pca").click();
  await expect(page.locator("#veu-pca")).toBeVisible();
  // exercício sugerido é o ano seguinte ao último com itens (2026 -> 2027)
  await expect(page.locator("#pca-ano")).toHaveValue("2027");
  await page.locator("#pca-gerar").click();
  await expect(page.locator("#pca-status")).toContainText("3 grupos");
  const linhas = page.locator("#pca-lista .linha:not(.cab)");
  await expect(linhas).toHaveCount(3);
  // sinalizações que orientam a revisão
  await expect(linhas.nth(0).locator(".aviso-un")).toBeVisible();
  await expect(linhas.nth(1).locator(".tag-unico")).toContainText("ÚNICA");
  await expect(page.locator("#pca-totais")).toContainText("525.000,00");
  // editar a quantidade recalcula o total
  await linhas.nth(0).locator('[data-campo="quantidade"]').fill("300");
  await linhas.nth(0).locator('[data-campo="quantidade"]').blur();
  await expect(page.locator("#pca-totais")).toContainText("533.000,00");
  // excluir um item sai da conta e é contado como excluído
  await linhas.nth(1).locator('[data-campo="incluir"]').uncheck();
  await expect(page.locator("#pca-totais")).toContainText("1 excluído");
  const chamadas = await page.evaluate(() => window.__chamadas.filter(
    c => c.metodo === "editar_item_minuta"));
  expect(chamadas.map(c => c.campos)).toEqual([
    { quantidade: 300 }, { incluir: 0 }]);
});

test("PCA: famílias filtram, ABC classifica e mesclagem funde itens",
    async ({ page }) => {
  await page.locator("#btn-pca").click();
  await page.locator("#pca-gerar").click();
  const linhas = page.locator("#pca-lista .linha:not(.cab)");
  await expect(linhas).toHaveCount(3);
  // curva ABC destacada e resumida no topo
  await expect(linhas.nth(0).locator(".abc")).toHaveText("B");
  await expect(page.locator("#pca-totais")).toContainText("classe A");
  // chips por família: FILTRO tem 2 itens
  const chipFiltro = page.locator('#pca-familias button[data-familia="FILTRO"]');
  await expect(chipFiltro).toContainText("2");
  await chipFiltro.click();
  await expect(linhas).toHaveCount(2);
  await page.locator('#pca-familias button[data-familia=""]').click();
  await expect(linhas).toHaveCount(3);
  // mesclar exige dois: o botão só habilita a partir do segundo
  await expect(page.locator("#pca-mesclar")).toBeDisabled();
  await linhas.nth(0).locator("[data-sel]").check();
  await expect(page.locator("#pca-mesclar")).toBeDisabled();
  await linhas.nth(2).locator("[data-sel]").check();
  await expect(page.locator("#pca-mesclar")).toContainText("2 itens");
  await page.locator("#pca-mesclar").click();
  await expect(page.locator("#pca-status")).toContainText("fundidos");
  await expect(linhas).toHaveCount(2);
  // o item fundido oferece desfazer
  await expect(page.locator("[data-dividir]")).toBeVisible();
  await page.locator("[data-dividir]").click();
  await expect(page.locator("#pca-status")).toContainText("desfeita");
});

test("modal do PCA ocupa a janela e a descrição tem espaço", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator("#btn-pca").click();
  await page.locator("#pca-gerar").click();
  await expect(page.locator("#pca-lista .linha:not(.cab)")).toHaveCount(3);
  const m = await page.evaluate(() => {
    const modal = document.querySelector("#veu-pca .modal");
    const desc = document.querySelector(
      '#pca-lista .linha:not(.cab) [data-campo="descricao"]');
    return { modal: modal.clientWidth, janela: window.innerWidth,
             descricao: desc.clientWidth };
  });
  expect(m.modal).toBeGreaterThan(m.janela * 0.9);   // usa a janela toda
  expect(m.descricao).toBeGreaterThan(700);          // nome do item legível
});

test("parâmetros do PCA chegam ao motor", async ({ page }) => {
  await page.locator("#btn-pca").click();
  await page.locator("#pca-base").selectOption("ultimo");
  await page.locator("#pca-estatistica").selectOption("recente");
  await page.locator("#pca-margem").fill("25");
  await page.locator("#pca-palavras").selectOption("2");
  await page.locator("#pca-recorrentes").uncheck();
  await page.locator("#pca-gerar").click();
  const c = await page.evaluate(() => window.__chamadas.find(
    x => x.metodo === "gerar_minuta_pca"));
  expect(c.params).toEqual({ base: "ultimo", estatistica: "recente",
                             margem: 25, palavras: 2, so_recorrentes: false });
});

test("valor sem homologação é marcado como estimado", async ({ page }) => {
  await abrirLista(page);   // a tela inicial agora é o Painel
  const linhas = page.locator(".linha:not(.cab)");
  // X-1 tem homologado: valor limpo, sem marca
  await expect(linhas.nth(0).locator(".est")).toHaveCount(0);
  // X-2 só tem estimado: itálico + "est."
  await expect(linhas.nth(1).locator(".est")).toContainText("est.");
  await expect(linhas.nth(1).locator(".est")).toContainText("200.000,00");
});

test("badge de situação encurtada mantém o texto completo no title",
    async ({ page }) => {
  await abrirLista(page);   // a tela inicial agora é o Painel
  const badge = page.locator(".linha:not(.cab)").nth(1).locator(".badge");
  await expect(badge).toHaveText("Divulgada");
  await expect(badge).toHaveAttribute("title", "Divulgada no PNCP");
});

test("limpar filtros aparece com filtro ativo e restaura a lista",
    async ({ page }) => {
  await abrirLista(page);   // a tela inicial agora é o Painel
  await expect(page.locator("#btn-limpar")).toBeHidden();
  await page.locator("#f-busca").fill("merenda");
  await expect(page.locator("#btn-limpar")).toBeVisible();
  await page.locator("#btn-limpar").click();
  await expect(page.locator("#f-busca")).toHaveValue("");
  await expect(page.locator("#btn-limpar")).toBeHidden();
});

test("selo, título da janela e última sincronização no rodapé",
    async ({ page }) => {
  await expect(page.locator("#svg-selo polygon").first()).toBeVisible();
  const titulo = await page.evaluate(() =>
    window.__chamadas.find(c => c.metodo === "set_titulo"));
  // desde a 1.34.0 a barra de título traz produto + versão + município
  expect(titulo.t).toBe("Licitarium Free 9.9.9 — Orindiúva/SP");
  await expect(page.locator("#sync-msg")).toContainText("Sincronizado");
});

test("abrir maximizada vem ligada e persiste ao desmarcar",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  await expect(page.locator("#cfg-maximizar")).toBeChecked();
  await page.locator("#cfg-maximizar").uncheck();
  const salvo = await page.evaluate(() => window.__chamadas.find(
    c => c.metodo === "set_config" && c.k === "maximizar"));
  expect(salvo.v).toBe("0");
});

test("densidade compacta aplica e persiste", async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator("#cfg-densidade").selectOption("compacta");
  await expect(page.locator("html"))
    .toHaveAttribute("data-densidade", "compacta");
  const salvo = await page.evaluate(() => window.__chamadas.find(
    c => c.metodo === "set_config" && c.k === "densidade"));
  expect(salvo.v).toBe("compacta");
});

test("modal trava o fundo, recebe foco e prende o Tab", async ({ page }) => {
  await page.locator("#btn-relatorios").click();
  await expect(page.locator("body")).toHaveClass(/travado/);
  // foco entrou no diálogo
  expect(await page.evaluate(() =>
    document.querySelector("#veu-relatorios").contains(document.activeElement)))
    .toBe(true);
  // Tab circula dentro do diálogo, nunca volta para o fundo
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() =>
    document.querySelector("#veu-relatorios").contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/travado/);
});

test("tamanho da fonte aplica zoom e persiste", async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator("#cfg-fonte").selectOption("grande");
  await expect(page.locator("html")).toHaveAttribute("data-fonte", "grande");
  const salvo = await page.evaluate(() =>
    window.__chamadas.find(c => c.metodo === "set_config" && c.k === "fonte"));
  expect(salvo.v).toBe("grande");
});

test("limites de dispensa usam máscara de dinheiro e salvam número puro",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  const campo = page.locator("#cfg-lim-compras");
  await expect(campo).toHaveValue(/R\$/);            // carrega formatado
  await campo.fill("7500000");                        // digita só dígitos
  await expect(campo).toHaveValue(/75\.000,00/);      // exibe mascarado
  await page.keyboard.press("Tab");                   // dispara change
  const salvo = await page.evaluate(() =>
    window.__chamadas.filter(c => c.metodo === "set_config"
      && c.k === "limite_dispensa_compras").pop());
  expect(parseFloat(salvo.v)).toBe(75000);            // persiste numérico
});

test("janela de fracionamento carrega do estado e salva ao trocar",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  await expect(page.locator("#cfg-frac-janela")).toHaveValue("exercicio");
  await page.locator("#cfg-frac-janela").selectOption("12");
  const salvo = await page.evaluate(() =>
    window.__chamadas.filter(c => c.metodo === "set_config"
      && c.k === "frac_janela").pop());
  expect(salvo.v).toBe("12");
});

test("chip de vencimento de contratos filtra pela janela de 60 dias, não por vigentes",
    async ({ page }) => {
  // "vigentes" não tem teto — todo contrato ativo entrava, e o alerta de
  // 25 virava lista de 50. O chip tem de ligar a caixa da janela fechada.
  await abrirLista(page);   // a tela inicial agora é o Painel
  await page.locator("#chip-vencendo-contratos").click();
  await expect(page.locator('nav.abas button[data-tipo="contratos"]'))
    .toHaveClass(/on/);
  await expect(page.locator("#f-vence60")).toBeChecked();
  await expect(page.locator("#f-vigentes")).not.toBeChecked();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(chamada.tipo).toBe("contratos");
  expect(chamada.filtros.vencendo).toBe(true);
  expect(chamada.filtros.vigentes).toBeNull();
});

test("chip de vencimento de atas leva à aba de atas, não à de contratos",
    async ({ page }) => {
  // Um alerta que soma contrato e ata não tem como abrir as duas telas de
  // uma vez — por isso são dois chips, cada um levando à tela certa.
  await abrirLista(page);
  await page.locator("#chip-vencendo-atas").click();
  await expect(page.locator('nav.abas button[data-tipo="atas"]'))
    .toHaveClass(/on/);
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "listar").pop());
  expect(chamada.tipo).toBe("atas");
  expect(chamada.filtros.vencendo).toBe(true);
});

test("contratos e atas mostram a situação da vigência por cor e texto",
    async ({ page }) => {
  for (const [aba, esperado] of [
      ["contratos", [["ok", "Vigente"], ["warn", /Vence em \d+ d/],
                     ["err", "Encerrado"]]],
      ["atas", [["ok", "Vigente"], ["warn", /Vence em \d+ d/],
                ["err", "Encerrado"]]]]) {
    await page.locator(`nav.abas button[data-tipo="${aba}"]`).click();
    const selos = page.locator(".linha:not(.cab) .badge");
    await expect(selos).toHaveCount(3);
    for (const [i, [classe, texto]] of esperado.entries()) {
      await expect(selos.nth(i)).toHaveClass(new RegExp(`badge ${classe}$`));
      await expect(selos.nth(i)).toHaveText(texto);
      // cor não pode ser o único indicador (WCAG 1.4.1): o title carrega a data
      await expect(selos.nth(i)).toHaveAttribute("title", /Vigência até \d{2}\//);
    }
  }
});

test("situação da vigência não escorrega de dia por causa do fuso",
    async ({ page }) => {
  // `new Date("2026-01-01")` é meia-noite UTC e, no nosso fuso, cai no dia
  // anterior — o que faria um contrato que vence hoje aparecer como encerrado
  const r = await page.evaluate(() => {
    const d = new Date();
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1)
      .padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const mais = n => { const y = new Date(); y.setDate(y.getDate() + n); return iso(y); };
    return {
      hoje: window.statusVigencia(iso(d)),
      ontem: window.statusVigencia(mais(-1)),
      amanha: window.statusVigencia(mais(1)),
      limite: window.statusVigencia(mais(60)),
      passouDoLimite: window.statusVigencia(mais(61)),
      semData: window.statusVigencia(null),
      comHora: window.statusVigencia(`${mais(5)}T00:00:00`),
    };
  });
  expect(r.hoje).toEqual({ cl: "warn", txt: "Vence hoje" });
  expect(r.ontem.cl).toBe("err");
  expect(r.amanha).toEqual({ cl: "warn", txt: "Vence em 1 d" });
  expect(r.limite.cl).toBe("warn");        // 60 dias ainda alerta
  expect(r.passouDoLimite.cl).toBe("ok");  // 61 já é rotina
  expect(r.semData).toBeNull();            // registro sem vigência: sem selo
  expect(r.comHora.cl).toBe("warn");       // tolera timestamp completo
});

test("selos de situação atingem o contraste AA nos quatro temas",
    async ({ page }) => {
  for (const tema of ["portal", "pergaminho", "observatorio", "civil"]) {
    await abrirApp(page, { tema, temaBanco: tema });
    await page.locator('nav.abas button[data-tipo="contratos"]').click();
    const medidas = await page.evaluate(() => {
      // o navegador devolve color-mix como `color(srgb r g b / a)`, com
      // componentes de 0 a 1 — e não como rgb() de 0 a 255
      const cor = s => {
        const n = (s.match(/[\d.]+/g) || []).map(Number);
        const srgb = s.startsWith("color(");
        const [r, g, b] = srgb ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3);
        const a = srgb ? (n[3] ?? 1) : (n[3] ?? 1);
        return { rgb: [r, g, b], a };
      };
      // fundo do selo é translúcido: compõe até achar algo opaco atrás
      const fundoOpaco = el => {
        for (let e = el; e; e = e.parentElement) {
          const c = cor(getComputedStyle(e).backgroundColor);
          if (c.a === 1) return c.rgb;
        }
        return [255, 255, 255];
      };
      const lum = ([r, g, b]) => {
        const f = v => (v /= 255) <= 0.03928 ? v / 12.92
          : Math.pow((v + 0.055) / 1.055, 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      return [...document.querySelectorAll(".linha:not(.cab) .badge")].map(b => {
        const e = getComputedStyle(b);
        const selo = cor(e.backgroundColor), atras = fundoOpaco(b.parentElement);
        const fundo = selo.rgb.map((v, i) => v * selo.a + atras[i] * (1 - selo.a));
        const [hi, lo] = [lum(cor(e.color).rgb), lum(fundo)].sort((x, y) => y - x);
        return { classe: b.className, razao: (hi + 0.05) / (lo + 0.05) };
      });
    });
    expect(medidas.length).toBe(3);
    // AA para texto pequeno: 4.5:1 (o selo tem 10,5px)
    const reprovados = medidas.filter(m => m.razao < 4.5)
      .map(m => `${tema}/${m.classe} = ${m.razao.toFixed(2)}`);
    expect(reprovados).toEqual([]);
  }
});

test("selo de vigência: coluna própria, centralizada mesmo em linha alta",
    async ({ page }) => {
  // achado 2026-08-12: vigência inicial/final e status viraram colunas
  // separadas (antes eram datas + selo espremidos numa célula só)
  await page.setViewportSize({ width: 1300, height: 900 });
  for (const aba of ["contratos", "atas"]) {
    await page.locator(`nav.abas button[data-tipo="${aba}"]`).click();
    const m = await page.evaluate(() =>
      [...document.querySelectorAll(".linha:not(.cab)")].map(l => {
        const selo = l.querySelector(".badge");
        const rs = selo.getBoundingClientRect();
        const rl = l.getBoundingClientRect();
        return {
          alturaLinha: rl.height,
          // quanto o centro do selo desvia do centro vertical da linha
          desvioCentro: Math.abs((rs.top + rs.height / 2)
                                 - (rl.top + rl.height / 2)),
        };
      }));
    expect(m.length).toBe(3);
    // uma das linhas tem objeto longo: é onde o alinhamento aparecia errado
    expect(Math.max(...m.map(x => x.alturaLinha))).toBeGreaterThan(90);
    for (const x of m)
      expect(x.desvioCentro).toBeLessThanOrEqual(2);   // centralizado
  }
});

test("brasão: sem upload, a tela abre sem preview nem botão de remover",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  await expect(page.locator("#cfg-brasao-preview")).toBeHidden();
  await expect(page.locator("#btn-brasao-remover")).toBeHidden();
});

test("brasão: já configurado, a tela abre com a preview visível",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__brasao = "data:image/png;base64,QQ==";
  });
  await page.locator("#btn-config").click();
  const preview = page.locator("#cfg-brasao-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", "data:image/png;base64,QQ==");
  await expect(page.locator("#btn-brasao-remover")).toBeVisible();
});

test("brasão: carregar mostra a preview e liga o botão de remover",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  await page.locator("#btn-brasao-carregar").click();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "carregar_brasao").pop());
  expect(chamada).toBeTruthy();
  await expect(page.locator("#cfg-brasao-preview")).toBeVisible();
  await expect(page.locator("#btn-brasao-remover")).toBeVisible();
});

test("brasão: remover esconde a preview e o próprio botão",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__brasao = "data:image/png;base64,QQ==";
  });
  await page.locator("#btn-config").click();
  await page.locator("#btn-brasao-remover").click();
  const chamada = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "remover_brasao").pop());
  expect(chamada).toBeTruthy();
  await expect(page.locator("#cfg-brasao-preview")).toBeHidden();
  await expect(page.locator("#btn-brasao-remover")).toBeHidden();
});

test("brasão: erro ao carregar aparece na tela, sem preview",
    async ({ page }) => {
  await page.evaluate(() => {
    window.__respostaCarregarBrasao =
      { ok: false, erro: "imagem muito grande (máx. 3 MB)" };
  });
  await page.locator("#btn-config").click();
  await page.locator("#btn-brasao-carregar").click();
  await expect(page.locator("#brasao-status"))
    .toContainText("imagem muito grande");
  await expect(page.locator("#cfg-brasao-preview")).toBeHidden();
});

test("Compacta é metade da janela, Expandida é a janela inteira",
    async ({ page }) => {
  // pedido do usuário (2026-08-08): a lista tinha teto próprio em pixels
  // (m2: 1400px, depois 1600px) enquanto o <main> do Painel não tinha
  // nenhum — o usuário viu a inconsistência comparando os dois lado a
  // lado na mesma janela Expandida. Regra virou global e relativa: metade
  // da janela em Compacta, a janela inteira em Expandida, pro <main> e
  // pra lista igual — sem teto fixo escolhido a dedo. Piso de 1000px
  // (janela larga o bastante aqui pra não entrar em jogo).
  await page.setViewportSize({ width: 2400, height: 900 });
  const compacta = await page.locator("main").evaluate(
    el => el.getBoundingClientRect().width);
  expect(compacta).toBeCloseTo(1200, 0);           // 50vw de 2400px

  await page.evaluate(() => { document.documentElement.dataset.largura = "expandida"; });
  const mainExpandida = await page.locator("main").evaluate(
    el => el.getBoundingClientRect().width);
  expect(mainExpandida).toBeCloseTo(2400, 0);       // 100% da janela

  // a lista segue a mesma regra do main, sem teto próprio
  await abrirLista(page, "contratos");
  const listaExpandida = await page.locator("#lista").evaluate(
    el => el.getBoundingClientRect().width);
  expect(listaExpandida).toBeGreaterThan(2300);
});

test("parar sincronização: botão só vale enquanto há coleta em curso",
    async ({ page }) => {
  await page.locator("#btn-config").click();
  // sem coleta, o botão nasce desabilitado — clicar nele não faria nada
  await expect(page.locator("#btn-parar-sync")).toBeDisabled();
});

test("parar sincronização: Configurações aberta no meio da coleta já vem armada",
    async ({ page }) => {
  // sem ler o status ao abrir, o botão nasceria desabilitado justamente
  // quando é necessário — o evento de progresso não é retroativo
  await page.evaluate(() => { window.__syncRodando = true; });
  await page.locator("#btn-config").click();
  const parar = page.locator("#btn-parar-sync");
  await expect(parar).toBeEnabled();

  await parar.click();
  await expect(parar).toBeDisabled();
  await expect(page.locator("#parar-sync-status"))
    .toContainText("Parando após o passo atual");
  expect(await page.evaluate(() => window.__chamadas
    .some(c => c.metodo === "parar_sync"))).toBe(true);
});

test("interrupção a pedido não é anunciada como falha", async ({ page }) => {
  // o usuário clicou em Parar: dizer "Falha na sincronização" faria ele
  // achar que quebrou alguma coisa
  await page.evaluate(() => window.onSyncFim({ cancelado: true, erro: null,
                                               resumo: null }));
  const msg = page.locator("#sync-msg");
  await expect(msg).toContainText("interrompida");
  await expect(msg).not.toContainText("Falha");
});

test("fim da coleta atualiza a vista aberta, inclusive o Painel",
    async ({ page }) => {
  // achado 2026-08-13: onSyncFim chamava carregarLista() sempre, e COLUNAS
  // não tem entrada para "painel" — a coleta de abertura terminando na aba
  // inicial estourava dentro de um handler assíncrono, sem tela de erro; o
  // Painel simplesmente não se atualizava.
  const erros = [];
  page.on("pageerror", e => erros.push(String(e)));
  expect(await page.evaluate(() => estado.tipo)).toBe("painel");
  await page.evaluate(() => window.onSyncFim({ resumo: { contratacoes: 5 },
                                               erro: null }));
  await expect(page.locator("#p-execucao .card")).not.toHaveCount(0);
  expect(erros).toEqual([]);
});

test("cabeçalho traz marca, edição gratuita e município", async ({ page }) => {
  await expect(page.locator("#sub-edicao")).toHaveText("Versão gratuita (9.9.9)");
  await expect(page.locator("#sub-municipio"))
    .toHaveText("Contratações públicas de Orindiúva · SP");
  const titulo = await page.evaluate(() => window.__chamadas
    .filter(c => c.metodo === "set_titulo").pop());
  expect(titulo.t).toBe("Licitarium Free 9.9.9 — Orindiúva/SP");
});
