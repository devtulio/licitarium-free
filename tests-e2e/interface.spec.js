// Guardas de interface que saíram da auditoria de 2026-08-14. São medições
// sobre a tela renderizada — o que não dá para conferir lendo o CSS, porque
// token, tema e composição de transparência só se encontram no navegador.
const { test, expect } = require("@playwright/test");
const { abrirApp } = require("./harness");

test.beforeEach(async ({ page }) => abrirApp(page));

const TEMAS = ["portal", "pergaminho", "observatorio", "civil"];

// O Chrome devolve duas notações de cor — rgb() em 0-255 e
// color(srgb r g b / a) em 0-1. Ler as duas com a mesma régua produz número
// sem sentido: na auditoria isso "achou" 22 contrastes de razão 1,0 que na
// tela eram 15:1. Fundo translúcido (o chip tem fill a 10%) tem de ser
// COMPOSTO sobre o que está atrás, senão a razão sai contra cor que ninguém vê.
const MEDIR_CONTRASTE = () => {
  const ler = (c) => {
    if (!c || /transparent/.test(c)) return [0, 0, 0, 0];
    const n = (c.match(/-?\d*\.?\d+(e-?\d+)?/gi) || []).map(Number);
    return /^color\(/.test(c)
      ? [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1]
      : [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
  };
  const sobre = (f, b) =>
    [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const lum = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map(v => {
      v /= 255;
      return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
    });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const fundoDe = (el) => {
    const pilha = [];
    for (let n = el; n; n = n.parentElement) {
      const c = ler(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) pilha.push(c);
      if (c[3] >= 1) break;
    }
    let base = [255, 255, 255, 1];
    for (let i = pilha.length - 1; i >= 0; i--) base = sobre(pilha[i], base);
    return base;
  };

  const fora = [];
  document.querySelectorAll("body *").forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest("#splash")) return;
    if (getComputedStyle(el).visibility === "hidden") return;
    const txt = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(" ");
    if (!txt) return;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const grande = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700);
    const exigido = grande ? 3 : 4.5;
    const [x, y] = [lum(ler(cs.color)), lum(fundoDe(el))]
      .sort((a, b) => b - a);
    const razao = (x + .05) / (y + .05);
    if (razao < exigido)
      fora.push(`${txt.slice(0, 28)} — ${razao.toFixed(2)}:1 ` +
                `(exige ${exigido}, ${px}px)`);
  });
  return fora;
};

test("nenhum texto da tela fica abaixo do contraste da WCAG AA",
    async ({ page }) => {
  // achados de 2026-08-14: chip de aviso a 4,03:1 (--warn #a26a00) e abas
  // não selecionadas a 4,46:1 no tema Rótulo Civil (--muted #5b7a6e)
  for (const tema of TEMAS) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, tema);
    await expect(page.locator("#p-execucao .card")).not.toHaveCount(0);
    // ESPERAR A TRANSIÇÃO FECHAR. `body` anima background e color por 250 ms
    // (estilo.css) e `getComputedStyle` devolve o valor interpolado: medindo
    // na hora, o texto já está na cor nova enquanto o fundo ainda está na
    // antiga, e sai razão de 2,39:1 que na tela parada não existe.
    await page.waitForTimeout(350);
    expect(await page.evaluate(MEDIR_CONTRASTE), `tema ${tema}`).toEqual([]);
  }
});

test("nenhum texto da interface fica abaixo de 11px", async ({ page }) => {
  // densidade é escolha legítima num painel, mas o piso estava em 9,5px.
  // O rótulo de eixo do SVG (.painel .rot) é a exceção deliberada: vive
  // dentro do gráfico, onde 10,5px ainda lê e o espaço é disputado.
  const miudos = await page.evaluate(() => {
    const fora = [];
    document.querySelectorAll("body *").forEach(el => {
      if (el.closest("#splash") || el.closest("svg")) return;
      const txt = [...el.childNodes]
        .filter(n => n.nodeType === 3 && n.textContent.trim().length > 3);
      if (!txt.length) return;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11)
        fora.push(`${txt[0].textContent.trim().slice(0, 30)} — ${px}px`);
    });
    return [...new Set(fora)];
  });
  expect(miudos).toEqual([]);
});

test("todo campo de texto tem nome acessível, não só placeholder",
    async ({ page }) => {
  // o placeholder some no primeiro caractere digitado: quem chegou ali por
  // teclado ou leitor de tela fica sem saber o que o campo espera
  await page.locator("#btn-config").click();
  const sem = await page.evaluate(() => {
    const fora = [];
    document.querySelectorAll("input[type=text], input:not([type]), select")
      .forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const nome = (el.labels && el.labels.length &&
                      el.labels[0].textContent.trim()) ||
                     el.getAttribute("aria-label") ||
                     el.getAttribute("title") || "";
        if (!nome) fora.push(el.id || el.outerHTML.slice(0, 60));
      });
    return fora;
  });
  expect(sem).toEqual([]);
});

test("valor gasto não é pintado de verde por ter subido", async ({ page }) => {
  // .up/.down afirmam "bom"/"ruim". Só cabem onde a direção TEM esse
  // sentido — economizar mais é melhor. Gastar mais não é nem um nem outro,
  // e o verde de "Homologada" dizia o que o dado não diz.
  const hero = page.locator("#p-execucao .card.hero .r");
  await expect(hero.locator(".dir")).toHaveCount(1);
  await expect(hero.locator(".up, .down")).toHaveCount(0);
  await expect(hero).toContainText(/[▲▼]/);          // a direção continua lá

  await page.locator('.subabas button[data-vista="economia"]').click();
  // no card de economia mais É melhor: ali verde/vermelho seguem valendo
  await expect(page.locator("#p-economia .card.hero .r .up, " +
                            "#p-economia .card.hero .r .down")).toHaveCount(1);
});

test("cor de alerta só marca o que tem consequência", async ({ page }) => {
  // Explicação do que o card faz não é aviso. Quando todo texto auxiliar
  // sai em âmbar, o âmbar deixa de significar alguma coisa — e as duas
  // frases que realmente avisam (trocar de município apaga o acervo; o
  // limite legal pode estar desatualizado) somem no meio das outras.
  await page.locator("#btn-config").click();
  const textos = await page.evaluate(() => {
    const ler = (sel) => [...document.querySelectorAll(sel)]
      .map(e => e.textContent.replace(/\s+/g, " ").trim().slice(0, 130));
    return { aviso: ler("#veu-config .aviso"), ajuda: ler("#veu-config .ajuda") };
  });
  // o que sobra em âmbar é consequência: uma apaga o acervo, a outra
  // alimenta o alerta de fracionamento com número que pode estar velho
  expect(textos.aviso).toHaveLength(2);
  expect(textos.aviso.join(" | ")).toMatch(/reinicia o acervo/);
  expect(textos.aviso.join(" | ")).toMatch(/valor vigente/);
  expect(textos.ajuda.length).toBeGreaterThanOrEqual(3);

  const cores = await page.evaluate(() => ({
    aviso: getComputedStyle(document.querySelector("#veu-config .aviso")).color,
    ajuda: getComputedStyle(document.querySelector("#veu-config .ajuda")).color,
  }));
  expect(cores.aviso).not.toBe(cores.ajuda);
});

test("deságio começa junto do rótulo quando ninguém estourou o estimado",
    async ({ page }) => {
  // O eixo era fixo em [-max, +max]: com todas as modalidades economizando,
  // metade do cartão ficava vazia e a barra nascia no meio, destoando dos
  // gráficos irmãos. Com estouro, a divergência volta — aí ela informa.
  await page.locator('.subabas button[data-vista="analise"]').click();
  const medir = () => page.evaluate(() => {
    const el = document.querySelector('[data-graf="desagio"]');
    const svg = el.querySelector("svg");
    const cx = el.getBoundingClientRect();
    const barras = [...svg.querySelectorAll("path")]
      .filter(p => (p.getAttribute("fill") || "none") !== "none")
      .map(p => p.getBoundingClientRect())
      .filter(r => r.width > 2 && r.height > 2);
    return { inicio: Math.round(Math.min(...barras.map(b => b.left - cx.left))),
             cartao: Math.round(cx.width),
             temLegenda: !!el.querySelector(".leg") };
  });
  const m = await medir();
  // o acervo de exemplo não tem estouro: a barra encosta no rótulo
  expect(m.inicio, `barra começa a ${m.inicio}px de um cartão de ${m.cartao}`)
    .toBeLessThan(m.cartao * 0.45);
  expect(m.temLegenda, "legenda de divergência sem divergência").toBe(false);
});

test("o mapa de calor traz a contagem dentro da célula", async ({ page }) => {
  await page.locator('.subabas button[data-vista="analise"]').click();
  const nums = await page.locator('[data-graf="calor"] svg text')
    .evaluateAll(ts => ts.map(t => t.textContent.trim())
      .filter(s => /^\d+$/.test(s)));
  expect(nums.length).toBeGreaterThan(5);
  expect(nums).not.toContain("0");   // célula zerada fica só com o tom
});

test("nenhuma marca de gráfico soma o balão nativo ao tooltip próprio",
    async ({ page }) => {
  // `title` faz o navegador desenhar o balão preto dele por cima do tooltip
  // do painel, com atraso: dois balões dizendo a mesma coisa. Quem precisa
  // do nome acessível usa `aria-label`, que fala sem desenhar.
  for (const vista of ["execucao", "analise", "vigilancia", "economia"]) {
    if (vista !== "execucao")
      await page.locator(`.subabas button[data-vista="${vista}"]`).click();
    const baloesNativos = await page.evaluate(() => {
      const raiz = document.querySelector(".vista:not(.oculto)");
      // marca com data-tip-v + title (calendário) OU svg de gráfico com <title>
      // (o nome acessível de todo gráfico virou aria-label — nenhum <title>
      // pode sobrar desenhando o balão preto por cima do tooltip próprio)
      const marcas = [...raiz.querySelectorAll("[data-tip-v][title]")]
        .map(e => e.getAttribute("title").slice(0, 40));
      const svgs = [...raiz.querySelectorAll("svg > title")]
        .map(t => t.textContent.slice(0, 40));
      return [...marcas, ...svgs];
    });
    expect(baloesNativos, `vista ${vista}`).toEqual([]);
  }
  // e o dia com vencimento continua tendo nome acessível
  const comNome = await page.locator('[data-graf="agenda"] .cal-dia.venc')
    .evaluateAll(cs => cs.filter(c => !c.getAttribute("aria-label")).length);
  expect(comNome, "célula de vencimento sem aria-label").toBe(0);
});

test("os cards de uma fileira têm a mesma anatomia", async ({ page }) => {
  // um card com duas linhas ao lado de irmãos com três quebrava a linha de
  // base da fileira, e a diferença não queria dizer nada
  //
  // Execução (Fase 2) e Economia (Fase 4) — mesma regra "manchete única":
  // os apoios soltos (`.card.kpiv`) viraram `.ap` dentro de um único
  // `.card.apoios` nas duas vistas.
  for (const [vista, sel, seletorApoio] of [
      ["execucao", "#p-execucao", ".card.apoios .ap"],
      ["economia", "#p-economia", ".card.apoios .ap"]]) {
    if (vista !== "execucao")
      await page.locator(`.subabas button[data-vista="${vista}"]`).click();
    // conta linha VISÍVEL, não nó no DOM: o que quebra a fileira é o que a
    // pessoa vê, e um `.r` escondido continuaria contando
    const linhas = await page.locator(`${sel} ${seletorApoio}`)
      .evaluateAll(cs => cs.map(c => [...c.querySelectorAll(".r")]
        .filter(r => r.getBoundingClientRect().height > 0).length));
    expect(linhas.length, `${vista} sem cards de apoio`).toBeGreaterThan(1);
    expect(new Set(linhas).size, `${vista}: ${linhas.join("/")} linhas`)
      .toBe(1);
  }
});

test("trocar a largura da página não deixa cartão para fora da janela",
    async ({ page }) => {
  // Item de grid nasce com min-width:auto = min-content, e o SVG do ECharts
  // tem largura FIXA em pixels: o cartão se recusava a encolher, e como não
  // encolhia o ResizeObserver nunca via largura menor e o gráfico nunca era
  // redesenhado. Trocar de Expandida para Compacta deixava a faixa 898px
  // para fora da janela — os cartões saíam cortados pela borda.
  await page.setViewportSize({ width: 1500, height: 900 });
  for (const vista of ["execucao", "analise", "vigilancia", "economia"]) {
    if (vista !== "execucao")
      await page.locator(`.subabas button[data-vista="${vista}"]`).click();
    for (const [de, para] of [["expandida", "compacta"],
                              ["compacta", "expandida"]]) {
      await page.evaluate(l => document.documentElement.dataset.largura = l, de);
      await page.waitForTimeout(400);
      await page.evaluate(l => document.documentElement.dataset.largura = l, para);
      await expect.poll(async () => page.evaluate(() => {
        const raiz = document.documentElement;
        const fora = [];
        document.querySelectorAll("main *").forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > raiz.clientWidth + 1 &&
              el.parentElement.getBoundingClientRect().right
                <= raiz.clientWidth + 1)
            fora.push(el.className || el.tagName);
        });
        return { rolaDeLado: raiz.scrollWidth > raiz.clientWidth + 1,
                 fora: [...new Set(fora)] };
      }), { message: `${vista}: ${de} → ${para}` })
        .toEqual({ rolaDeLado: false, fora: [] });
    }
  }
  await page.evaluate(() => document.documentElement.dataset.largura = "compacta");
});
