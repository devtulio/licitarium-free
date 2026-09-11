// ══ Ícones de interface ═══════════════════════════════════════════════════
// Desenhados aqui, não emoji. Emoji é renderizado pela fonte do sistema:
// vem colorido, com estilo próprio (cartunesco no Windows), e ignora a
// paleta do tema — num app cuja identidade é epigráfica, destoava de tudo.
// Estes herdam `currentColor`, então acompanham o tema, inclusive os dois
// que trocam de tipografia (Pergaminho e Rótulo Civil).
//
// Convenções: grade de 24, traço 1.75, pontas e junções arredondadas,
// `fill="none"` — só contorno, como as marcas da própria identidade.
// `aria-hidden`: o rótulo de texto ao lado é que nomeia; sem isso o leitor
// de tela leria o ícone e o texto, em duplicata (auditoria de 2026-08-09).

const _SVG = (corpo, traco = 1.75) =>
  `<svg class="ico" viewBox="0 0 24 24" width="1em" height="1em" fill="none"
        stroke="currentColor" stroke-width="${traco}" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

const ICONE = {
  // limite anual de dispensa estourado ou perto: triângulo de atenção.
  // A forma triangular já é sinal de perigo fora de qualquer cultura de
  // interface — é a única do conjunto que não depende de reconhecer metáfora.
  limite: _SVG(`<path d="M12 4.2 20.8 19.4a1.2 1.2 0 0 1-1 1.8H4.2a1.2 1.2 0 0 1-1-1.8Z"/>
                <path d="M12 10v4.2"/><path d="M12 17.6h.01"/>`),

  // prazo correndo (contrato/ata vencendo): relógio.
  // Escolhido em vez da ampulheta (⏳) pelo mesmo motivo de 2026-08-08 —
  // ampulheta lê como "processando", não como "prazo chegando".
  prazo: _SVG(`<circle cx="12" cy="12.5" r="8.4"/><path d="M12 7.6v5.1l3.4 2.1"/>`),

  // proposta aberta: a própria tabula ansata, a placa de aviso público
  // romana que dá forma ao ícone do programa — o edital ainda em exposição.
  proposta: _SVG(`<path d="M5.6 7.4h12.8v9.2H5.6z"/>
                  <path d="M5.6 9.2 2.6 7v10l3-2.2"/><path d="M18.4 9.2 21.4 7v10l-3-2.2"/>
                  <path d="M8.8 12h6.4"/>`, 1.6),

  // processo sem resultado há mais de 90 dias: pausa.
  // ⏸ foi escolhido em 2026-08-08 justamente por NÃO competir com o
  // relógio — "parado" e "prazo chegando" dizem coisas opostas.
  parado: _SVG(`<circle cx="12" cy="12" r="8.6"/>
                <path d="M10.1 9.2v5.6"/><path d="M13.9 9.2v5.6"/>`),

  // imprimir
  imprimir: _SVG(`<path d="M7 9.2V3.8h10v5.4"/>
                  <path d="M7 17.5H5.2A2.2 2.2 0 0 1 3 15.3v-3.9a2.2 2.2 0 0 1 2.2-2.2h13.6A2.2 2.2 0 0 1 21 11.4v3.9a2.2 2.2 0 0 1-2.2 2.2H17"/>
                  <path d="M7 14.6h10v5.6H7z"/>`, 1.6),
};
