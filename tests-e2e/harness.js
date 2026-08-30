// Ponte pywebview mockada + dados de exemplo para os testes E2E e screenshots.
const path = require("path");
const PAINEL = require("./painel-dados");

const URL_UI = "file://" +
  path.resolve(__dirname, "..", "ui", "index.html").replace(/\\/g, "/");

// Vigências relativas a hoje: com data fixa, o mesmo registro mudaria de
// estado (vigente -> vencido) com a passagem do tempo e os testes de cor
// passariam a falhar sozinhos, num dia qualquer.
const emDias = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const DADOS = {
  contratacoes: [
    { numero_controle: "X-1", ano: 2026, sequencial: 12,
      modalidade_nome: "Dispensa", objeto: "Aquisição de gêneros alimentícios para merenda escolar",
      valor_estimado: 52000, valor_homologado: 48230,
      situacao: "Homologada", data_publicacao: "2026-03-14" },
    { numero_controle: "X-2", ano: 2026, sequencial: 4,
      modalidade_nome: "Pregão - Eletrônico", objeto: "Contratação de empresa para manutenção de vias públicas",
      valor_estimado: 200000, valor_homologado: null,
      situacao: "Divulgada no PNCP", data_publicacao: "2026-05-02" },
    { numero_controle: "X-3", ano: 2025, sequencial: 50,
      modalidade_nome: "Pregão - Eletrônico", objeto: "Registro de preços para medicamentos básicos",
      valor_estimado: 261115, valor_homologado: 261115,
      situacao: "Homologada", data_publicacao: "2025-11-20" },
  ],
  contratos: [
    { numero_controle: "Y-1", numero_contrato: "0033/26", ano_contrato: 2026,
      objeto: "Serviços de assessoria e consultoria técnica na área da educação",
      fornecedor_nome: "DANILO HENRIQUE NUNES CONSULTORIA",
      valor_global: 30294, vigencia_inicio: "2026-05-28",
      vigencia_fim: emDias(300), data_publicacao: "2026-07-13" },
    { numero_controle: "Y-2", numero_contrato: "0041/26", ano_contrato: 2026,
      objeto: "Manutenção preventiva da frota municipal",
      fornecedor_nome: "OFICINA CENTRAL LTDA",
      valor_global: 88000, vigencia_inicio: "2026-02-01",
      vigencia_fim: emDias(20), data_publicacao: "2026-02-05" },
    { numero_controle: "Y-3", numero_contrato: "0012/25", ano_contrato: 2025,
      objeto: "Contratação de empresa especializada, em regime de contratação integrada, para a elaboração dos projetos executivos de engenharia e arquitetura, obtenção de todas as autorizações e licenças exigidas pelas legislações municipal, estadual e federal, bem como a execução das obras de 20 unidades habitacionais de interesse social prontas para uso",
      fornecedor_nome: "COPIADORA REGIONAL ME",
      valor_global: 14500, vigencia_inicio: "2025-01-10",
      vigencia_fim: emDias(-45), data_publicacao: "2025-01-15" },
  ],
  atas: [
    { numero_controle: "Z-1", numero_ata: "13", ano_ata: 2026,
      objeto: "Registro de preços de óleos lubrificantes para a frota",
      contratacao_controle: "45148970000177-1-000061/2025",
      vigencia_inicio: "2026-04-10", vigencia_fim: emDias(250) },
    { numero_controle: "Z-2", numero_ata: "07", ano_ata: 2026,
      objeto: "Registro de preços de material de limpeza",
      contratacao_controle: "45148970000177-1-000044/2025",
      vigencia_inicio: "2026-01-15", vigencia_fim: emDias(12) },
    { numero_controle: "Z-3", numero_ata: "02", ano_ata: 2025,
      objeto: "Registro de preços para eventual e futura aquisição parcelada de gêneros alimentícios destinados ao preparo da merenda escolar das unidades da rede municipal de ensino, incluindo creches e pré-escolas, conforme quantitativos e especificações do termo de referência",
      contratacao_controle: "45148970000177-1-000028/2025",
      vigencia_inicio: "2025-03-01", vigencia_fim: emDias(-90) },
  ],
  pca: [],
  itens: [
    { id: "X-3#1", contratacao_controle: "X-3", ano: 2025, sequencial: 50,
      numero_item: 1, descricao: "PAPEL SULFITE A4 75G RESMA 500 FOLHAS",
      unidade: "RESMA", quantidade: 300, quantidade_homologada: 300,
      valor_unitario_estimado: 24.9, valor_unitario_homologado: 18.75,
      por_conteudo: { valor: 0.0375, base: "un", conteudo: 500,
                      rotulo: "unidade" },
      corrigido: 20.6,
      fornecedor_nome: "PAPELARIA CENTRAL LTDA",
      data_resultado: "2025-11-28" ,
      municipio_ibge: "3534203", municipio_nome: "Orindiúva" },
    // nomes e valores reais do acervo: a linha tem de caber sem quebrar
    { id: "X-3#9", contratacao_controle: "X-3", ano: 2025, sequencial: 43,
      numero_item: 9, descricao: "PÃO FRANCÊS 50G",
      unidade: "KG", quantidade: 9000, quantidade_homologada: 9000,
      valor_unitario_estimado: 30.0, valor_unitario_homologado: 26.8,
      fornecedor_nome: "ZILDA OLIVEIRA VIEIRA PANIFICADORA",
      data_resultado: "2025-09-15" ,
      municipio_ibge: "3534203", municipio_nome: "Orindiúva" },
    { id: "X-3#10", contratacao_controle: "X-3", ano: 2026, sequencial: 30,
      numero_item: 10, descricao: "CADEIRA DE RODAS REFORÇADA DOBRÁVEL",
      unidade: "UN", quantidade: 1, quantidade_homologada: 1,
      valor_unitario_estimado: 2100.0, valor_unitario_homologado: 635000.0,
      fornecedor_nome: "CENTRAL HOLDING LOGISTICA LTDA",
      data_resultado: "2026-07-02" ,
      municipio_ibge: "3534203", municipio_nome: "Orindiúva" },
    // pior caso real do acervo (105 chars): não cabe em coluna alguma,
    // serve para garantir que corta com reticências em vez de quebrar
    { id: "X-3#11", contratacao_controle: "X-3", ano: 2026, sequencial: 30,
      numero_item: 11, descricao: "SERVIÇO BANCÁRIO",
      unidade: "UN", quantidade: 1, quantidade_homologada: 1,
      valor_unitario_estimado: 100.0, valor_unitario_homologado: 90.0,
      fornecedor_nome: "COOPERATIVA DE CRÉDITO, POUPANÇA E INVESTIMENTO DO "
        + "NOROESTE DO ESTADO DE SÃO PAULO - SICREDI NOROESTE -SP",
      data_resultado: "2026-07-02" ,
      municipio_ibge: "3534203", municipio_nome: "Orindiúva" },
    { id: "REF#1", contratacao_controle: "R-1", ano: 2026, sequencial: 7,
      numero_item: 1, descricao: "PAPEL SULFITE A4 75G RESMA 500 FOLHAS",
      unidade: "RESMA", quantidade: 200, quantidade_homologada: 200,
      valor_unitario_estimado: 23.0, valor_unitario_homologado: 16.4,
      fornecedor_nome: "DISTRIBUIDORA VIZINHA LTDA",
      data_resultado: "2026-05-20",
      referencia: 1, municipio_ibge: "3535002",
      municipio_nome: "Palestina" },
    { id: "X-3#2", contratacao_controle: "X-3", ano: 2025, sequencial: 50,
      numero_item: 2, descricao: "CANETA ESFEROGRÁFICA AZUL",
      unidade: "UN", quantidade: 500, quantidade_homologada: 500,
      valor_unitario_estimado: 1.9, valor_unitario_homologado: null,
      fornecedor_nome: null, data_resultado: null ,
      municipio_ibge: "3534203", municipio_nome: "Orindiúva" },
  ],
};

// serializada para dentro do addInitScript (roda no contexto da página)
function scriptPonte(temaBanco = "portal") {
  return `
    window.__chamadas = [];
    window.PAINEL_DADOS = ${JSON.stringify(PAINEL)};
    window.__temaBanco = ${JSON.stringify(temaBanco)};
    const DADOS = ${JSON.stringify(DADOS)};
    window.pywebview = { api: {
      get_estado: async () => ({ versao: "9.9.9", municipio: "Orindiúva",
        uf: "SP", ibge: "3534203", tema: window.__temaBanco,
        largura: "compacta",
        fonte: "normal", densidade: "confortavel", colunas: "{}",
        maximizar: "1",
        limite_dispensa_compras: "62639.92", limite_dispensa_obras: "125279.84",
        last_sync: "2026-07-29", sincronizado_em: "2026-07-29T14:32:00",
        kpis: { contratacoes: 131, homologado_ano: 10828702.73, vigentes: 47,
                vencendo_60_contratos: 7, vencendo_60_atas: 2,
                propostas_abertas: 2 } }),
      painel: async (ano, orgao) => {
        window.__chamadas.push({ metodo: "painel", ano, orgao });
        return window.__painel ?? PAINEL_DADOS;
      },
      imprimir_painel: async (vistas, ano) => {
        window.__chamadas.push({ metodo: "imprimir_painel", ano,
          tamanhos: (vistas || []).map(([nome, html]) => [nome, html.length]),
          // guardado inteiro: é aqui que dá para conferir o que de fato
          // viaja para o papel, e não só o tamanho
          html: (vistas || []).map(([, html]) => html).join("") });
        return { ok: true, arquivo: "C:/tmp/painel.html" };
      },
      filtros_disponiveis: async () => ({ anos: [2026, 2025, 2024],
        situacoes: ["Homologada", "Divulgada no PNCP"],
        modalidades: [{ id: 8, nome: "Dispensa" },
                      { id: 6, nome: "Pregão - Eletrônico" }],
        orgaos: [{ cnpj: "45148970000177", nome: "MUNICIPIO DE ORINDIUVA" },
                 { cnpj: "51351716000174", nome: "ORINDIUVA CAMARA MUNICIPAL" }],
        // já agrupadas pelo backend: "CX" e "Caixa" chegam como uma opção só
        unidades: [{ nome: "Unidade", n: 12 }, { nome: "Caixa", n: 4 },
                   { nome: "Serviço", n: 1 }] }),
      listar: async (tipo, filtros, pagina) => {
        window.__chamadas.push({ metodo: "listar", tipo, filtros, pagina });
        let itens = DADOS[tipo] || [];
        if (tipo === "itens" && filtros && filtros.so_homologados)
          itens = itens.filter(i => i.valor_unitario_homologado != null);
        if (tipo === "itens" && filtros && filtros.origem === "proprio")
          itens = itens.filter(i => !i.referencia);
        if (tipo === "itens" && filtros && filtros.excluidos)
          itens = itens.filter(i => !filtros.excluidos.includes(String(i.id)));
        return { itens, total: itens.length };
      },
      estatisticas_preco: async (busca, ano, origem, excluidos,
                                 porConteudo, corrigir, incluidos) => {
        window.__chamadas.push({ metodo: "estatisticas_preco", busca, ano,
                                 origem, excluidos, porConteudo, corrigir,
                                 incluidos });
        if (!/papel/i.test(busca || "")) return null;
        const total = (DADOS.itens || []).length;
        if (incluidos && !incluidos.length)
          return { n: 0, nada_selecionado: true, total };
        if (corrigir && !porConteudo) return {
          n: 4, minimo: 20.6, maximo: 700000, media: 175030, mediana: 30.2,
          fornecedores: 3, desvio: 349985, cv: 2.0, q1: 25.1, q3: 175015,
          limite_inf: -224733, limite_sup: 424873, fora_da_curva: [],
          proprios: 3, referencia: 1, corrigido: true, ipca_ate: "2026-06",
          ipca_ate_extenso: "jun/2026", total,
          // 1 de 5 é 20% da série: acima do limiar, o backend acusa
          sem_indice: window.__serieInteira ? 0 : 1,
          amostra_reduzida: !window.__serieInteira };
        if (porConteudo) return window.__semConteudo
          ? { n: 0, por_conteudo: true, sem_conversao: 4, total }
          : { n: 3, minimo: 0.0375, maximo: 0.389, media: 0.158,
              mediana: 0.0466, fornecedores: 2, desvio: 0.19, cv: 1.2,
              q1: 0.042, q3: 0.21, limite_inf: -0.21, limite_sup: 0.46,
              fora_da_curva: [], proprios: 2, referencia: 1,
              por_conteudo: true, base: "un", rotulo_base: "unidade",
              sem_conversao: 2, total };
        const foraSaiu = (excluidos || []).includes("X-3#10")
          || (incluidos && !incluidos.includes("X-3#10"));
        const fora = foraSaiu ? [] : ["X-3#10"];
        // n é subconjunto de total: devolver 7 com total 6 fazia a tela
        // renderizar "7 de 6 selecionados" e o teste do contador ser
        // afrouxado para tolerar (auditoria, 2026-08-09)
        return { n: incluidos ? incluidos.length : 5,
                 minimo: 15.4, maximo: 249.8, media: 53.63,
                 mediana: 18.75, fornecedores: 2,
                 desvio: 86.4, cv: 1.61, mad: 6.2,
                 limite_inf_robusto: -13.4, limite_sup_robusto: 50.6,
                 q1: 16.9, q3: 30.5, iqr: 13.6,
                 limite_inf: -3.5, limite_sup: 50.9, fora_da_curva: fora,
                 itens: [
                   { id: "X-3#1", descricao: "PAPEL SULFITE A4 RESMA",
                     fornecedor: "11.111.111/0001-11", valor: 15.4 },
                   { id: "X-3#2", descricao: "PAPEL SULFITE A4 BRANCO",
                     fornecedor: "22.222.222/0001-22", valor: 16.9 },
                   { id: "X-3#9", descricao: "PAPEL A4 COLORIDO",
                     fornecedor: "11.111.111/0001-11", valor: 18.75 },
                   { id: "X-3#11", descricao: "PAPEL A4 CARBONO",
                     fornecedor: "22.222.222/0001-22", valor: 30.5 },
                   { id: "X-3#10", descricao: "FORNECIMENTO DE PAPEL A4 TIMBRADO",
                     fornecedor: "33.333.333/0001-33", valor: 249.8 },
                 ],
                 alertas_concentracao: fora.length
                   ? ["1 fornecedor com mais de um preço na amostra"] : [],
                 sensibilidade: fora.length ? { removido: 249.8,
                   mediana_antes: 18.75, mediana_depois: 17.2,
                   media_antes: 53.63, media_depois: 22.1 } : null,
                 proprios: 2, referencia: 1, total };
      },
      detalhe: async (tipo, nc) =>
        ({ ...(DADOS[tipo] || []).find(d => d.numero_controle === nc),
           raw: { exemplo: true } }),
      descartes: async (busca) => {
        window.__chamadas.push({ metodo: "descartes", busca });
        return window.__descartes?.[String(busca).toLowerCase().trim()] ?? [];
      },
      descartar_preco: async (busca, item_id, motivo) => {
        window.__chamadas.push({ metodo: "descartar_preco", busca, item_id,
                                 motivo });
        return { ok: true };
      },
      classificar_por_unidade: async (busca, unidade, ano, origem) => {
        window.__chamadas.push({ metodo: "classificar_por_unidade", busca,
                                 unidade, ano, origem });
        return { ok: true, n: 0 };
      },
      selecionados: async (busca) => {
        window.__chamadas.push({ metodo: "selecionados", busca });
        // sem override explícito do teste, a busca já vem com tudo
        // selecionado — poupa reescrever todo teste que não é sobre a
        // seleção em si (IPCA, conteúdo, ordenação...). Testes que
        // exercitam o padrão novo (tudo desmarcado) setam
        // window.__selecionados = {} (ou um subconjunto) explicitamente.
        if (window.__selecionados)
          return window.__selecionados[String(busca).toLowerCase().trim()]
            ?? [];
        return (DADOS.itens || []).map(i => i.id);
      },
      selecionar_preco: async (busca, item_id) => {
        window.__chamadas.push({ metodo: "selecionar_preco", busca, item_id });
        return { ok: true };
      },
      desselecionar_preco: async (busca, item_id) => {
        window.__chamadas.push({ metodo: "desselecionar_preco", busca,
                                 item_id });
        return { ok: true };
      },
      selecionar_todos_precos: async (busca, ano, origem) => {
        window.__chamadas.push({ metodo: "selecionar_todos_precos", busca,
                                 ano, origem });
        return { ok: true, n: (DADOS.itens || []).length };
      },
      fornecedores_pesquisa_precos: async (busca, ano, origem) => {
        window.__chamadas.push({ metodo: "fornecedores_pesquisa_precos",
                                 busca, ano, origem });
        return window.__fornecedoresPrecos ?? [
          { ni: "11.111.111/0001-11", nome: "Fornecedor Um", n: 3 },
          { ni: "22.222.222/0001-22", nome: "Fornecedor Dois", n: 2 },
        ];
      },
      selecionar_por_fornecedor: async (busca, fornecedor_ni, ano, origem) => {
        window.__chamadas.push({ metodo: "selecionar_por_fornecedor", busca,
                                 fornecedor_ni, ano, origem });
        return { ok: true, n: 0 };
      },
      selecionar_por_faixa: async (busca, minimo, maximo, ano, origem) => {
        window.__chamadas.push({ metodo: "selecionar_por_faixa", busca,
                                 minimo, maximo, ano, origem });
        return { ok: true, n: 0 };
      },
      selecionar_por_texto: async (busca, contendo, ano, origem) => {
        window.__chamadas.push({ metodo: "selecionar_por_texto", busca,
                                 contendo, ano, origem });
        return { ok: true, n: 0 };
      },
      exportar_acervo: async () => {
        window.__chamadas.push({ metodo: "exportar_acervo" });
        return window.__respostaExportar ?? { ok: true, arquivo: "C:/tmp/c.zip",
          mb: 12.3, contagens: { contratacoes: 131, itens: 2674 } };
      },
      importar_acervo: async () => {
        window.__chamadas.push({ metodo: "importar_acervo" });
        return window.__respostaImportar ?? { ok: true, itens: 2674,
          municipio: "Orindiúva", exportado_em: "2026-08-05T09:00:00" };
      },
      sincronizar: async () => true,
      status_sync: async () => (window.__syncRodando
        ? { rodando: true, msg: "Contratações — 1 de 3…" } : { rodando: false }),
      parar_sync: async () => {
        window.__chamadas.push({ metodo: "parar_sync" });
        if (!window.__syncRodando) return { ok: false, rodando: false };
        window.__syncRodando = false;
        return { ok: true, rodando: true };
      },
      checar_atualizacao: async () => null,
      set_config: async (k, v) => {
        window.__chamadas.push({ metodo: "set_config", k, v }); return true; },
      set_titulo: async t => {
        window.__chamadas.push({ metodo: "set_titulo", t }); return true; },
      listar_orgaos: async () => [],
      brasao: async () => ({ dataurl: window.__brasao ?? null }),
      carregar_brasao: async () => {
        window.__chamadas.push({ metodo: "carregar_brasao" });
        const r = window.__respostaCarregarBrasao ?? { ok: true };
        if (r.ok) window.__brasao = "data:image/png;base64,QQ==";
        return r;
      },
      remover_brasao: async () => {
        window.__chamadas.push({ metodo: "remover_brasao" });
        window.__brasao = null;
        return { ok: true };
      },
      municipios: async (texto, uf) => {
        window.__chamadas.push({ metodo: "municipios", texto, uf });
        return [{ c: 3536604, n: "Paulo de Faria", uf: "SP" },
                { c: 3535002, n: "Palestina", uf: "SP" },
                { c: 3533908, n: "Olímpia", uf: "SP" },
                { c: 3533007, n: "Nova Granada", uf: "SP" }]
          .filter(m => m.n.toLowerCase().includes((texto || "").toLowerCase()));
      },
      ultimo_log: async () => [],
      dados_grafico_precos: async (termo, ano, orgao, excluidos) => {
        window.__chamadas.push({ metodo: "dados_grafico_precos", termo, ano,
                                 orgao, excluidos });
        if (window.__semSelecaoPrecos) return { ok: false, erro: "selecione" };
        return { ok: true, resumo: {
          n: 3, minimo: 15.4, maximo: 249.8, media: 53.63, mediana: 18.75,
          desvio: 86.4, cv: 1.61, q1: 16.9, q3: 30.5,
          limite_inf: -3.5, limite_sup: 50.9,
          itens: [
            { descricao: "PAPEL SULFITE A4 RESMA", fornecedor: "11.111.111/0001-11", valor: 15.4 },
            { descricao: "PAPEL A4 COLORIDO", fornecedor: "11.111.111/0001-11", valor: 18.75 },
            { descricao: "FORNECIMENTO DE PAPEL A4 TIMBRADO", fornecedor: "33.333.333/0001-33", valor: 249.8 },
          ] } };
      },
      gerar_relatorio: async (tipo, params) => {
        window.__chamadas.push({ metodo: "gerar_relatorio", tipo, params });
        return { ok: true };
      },
      anos_com_itens: async () => [2025, 2026],
      gerar_minuta_pca: async (ano, params) => {
        window.__chamadas.push({ metodo: "gerar_minuta_pca", ano, params });
        window.__minuta = [
          { id: 1, chave: "FILTRO AR MOTOR", familia: "FILTRO", abc: "B",
            descricao: "FILTRO DE AR",
            unidade: "UND", categoria: "Material", quantidade: 220,
            valor_unitario: 100, margem: 10, incluir: 1, valor_total: 22000,
            origem: { recorrente: true, unidades_divergentes: true } },
          { id: 2, chave: "REFORMA PRACA", familia: "REFORMA", abc: "A",
            descricao: "REFORMA DE PRAÇA",
            unidade: "UN", categoria: "Serviço", quantidade: 1,
            valor_unitario: 500000, margem: 10, incluir: 1,
            valor_total: 500000, origem: { recorrente: false } },
          { id: 3, chave: "FILTRO ÓLEO MOTOR", familia: "FILTRO", abc: "C",
            descricao: "FILTRO DE ÓLEO",
            unidade: "UND", categoria: "Material", quantidade: 100,
            valor_unitario: 30, margem: 10, incluir: 1, valor_total: 3000,
            origem: { recorrente: true } },
        ];
        return { ok: true, grupos: 3 };
      },
      listar_minuta_pca: async () => {
        const itens = window.__minuta || [];
        const inc = itens.filter(i => i.incluir);
        const fam = {};
        itens.forEach(i => {
          const f = fam[i.familia] || (fam[i.familia] =
            { familia: i.familia, itens: 0, valor: 0, excluidos: 0 });
          f.itens++;
          i.incluir ? f.valor += i.valor_total : f.excluidos++;
        });
        return { itens, gerado_em: "2026-07-31T10:00:00",
                 familias: Object.values(fam).sort((a, b) => b.valor - a.valor),
                 parametros: { margem: 10, base: "media" },
                 totais: { grupos: inc.length, excluidos: itens.length - inc.length,
                           valor: inc.reduce((s, i) => s + i.valor_total, 0) } };
      },
      mesclar_itens_minuta: async (ano, ids) => {
        window.__chamadas.push({ metodo: "mesclar_itens_minuta", ano, ids });
        const alvo = (window.__minuta || []).filter(i => ids.includes(i.id));
        const qtd = alvo.reduce((s, i) => s + i.quantidade, 0);
        const valor = alvo.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);
        window.__minuta = (window.__minuta || []).filter(i => !ids.includes(i.id));
        window.__minuta.push({ ...alvo[0], id: 99, mesclado: true,
          quantidade: qtd, valor_unitario: valor / qtd, valor_total: valor });
        return { ok: true, itens: alvo.length };
      },
      dividir_item_minuta: async id => {
        window.__chamadas.push({ metodo: "dividir_item_minuta", id });
        return { ok: true, itens: 2 };
      },
      editar_item_minuta: async (id, campos) => {
        window.__chamadas.push({ metodo: "editar_item_minuta", id, campos });
        const i = (window.__minuta || []).find(x => x.id === id);
        if (i) {
          Object.assign(i, campos);
          i.valor_total = (i.quantidade || 0) * (i.valor_unitario || 0);
        }
        return { ok: true };
      },
      exportar_planilha: async () => ({ ok: false, erro: null }),
      abrir_pncp: async () => true,
      imprimir_detalhe: async (tipo, nc, titulo, subtitulo, meta_html,
                               raw_html) => {
        window.__chamadas.push({ metodo: "imprimir_detalhe", tipo, nc,
          titulo, subtitulo, meta_html, raw_html });
        return { ok: true, arquivo: "detalhe.html" };
      },
    }};
  `;
}

async function abrirApp(page, opcoes = {}) {
  await page.addInitScript(scriptPonte(opcoes.temaBanco || "portal"));
  // o Python passa o tema na URL para a splash nascer na cor certa
  await page.goto(opcoes.tema ? `${URL_UI}?tema=${opcoes.tema}` : URL_UI);
  await page.evaluate(() => window.dispatchEvent(new Event("pywebviewready")));
}

// Desde a 1.10.0 o programa abre no Painel: os testes de lista precisam
// dizer em qual aba querem estar.
async function abrirLista(page, tipo = "contratacoes") {
  await page.locator(`nav.abas button[data-tipo="${tipo}"]`).click();
  await page.locator("#lista").waitFor({ state: "visible" });
}

module.exports = { abrirLista, URL_UI, DADOS, abrirApp };
