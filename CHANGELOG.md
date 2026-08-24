# Changelog

## 1.44.4 — 2026-08-24

**Três correções no motor de sincronização, achadas em auditoria**

Uma contratação com erro de rede na coleta de itens parava a fila inteira
no meio — as demais pendentes daquela passada nem eram tentadas. Agora, uma
falha isolada não impede as outras de serem baixadas normalmente, do
mesmo jeito que já acontecia nas outras fases da sincronização.

Trocar de município não limpava os itens nem o Plano de Contratações Anual
do município anterior — ficavam órfãos no banco, ocupando espaço para
sempre. Agora saem junto na troca.

Um único órgão fora do ar (contratos, atas ou PCA) travava a data de corte
de todos os outros órgãos: a cada sincronização, o motor refazia a janela
inteira para todo mundo até aquele órgão específico voltar a responder.
Agora cada órgão tem seu próprio marcador de progresso, e um problema num
não atrasa os demais.

## 1.44.3 — 2026-08-19

**A sincronização parou de buscar preços de outras cidades**

A saída de preços do Free na 1.44.0 removeu a tela e o botão de município de
referência, mas o motor de sincronização continuou a sincronizar, de
verdade, os municípios que já estavam configurados antes disso — quem
usava a Pesquisa de Preços via seis cidades vizinhas sendo consultadas no
PNCP a cada sincronização, sem tela nenhuma para ver ou desligar isso.
O laço que fazia essa busca foi removido do motor: a sincronização volta a
tratar só o município do próprio acervo.

## 1.44.2 — 2026-08-18

**O balão dos gráficos aparece na faixa toda da coluna, não só na barra fina**

No Painel, o balão que segue o mouse só nascia quando o cursor caía exatamente
sobre a barra ou a coluna colorida. Numa coluna baixa — um mês de pouco
movimento — quase não havia o que acertar, e o balão não vinha. O calendário
da agenda já acertava a faixa inteira do dia; agora todos os gráficos fazem
igual: passar o mouse em qualquer ponto da faixa daquele item já mostra o
balão, tenha a barra a altura que tiver. Vale para as colunas de mês, as
barras horizontais, o deságio, os limites, o funil "do edital ao contrato" e
o mapa de calor — onde até a borda entre as células e as células vazias agora
respondem ao cursor.

## 1.44.1 — 2026-08-17

**Some o balão preto do navegador sobre os gráficos do Painel**

Ao passar o mouse sobre um gráfico do Painel, além do balão próprio (bonito,
instantâneo, que segue o cursor) aparecia, depois de um segundo, um segundo
balão preto e quadrado do próprio navegador, dizendo a mesma coisa. Era o
`<title>` que o programa punha no gráfico para o leitor de tela — e o
navegador o desenha sozinho.

O nome acessível do gráfico passou a ser um `aria-label`: ele fala para o
leitor de tela sem desenhar balão nenhum, e os números escritos dentro do
gráfico continuam sendo lidos. É a mesma correção já feita no calendário da
agenda, agora estendida a todos os gráficos.

## 1.44.0 — 2026-08-17

**A pesquisa de preços saiu do Free — ele volta a ser o repositório de
contratações**

O Licitarium Free se concentra no que faz melhor: ser o **repositório das
contratações públicas do município** no PNCP. A parte de preços — a pesquisa
de preços por termo (banco de preços do art. 23) e a comparação de preços
entre municípios — **deixou de fazer parte do Free**: vira um produto à parte,
para quem precisar dela.

O que mudou para você:

- Saiu a aba de preços da barra. O Free agora tem **Painel · Contratações ·
  Contratos · Atas · PCA** — e termina no PCA.
- Saíram o cadastro de **municípios de referência** (Configurações) e a coleta
  dos preços deles; o relatório de pesquisa de preços saiu do menu Relatórios.
- Nada das suas contratações, contratos e atas muda: o acervo do município
  continua inteiro, e os relatórios oficiais, o Painel e o Montar PCA seguem
  iguais.

## 1.42.3 — 2026-08-16

**Duas correções sincronizadas do Licitarium Pro (sistema irmão)**

Uma análise de convergência entre o Free e o Pro apontou duas divergências
em código que nasceu compartilhado — e nos dois casos a versão do Pro tinha
uma correção que faltava aqui:

- **Agrupamento por objeto:** uma quantidade no começo da descrição ("06
  TENDAS", "12 TENDAS") virava parte do radical e separava em famílias
  diferentes o que deveria somar junto. No termômetro de fracionamento isso
  **dividia o acumulado contra o mesmo teto do art. 75** — o município podia
  aparecer abaixo do limite quando não estava. Agora o número puro no início
  é descartado; número no meio ("PNEU 295") continua contando.
- **Coleta do PNCP:** um HTTP 404 numa listagem de consulta era lido como
  "sem registros". Só que ali "vazio" é sempre 204 ou corpo vazio — um 404 é
  falha passageira do portal. A leitura antiga fazia a marca d'água avançar
  sobre uma janela que não foi baixada (perda silenciosa). Agora a listagem
  retenta e, se o 404 persistir, aborta a fase em vez de gravá-la como vazia.

## 1.42.2 — 2026-08-16

**A impressão do painel, resolvida da raiz — quatro causas, não uma**

Os gráficos vinham saindo errados no PDF do painel de formas diferentes a
cada tentativa. Desta vez cada sintoma foi levado até a origem e travado com
um teste. Foram quatro causas independentes:

- **A moldura era mais larga que o papel.** Tinha uma largura máxima fixa em
  pixels (1080 para o deitado); uma folha A4 deitada, fora as margens, tem
  cerca de 1017. O que passava da borda era cortado. Agora a moldura ocupa
  exatamente a área imprimível da folha.

- **A grade não encolhia no papel.** Cada cartão de gráfico se recusava a
  ficar mais estreito que o desenho que continha, então a faixa transbordava
  a página e o gráfico da direita saía cortado. A tela já tinha o conserto; o
  papel usa um estilo próprio e não o tinha.

- **Um gráfico invadia o vizinho.** O desenho era capturado na largura da
  tela do usuário — num monitor ultralargo, larguíssimo — e colado num cartão
  estreito de A4, escapava por cima do gráfico ao lado. Agora o painel é
  redesenhado numa medida de papel fixa antes de ir para a folha, não importa
  o tamanho da janela.

- **"Por modalidade" saía em branco na primeira impressão.** Um detalhe da
  cópia do gráfico fazia a primeira impressão reaproveitar o gráfico da tela
  em vez de desenhar um novo — some do papel e, de quebra, apagava o da tela.
  Da segunda impressão em diante voltava. Corrigido: cada impressão desenha o
  seu próprio, sem tocar na tela.

E um acabamento: **acabou a página em branco no fim.** A última seção
mantinha uma quebra de página que jogava só o rodapé para uma folha nova.

## 1.42.1 — 2026-08-15

**O calendário da agenda agora usa a largura toda da página**

Ele estava preso à esquerda do cartão, com metade da página vazia ao lado —
um teto de largura por mês, posto para o quadrado não ficar gigante, acabou
prendendo a grade inteira. Agora os três meses dividem a largura disponível e
o quadrado do dia acompanha: grande na tela cheia, menor na largura
*Compacta*, sempre com a grade inteira à vista.

## 1.42.0 — 2026-08-14

**Trocar a largura da página deixava os cartões para fora da janela**

Em **Configurações → Largura da página**, sair de *Expandida* para
*Compacta* encolhia a moldura da página mas não os cartões: eles ficavam do
tamanho antigo e saíam cortados pela borda direita da janela, com barra de
rolagem horizontal. Só voltava ao normal fechando e reabrindo o programa.

A causa tem duas metades que se travavam uma na outra. O desenho do gráfico
carrega a largura em que foi feito, e isso impedia o cartão de encolher; como
o cartão não encolhia, o programa nunca percebia que havia menos espaço e
nunca refazia o desenho menor. Um segurava o outro.

Agora o cartão pode apertar, e ao apertar avisa — o gráfico se redesenha na
medida nova. Vale nos dois sentidos e nas seis abas.

## 1.41.2 — 2026-08-14

**O calendário da agenda estava pequeno demais**

Na versão anterior o quadrado do dia ganhou um teto para não virar um
tabuleiro ocupando meia tela — e o teto ficou apertado. O quadrado volta a
crescer até 48 pixels quando há espaço, e continua encolhendo sozinho
quando o cartão aperta: na largura *Compacta* fica em torno de 40 pixels,
sem quebrar a grade.

## 1.41.1 — 2026-08-14

**Gráficos cortados na impressão**

Os gráficos saíam do painel impresso com o pedaço da direita faltando — o
mês de agosto sumia das colunas, o mapa de calor perdia metade dos meses, e
o cartão de concentração de fornecedores era partido ao meio pela borda da
página.

O desenho vinha da tela com a largura travada em pixels, medida para o
monitor. No papel, mais estreito, ele não sabia encolher: era cortado. Agora
cada gráfico sai da tela sabendo se ajustar ao espaço que encontrar — no A4,
no A3, em qualquer largura. Em A3 o problema não aparecia porque a página
era larga o bastante para esconder o corte.

**Três das quatro visões saíam sem gráfico nenhum**

Achado ao escrever a verificação do defeito acima. Quem abrisse o programa e
mandasse imprimir direto recebia as visões *Análise*, *Vigilância* e
*Economia* com os cartões vazios: título, nota de rodapé e nenhum desenho.

A causa: uma visão que ainda não foi aberta tem largura zero, e o gráfico não
é desenhado nela. Só passava despercebido porque quem imprime costuma ter
navegado pelas visões antes. Agora cada visão é preparada no momento da
impressão, tenha sido aberta ou não.

**Rótulo de eixo encostando na nota do cartão**

No gráfico de concentração, os rótulos de baixo ficavam a 5 pixels da nota
explicativa — grudados. Ganharam respiro.

## 1.41.0 — 2026-08-14

**O calendário voltava quebrado na impressão**

Defeito da 1.40.0, encontrado ao conferir o PDF de verdade. Na tela o
calendário estava certo; no papel a grade sumia e os 92 dias saíam
empilhados numa coluna única, sem cor, ocupando duas páginas.

A causa é uma fronteira que não estava documentada: o painel impresso **não
carrega o mesmo arquivo de estilo da tela**. Ele leva só o conteúdo das
visões, e quem o formata é um estilo próprio, escrito para papel. O
calendário era novo e ninguém tinha escrito as regras dele desse lado.

Agora há um teste que compara o que a tela emite com o que o documento sabe
formatar, e falha antes de o problema chegar à impressora.

**O painel passa a sair em A4 paisagem**

Era A3 — papel que quase nenhuma impressora de secretaria tem, e que obrigava
a escolher "ajustar à página" na hora de imprimir. Agora sai em A4 deitado,
direto. Quem quiser A3 escolhe na caixa de impressão do navegador: o desenho
acompanha o papel, sem precisar de ajuste.

**Os quadrados do calendário diminuíram**

Num cartão de página inteira cada quadrado passava de 90 pixels e o
calendário virava um tabuleiro — três meses ocupando mais altura que o resto
da visão junto. Agora o quadrado tem teto: 35 pixels, o suficiente para o dia
e o selo de contagem. O que sobra de largura fica de margem.

## 1.40.1 — 2026-08-14

**Um balão só ao passar o mouse no calendário**

Apontar um dia com vencimento mostrava o balão do próprio programa e,
segundos depois, um segundo balão — preto, quadrado — repetindo a mesma
informação. O segundo era do navegador: cada dia carregava o atributo
`title`, posto ali para leitor de tela, e o navegador desenha um balão
nativo sempre que ele existe.

A descrição para leitor de tela passa a ir em `aria-label`, que é lido em
voz alta sem desenhar nada na tela.

## 1.40.0 — 2026-08-14

**A agenda dos próximos 90 dias vira um calendário**

Era uma linha do tempo: um ponto por vencimento, espalhados de hoje até
noventa dias. Só que vencimento não se espalha — ele se amontoa. No acervo
de exemplo, quarenta contratos e atas caem em sete datas, e onze deles no
mesmo dia. O resultado era previsível: quarenta pontos disputando o primeiro
terço da linha, nomes se atropelando, e dois terços do cartão vazios.

No lugar entram três meses de calendário, com os dias da semana no
cabeçalho. O amontoado passa a cair onde ele pertence — na data — e vira
informação: dá para ver que a segunda semana de agosto concentra quase tudo.

Cada dia com vencimento acende na cor do prazo (vermelho até 15 dias, âmbar
até 60, verde além disso) e ganha um selo no canto com **quantos** vencem
nele. O número do dia continua no meio da célula: no protótipo a célula
acesa mostrava só a contagem, e "3" tanto podia ser o dia 3 quanto três
vencimentos. Passar o mouse lista quais são.

Some junto a lógica que existia só para impedir que os nomes colidissem na
linha — cortar o texto pelo espaço livre até o rótulo anterior. Sem linha,
sem colisão.

## 1.39.0 — 2026-08-14

**O deságio por modalidade volta a começar junto dos nomes**

O gráfico reservava metade da largura para o lado negativo — o das
modalidades que fecharam *acima* do estimado. Como isso quase nunca
acontece, na prática metade do cartão ficava vazia e as barras nasciam no
meio, longe dos rótulos: o único gráfico do painel que não alinhava a barra
ao nome.

Agora o zero fica onde o dado o coloca. Não havendo nenhum estouro, ele
encosta à esquerda e o desenho é uma barra comum como as vizinhas; havendo,
o eixo abre para o lado negativo e a divergência aparece — que é justamente
quando ela diz alguma coisa. A legenda "acima do estimado / economia" só
aparece nesse caso.

**O mapa de calor mostra o número de processos dentro de cada quadrado**

Antes era preciso passar o mouse para saber se um mês tinha 2 ou 20
processos. A cor continua dando a leitura rápida; o número dá a exata.
Quadrado sem processo fica só com o tom de fundo — imprimir "0" doze vezes
por linha seria ruído.

A tinta do número acompanha o degrau da rampa, não o tema: no Observatório a
rampa é invertida (o tom mais claro é o de maior volume), então "muito
processo = texto claro" seria falso lá. Os vinte pares — cinco degraus × quatro
temas — foram medidos, e o quarto degrau do tema Portal precisou escurecer um
tom porque, no anterior, nem branco puro alcançava o contraste mínimo. Esse
degrau é usado também no painel impresso, que acompanhou a mudança.

## 1.38.1 — 2026-08-14

**Só avisa o que é aviso**

Em Configurações, todo texto explicativo saía na cor de alerta — o âmbar
reservado a "preste atenção nisto". Eram cinco blocos, e três deles apenas
descreviam o que o card faz: como a coleta funciona, que formato de imagem
o brasão aceita, para que serve a cópia do acervo. Quando tudo é âmbar,
nada é, e as duas frases que realmente avisam se perdiam no meio.

Esses três passam a texto comum. Continuam em âmbar as duas que trazem
consequência: **trocar de município reinicia o acervo** e o **limite legal
pode estar desatualizado** — este alimenta o Alerta de Fracionamento, então
um número velho ali produz alerta errado.

Tem teste: falha se um texto de ajuda for pintado de alerta, e também se um
dos dois avisos de verdade for despromovido a texto comum.

## 1.38.0 — 2026-08-14

**Sete correções de interface, saídas de uma auditoria medida**

A auditoria dirigiu a interface de verdade — 15 telas, os 4 temas, 40
paradas de tabulação — e mediu o que não se confere lendo o código. O que
ela achou:

**Gasto que subiu não é mais pintado de verde.** O card "Homologado em
2026" mostrava "▲ 73% sobre 2025" na mesma tinta verde usada em
"Homologada": o programa afirmava que gastar mais é bom. Verde e vermelho
passam a valer só onde a direção do número tem esse sentido — no card
"Economizado", onde mais realmente é melhor. No card de gasto a seta
continua, sem juízo de valor.

**Texto claro demais em quatro pontos.** Os chips de aviso ficavam em
4,03:1 de contraste (a norma exige 4,5:1), e a mesma tinta de aviso
deixava o marcador de "município de fora" em 4,31:1 — justamente o texto
que distingue preço do próprio município de preço alheio. As abas não
selecionadas do tema Rótulo Civil ficavam em 4,46:1. Os tons de aviso dos
temas Portal, Pergaminho e Rótulo Civil foram escurecidos, e o cinza do
Rótulo Civil também.

**Nada abaixo de 11 px.** Havia 198 trechos menores que isso, alguns em
9,5 px. Densidade continua sendo a escolha do painel, mas o piso subiu. A
única exceção deliberada é o rótulo dos eixos dentro dos gráficos, onde o
espaço é disputado e 10,5 px ainda lê.

**Campos com rótulo de verdade.** "CNPJ", "Nome do órgão", "UF" e
"Município de referência" tinham o nome apenas no texto cinza de dentro
do campo — que some no primeiro caractere digitado, e que leitor de tela
não anuncia. Agora o rótulo fica acima, e o texto de dentro virou exemplo.

**Cards da mesma fileira com a mesma altura.** Na vista Economia, o card
"homologado no ano" tinha duas linhas contra três dos irmãos. Ganhou a
comparação com o ano anterior — informação, não espaço em branco.

Cada uma dessas correções tem um teste que varre a tela renderizada e
falha se o defeito voltar: contraste nos quatro temas, piso de tamanho de
letra, rótulo de campo, cor do indicador de variação e anatomia dos cards.

## 1.37.1 — 2026-08-14

**A barra volta a ser o maior elemento do gráfico**

Correção de uma regressão da 1.37.0. Ao reservar corretamente a margem para
o valor no fim da barra, o desenho passou a caber — mas nos cartões
estreitos da vista Economia a barra ficou com apenas **14% da largura**, e o
texto em volta com os outros 86%. Numa barra, quem carrega o dado é a barra;
rótulo e valor são legenda.

Agora a barra tem um piso garantido de espaço. Quando o cartão é apertado
demais para tudo caber, o que sai do gráfico é o sufixo do valor — o
"· 29 processos" — e não o tamanho da barra; o texto completo continua no
balão que aparece ao passar o mouse. O eixo também deixou de arredondar o
valor máximo para um "número redondo": como ele é invisível, o
arredondamento só encurtava a barra mais longa sem informar nada.

Medido nas quatro vistas: a barra mais longa saiu de 14–23% para 35–44% da
largura do cartão nos cartões estreitos, e de 61% para 67% no cartão largo.
Há teste que falha se ela cair abaixo de 30%.

## 1.37.0 — 2026-08-14

**Nome de modalidade não é mais cortado no gráfico**

"Concorrência - Eletrônica" perdia o **C** na borda do cartão, e do outro
lado "R$ 7,2 mi · 4 processos" virava "· 4 proces". Acontecia na tela e no
PDF do painel, que captura o mesmo desenho.

A causa: o motor de gráficos reserva o espaço do texto medindo-o antes de
desenhar, e sem a fonte declarada ele media com uma fonte e desenhava com
outra, mais larga — a reserva saía curta. A margem da direita, além disso,
era um número fixo que não sabia o tamanho do rótulo que ia caber ali.
Agora a fonte vai declarada e a margem sai da medida do rótulo mais longo.

Aproveitando a mesma passada, três outros gráficos que também deixavam
texto escapar do cartão foram corrigidos: deságio por modalidade, mapa de
calor e a linha do tempo de vencimentos (as marcas "hoje" e "+90 dias"
ficavam metade para fora). Nome muito comprido de categoria ou fornecedor
passa a ser cortado com reticências em vez de engolir o gráfico inteiro —
o nome completo continua aparecendo ao passar o mouse.

Há teste que varre as quatro vistas e falha se **qualquer** texto de
gráfico ultrapassar a borda do cartão.

**O botão de relatório saiu da vista Economia**

Ele duplicava o que a aba **Relatórios** já oferece, e — por estar dentro
da vista — era impresso junto no PDF do painel, onde um botão não tem
função nenhuma. O relatório *Economia e Comparativos* segue inteiro em
**Relatórios**.

**A mensagem de status do PCA passa a ser anunciada** por leitor de tela,
como as demais mensagens dinâmicas do programa já eram.

## 1.36.0 — 2026-08-14

**Uma consulta que cai não leva a sincronização inteira junto**

A coleta de contratações dispara 13 modalidades × uma janela por ano — 78
consultas numa passada de cinco anos. Bastava **uma** delas esgotar as cinco
tentativas para toda a fase ser descartada, inclusive as 77 que já tinham
respondido. Agora o que chegou é gravado, e só o pedaço que faltou volta
para a fila da próxima sincronização.

A sincronização continua sendo marcada como falha nesse caso — de propósito.
Se ela fosse dada por concluída, a data de corte avançaria por cima de uma
janela que nunca foi baixada e o buraco ficaria no acervo para sempre. O
aviso em **Configurações → Sincronizações recentes** passa a dizer quantas
consultas caíram e quantos registros entraram mesmo assim.

**O recuo automático agora vale no meio da coleta**

O programa já reduzia o número de conexões simultâneas ao perceber o portal
recusando, mas a fase de contratações decidia esse número uma única vez, no
começo, e seguia com ele até o fim — justamente a fase que mais provoca
recusa. As requisições passam a sair em levas curtas, e entre uma leva e
outra o recuo é reavaliado.

**Medições que motivaram a mudança** (PNCP, madrugada de 14/08/2026, contra a
API real): 13 de 60 requisições voltaram `429` com uma conexão só, e o
intervalo entre elas não explicou o padrão — 0,5 s deu 3 recusas em 12; 1,0 s
deu 5; 1,5 s deu 5; 2,0 s e 3,0 s não deram nenhuma. Nenhuma resposta trouxe
o cabeçalho `Retry-After`. Na mesma noite o mesmo endereço alternou entre
responder em 0,3 s e devolver erro de banco de dados depois de 60 s. Como a
recusa não é função do nosso ritmo, a defesa é aguentar a perda, não calibrar
o ritmo contra um número que não é nosso.

**Conferências de uso da API que não geraram mudança** — todas contra o
portal real, no mesmo dia: o filtro por município é de fato aplicado no
servidor (a mesma consulta vai de 67.606 registros para 1); a modalidade é
mesmo obrigatória, então o laço de 13 não tem como sumir; o limite de página
é 50 nas contratações e 500 nos contratos e atas, como o programa já usava —
e agora há teste fixando os dois, porque trocá-los quebraria a coleta em
silêncio; e não existe endereço que traga resultados de vários itens de uma
vez, então o custo da fase de itens é da API, não do programa.

## 1.35.0 — 2026-08-14

**O executável passa a se chamar `Licitarium Free vX.Y.Z.exe`**

Acompanha o nome do produto. Na página de releases o GitHub troca os
espaços por pontos, então o arquivo aparece como
`Licitarium.Free.v1.35.0.exe`.

O verificador de atualização casa o anexo do release por padrão de nome,
e passou a aceitar as três formas já publicadas (`Licitarium.exe` das
versões até a 1.2.3, `Licitarium.vX.Y.Z.exe` da 1.2.4 à 1.34.0, e a nova
com `Free`) — a checagem também roda contra releases antigas, que
continuam no GitHub com o nome de então.

**Efeito de uma vez só:** quem está na 1.34.0 ou anterior tem embutido o
verificador antigo, que não reconhece o novo nome. Essas instalações
continuam avisando que há atualização, mas abrem a página do release
para download manual em vez de instalar sozinhas. Da 1.35.0 em diante a
instalação automática volta ao normal.

O **manual** acompanha o produto: o título passa a ser *Manual
Operacional — Licitarium Free vX.Y.Z*, que é o nome do PDF quando se
imprime pelo botão do próprio manual.

## 1.34.0 — 2026-08-13

**Parar a sincronização, e identificação da edição**

- **Botão "Parar sincronização"** em Configurações. A coleta encerra no
  fim do passo em andamento, não no meio de uma consulta ao portal — na
  prática, alguns segundos. Interromper é seguro por construção: o
  programa só marca um período como concluído quando ele termina
  inteiro, e as gravações são idempotentes, então o que já entrou fica e
  a próxima coleta refaz só o que ficou pendente. A interrupção é
  anunciada como interrupção, nunca como falha.
- **Barra de título** passa a trazer produto, versão e município:
  *Licitarium Free 1.34.0 — Orindiúva/SP*.
- **Cabeçalho** ganha a linha da edição, abaixo da marca:
  *Versão gratuita (1.34.0)*.

**Correção achada no caminho**

Ao terminar, a sincronização mandava recarregar a **lista**, sempre —
mas a aba inicial do programa é o **Painel**, que não tem lista. O
resultado era um erro dentro de código assíncrono, sem tela de aviso: o
Painel simplesmente não se atualizava com os dados recém-baixados, e era
preciso trocar de aba e voltar. Agora a atualização segue a vista que
está aberta. O caso mais comum era o pior: a coleta automática de
abertura terminando com o usuário parado no Painel.

## 1.33.0 — 2026-08-13

**Revisão da identidade visual**

Mesmo conceito de sempre — tabula ansata, estandarte, LICITARIVM com V
clássico, a fundamentação histórica intacta. O que mudou foi a execução.

- **A marca não depende mais de fonte instalada.** O L do ícone e as
  inscrições do estandarte eram `<text font-family="Georgia">`: numa
  máquina sem Georgia, a marca mudava de desenho. Agora são contorno
  vetorial da EB Garamond vendorizada (SIL OFL, que permite vetorizar e
  redistribuir).
- **A inscrição do estandarte parou de ser espremida.** O `textLength`
  comprimia os glifos para caber — LICITARIVM mede 9,3× a altura da
  capitular e era forçado em ~6,7×. O corpo agora é derivado da largura
  disponível, e a letra mantém a proporção que o desenhista lhe deu.
- **Ícones de interface desenhados, no lugar de emoji.** Os ⚠ ⏱ 📄 ⏸ 🖨
  vinham coloridos da fonte do sistema e ignoravam a paleta; os novos
  herdam `currentColor` e acompanham os quatro temas. De quebra, os
  mesmos conceitos usavam emoji diferentes em telas diferentes
  (vencimento era ⚠ na tela inicial e ⏱ no Painel) — agora saem todos do
  mesmo conjunto.
- **O wordmark passa a usar a mesma serifada da marca** nos quatro temas,
  em vez da Georgia do sistema.
- **Rótulo Civil ganhou splash própria**, em vez de reaproveitar a do
  Portal.
- **Um gerador, não quatro cópias à mão.** A arte era mantida em paralelo
  nos SVG, no `ui/app.js`, no `relatorios.py` e no desenho em Pillow do
  `gerar_ico.py`. Agora `design/gerar_marca.py` é a fonte, e
  `tests/test_marca.py` falha se alguém editar uma cópia sem regerar.

## 1.32.0 — 2026-08-13

**Novo tema: Rótulo Civil**

Quarto tema, ao lado de Portal, Pergaminho e Observatório: fundo claro,
verde de confirmação/economia como acento, cantos mais soltos — nasceu da
direção "Rótulo Civil" do brainstorm visual do projeto irmão Rationarium
(aposentado; só o visual foi aproveitado). Paleta de gráficos validada
pelo script de seis checks da skill dataviz (separação sob daltonismo,
contraste, banda de luminosidade).

Pergaminho e Rótulo Civil ganham tipografia própria — EB Garamond (serifa
de destaque em valores/números) + Public Sans/Lato (corpo), vendorizadas
localmente em `ui/fonts/*.woff2`, sem CDN. Portal e Observatório
continuam no `system-ui` de sempre.

## 1.31.1 — 2026-08-13

**Correção: CI de release sempre falhava (cosmético, sem efeito no release)**

O job da CI que roda em push de tag tentava anexar o executável à
release de novo, mas ele já tinha sido subido pelo passo manual do
fluxo de release — sem `--clobber`, esse job sempre mostrava X vermelho
mesmo com o release e o DOI saindo corretos. Também: repositório
renomeado para `licitarium-free`, sem mudança de código/branding.

## 1.31.0 — 2026-08-13

**Painel migrado para ECharts**

Os 9 gráficos do Painel (colunas mensais, barras por modalidade/economia,
deságio, funil, medidor de limite, mapa de calor, séries multi-ano,
concentração de fornecedores e agenda de vencimentos) que ainda eram SVG
desenhado à mão passam a usar ECharts, como Preços/Executivo/Economia já
usavam. Cor sempre por `var(--token)` — segue o tema ao vivo na tela e
resolve fixa no papel (o CSS de impressão do Painel já define os tokens),
sem precisar do mecanismo de paleta fixa criado para os outros
relatórios. Corte vertical, ponto padrão do ano corrente e a colisão de
rótulo da agenda continuam com a mesma lógica de antes, agora sobre as
coordenadas de pixel do próprio ECharts. Realce de hover (opacidade das
irmãs, brilho da marca) passa a valer só para `<circle>` — barra também
virou `<path>` no SVG do ECharts, e "path cresce no hover" deixou de
identificar só os pontos.

## 1.30.1 — 2026-08-13

**Correção: gráfico impresso vazava a cor do tema da tela**

Achado por auditoria /dataviz. O box-plot de Preços e as barras/colunas de
Executivo/Economia, capturados via ECharts para o papel, liam a cor viva
do tema ativo na tela (`getComputedStyle`) — Pergaminho e Observatório
nunca foram validados para o fundo branco do documento impresso.
Documento oficial não tem tema: os 3 gráficos agora sempre usam a mesma
paleta fixa validada do papel, independente do tema em uso na tela.

## 1.30.0 — 2026-08-13

**Selo de procedência nos relatórios (identidade sem logotipo)**

Portado do diagnóstico de identidade visual feito pro projeto irmão
licitarium-relatorios (Rationarium): "identidade forte de fornecedor
num documento oficial não passa por sofisticação, passa por material
publicitário dentro de autos" — o teto real é procedência, não marca.

- **Tarja por tipo de relatório**: etiqueta colorida acima do
  cabeçalho — Cadastral (contratações/contratos/atas), Analítico
  (executivo/economia), Vigilância (fracionamento), Planejamento
  (PCA/preços). Mesmo princípio da CGU: a cor da capa codifica o tipo
  de trabalho, não decora.
- **Faixa de acervo**: "Acervo sincronizado em {data} · {hash}"
  abaixo do cabeçalho — a mesma fotografia do banco (mesmo hash) em
  todo documento gerado na mesma sincronização, sem precisar de
  consulta nova.
- **Rodapé de procedência**: "Apurado a partir do PNCP · acervo
  sincronizado em {data}" no lugar de "Documento gerado
  automaticamente".
- **Nota de método** em Contratações, Contratos, Atas, Executivo e
  Economia — os 5 relatórios que não tinham (Fracionamento, Minuta do
  PCA e Preços já tinham).
- **Card com aba superior** (cor da categoria) e **rótulos em
  versalete** no lugar de caixa alta.
- Painel e a ficha impressa do modal de detalhe **não mudam** — já
  têm identidade visual própria; chamam `_pagina` sem `categoria`.

372 pytest + 152 E2E.

## 1.29.0 — 2026-08-12

**Cinco correções portadas do licitarium-relatorios (Django)**

Auditoria cruzada entre os dois projetos irmãos (mesmos dados do PNCP,
motores diferentes) achou 5 bugs de lógica de negócio que também
existiam no Desktop — nenhum específico do motor de impressão (esses
ficaram de fora, o Desktop imprime via navegador).

- **Categoria morta**: o PNCP preenche `categoria` com "Não se
  aplica" em quase todos os itens — o `COALESCE` nunca caía no
  fallback (`material_servico`) porque a string é truthy. "Economia
  por categoria" saía com uma barra só, sem informação nenhuma.
- **Preço fora da curva marcado só por cor** (WCAG 1.4.1): a linha
  destoante da Pesquisa de Preços virava vermelha só via `style`
  inline. Agora leva `*` no valor + nota de rodapé explicando o
  critério — quem imprime em P&B ou não distingue vermelho lê o
  mesmo alerta.
- **"Economia por modalidade" ordenava errado**: a lista ordenava
  pelo valor estimado, mas o gráfico desenha o economizado. As outras
  três (família/categoria/fornecedor) já ordenavam certo.
- **Modalidade não é amparo legal**: `modalidade_id=8` (Dispensa)
  virava sinônimo de "sujeita ao limite do art. 75, II" — uma compra
  de agricultura familiar (dispensa própria, sem teto por valor)
  podia acusar centenas de % do limite sem irregularidade nenhuma.
  Novo `teto_da_dispensa()` classifica pelo amparo real (art. 75, I =
  teto de obras; art. 75, II = teto de compras; demais incisos e
  outras leis = sem teto, declarado à parte em
  `fora_do_limite_legal`).
- **Teto de dispensa somava por município, não por órgão**: o art. 75
  fala em teto "por órgão ou entidade" (§1º) — Prefeitura e Câmara
  dispensando a mesma coisa somavam contra um teto só, o que pode
  acusar fracionamento (crime, art. 337-E do CP) onde há duas compras
  legais. `dados_fracionamento` e o alerta do Painel agora segregam
  por (órgão, unidade/objeto, teto).

O relatório de Fracionamento ganha coluna "Tipo" (Obras/Compras) e
coluna "Órgão" (só quando há mais de um órgão com dispensa no
exercício).

368 pytest + 152 E2E.

## 1.28.1 — 2026-08-12

**Nome do PDF: ficha impressa de contratações**

Pedido do usuário: mesma lógica dos contratos/atas (1.28.0), agora
pras contratações. `{MODALIDADE} {número}-{ano} {ÓRGÃO}` — ex.:
`PREGÃO ELETRÔNICO 28-2026 MUNICIPIO DE ORINDIUVA`,
`INEXIGIBILIDADE 28-2026 MUNICIPIO DE ORINDIUVA`. Sem fornecedor: uma
contratação pode ter mais de um (ou nenhum, se ainda não homologada).
`orgao_nome` já vem na própria linha de `contratacoes` — não precisa
do cadastro local de órgãos como contratos/atas precisavam.

360 pytest + 152 E2E.

## 1.28.0 — 2026-08-12

**Nome do PDF: ficha impressa de contrato/ata**

Pedido do usuário: ao "Salvar como PDF" a ficha de um contrato ou
ata, o nome sugerido pelo navegador identifica o documento sem
precisar abrir.

- Contrato: `CONTRATO {número}-{ano} {ÓRGÃO} X {FORNECEDOR}`.
- Ata: `ATA DE REGISTRO DE PREÇOS {número}-{ano} {ÓRGÃO}` — sem
  fornecedor: o PNCP não guarda fornecedor por ata (é por item).
- Nos demais tipos (contratações, itens, PCA) o título continua
  "Município — UF", como já era.
- Nome do órgão vem da tabela local `orgaos` (mesma fonte que
  Configurações já usa) por CNPJ do registro.

359 pytest + 152 E2E.

## 1.27.2 — 2026-08-12

**Ficha impressa do detalhe: cabeçalho, objeto e link da origem**

Pedido do usuário, olhando a ficha impressa de um contrato: o objeto
(texto comprido) disputava espaço com o brasão no cabeçalho.

- Cabeçalho volta a ser só brasão + identificação do município (mesmo
  padrão dos demais relatórios) — o objeto desce pro corpo, em
  parágrafo próprio, caixa alta e justificado.
- "Contratação de origem" na grade de campos vira link pro edital no
  PNCP (construído no JS a partir do próprio número de controle —
  mesmo formato que `Api.abrir_pncp` já usa, sem chamada nova à
  ponte). Só no papel: um `<a href>` cru dentro da modal do pywebview
  navegaria a janela do app pra fora dele, então a tela continua
  mostrando texto puro.

357 pytest + 152 E2E.

## 1.27.1 — 2026-08-12

**Configurações: modal abria devagar — corrigido**

Achado pelo usuário: clicar em "Configurações" demorava a abrir a
modal. Causa: o clique disparava 5 chamadas à ponte pywebview (dados
do município, brasão, órgãos monitorados, municípios de referência,
log de sincronização) uma **depois** da outra — cada `await` soma o
ida-e-volta da ponte, que sozinho já custa dezenas de ms, e a modal só
aparecia depois que as 5 respondiam.

- A modal agora abre no clique, antes de qualquer chamada.
- As 5 chamadas disparam juntas (`Promise.all`) em vez de em fila — o
  tempo de espera vira o da mais lenta, não a soma de todas.
- Teste novo mede o efeito de verdade: com 200ms de atraso simulado
  em cada chamada, a modal abre em <200ms (antes: ~1000ms, a soma das
  5) e os dados terminam de chegar perto dos 200ms, não dos 1000ms.

356 pytest + 151 E2E.

## 1.27.0 — 2026-08-12

**Contratos e Atas: vigência inicial/final e status em colunas próprias**

Pedido do usuário: a coluna "Vigência" combinava as duas datas e o
selo (Vigente/Vence em N d/Encerrado) espremidos numa célula só.
Agora são três colunas: Vigência inicial, Vigência final e Status —
mais fáceis de ler e de ordenar (novo: ordenar por qualquer uma das
duas datas, antes só dava pela data final).

- Contratos: Contrato, Objeto / Fornecedor, Vigência inicial, Vigência
  final, Status, Valor.
- Atas: Ata, Contratação de origem, Objeto, Vigência inicial, Vigência
  final, Status (sem Valor — atas não têm esse campo no PNCP).
- Selo do Status continua com o texto no badge e a data completa no
  title (WCAG 1.4.1: cor nunca é o único indicador).

356 pytest + 150 E2E.

## 1.26.1 — 2026-08-12

**Ficha impressa do detalhe ganha os "Dados completos (JSON)"**

Achado pelo usuário: a ficha de 1.26.0 saía sem a seção "Dados
completos (JSON do PNCP)" que o modal mostra — ficava só cabeçalho
(brasão + identificação) e a grade de campos. `Api.imprimir_detalhe`/
`relatorios.render_detalhe` ganham `raw_html`: o JSON colorido que o
modal já monta (`jsonColorido`) entra pronto na ficha, mesmo padrão de
`meta_html` — sem reimplementar o realce de sintaxe em Python.

356 pytest + 149 E2E.

## 1.26.0 — 2026-08-12

**Imprimir ficha do registro no modal de detalhe**

Pedido do usuário: ao clicar numa contratação, contrato ou ata e abrir
o modal com "Ver no PNCP ↗", agora tem também "🖨 Imprimir" — gera uma
ficha impressa (A4 retrato) só daquele registro específico, com brasão
do município quando configurado.

- Novo `Api.imprimir_detalhe`/`relatorios.render_detalhe`: mesmo padrão
  já usado pro Painel e pros relatórios ECharts — a tela manda o
  `#det-meta` que já montou (rótulo/valor com a mesma formatação de
  moeda/data do modal), o Python só envelopa em página impressa. Sem
  reimplementar rótulo por rótulo em Python, sem divergir do que a
  tela mostra.
- Funciona pra qualquer tipo aberto nesse modal (contratações,
  contratos, atas, itens, PCA) — o botão não é específico de um tipo.

355 pytest + 149 E2E.

## 1.25.1 — 2026-08-12

**Correção: gráficos zerados no papel (Executivo, Economia, Preços)**

Achado pelo usuário testando os relatórios reais: barras e colunas
saíam zeradas no documento impresso, apesar do `<svg>` e dos rótulos
aparecerem certos. Causa: `desenharBarrasEcharts`/`desenharColunasEcharts`/
`desenharBoxplotPreco` não desligavam a animação padrão do ECharts —
a captura do `innerHTML` acontece no MESMO tick do `setOption`, então
pegava sempre o 1º frame da animação (barra crescendo de zero), nunca
o desenho final. `animation: false` nas três funções — sem efeito na
tela (a prévia/impressão nunca fica visível animando de qualquer
jeito). Teste antigo não pegava isso: checava `<svg>` e texto, não
geometria — novo teste lê o `d` do primeiro `<path>` de barra e confere
que a largura bate com o dado real, não com zero.

353 pytest + 148 E2E.

## 1.25.0 — 2026-08-11

**Motor de gráfico: papel une com a tela em Executivo e Economia**

Fecha a fase B do incremento: os relatórios avulsos "Executivo" e
"Economia e Comparativos" nunca tiveram vista nenhuma na tela — eram
gerados 100% no Python, com gráficos em SVG à mão. Passam a reusar
exatamente os dados que a vista Painel já busca (`api.painel`, sem
método novo) e desenhar com o mesmo ECharts das telas.

- Ao gerar, a tela desenha colunas pareadas (meses) e barras
  (modalidade/família/categoria/fornecedor) num contêiner oculto,
  captura o SVG de cada uma e manda pronto (`params.graficos`) —
  mesmo padrão já usado pra Preços em 1.24.0.
- `render_executivo`/`render_economia` (1.24.0) já aceitavam
  `graficos={}` pré-renderizado; chamada direta, CLI e testes seguem
  funcionando sem depender de navegador — sem gráfico pronto, cai no
  SVG de sempre.
- Atalho "Relatório de economia" da própria vista Painel (Economia)
  não muda — já é gerado a partir de uma tela que acabou de desenhar
  os gráficos; o alvo aqui era só o caminho do relatório avulso, que
  nunca passava pela tela antes de imprimir.

353 pytest + 147 E2E.

## 1.24.0 — 2026-08-11

**Motor de gráfico: papel une com a tela na pesquisa de preços**

Fecha o incremento 2: o relatório impresso de pesquisa de preços deixa de
reimplementar o gráfico à parte em Python (`_grafico_dispersao`, SVG à
mão) e passa a usar o mesmo ECharts que a aba Preços já desenha na tela
(1.23.0) — com ponto por item, não só o agregado.

- `estatisticas_preco`/novo `dados_grafico_precos` devolvem cada preço
  (descrição, fornecedor, valor) — o gráfico da tela ganha o modo
  "Anotada": ponto por item, jitter em zigue-zague por ordem de valor
  (não de cadastro — dois preços vizinhos nunca caem na mesma altura),
  vermelho no que passa de alguma das duas cercas.
- `dados_grafico_precos` roda a MESMA `dados_precos()` com os MESMOS
  parâmetros que o documento final vai usar — garante que a prévia nunca
  diverge do papel.
- `render_precos` aceita o SVG pronto vindo da tela (`grafico_html`); sem
  ele, cai no `_grafico_dispersao` de sempre — chamada direta, CLI e
  testes continuam funcionando sem depender de navegador nenhum.
- Achado no caminho: `_normalizar_por_conteudo` reconstruía a linha e
  derrubava a descrição — "comparar por conteúdo" ligado deixava o
  gráfico sem rótulo por item. Corrigido: contrato de posição uniforme
  (id/valor/descrição sempre nos mesmos lugares) entre as três
  transformações possíveis (corrigir IPCA, comparar por conteúdo, as
  duas, nenhuma).
- Achado de robustez: instância do ECharts presa a uma variável de
  módulo — desenhar na tela e no contêiner oculto de impressão ao mesmo
  tempo fazia o `dispose()` de um derrubar o outro. Agora cada elemento
  guarda a própria instância.

351 pytest + 145 E2E.

## 1.23.0 — 2026-08-11

**Motor de gráfico: primeiro gráfico da pesquisa de preços na tela**

A aba Preços nunca teve gráfico nenhum na tela — só texto (a caixa de
Tukey só existia impressa, gerada à parte pelo Python). Ganha agora um
box-plot em Apache ECharts (vendorizado local, sem CDN, `renderer:'svg'`)
mostrando as **duas** cercas de extremo juntas: a de Tukey e a do escore Z
modificado sobre o desvio absoluto mediano (MAD, 1.22.0) — a segunda
nunca teve representação visual em lugar nenhum, só em texto. Cores lidas
das variáveis do tema em uso (`--s1`, `--erro`, `--warn`) — segue o tema
(Portal/Pergaminho/Observatório), não fica preso a uma paleta fixa.

Escopo desta etapa: só a tela, só o agregado (caixa + cercas + média,
sem ponto por item — `estatisticas_preco` não devolve preço por item
hoje). O relatório impresso continua gerado 100% no Python
(`_grafico_dispersao`), sem mudança — ele nunca passa pela tela antes de
imprimir (diferente do Painel), então migrar o motor lá exige plumbing
nova, ainda não construída.

348 pytest + 142 E2E.

## 1.22.0 — 2026-08-11

**Pesquisa de preços: quatro reforços aproveitados de uma skill de pesquisa
de preços públicos que o autor mantém para outra ferramenta (ChatGPT/Codex)**

- **Desvio padrão passa a ser populacional** (divide por n, não por n-1):
  descreve a cesta efetivamente coletada, alinhado com a metodologia
  administrativa (INSS/Manual de Pesquisa de Preços do STJ) que já embasa
  a presunção de CV de 25% usada na leitura do coeficiente de variação.
- **Segundo diagnóstico de extremo — escore Z modificado sobre o desvio
  absoluto mediano (MAD)** — funciona já com 3-4 preços, faixa em que o
  critério de Tukey (que exige 5+) nem entrava. Uma pesquisa pequena
  passa a ter *algum* apontamento de extremo, onde antes não tinha
  nenhum.
- **"Fora da curva" marcado no papel, não só na tela.** O relatório
  impresso não indicava nenhuma linha como extrema — só a caixa agregada
  de dispersão. Agora a linha destoante vem destacada na tabela, igual ao
  que o botão "Descartar os itens fora da curva" já fazia na tela.
- **Sensibilidade: "e se eu tirasse o pior caso?"** Sem excluir sozinho
  (decisão de quem assina, art. 23), o resumo agora mostra o efeito de
  tirar o preço mais destoante — média e mediana antes/depois — tanto na
  tela quanto no papel.
- **Alerta de concentração por fornecedor/processo.** Preços da mesma
  contratação ou do mesmo fornecedor não são evidências independentes;
  agora isso é avisado. Fornecedor e contratação precisaram ser
  preservados através das transformações de correção pelo IPCA e de
  normalização por conteúdo, que antes reconstruíam a linha e perdiam
  qualquer coluna além das que já usavam.

**O que ficou de fora da skill de propósito:** o script de varredura do
CSV nacional do Compras.gov não entrou — o banco de preços do Licitarium é
deliberadamente escopado a "seu município + municípios de referência"
(mesmo limite que a correção de troca de município desta sessão
reforçou), e puxar a base nacional inteira contradiria essa arquitetura.

348 pytest + 140 E2E. Cada reforço com teste que morde sem ele.

## 1.21.2 — 2026-08-11

**4ª esquina da mesma raiz**

Testando a correção de `moeda()`/`moeda_fina()` da 1.21.1, o teste achou
um sítio a mais: `resumo_estatistico()` — `sum()`/variância em Python
quebravam com TEXT numa lista de `valor_unitario_homologado`, mesmo
problema de afinidade SQLite dos outros três (banco anterior à validação
na ingestão do PNCP). A linha malformada agora é descartada, a estatística
segue com o resto — mesmo critério que `sync_ipca` já usa para uma linha
de IPCA estranha.

343 pytest + 140 E2E.

## 1.21.1 — 2026-08-11

**Auditoria de code review — 8 achados, todos de falha que não chegava a
lugar nenhum ou dado que não era conferido antes de virar cálculo**

- **PNCP nunca validava campo numérico antes de gravar.** Um valor que não
  fosse número JSON limpo (string vazia, decimal malformado) ficava
  guardado como TEXT numa coluna REAL — afinidade do SQLite não converte —
  e a corrupção só se manifestava bem depois, derrubando relatórios. Um
  `_num()` no ponto de ingestão (`pncp.py`) evita o resto em cascata.
- **`moeda()`/`moeda_fina()` não tinham a blindagem que `quantidade()` já
  ganhou** contra esse mesmo TEXT-em-REAL — crashavam o relatório inteiro
  em vez de mostrar "–". `preco_por_conteudo()`, achado testando a
  correção acima, tinha o mesmo problema.
- **Economia por modalidade: gráfico cortava em 8, tabela ao lado (mesma
  página) e a tela mostravam a lista inteira.** Único corte fora do padrão
  das listas irmãs.
- **`date('now')` do SQLite é UTC; nada usava `'localtime'`.** Entre ~21h
  e meia-noite de Brasília, um contrato vencendo hoje lia como já vencido
  nos painéis de vigência e prazo — mesma classe de bug de fuso já
  corrigida na outra família de sistemas do autor.
- **"Restaurar todos" (aba Preços) descartava o retorno `{ok}` num loop**
  — irmão não corrigido do toggle individual que a auditoria anterior já
  tinha fechado.
- **Troca de município/importação de acervo não coordenava com uma
  sincronização em andamento** — a thread de sync guarda o código do
  IBGE numa variável local antes de rodar; trocar o município no meio
  contaminava o banco novo com dados do antigo, sem erro visível. As três
  operações que mexem nas mesmas tabelas agora recusam enquanto o lock
  estiver preso.
- **Mesclar itens do PCA somava quantidade sem checar a unidade** — 300
  pacotes viravam 300 kg fantasmas na minuta. Ação manual do usuário
  agora recusa em vez de corromper (a consolidação automática continua só
  sinalizando, que é o comportamento certo para ela).
- **Coeficiente de variação podia ser `None`** onde só o desvio padrão era
  checado — itens a R$0,00 (doação/brinde) derrubavam o relatório de
  preços.

341 pytest + 140 E2E. Cada achado com teste que morde sem a correção.

## 1.21.0 — 2026-08-09

**Fecha as correções em aberto das auditorias**

- **A ponte com o Python ganhou rede.** O pywebview *rejeita* a promise
  quando o Python levanta, e no exe sem console o traceback não vai a
  lugar nenhum: uma chamada que falhava deixava os números **velhos** na
  tela — marcar "corrigir pelo IPCA", a chamada falhar, e o resumo seguir
  mostrando os valores não corrigidos com a caixa marcada. Um `Proxy` no
  ponto único onde a ponte é ligada, em vez de `try/catch` em ~50 lugares.
- **Seleção que não grava não fica muda.** A tela mostra um conjunto em
  memória; o documento sai da tabela do banco. Se a gravação não pegava e
  ninguém lia o retorno, os dois divergiam sem sintoma — a mediana da tela
  deixava de ser a do papel. Agora a caixa volta atrás, o usuário é
  avisado e a lista é relida do banco. Saiu também o `?.` dos seis pontos
  de gravação: os métodos existem, e o `?.` só esconderia uma renomeação.
- **Cópia do acervo que falha avisa.** Disco cheio deixava um `.zip`
  truncado, de nome plausível, e a tela presa em "Salvando cópia…". Na
  restauração a ordem estava pior: o acervo era renomeado **antes** da
  cópia, então uma falha no meio deixava o usuário sem banco nenhum, o
  dele sob um nome que ninguém contou. Agora a parte demorada acontece
  primeiro e, se a troca falhar, o acervo volta ao lugar.
- **404 do PNCP deixou de virar "não tem itens".** Um 404 sob carga é
  portal ocupado; tratá-lo como ausência carimbava a contratação como
  resolvida e ela **nunca mais** era revisitada — os preços dela sumiam do
  banco calados. Agora fica pendente para a próxima coleta, e o aviso
  aparece em Configurações → Sincronizações recentes.
- **Largura de coluna por modo na aba Preços.** "Corrigir pelo IPCA" e
  "comparar por conteúdo" acrescentam uma coluna cada; tudo era guardado
  sob a mesma chave, e a guarda só rejeitava mapa faltando entrada, nunca
  sobrando — voltar ao modo base aplicava as 8 primeiras larguras de um
  layout de 9 e desalinhava. As variantes também liam variáveis CSS que
  nada definia, então arrastar ali não aplicava nada.

**Dívida técnica, fase 1:** teto no `pywebview` (`<7` — a API já derivou
uma vez e o CI instalava sem trava), Node 24 no CI (o 20 está depreciado)
e o piso de Python declarado no README.

330 pytest + 139 E2E. Cada correção com teste que morde sem ela.

## 1.20.4 — 2026-08-09

**Gráficos: método dataviz (auditoria visual)**

A paleta foi validada rodando o script de seis checks, não a olho. **Os
três temas passam em tudo** — banda de luminosidade, piso de croma,
separação sob daltonismo (ΔE 8,2–9,1), piso de visão normal e contraste.
Os avisos de contraste que restam são satisfeitos pelo alívio que a regra
do projeto já exige — rótulo direto em toda barra, mais a tabela completa
no relatório. **A paleta não foi mexida**: mudá-la arriscaria a separação
sob daltonismo, que passa perto do piso.

- **O papel deixou de divergir da tela.** Os quatro gráficos de economia
  do relatório usavam quatro cores diferentes, enquanto na tela os mesmos
  quatro usam a cor padrão. São gráficos de série única — a cor não
  codifica nada ali, quem diz de que é cada um é o título. Agora todos
  usam a mesma, o que também tira o aviso de contraste (a cor escolhida é
  a única do conjunto acima de 3.0 contra papel branco).
- **Número grande deixou de usar largura fixa de dígito.** `tabular-nums`
  em número de exibição deixa o valor "frouxo"; ele serve para onde
  números se alinham na vertical (tabela, eixo), e lá continua.

326 pytest + 136 E2E.

## 1.20.3 — 2026-08-09

**Acessibilidade: o que um leitor de tela recebia (auditoria WCAG 2.1 AA)**

A última passagem de acessibilidade era da v0.4.0 e cobria contraste e
diálogos. Desde então entraram a 4ª vista do Painel, o card do Brasão, o
ranking de fornecedores e a aba Preços opt-in inteira — nada disso tinha
sido checado.

- **Gráfico era imagem sem nome e sem conteúdo.** O helper `svg()` emitia
  `role="img"` sem nome acessível — e `role="img"` torna os filhos
  apresentacionais, então os rótulos de dentro do desenho **também**
  sumiam. Agora o nome entra como `<title>`, num ponto único
  (`desenharGraficos`), e o `role` saiu: estes gráficos põem rótulo direto
  dentro do desenho por regra de projeto, e é lá que moram os números.
- **Aba dizia `role="tab"` e nunca dizia qual estava selecionada** — só
  alternava a classe `.on`, que não diz nada a leitor de tela. Novo
  `marcarAba()` cuida das abas de topo e das subabas do Painel de uma vez.
- **Nada dinâmico era anunciado**: `#sync-msg`, `#brasao-status`,
  `#economia-status` e o contador "X de Y selecionados" — o único retorno
  das seleções em lote e das mensagens de erro — ganharam `role="status"`.
- **Checkbox da linha era filho de `role="button"`**, o que tornava o
  estado marcado não confiável e fazia o rótulo dele virar o nome da
  linha. O papel de botão passou para a célula da descrição; os handlers
  seguem na linha, porque o evento borbulha.
- **Foco não se perdia mais** a cada seleção em lote, e o rótulo de cada
  checkbox passou a dizer de qual item ele é.

Corrigidos em helpers compartilhados, então valem também para os gráficos
e as abas anteriores. Novo `tests-e2e/acessibilidade.spec.js` trava os
cinco no navegador.

326 pytest + 137 E2E.

**Pendente, item próprio:** a série de cores dos gráficos fica abaixo do
mínimo de 3.0 (WCAG 1.4.11) contra a superfície — `s3` 2,82 e `s4` 2,17 no
Portal (tema padrão), `s2` 2,76 no Pergaminho. É pré-existente e mexer nas
cores exige revalidar daltonismo, que é o que a paleta protege.

## 1.20.2 — 2026-08-09

**Dois defeitos críticos da auditoria de falha silenciosa**

- **A pesquisa de preços saía sobre a busca inteira quando nada estava
  selecionado.** A tela dizia *"Nenhum item selecionado ainda"*; o
  documento saía pronto, com mediana e máximo de uma série que o usuário
  nunca curou — incluindo preço de município de referência — e sem
  nenhum aviso no papel. Medido numa amostra: mediana R$ 17,50 e máximo
  R$ 500,00 sem seleção, contra R$ 12,00 e R$ 15,00 com os itens
  escolhidos. Gerar agora recusa e explica. Busca que não acha nada segue
  gerando o documento de "nenhum item encontrado" — mandar selecionar o
  que não existe seria pior.
- **"Lembrar onde o usuário estava" nunca funcionou.** A allowlist de
  `set_config` é da 0.1.0; `aba` chegou na v1.12.0 e `painel_vista`
  depois, e nenhuma das duas foi acrescentada — `set_config` devolvia
  `False` em silêncio e `get_estado` caía no padrão. Corrigido, mais
  recusa de valor nulo (que também fingia ter gravado).

Por que nenhum teste pegou o segundo: os E2E que cobrem a persistência
batem no mock do harness, que aceita qualquer chave. Eles provam que a
interface **envia** a chamada certa, não que o backend **aceita**. O novo
`tests/test_config.py` fecha o outro lado — grava pela ponte e lê de volta
por `get_estado`, sem mock no meio, e ainda confere que toda chave enviada
pela interface consta da allowlist.

326 pytest (era 314) + 131 E2E. Os onze testes que geravam o documento sem
seleção passaram a selecionar antes, pela fixture nova `selecionar_tudo`.

## 1.20.1 — 2026-08-09

**Dois sinks de XSS armazenado nos relatórios (auditoria de segurança)**

O relatório é aberto com `webbrowser.open` no **navegador real** do
usuário (origem `file://`), não dentro do WebView — marcação que sai dali
executa fora da janela do programa. Vetor confirmado: `importar_acervo`
troca o banco inteiro por um `.zip` de terceiro, validado só por
`quick_check`, sem conferência de tipo de coluna.

- **`quantidade_homologada` saía crua** no `<td class="num">` (dois
  pontos: tabela de preços e itens desconsiderados). A coluna é `REAL`,
  mas afinidade do SQLite não converte texto não-numérico — ele fica
  gravado como TEXT. Novo `quantidade()` formata número e devolve
  travessão para o que não for número, que é o que a coluna promete.
- **`mes_por_extenso` validava só o mês** e devolvia o ano cru:
  `"<marcação>-06"` virava `"jun/<marcação>"` na prosa da correção pelo
  IPCA. Agora ano e mês são validados como número, e competência fora do
  formato some em vez de virar texto.

314 pytest + 131 E2E. Os dois com teste que morde sem a correção.

**Limpeza (auditoria de over-engineering) — −83 linhas**

- **O parâmetro `tema` sumiu** de `gerar`, das 9 `render_*` e de `_pagina`.
  Desde a v1.20.0 o documento tem paleta própria, então ele atravessava
  11 funções sem alterar nada. Agora o documento não segue a tela **por
  construção**: não há parâmetro para seguir.
- **`PALETAS` deletado** (3 paletas, zero leitores) e `SERIES_PAINEL`
  reduzido ao único conjunto que o papel usa, agora `SERIE_DOCUMENTO`.
  `_vars()` e a concatenação manual de `_css_painel` viraram compreensão
  sobre o próprio dicionário — as chaves já eram os nomes das variáveis
  CSS.
- **`restaurar_preco` deletado.** Sem chamador na interface desde que a
  seleção virou opt-in, e no modelo atual fazia meia operação: limpava o
  descarte sem repor o item na seleção — o defeito que `DASHBOARD.md` já
  registrava. Método, teste e stub saíram juntos.
- Miudezas: `estado.total` (escrito, nunca lido), 3º parâmetro de
  `preencher()`, chave `unidade` duplicada em `ROTULOS`, id
  `precos-selecao-criterio`, `import pca_builder` dentro de `gerar()` (já
  era módulo) e `unidade` selecionada duas vezes no mesmo `SELECT`.

## 1.20.0 — 2026-08-08

**Documento impresso fica sóbrio — e deixa de seguir o tema da tela**

Pedido do usuário, fechando o brainstorm de "mais institucional": o papel
que vai ao Tribunal de Contas é peça do município, não vitrine da
ferramenta.

- **Paleta própria do documento** (`PALETA_DOCUMENTO`): fundo branco,
  texto grafite, réguas cinza discretas. Saíram o bege do pergaminho, o
  vinho do acento e o dourado das réguas.
- **Régua dupla de diploma virou linha simples** no cabeçalho e no rodapé.
- **Reversão consciente da v1.14.4**: lá o documento passou a seguir o
  tema da tela porque forçava pergaminho e ignorava a escolha do usuário.
  Agora a regra é outra e mais forte — documento oficial não tem tema, sai
  igual nos três. Imprimir no Observatório gerava documento de fundo
  escuro, que nunca ia parecer peça de Tribunal.
- **Cores de série fixadas no conjunto do Portal**, que é o calibrado para
  superfície branca. As cores não mudaram; mudou qual dos três conjuntos
  já existentes o papel usa. Medido: sobre branco, as rampas do
  Observatório caíam a 2,99 e 1,54 de contraste e as do Pergaminho a
  1,28–2,55 — invisíveis no papel.
- O lema no rodapé e o estandarte seguem como estão: marca não troca de
  cor com a pele (`design/IDENTIDADE.md`). A tela mantém os três temas
  integralmente.

312 pytest + 131 E2E. Os dois testes que travavam o comportamento da
v1.14.4 foram reescritos para o contrato novo, com o histórico no
docstring.

## 1.19.0 — 2026-08-08

**Ranking de fornecedores por deságio**

Fecha a vista Economia: além de modalidade, família de item e categoria,
agora também **quem fechou abaixo do estimado** — na tela e no relatório
avulso, com tabela completa e o documento mascarado (CNPJ ou CPF, pelo
número de dígitos).

- **Agrupa pelo CNPJ/CPF, não pelo nome** — a mesma empresa aparece com
  grafias diferentes entre processos; item sem fornecedor fica de fora do
  ranking em vez de virar uma linha "(sem fornecedor)" que ninguém pode
  cobrar.
- **Nenhuma consulta nova**: a mesma leitura de `itens` que já alimentava
  família e categoria ganhou dois campos e um terceiro agrupamento.
- **Ressalva junto do número**, na tela e no papel: deságio alto não é
  atestado de bom fornecedor — pode ser estimativa inflada na origem.

312 pytest + 131 E2E. Cada agrupamento com teste que morde sem ele.

## 1.18.0 — 2026-08-08

**Brasão do município nos relatórios**

Pedido do usuário, no espírito de deixar o sistema "mais institucional":
em Configurações, subir o brasão do município (PNG/JPG, até 3 MB) e vê-lo
impresso no cabeçalho de todo relatório gerado — no lugar do estandarte
romano do Licitarium, que continua assinando o rodapé.

- **Upload pelo diálogo nativo** (`create_file_dialog`, o mesmo mecanismo
  de exportar/importar acervo) — programa de mesa não tem
  `<input type="file">` de navegador; o Python lê o arquivo direto do
  disco, nenhum byte cruza a ponte JS.
- Guardado como Data URL no `config` (mesma tabela chave/valor de
  tema/densidade/etc — nenhuma tabela nova), sem redimensionar.
- **`brasao` atravessa toda `render_*` como `tema` já atravessa** —
  qualquer relatório, e também o Painel A3 inteiro, mostra o brasão
  quando configurado.

308 pytest + 130 E2E. Cada método novo com teste que morde sem ele.

## 1.17.2 — 2026-08-08

**Economia ganha o comparativo de 3 exercícios**

Continuação da vista Economia (v1.17.0): gráfico de linha com a economia
acumulada (estimado − homologado) do ano corrente contra os dois
anteriores, mês a mês — mesmo padrão já usado na vista Análise para o
valor homologado acumulado, e a mesma consulta (um `SELECT` a mais por
ano, não uma consulta nova).

298 pytest + 125 E2E. Teste que morde sem a série.

## 1.17.1 — 2026-08-08

**Adicionar órgão manualmente confere o CNPJ no PNCP antes de aceitar**

Achado ao discutir se "órgãos monitorados" serviria para comparar
prefeituras: contratos/atas são baixados por CNPJ isolado, sem checar
município — o campo de CNPJ manual só exigia 14 dígitos, então o CNPJ de
**outra prefeitura** entraria sem o processo de origem (só a fase 1,
por município, cria a contratação-mãe) e contaminaria os relatórios
oficiais, que confiam em `referencia=0` para separar o que é seu do que
não é.

- **`pncp.consultar_orgao(cnpj)`** — nova consulta ao registro do CNPJ no
  PNCP (`/v1/orgaos/{cnpj}`: razão social e esfera).
- **`add_orgao` agora recusa**: CNPJ que o PNCP não reconhece, órgão que
  não é da esfera municipal, e razão social que não cita o nome do
  município configurado (comparação sem acento/caixa). Erro claro na
  tela, com a razão social encontrada — sem checagem se o município ainda
  não foi configurado (acervo novo).

297 pytest (era 289) + 124 E2E. Teste que morde sem a checagem: CNPJ de
outra prefeitura era aceito antes da correção.

## 1.17.0 — 2026-08-08

**Painel ganha a vista Economia — quanto foi economizado, por modalidade,
família de item e categoria**

Primeiro passo para preparar o sistema para prefeituras menores: o Painel
já media desempenho de contratação, mas o quanto foi economizado só
aparecia como um número solto no Resumo Executivo. Agora é uma vista
própria, com os mesmos dados por trás do restante do Painel — sem ida
extra ao banco.

- **4ª subaba "Economia"**, ao lado de Execução/Análise/Vigilância — total
  economizado no ano, comparação com o mesmo período do ano anterior,
  deságio médio, e três gráficos de barras (por modalidade, por família de
  item — o mesmo agrupamento do medidor de limite de fracionamento — e por
  categoria bruta do PNCP).
- **Entra na impressão do Painel em A3** de graça: o botão "Imprimir" já
  captura a vista nova junto das outras três.
- **Novo relatório avulso "Economia e Comparativos"**, no modal de
  Relatórios — mesmos números, em documento que se gera sem abrir o
  Painel, com tabela completa (não só o topo) por modalidade, família e
  categoria; CSV pela família de item.

289 pytest + 124 E2E. Cada agrupamento com teste que morde sem a correção.

## 1.16.1 — 2026-08-08

**Pesquisa de preços: contador e três novos jeitos de selecionar**

Pedido do usuário, depois do levantamento de filtros da v1.16.0:

- **Contador "X de Y selecionados"** no resumo — o total é a busca
  inteira, sem olhar seleção nem descarte.
- **Filtro por unidade agora acumula**, não substitui: escolher "Maço" e
  depois "Unidade" deixa as duas dentro (antes, a segunda escolha
  trocava a primeira).
- **Selecionar por fornecedor** — lista quem aparece na busca, do mais
  frequente pro mais raro.
- **Selecionar por faixa de valor** — De/Até, um dos dois pode ficar
  vazio; corte manual complementar ao aviso de preço fora da curva.
- **Selecionar por texto na descrição** — para separar o que uma unidade
  só não separa (ex.: dentro de "papel", só quem tem "sulfite").

Os quatro seletores por critério (unidade, fornecedor, faixa, texto)
compartilham a mesma regra: somam à seleção atual, nunca substituem.

282 pytest + 121 E2E. Cada seletor com teste que morde sem a correção.

## 1.16.0 — 2026-08-08

**Pesquisa de preços: seleção passa a ser opt-in, não opt-out**

Pedido do usuário, três achados na aba Preços:

- **A busca abre com tudo desmarcado** — antes vinha tudo marcado e
  comparar por um subconjunto (ex.: só os itens em "maço") exigia
  desmarcar item por item na mão. Agora marcar é ato positivo: o resumo
  só conta o que foi selecionado.
- **Botão "Selecionar todos"**, ao lado da busca — marca a pesquisa
  inteira de uma vez (não só a página visível), para quem quer partir de
  tudo e ir tirando o que não serve, do jeito que era antes.
- **MAÇO e MÇ eram grupos de unidade diferentes** — faltava "Maço" no
  mapa de sinônimos (`UNIDADES_SINONIMAS`). Corrigido; escolher uma
  unidade no filtro agora também **seleciona** os itens dela direto
  (antes só filtrava a lista visível — a estatística sempre rodou sobre o
  que foi selecionado, não sobre o filtro da tela).

Por baixo: nova tabela `precos_selecionados` (sem motivo — selecionar não
precisa de justificativa; motivo continua existindo só para
`precos_descartes`, quando um item que chegou a ser selecionado é tirado
depois). O relatório de pesquisa de preços passa a sair sobre a mesma
seleção que a tela mostrava, não sobre tudo que a busca trouxe.

275 pytest + 116 E2E. Achado no caminho: uma corrida real entre desenhar
as linhas da lista e carregar a seleção do banco — a lista podia nascer
com a caixa errada até o próximo redesenho. Corrigida junto.

## 1.15.4 — 2026-08-08

**Rótulos do gráfico de dispersão ainda coladas em duas fileiras**

- O fix anterior (v1.15.2) empilhava mediana/média em duas fileiras
  quando colidiam, mas o passo entre elas (22px) só cabia o nome sozinho
  — o bloco nome+valor inteiro precisa de mais espaço, e as duas
  fileiras ainda quase se sobrescreviam ("média" encostando em
  "mediana", print real do usuário). Passo subiu para 28px, mesmo vão já
  usado entre nome e valor dentro da mesma fileira.

264 pytest + 113 E2E.

## 1.15.3 — 2026-08-08

**Largura da página: regra global, não mais teto fixo em pixels**

- Achado do usuário comparando Painel e Contratações lado a lado na mesma
  janela Expandida: o Painel usava a tela toda, mas a lista parava num
  teto de 1.600px — inconsistente. Regra virou global e relativa:
  **Compacta = metade da largura da janela, Expandida = a janela
  inteira**, para o `<main>` inteiro (Painel) e para as listas igual — sem
  número escolhido a dedo.
- Piso de 1.000px na Compacta: 50% puro derrubava a largura útil para
  450px na janela mínima do programa (900px) — abaixo do que a barra de
  filtros e os 5 chips de alerta do Painel precisam para caber numa linha
  só. O piso só entra em jogo abaixo de ~2.000px de janela.

263 pytest + 113 E2E.

## 1.15.2 — 2026-08-08

**Três achados do usuário na aba Preços**

- **Rótulos do gráfico de dispersão sobrepostos** quando mediana e média
  ficam perto uma da outra — mesma família do achado C1 da agenda do
  Painel. Corrigido empilhando em duas fileiras quando não cabem lado a
  lado, em vez de deixar sobrepor.
- **Escolher uma unidade de medida agora classifica a pesquisa inteira**:
  marca só os itens daquela unidade e descarta o resto com a justificativa
  "Embalagem ou unidade de medida diferente" já preenchida — antes só
  filtrava a lista visível, e comparar por uma unidade só exigia desmarcar
  item por item na mão (e só valia para os itens da página aberta).
- **Teto da lista em Expandida subiu de 1.400px para 1.600px**: com
  1.400px, a tabela sobrava margem visível demais em monitor comum e
  parecia não estar usando a tela. Não existe número que zere ao mesmo
  tempo a margem de fora e o vão depois do texto de dentro (são a mesma
  folga vista de dois lados) — 1.600px foi escolhido medindo as duas
  pontas.

263 pytest + 113 E2E.

## 1.15.1 — 2026-08-08

**Os três achados do levantamento de relatórios, corrigidos**

- **Alerta de Fracionamento ganha o medidor de limite** — o mesmo gráfico
  do Painel (barra cheia = limite, ultrapassar vira "×o limite" em vez de
  esconder a gravidade numa barra do tamanho da de 100%), acima da tabela
  que já existia.
- **Pesquisa de Preços ganha a caixa de dispersão (Tukey)** — mín/Q1/
  mediana/média/Q3/máx num olhar só, com aviso quando o mínimo ou o
  máximo está fora da faixa esperada. A distância entre mediana e média,
  que já era descrita em texto, agora também aparece visualmente.
- **Minuta do PCA mostra a curva ABC** — o cálculo já existia
  (`pca_builder.classificar_abc`, usado pela tela de Montar PCA) e nunca
  aparecia no documento. Coluna ABC por item + resumo ("N itens classe A
  = X% do valor") dizendo onde a revisão rende mais.

260 pytest + 111 E2E.

## 1.15.0 — 2026-08-08

**Relatórios em paisagem por padrão; resumo executivo reformulado com os gráficos do Painel**

- Todos os relatórios agora saem em paisagem — Executivo e Alerta de
  Fracionamento eram os dois últimos ainda em retrato, desperdiçando a
  largura da página.
- **Resumo Executivo reformulado**: em vez de só cartões e tabelas, agora
  abre com o mesmo hero com sparkline do Painel (Homologado no ano,
  variação sobre o exercício anterior), cartões de KPI (contratações,
  deságio médio, contratos/atas vigentes) e dois gráficos — colunas
  mensais pareadas (estimado × homologado) e barras por modalidade. É a
  mesma consulta do Painel (`dados_painel`), então os números nunca
  divergem do que está na tela. As tabelas de detalhe (modalidade,
  evolução mensal, fornecedores, vigências a vencer) continuam abaixo,
  intactas.

257 pytest + 111 E2E.

## 1.14.4 — 2026-08-08

**Relatórios e painel impresso saíam sempre em pergaminho**

- Achado do usuário: com o tema Portal ativo, a impressão de qualquer
  relatório (Contratações, Contratos, Atas, PCA, Preços, Executivo) saía
  sempre com a paleta do Pergaminho. Havia um `@media print` que forçava
  as cores do Pergaminho por cima do tema escolhido, mais dois lugares que
  hardcodavam fundo branco/`#faf6ec` na impressão.
- O painel impresso (A3) tinha o mesmo problema num terceiro lugar: as
  cores de série dos gráficos e o fundo dos cards ficavam sempre no
  Pergaminho, mesmo com o SVG da tela já vindo no tema certo.
- Removidos os três overrides — a impressão agora usa o tema que está
  ativo no momento, os três (Portal, Pergaminho, Observatório).

255 pytest + 111 E2E.

## 1.14.3 — 2026-08-08

**Municípios de referência: ordem escolhível**

- Seletor "Ordenar por" acima da lista: tamanho em disco (padrão), nome
  (A-Z) ou nº de preços no banco. Reordena na hora, sem ida ao servidor —
  a lista já veio inteira.

254 pytest + 111 E2E.

## 1.14.2 — 2026-08-08

**Municípios de referência: lista ordenada do maior para o menor**

- Pedido do usuário: a listagem em Configurações agora vem por tamanho em
  disco decrescente, não por nome — quem mais pesa no acervo é quem mais
  interessa ver primeiro.

254 pytest + 110 E2E.

## 1.14.1 — 2026-08-08

**Os cinco achados restantes da auditoria de design, corrigidos**

- **Chip "processo parado" tinha o mesmo ícone dos chips de vencimento.**
  ⏳ (ampulheta) e ⏱ (relógio, usado nos dois chips de vencimento) leem
  como "tempo passando" à primeira vista, mas dizem coisas opostas — prazo
  chegando vs. processo sem movimento. Trocado por ⏸.
- **Área clicável dos filtros de caixinha seguia a altura do texto**
  (~16-18px) — não é bloqueio de acessibilidade (alvo mínimo de 44px é
  critério AAA, e o programa é de mouse), mas incomodava em trackpad. Um
  padding aumenta a área sem mudar o layout visível.
- **Número do hero do Painel quebrava em duas linhas** ("R$ 19,6" numa
  linha, "mi" sozinho na outra) na largura mínima da janela (900px,
  `min_size` do pywebview) — o número mais importante da tela com a pior
  tipografia bem onde sobra menos espaço. A fonte agora encolhe com
  `clamp()` antes de precisar quebrar.
- **Coluna Objeto/Descrição das listas crescia sem limite na largura
  "Expandida"**, sobrando um vão vazio depois do texto em vez de ajudar em
  algo (medido: ~1614px de vão a 2560px de janela). A lista agora tem teto
  próprio (1400px), independente do resto da página.
- **"Corrigir pelo IPCA" e "Comparar por conteúdo" disputavam espaço visual
  com filtros comuns**, sem hierarquia — um muda o cálculo do resumo
  inteiro, o outro só filtra a lista. Um leve fundo nos dois marca a
  diferença sem precisar de rótulo.

253 pytest + 110 E2E.

## 1.14.0 — 2026-08-08

**Três achados da auditoria de design, corrigidos**

- **Agenda dos próximos 90 dias não sobrepõe mais rótulos.** Quando dois
  vencimentos caíam perto (grupos de 11-12 fornecedores em dias vizinhos, no
  acervo real), os nomes se sobrepunham e viravam ruído ilegível. O corte de
  caracteres agora respeita o espaço livre até o rótulo vizinho, em vez de um
  limiar fixo de pixels que não sabia quanto texto vinha depois.
- **Nome de fornecedor cortado ganha o nome completo ao passar o mouse** em
  três lugares que não tinham: as duas tabelas do Painel ("Onde o dinheiro
  foi" e "Vence nos próximos 90 dias") e a lista de Contratos. A aba Preços
  já fazia isso — o padrão só precisava chegar aos outros três.
- **Barra de filtros com folga vertical maior que a horizontal** quando
  quebra em duas linhas (Contratações, Preços) — a segunda linha, que sobra
  com poucos itens, parava colada na primeira e parecia acidente de largura.

253 pytest + 105 E2E.

## 1.13.3 — 2026-08-08

**Chips de vencimento 8px mais baixos que os irmãos**

- Mesmo print do usuário, terceira rodada: os cards tinham a mesma altura
  mas ficavam visivelmente desalinhados verticalmente. Causa: colisão de
  nome de classe. Uma classe `.aviso` genérica do CSS (texto de aviso sob
  campo de formulário) tem `margin-top:8px`; os dois chips de vencimento
  são `class="chip aviso"` e herdavam essa margem sem relação nenhuma
  com o alerta do Painel.
- `.chip.aviso { margin-top:0 }` resolve. Como altura já era igual, o
  teste de altura anterior não detectava — precisou de um teste novo
  medindo posição, não só tamanho.

253 pytest + 101 E2E.

## 1.13.2 — 2026-08-08

**5º alerta quebrava pra uma linha sozinho**

- Com os 5 alertas possíveis ativos ao mesmo tempo (limite anual,
  contratos vencendo, atas vencendo, propostas abertas, processo parado),
  o piso de 200px por card não cabia mais na largura padrão da tela — o
  5º card ("processo sem resultado") caía sozinho numa segunda linha,
  com espaço vazio ao lado dele. Achado pelo usuário sobre um print real
  com todos os alertas ativos.
- Piso baixado para 160px, calculado para caber os 5 numa linha só até a
  largura mínima da janela (900px).

253 pytest + 100 E2E.

## 1.13.1 — 2026-08-08

**Altura dos cards do Painel também padronizada**

- A 1.13.0 igualou a largura, mas a altura ficou torta: o card do limite
  anual (frase longa) quebra em duas linhas e ficava mais alto que os
  demais. `align-items:stretch` — que deveria igualar sozinho — não
  igualava porque o card é um `<button>`, e elementos de formulário
  resistem a esticar em layout flex/grid por padrão. `height:100%`
  explícito resolve.

253 pytest + 99 E2E.

## 1.13.0 — 2026-08-07

**Contrato e ata deixam de dividir o mesmo alerta**

- O card "contratos/atas vencem em 60 dias" virou **dois**: um para
  contratos, outro para atas — cada um leva à sua própria aba já filtrada.
  Antes o alerta somava os dois e o clique só conseguia abrir uma das duas
  telas, então metade da contagem nunca aparecia na lista.
- Mesma separação no chip que aparece no topo das listas (`chip-vencendo`).
- **Cards do Painel com tamanho padronizado.** Antes cada card só media o
  próprio texto — "5 objetos acima do limite anual de dispensa" ficava bem
  mais largo que "1 processo com proposta aberta" na mesma fileira. Agora
  todos dividem a largura da fileira igualmente.

253 pytest + 98 E2E.

## 1.12.1 — 2026-08-07

**"25 contratos vencem" abria lista de 50 — o filtro era "vigentes", não
"vence em 60 dias"**

- O alerta conta contratos e atas com vigência terminando dentro de uma
  **janela fechada de 60 dias**. O clique aplicava o filtro **Vigentes**,
  que não tem limite superior — todo contrato ainda ativo entrava, mesmo um
  vencendo daqui a um ano. Achado reportado pelo usuário: 25 no alerta, 50
  na lista.
- Ganhou filtro e caixa próprios (**Vence em 60 dias**), distintos de
  **Vigentes**: a caixa antiga continua útil sozinha (ver tudo que ainda
  não venceu, sem prazo), e agora as duas podem ser ligadas ou desligadas
  independentemente, na mão ou pelo alerta.
- Mesma correção nos **dois lugares** que levam a esse alerta: o chip do
  Painel e o chip de vencimento que aparece no topo das listas.

252 pytest + 96 E2E.

## 1.12.0 — 2026-08-07

**Clicar num alerta do Painel agora filtra a lista de verdade**

- **Objetos acima do limite anual**: até aqui o clique não fazia nada além de
  trocar de aba — o filtro de modalidade nunca era aplicado. Agora abre a
  lista já com **Dispensa**, o **exercício** e os **objetos exatos** que o
  alerta apontou (não todas as dispensas do ano); um aviso acima da lista
  diz que o filtro veio do alerta, com botão para tirá-lo.
- **Processo sem resultado há mais de 90 dias**: esse alerta nunca teve
  filtro nenhum — o critério só existia dentro da contagem. Ganhou filtro
  próprio, com caixa dedicada (**Sem resultado (90+ dias)**) que também pode
  ser ligada na mão, sem passar pelo alerta.
- **Contratos/atas vencendo e propostas abertas** já filtravam, mas por uma
  corrida: o clique na aba resetava os filtros e recarregava a lista sem
  filtro nenhum, e o clique no alerta religava o filtro e recarregava de
  novo — duas consultas disputando qual pintava a tela por último. Virou
  uma consulta só, sem corrida.
- Os quatro alertas passaram a levar também o **órgão** selecionado no
  Painel — antes a lista abria sempre com "todos os órgãos", mesmo quando o
  alerta foi contado com um órgão específico filtrado.

Mudança de comportamento, sem efeito em nenhum número já publicado — os
alertas sempre contaram certo; só o clique não levava até o que foi contado.
250 pytest + 95 E2E.

## 1.11.2 — 2026-08-07

**Tooltip próprio e corte vertical nos gráficos de linha**

- O `<title>` nativo do navegador saiu: demorava ~1s para aparecer e não
  seguia o cursor. No lugar, um **rótulo próprio, instantâneo**, com o valor
  em destaque e o rótulo secundário — em todos os nove gráficos do Painel.
- **Passar o mouse sobre o gráfico de acumulado do exercício ou o de
  concentração de fornecedores** traz uma **linha vertical** que segue o
  cursor: em vez de mirar os 2px da linha, qualquer ponto do gráfico serve, e
  o rótulo passa a listar o valor de **cada série** naquele ponto — os três
  anos lado a lado, não um de cada vez. Tirando o mouse, o gráfico volta ao
  ponto de referência que segue sempre visível (mês corrente, 10º
  fornecedor).
- Mudança de interface, sem efeito em número, cálculo ou relatório algum.
  245 pytest + 91 E2E; os quatro testes novos conferidos falhando com a
  camada de interação desligada.

## 1.11.1 — 2026-08-06

**Os gráficos do Painel respondem ao cursor**

- Passar o mouse sobre uma barra, ponto ou célula **acende a marca e recua as
  demais**. Num gráfico de doze meses com duas séries, é o que permite saber qual
  marca se está lendo — antes só havia o rótulo do sistema, que não diz qual
  retângulo o produziu.
- **Barra não muda de tamanho.** Ela vale o número que representa, e crescer ao
  ser apontada faria a marca mentir sobre o valor. Quem cresce é o que é ponto —
  círculo da agenda, seta de estouro de limite —, onde tamanho não codifica dado.
- Transições de 150 ms, e nenhuma animação de entrada: o painel redesenha a cada
  troca de exercício e de subaba, e repetir o espetáculo a cada vez cansaria.
  Quem pede menos movimento no sistema (`prefers-reduced-motion`) recebe o
  realce sem transição.

## 1.11.0 — 2026-08-06

**Dois defeitos que só o acervo cheio revelou**

- **Preço por quilo saía dividido pela caixa de transporte.** A descrição do
  hortifruti traz o padrão comercial do CEAGESP — *"SACO COM 20 KG"* — junto da
  especificação, e a unidade licitada é o quilo. O preço unitário já estava por
  quilo, mas o programa lia os 20 kg da descrição e dividia de novo: abóbora a
  R$ 5,45/kg virava **R$ 0,27/kg**, banana R$ 0,165/kg. Eram **1.245 itens**,
  16% de tudo que o extrator lia.
- Agora, quando a **unidade licitada já é a unidade-base** (quilo, litro, metro
  ou unidade), o conteúdo vale 1 e nada é dividido. O efeito colateral é bem-
  vindo: a mercadoria **a granel passa a se comparar com a embalada** — o feijão
  por quilo entra na mesma série do pacote de 5 kg, e a caneta avulsa na do
  pacote com 12. Antes as duas ficavam de fora da comparação.
- **A correção pelo IPCA podia mover a mediana sem que fosse inflação.** Os
  preços mais recentes que o último índice publicado saem da série — e com eles
  muda a composição da amostra. Em *"instalação manutenção"*, 76 de 330 preços
  saíram, todos recentes e baratos, e a mediana subiu **92%**, num período em
  que o IPCA acumulado não passava de 25%.
- Acima de **10% da série excluída**, a tela e o relatório passam a dizer, com
  destaque, que a diferença para os valores nominais não decorre apenas da
  correção monetária. O texto do relatório também deixou de atribuir a exclusão
  só à "falta de data": a causa mais comum é o preço ser posterior ao índice.
- **Embalagem individual dispensa o marcador.** Até aqui, a medida na descrição
  só era lida com `C/`, `COM` ou `CAIXA COM` — a regra existia para não
  confundir *"SERINGA 10ML"* (capacidade do artefato) com conteúdo. Mas quando a
  unidade de compra **é** a embalagem do produto (pacote, balde, galão, pote,
  lata, frasco), a medida escrita é o conteúdo: *"BATATA PALHA 1KG"* num pacote
  é um quilo. Recupera **1.501 itens**, quase todos de merenda escolar.
- Caixa e fardo ficam **de fora** dessa leitura, de propósito: são embalagens
  coletivas e o preço é o da caixa inteira. Foi de onde saíram todos os erros da
  amostra — *"FERMENTO BIOLÓGICO 10G"* em caixa a R$ 216 daria **R$ 21.600/kg**,
  e *"ÓLEO DE SOJA 900ML"* em caixa a R$ 139,50 daria R$ 155/litro.
- **A unidade-base da comparação passou a ser escolhida só por quem declara
  conteúdo.** Como todo item vendido a unidade agora vale "1 unidade", esses
  itens passariam a decidir a base pelo peso do número: em *leite*, 140 avulsos
  faziam a comparação sair **por unidade** e jogavam fora 89 itens em litro e
  101 em quilo — justamente os que a comparação existe para pôr lado a lado. O
  mesmo em *café*, que perdia 100 itens em quilo. Agora o voto é de quem
  declarou embalagem; se ninguém declarou, o avulso decide, que é o certo numa
  pesquisa só de itens unitários.
- A comparação por conteúdo **não filtra lote** — o item lançado como *"Proposta
  para todos os itens"* entra com o valor do lote. Quem o tira da série é o
  descarte com razão, com o motivo próprio, que deixa registro no documento.

## 1.10.5 — 2026-08-06

**Quando o programa não abre, ele passa a dizer por quê**

- A interface do Licitarium é publicada num servidor local (`127.0.0.1`) e lida
  pela janela do programa. Quando esse servidor não sobe — antivírus, firewall
  ou proxy sem exceção para endereços locais —, aparecia a página de erro do
  navegador falando de proxy e firewall, **sem mencionar o Licitarium**.
- Agora o programa confere se a interface respondeu e, se não respondeu, mostra
  uma janela própria explicando o que aconteceu e os três caminhos que costumam
  resolver.
- O executável é compilado **sem console**: até aqui, uma falha na partida não
  deixava rastro nenhum. Passa a gravar `ultimo-erro.log` na pasta de dados,
  com data, versão e detalhe técnico — é o primeiro lugar a olhar quando o
  programa não abre.

## 1.10.4 — 2026-08-05

**O Painel travava ao filtrar por órgão — e era um erro de consulta**

- `contratações` e `itens` têm as duas uma coluna com o CNPJ do órgão. Na
  consulta que junta as duas, sem dizer de qual tabela, o SQLite recusa tudo
  com *ambiguous column name*: escolher um órgão simplesmente não montava o
  painel, e a tela ficava como estava — parecendo travada.
- **Trocar de subaba ia ao banco de novo** sem necessidade: as três visões já
  estão montadas, então trocar agora é só mostrar.
- **A compactação do acervo bloqueia toda leitura** enquanto roda — 0,6 s num
  acervo de 114 MB — e disparava com apenas 0,8 MB de espaço livre, ou seja,
  em quase toda sincronização. Agora só quando há desperdício de verdade (5% do
  arquivo e no mínimo 2.000 páginas).
- O painel mostra que está carregando e, se a consulta falhar, **diz o erro**
  em vez de ficar mudo.

**Erros do PNCP: o portal não recusa, ele demora**

- No acervo do piloto, **todos** os erros de um dia foram *the read operation
  timed out* — nenhuma recusa, nenhum bloqueio. Insistir com o mesmo prazo
  curto repetia a falha: o tempo de espera agora **cresce a cada tentativa**
  (30, 45, 60, 75, 90 s).
- A mensagem dizia "sem conexão com o PNCP", o que mandava procurar defeito na
  internet. Agora diz que **o portal não respondeu a tempo**.
- Erro de servidor e tempo esgotado passam a **reduzir o número de conexões
  simultâneas**, como o 429 já fazia: diante de um portal sobrecarregado o
  programa insistia a quatro conexões.
- O tempo de espera entre tentativas ganhou **sorteio**, para as conexões que
  falharam juntas não voltarem no mesmo instante.
- **Abrir o programa não repete a coleta inteira**: a sincronização automática
  respeita um intervalo de 10 minutos desde a última. O botão **Sincronizar**
  continua valendo sempre.

## 1.10.3 — 2026-08-05

**Cada tema com a sua paleta de gráficos**

- No **Pergaminho**, as barras azuis liam como corpo estranho sobre o papel
  sépia. As séries passam a ser **terracota, ocre, verde e ardósia**, validadas
  contra a superfície do tema — a ardósia fria fica na quarta posição porque
  quatro tons quentes não se separam sob daltonismo.
- No **Observatório**, o mapa de calor quase não diferenciava os níveis: os
  degraus da rampa eram próximos demais para fundo escuro. Refeitos com mais
  separação de luminosidade.
- O **relatório impresso** acompanha o Pergaminho, que é o tema do papel.

## 1.10.2 — 2026-08-05

**O Painel passa a usar a tela**

- Os gráficos eram desenhados numa largura fixa e escalados para caber: em
  monitor largo, cada um ficava ilhado no meio do cartão, com faixas vazias dos
  dois lados. Agora **cada gráfico é desenhado na medida do espaço** e
  redesenhado quando a janela muda de tamanho — as barras crescem, os rótulos
  se espalham e o cartão fica cheio.
- **Os estilos do painel não estavam sendo aplicados.** A seção tinha só o
  identificador, e as regras usavam a classe: títulos, tabelas e notas ficavam
  com a formatação genérica. Corrigido — tabelas ganham colunas de largura
  previsível e texto longo é cortado com reticências, em vez de encostar na
  coluna vizinha.
- **Rótulos que se sobrepunham**: na curva de concentração o texto caía sobre a
  linha (e destacava "todos os fornecedores = 100%", que não informa nada);
  na agenda, nomes de vencimentos próximos se encavalavam; no deságio, a escala
  não acompanhava o eixo ao mudar a largura.
- Os avisos concordam em número: *1 processo com proposta aberta*, não
  *1 processos*.

## 1.10.1 — 2026-08-05

**Correções no Painel — três números que induziam a erro**

- **A comparação com o ano anterior media períodos diferentes.** O painel
  confrontava o acumulado do exercício em curso com o **ano inteiro**
  anterior: em agosto, "caiu 67%" dizia apenas que faltavam quatro meses.
  Agora compara com o **mesmo período** do ano anterior, e o rótulo diz isso.
- **O funil misturava escopos.** "Vigentes hoje" contava contratos de qualquer
  exercício, enquanto as demais etapas eram só do ano escolhido — a última
  barra chegava a ser maior que a primeira. As quatro etapas passam a falar do
  mesmo conjunto.
- **O medidor de limite não separava nada.** Ele agrupava por unidade
  administrativa, e o campo do PNCP traz o nome do órgão: no acervo do piloto,
  as 16 dispensas caíam todas numa linha só, com 874%. Agora o agrupamento é
  por **objeto**, que é também o critério do art. 75 — e passando de 100% o
  medidor mostra quantas vezes o limite foi excedido, em vez de uma barra cheia
  idêntica à de quem está em 100%.
- **Mês sem contratação voltou ao eixo.** Meses vazios eram omitidos, e o
  gráfico emendava fevereiro com abril sem avisar que março existia.

## 1.10.0 — 2026-08-05

**Painel — a nova tela inicial**

- O programa passa a abrir num **Painel** com gráficos do exercício, em três
  visões: **Execução** (como está o ano), **Análise** (o que mudou e onde
  concentra) e **Vigilância** (o que precisa de ação). A visão escolhida fica
  guardada, e os seletores de exercício e órgão valem para as três.
- **Execução**: valor homologado com comparação ao ano anterior, contratações,
  deságio médio, contratos vigentes, valores mês a mês (estimado × homologado),
  modalidades, vencimentos de 90 dias e principais fornecedores.
- **Análise**: acumulado do ano contra os dois anteriores, deságio por
  modalidade, concentração de fornecedores e mapa de calor de processos por mês
  e modalidade.
- **Vigilância**: medidores do limite anual de dispensa por unidade, funil do
  edital ao contrato e agenda dos próximos 90 dias.
- Os **alertas** — limite de dispensa, vencimentos, propostas abertas e
  processos sem resultado há mais de 90 dias — ficam acima das três visões e
  levam à lista já filtrada.
- **Impressão em A3 paisagem**, uma visão por página, com o mesmo desenho da
  tela. Os gráficos são vetoriais, então saem na resolução da impressora, e as
  cores são preservadas no papel.

**Correção**

- O gráfico de valores mensais usava, na barra de *homologado*, o valor
  estimado quando o processo ainda não tinha homologação — mostrava como pago o
  que era estimativa. Agora homologado é homologado; processo sem resultado não
  entra nessa barra nem no acumulado.

## 1.9.0 — 2026-08-05

**Corrigir pelo IPCA**

- Nova caixa **Corrigir pelo IPCA** na aba Preços: cada valor é trazido a
  preços de hoje antes de qualquer conta. R$ 208,04 pagos em março de 2022
  equivalem a **R$ 252,06** em junho de 2026 — comparar reais de anos
  diferentes subestimava o preço atual em mais de 20%.
- O índice é a **série 433 do Banco Central**, baixada junto com a
  sincronização e guardada no banco (poucos KB). Falha ao baixá-la não
  atrapalha a coleta do acervo.
- A data-base de cada preço é a **data do resultado**; sem ela, a da publicação
  do processo. O índice do mês da compra já está no preço pago, então a
  correção acumula os meses seguintes.
- **O programa não projeta índice.** A correção vai até o último mês publicado,
  e tela e relatório declaram qual é. Preço mais recente que o índice, ou sem
  data utilizável, fica de fora e é contado no aviso.
- As duas caixas convivem: com correção e conteúdo ligados, o preço por
  conteúdo já sai corrigido — senão a coluna divergiria do resumo.

## 1.8.0 — 2026-08-05

**Comparar por conteúdo**

- Nova caixa **Comparar por conteúdo** na aba Preços. Ligada, o resumo inteiro
  passa a ser por **unidade-base** (R$/folha, R$/quilo, R$/litro, R$/metro) e a
  lista ganha a coluna correspondente.
- Resolve a distorção da embalagem: a caixa de papel A4 com 5.000 folhas a
  R$ 232,80 custa **R$ 0,0466 por folha**, enquanto o pacote com 100 folhas a
  R$ 38,90 custa **R$ 0,3890** — 8,4 vezes mais caro. Os dois entravam na
  mesma mediana como se fossem comparáveis.
- O conteúdo é lido do que o órgão publicou, no campo de unidade
  (*Embalagem 1,00 KG*) ou na descrição quando ela declara a embalagem
  (*C/5000 FLS*, *CAIXA COM 100 UNIDADES*).
- **O programa prefere não converter a converter errado.** Gramatura
  (*75G/M²*), dimensão (*210MM X 297MM*) e capacidade de artefato
  (*SERINGA 10ML*) não viram conteúdo — nesses casos a coluna fica com um
  traço. Metade dos testes desta versão existe para garantir isso.
- Comparar R$/quilo com R$/folha não diria nada: a comparação usa a
  unidade-base mais frequente e informa **quantos itens ficaram de fora**.
- O relatório em PDF acompanha o modo, com a coluna nova, os valores em
  unidade-base e a declaração de quantos preços não entraram na comparação.

## 1.7.0 — 2026-08-05

**A razão de cada preço descartado, gravada e impressa**

- O aviso de itens descartados virou uma **lista**: cada item mostra o que é,
  quanto custava e um seletor de **razão**. Seis motivos prontos — item não
  comparável, embalagem ou unidade diferente, preço inexequível, preço
  excessivamente elevado, contratação antiga demais, valor de lote lançado como
  item único — e **Outro…** abre campo livre.
- O relatório ganhou a seção **Itens desconsiderados nesta pesquisa**, com
  preço, fornecedor, processo e motivo. Antes o item simplesmente sumia do
  documento: quem conferia não tinha como saber que a série fora filtrada —
  justamente o que o art. 23 e a IN SEGES 65/2021 não admitem.
- **Descartar continua sendo um clique**; a razão pode vir depois. O que ficar
  sem justificativa é contado no aviso da tela e **marcado no documento**, como
  pendência a resolver antes de juntar o relatório ao processo.
- Os descartes passam a ser **gravados por pesquisa**: voltar ao mesmo termo
  amanhã traz de volta o que foi desconsiderado e por quê.
- O documento passou a ler os descartes do banco, e não do estado da tela — o
  relatório sai igual mesmo gerado depois, de outra tela.

## 1.6.0 — 2026-08-05

**Cópia do acervo**

- **Configurações → Cópia do acervo** ganhou dois botões: **Salvar cópia…**
  guarda tudo num arquivo `.zip` (contratações, contratos, atas, itens, PCA,
  configurações e a lista de municípios de referência) e **Restaurar cópia…**
  devolve esse arquivo ao lugar.
- O Licitarium nasceu sem cópia de segurança porque o acervo é reconstruível a
  partir do PNCP — e continua sendo. Só que reconstruir o próprio município
  leva minutos enquanto **cada município de referência custa de minutos a
  horas**, e a lista deles se perde junto com o banco. A cópia troca essas
  horas por um arquivo.
- A cópia sai pela API de backup do SQLite, e não copiando o arquivo do disco:
  com a sincronização gravando, um arquivo copiado nasceria pela metade.
- Restaurar confere o arquivo antes de tocar em qualquer coisa e **guarda o
  acervo atual** como `.substituido-<data>`, em vez de apagá-lo.

## 1.5.2 — 2026-08-05

- **O programa não aposenta mais um banco por conta própria.** A 1.5.1 passou
  a guardar como `.corrompido-<data>` o banco que não conseguisse ler, criando
  um novo em seguida. Só que um diagnóstico de corrupção pode estar errado — e
  quando está, o que desaparece da tela é um acervo que custou horas de coleta.
  Agora o programa **pergunta antes**, numa caixa do Windows: começar um banco
  novo ou sair sem tocar em nada. Escolhendo sair, o arquivo continua
  exatamente onde estava, para você cuidar dele.

## 1.5.1 — 2026-08-05

- **Correção: o programa deixava de abrir por causa do diário de transações.**
  O SQLite mantém um arquivo `-wal` com o que ainda não foi gravado no banco.
  Se sobrar um `-wal` de outro momento do arquivo — cópia da pasta, restauração
  de backup, sincronizador de nuvem, encerramento à força —, ele é aplicado
  sobre o banco atual e produz `database disk image is malformed` antes mesmo
  de a janela aparecer, com um traceback no lugar de qualquer explicação.
  Foi o que aconteceu aqui: o banco estava íntegro (29.489 itens,
  verificação sem erro) e só o diário de três dias antes derrubava tudo.
- Agora o Licitarium **confere o banco ao abrir**. Diário incompatível é posto
  de lado como `.orfao-<data>` e o programa segue, avisando na tela. Banco
  realmente corrompido é guardado como `.corrompido-<data>` e um novo é criado
  — o acervo volta na sincronização, porque a fonte é o PNCP.
- E ao fechar, o diário é **consolidado no banco**, para não sobrar nada capaz
  de voltar órfão na abertura seguinte.

## 1.5.0 — 2026-08-05

**Análise estatística da pesquisa de preços**

- Ao lado de média e mediana, o resumo passa a mostrar a **faixa central** dos
  preços, o **desvio padrão** e o **coeficiente de variação**, com a leitura
  escrita: até 15% os preços são homogêneos; acima de 50% a amostra é dispersa
  demais e provavelmente tem item não comparável no meio. Os mesmos números
  saem no relatório em PDF.
- **Preço fora da curva é apontado**, pelo critério de Tukey (uma vez e meia a
  faixa central), com a faixa normal escrita no aviso e um botão que descarta
  os itens de uma vez. Nada sai sozinho da conta: desprezar preço coletado é
  decisão de quem assina, e o item continua na lista para conferência.
- Com menos de cinco preços a análise se cala, em vez de apresentar como
  estatística o que seria opinião.

**Filtro por unidade de medida**

- A aba Preços ganhou o filtro **Todas as unidades**, com as grafias já
  agrupadas: *CX*, *Caixa* e *CAIXAS* viram uma opção só. No acervo do piloto
  isso reduz 566 textos distintos a 192 opções, ordenadas da mais comum para a
  mais rara e com a contagem de itens ao lado. A coluna da lista continua
  mostrando o texto original do PNCP.

**Outras melhorias**

- A coluna **Qtde** da aba Preços passa a ordenar, como as demais.

## 1.4.3 — 2026-08-03

- **O aviso de volume dizia um tamanho menor que o real.** Ele previa os MB
  de JSON que viriam do portal, não o quanto o arquivo ia crescer — e o banco
  cobra quase o dobro, entre colunas, índices e busca. Com os cinco
  municípios de referência já coletados (714 contratações, 12.587 itens,
  45,4 MB), as estimativas foram refeitas: agora o aviso fala de espaço em
  disco e a previsão para esses cinco erra 0,5 MB, contra 11 MB antes.

## 1.4.2 — 2026-08-02

- **Tamanho de cada município de referência.** A lista em Configurações passa
  a mostrar quanto cada município ocupa no banco, ao lado da contagem de
  preços. Um vizinho custa de 1 a 15 MB, conforme o quanto publica; agora dá
  para ver qual deles está pesando antes de decidir remover.

## 1.4.1 — 2026-08-02

- **Link para o PNCP no relatório de pesquisa de preços.** O número do
  processo passa a levar à página oficial daquela contratação no portal.
  Em PDF fica clicável; no papel, o número continua legível. Quem recebe o
  levantamento confere cada preço na fonte, em vez de confiar só na tabela.
- **Colunas Município e Unid. deixam de quebrar** no relatório: "Paulo de
  Faria" e "Fardo 64,00 RO" ocupavam duas linhas cada. A coluna de descrição
  cede o espaço.

## 1.4.0 — 2026-08-02

**Escolher quais preços entram na pesquisa**

- Cada linha da aba Preços passa a ter uma **caixa de seleção**, marcada por
  padrão. Desmarque o que não for comparável e o resumo se refaz na hora: o
  item sai do cálculo e do **relatório de pesquisa de preços**, mas continua
  na tela, para dar para voltar atrás.
- Resolve a distorção mais comum: buscar *papel higiênico* traz também
  *suporte de papel higiênico* e *locação de banheiro químico*. No acervo do
  piloto, descartar esses dois derruba a média de R$ 53,63 para R$ 30,74 e o
  maior preço de R$ 249,80 para R$ 33,90.
- Um aviso mostra quantos itens foram descartados, com **Restaurar todos**. A
  escolha vale para a pesquisa em curso; trocar o termo recomeça.

## 1.3.2 — 2026-08-01

- **A coluna Município passa a ordenar**, como as demais da aba Preços. A
  ordem é alfabética pelo nome do município, e não pelo código interno.

## 1.3.1 — 2026-08-01

- **Coluna Município na aba Preços.** A origem de cada preço passa a ter
  coluna própria, sempre visível, em vez de aparecer apenas nos itens vindos
  de fora. Os preços de municípios de referência continuam destacados.
- **Municípios de referência listados como os órgãos monitorados**, com o
  código IBGE e a contagem de preços de cada um. Enquanto a sincronização não
  roda, a lista mostra *ainda sem preços — serão baixados na próxima
  sincronização*.
- As larguras de coluna salvas antes desta versão são descartadas na aba
  Preços, que ganhou uma coluna; as demais abas não mudam.

## 1.3.0 — 2026-08-01

**Municípios de referência no banco de preços**

Um município pequeno compra pouco e compra variado: no acervo do piloto, 98%
das descrições de item aparecem uma única vez. Buscar *papel A4* devolvia um
único preço, e mediana sobre um preço só não sustenta uma pesquisa perante o
Tribunal de Contas.

- Em **Configurações → Municípios de referência** dá para indicar municípios
  vizinhos. Os itens deles passam a aparecer no **banco de preços**, ao lado
  dos seus, com amparo no **art. 23, §1º, I** da Lei 14.133/2021, que admite
  contratações similares de outros entes como parâmetro.
- **A referência não entra em mais nada.** Indicadores da tela inicial, abas
  Contratações, Contratos, Atas e PCA, o módulo Montar PCA e todos os
  relatórios oficiais continuam exclusivamente do seu município.
- Na lista, o preço vindo de fora traz o **nome do município** logo abaixo do
  processo; o resumo informa a composição (*12 do seu município e 47 de
  referência*) e a caixa **Só do meu município** isola a sua série.
- O **relatório de Pesquisa de Preços** ganhou coluna **Município**: valor de
  fora é aceitável, mas precisa estar identificado no documento.
- Cada município da lista mostra quantos preços trouxe. Remover apaga os
  preços dele sem tocar no seu acervo.

> Nem todo vizinho publica no PNCP — na região do piloto, um município de 21
> mil habitantes não tem registro algum. Depois de sincronizar, confira a
> contagem em Configurações.

## 1.2.5 — 2026-08-01

- **Correção da atualização automática da 1.2.4.** Ao publicar um anexo, o
  GitHub troca o espaço do nome do arquivo por ponto: o executável sobe como
  "Licitarium v1.2.4.exe" e fica disponível como **"Licitarium.v1.2.4.exe"**.
  A 1.2.4 procurava o nome com espaço e não encontrava o download, então não
  oferecia a troca automática. Agora os dois formatos são reconhecidos.

## 1.2.4 — 2026-08-01

- **O executável passa a trazer a versão no nome**: o arquivo baixado da
  página de releases se chama **"Licitarium.v1.2.4.exe"**, no mesmo padrão do
  manual. Dá para saber qual versão você tem só de olhar o arquivo, e as
  versões guardadas não se sobrescrevem.
- Ao atualizar sozinho, o programa também **renomeia o arquivo** para a versão
  nova — do contrário o nome passaria a mentir sobre o conteúdo. Se você tiver
  um atalho apontando para o executável, refaça-o depois da primeira
  atualização.

> Quem está na 1.2.3 ou anterior continua recebendo o aviso de versão nova,
> mas precisará **baixar manualmente desta vez**: aquelas versões procuram um
> arquivo com o nome antigo. Da 1.2.4 em diante a atualização automática volta
> a funcionar normalmente.

## 1.2.3 — 2026-08-01

- **Nome do manual em PDF segue o padrão dos sistemas irmãos.** Ao imprimir ou
  salvar o manual, o arquivo sai como **"Manual Operacional — Licitarium
  v1.2.3"**, no mesmo formato usado por SGCD, SGCA, SGDP e SGEA — assim os
  manuais dos cinco ficam juntos e ordenados na pasta. O cabeçalho de cada
  página impressa também acompanha o padrão.

## 1.2.2 — 2026-08-01

- **CNPJ e CPF com máscara nos relatórios.** O documento do fornecedor saía
  como um bloco de dígitos (`13286494000164`) nas relações impressas. Agora
  sai pontuado — e o programa distingue os dois: pessoa jurídica em
  `00.000.000/0000-00`, pessoa física em `000.000.000-00`, porque o campo
  do PNCP guarda os dois tipos. A exportação em CSV continua com o número
  puro, para não atrapalhar quem for tratar os dados em planilha.
- **Selo de vigência centralizado.** Na 1.2.1 o selo passou a acompanhar o
  rodapé da linha e, em contratos de objeto longo, ficava distante demais das
  datas. Voltou ao centro da célula, agora com um espaçamento entre a data e
  o selo.

## 1.2.1 — 2026-08-01

- **Alinhamento do selo de vigência.** Em contratos e atas com objeto longo,
  o selo ficava no meio da linha, longe do nome do fornecedor. Agora ele
  acompanha a última linha da descrição, na mesma altura do fornecedor.

## 1.2.0 — 2026-08-01

**Novidades desta versão**

- **Situação da vigência em contratos e atas.** Cada registro passa a exibir,
  ao lado das datas, um selo com a sua situação: **Vigente** (verde),
  **Vence em N dias** (amarelo, nos 60 dias finais — o mesmo prazo do alerta
  do topo da tela) e **Encerrado** (vermelho). Dá para ver de relance o que
  precisa de atenção sem abrir registro por registro.
- O selo traz sempre o texto junto da cor, e a data completa no rótulo de
  passagem do mouse: quem não distingue as cores, ou imprime em preto e
  branco, continua lendo a informação.

**Correções**

- Os selos de situação (inclusive os das contratações, que já existiam)
  tinham **contraste insuficiente** entre texto e fundo nos temas claros,
  abaixo do mínimo de acessibilidade para textos pequenos. A tinta foi
  escurecida nos três temas até passar no critério AA.

## 1.1.1 — 2026-07-31

Sincronização muito mais rápida. Medido no acervo real, numa atualização
depois de uma semana sem abrir o programa: **de 20 minutos para 33 segundos**,
e de 1.724 para 69 consultas ao PNCP.

**Correções**

- A coleta em paralelo introduzida na 1.1.0 se desligava sozinha e não voltava
  mais: bastavam três recusas do PNCP — comuns logo no início — para o
  programa cair no ritmo lento pelo resto da execução, justamente na etapa
  mais demorada. Agora só contam as recusas recentes, e o ritmo volta ao
  normal assim que o portal se acalma.

**Melhorias**

- **Itens que não mudaram não são mais reconsultados.** O PNCP altera a data
  da contratação por motivos que não têm nada a ver com os itens dela, e isso
  fazia o programa rebuscar o preço de todos eles. Medido: 1.815 consultas
  para nenhum item alterado. Agora a data de cada item é comparada antes.
- **Editais, contratos, atas e PCA são baixados em paralelo**, como já
  acontecia com os itens. A etapa dos editais caiu de 38 s para 4,5 s.

## 1.1.0 — 2026-07-31

Versão de desempenho: a coleta ficou muito mais rápida e a busca do banco de
preços passou a entender palavras soltas.

**Novidades desta versão**

- **Busca por palavras** no banco de preços e na aba Itens: digitar
  `papel a4` encontra `PAPEL SULFITE A4 BRANCO` mesmo com as palavras fora de
  ordem e separadas por outras. Acentos são ignorados (`oleo` acha `ÓLEO`) e
  palavras incompletas valem como início (`sulfit` acha `SULFITE`). A busca
  usa um índice de texto interno, então continua instantânea.
- **Coleta de itens em paralelo**: a primeira sincronização, que percorre
  todos os itens e seus vencedores, deixou de ser feita uma requisição por
  vez. Se o PNCP começar a recusar as conexões, o programa volta sozinho ao
  ritmo antigo.
- **Compactação automática do acervo**: ao final da sincronização, quando o
  arquivo tem muito espaço ocioso, ele é compactado.
- **Organização do código**: a interface, que era um arquivo único de 1.713
  linhas, virou três (`ui/index.html`, `ui/estilo.css`, `ui/app.js`). Nada
  muda para quem usa o programa.
- **Manual com tema**: os três temas do programa (Pergaminho, Portal e
  Observatório) também valem para o manual, com seletor no canto da página.
  O estandarte da capa mantém as cores da marca em qualquer tema, e a
  impressão sai sempre em pergaminho.

## 1.0.0 — 2026-07-31

Primeira versão estável. O acervo, os relatórios para o Tribunal de Contas,
o banco de preços e a montagem do PCA estão completos e em uso real.

**Novidades desta versão**

- **Montar PCA**: novo módulo que usa o histórico de itens contratados para
  sugerir o Plano de Contratações Anual do próximo exercício. Agrupa por
  semelhança de descrição, projeta o quantitativo (média dos anos, último,
  maior ou soma), estima o preço (mediana, média, mais recente ou menor) e
  aplica margem de segurança — tudo configurável, com padrão de 10%.
  Sinaliza unidades divergentes e itens de ocorrência única. A lista é
  editável e os ajustes manuais sobrevivem a uma nova geração.
- Exportação da minuta em CSV e novo relatório **Minuta do PCA**.
- **Revisão em famílias**: os itens são agrupados por tipo (PNEU, FILTRO,
  FRALDA…) e a lista pode ser filtrada por família.
- **Curva ABC**: cada item recebe classe conforme o peso no valor total,
  mostrando onde concentrar a revisão.
- **Mesclar e dividir itens**: junta o que o agrupamento separou
  indevidamente, somando quantidades e ponderando o preço pelo volume; dá
  para desfazer a qualquer momento.
- Novo aviso de **preço disperso** (grupo cujo maior preço é muitas vezes o
  menor, sinal de lote lançado como item único) e agrupamento que ignora
  aberturas de edital como "aquisição de" e "contratação de empresa para".

## 0.9.4 — 2026-07-31

- **Uma única tela de abertura**: a imagem fixa que aparecia logo ao clicar no
  executável foi removida. Fica apenas a tela de abertura do aplicativo, que
  acompanha o tema escolhido. O executável também ficou mais leve.

## 0.9.3 — 2026-07-31

- **Fim da troca de tela na abertura**: a tela de abertura trocava de
  composição no meio do carregamento — nascia numa e era substituída por
  outra ao ler o tema. O tema passou a ser entregue à interface antes de ela
  carregar, então a composição correta aparece já no primeiro instante e
  permanece.

## 0.9.2 — 2026-07-31

- **Tela de abertura no tema certo**: a janela passou a usar armazenamento
  próprio, então a preferência de tema sobrevive ao fechamento do programa —
  antes o navegador embutido abria um perfil novo a cada execução e a tela de
  abertura caía sempre na composição padrão. Na primeira abertura após esta
  atualização, a tela é remontada assim que o tema é lido do banco.

## 0.9.1 — 2026-07-31

- **Correção crítica**: o executável da 0.9.0 abria com "Arquivo não
  encontrado". A tela era carregada por um endereço com parâmetro
  (`index.html?tema=…`) que funciona ao rodar pelo código-fonte, mas dentro
  do executável faz o navegador embutido procurar um arquivo com esse nome
  literal. O tema da tela de abertura passou a ser lido do armazenamento
  local do próprio aplicativo.

## 0.9.0 — 2026-07-30

- **Tela de abertura (splash)** em dois estágios: uma imagem aparece assim que
  o executável é aberto, enquanto o programa se prepara, e em seguida a tela
  de abertura do próprio aplicativo — com composição própria para cada tema
  (Portal: cartão com selo; Pergaminho: cartão com estandarte; Observatório:
  selo com anel). A barra acompanha as etapas reais do carregamento.

- Janela abre **maximizada** por padrão, com opção para desligar nas
  configurações.
- Estado da sincronização e origem dos dados (PNCP · versão) movidos do
  rodapé para o cabeçalho, junto à marca; abas em caixa alta.

## 0.8.0 — 2026-07-30

- **Colunas ajustáveis com o mouse**: arraste a borda direita de um cabeçalho
  para redimensionar e dê duplo clique para ajustar ao conteúdo (autofit),
  em todas as listas. As larguras são salvas por aba e há "Restaurar larguras
  padrão" nas configurações. A coluna de objeto/descrição nunca é reduzida
  abaixo do mínimo legível.
- Nome de fornecedor sem o sufixo societário (LTDA, ME, EPP…) na aba Preços,
  com o nome íntegro no tooltip e nos relatórios.

## 0.7.0 — 2026-07-30

- **Banco de preços municipal**: nova aba **Preços** com os itens de cada
  contratação — descrição, unidade, quantidade, valor unitário homologado e
  fornecedor vencedor. Buscar um termo mostra menor preço, mediana, média,
  maior preço, quantidade de itens e de fornecedores.
- **Relatório de Pesquisa de Preços**: levantamento timbrado do histórico de
  preços unitários homologados para um termo, do menor para o maior, com
  fornecedor e processo de origem — subsídio ao art. 23 da Lei 14.133/2021.
- Coleta de itens como terceira fase da sincronização, só revisitando
  contratação nova ou alterada (controle por `itens_versao`).
- Correção: com o Smart App Control do Windows 11 ativo, a atualização
  automática fica desligada e o exe novo é validado antes de substituir o
  atual (era a causa do erro "Failed to load Python DLL").

## 0.6.0 — 2026-07-29

- **Valor estimado distinguido do homologado**: processos sem homologação
  registrada exibem o valor em itálico com "est." — antes um processo em
  andamento parecia ter valor final.
- **Diálogos com foco**: abrir Relatórios, Configurações ou o detalhe trava a
  rolagem do fundo, leva o foco para o diálogo e prende o Tab nele.
- **Selo no cabeçalho**; barras de rolagem na paleta do tema; badge de
  situação encurtada; título da janela com o município.
- **Rodapé informativo**: "Sincronizado hoje às HH:MM" no lugar do traço.
- **Estado vazio contextual**: oferece sincronizar (acervo vazio) ou limpar
  filtros (busca sem resultado), com o selo em marca d'água.
- **Botão "Limpar filtros"** quando há filtro ativo.
- **Densidade das listas** (Confortável/Compacta) nas configurações.
- **Atualização automática mais resiliente**: valida o tamanho do download e
  reabre o programa se a primeira tentativa falhar (o antivírus varrendo o
  executável recém-escrito podia impedir a abertura).

## 0.5.0 — 2026-07-29

- **PCA corrigido**: o endpoint rejeita datas anteriores a 01/04/2021 (422) e
  responde 200 com corpo vazio quando não há dados — os dois casos derrubavam
  a sincronização. PCAs da Câmara de Orindiúva (2025/2026) agora sincronizam.
- **Relatórios seguem o tema** do app (Portal/Pergaminho/Observatório); a
  impressão usa sempre a paleta clara, seja qual for o tema.
- **Atas com coluna de objeto** (reprojetada do raw com migração automática),
  ordenável e coberta pela busca.
- **Número do contrato normalizado** para numero/ano (0033/26 → 33/2026) na
  lista, no detalhe e na relação.
- **Tamanho da fonte** nas configurações (Pequena a Extra grande).
- **Máscara de dinheiro** nos limites de dispensa.
- **JSON do detalhe formatado e colorido** conforme o tema; objeto do detalhe
  justificado.

## 0.4.0 — 2026-07-29

- **Alerta de Fracionamento** (relatório de uso interno): dispensas somadas
  por unidade × limites do art. 75, parametrizáveis nas configurações, com
  farol de atenção e lista completa para avaliação do gestor.
- **KPIs clicáveis e alertas na home**: cards navegam para as listas; chips
  de contratos/atas vencendo em 60 dias e de processos com propostas abertas.
- **Filtros novos**: "Propostas abertas" (contratações) e "Vigentes"
  (contratos/atas).
- **Atualização automática**: rodando pelo executável, o aviso de versão nova
  baixa, instala e reabre o programa sozinho.
- **Acessibilidade**: auditoria de contraste (21/21 pares AA nos 3 temas) e
  nomes acessíveis nos diálogos.
- **Qualidade**: suíte E2E (Playwright) com a ponte mockada no CI;
  screenshots dos 3 temas no README.

## 0.3.0 — 2026-07-29

- **Relatórios** (botão próprio): Relação de Contratações (TCE, com amparo
  legal e deságio), Relação de Contratos, Relação de Atas e Resumo Executivo
  Anual — HTML timbrado imprimível (nome do PDF correto) + CSV nas relações.
- **Filtro por órgão** na listagem (4 abas) e nos relatórios — prefeitura,
  câmara e demais órgãos separáveis; nome do órgão no cabeçalho e no nome do
  arquivo dos relatórios filtrados.
- **Números humanos**: contratações (nº/ano em coluna própria), contratos
  (0033/26/2026) e atas (13/2026) exibem o número do instrumento em vez do id
  longo do PNCP, com ordenação cronológica real; migração automática reprojeta
  bancos existentes a partir do raw.
- **Tratamento estético** nas listas e relatórios: colunas curtas
  centralizadas nos dois eixos, objeto justificado com hifenização, zebra
  sutil, dígitos tabulares.
- **Largura da página** (Compacta/Expandida) nas configurações, como no SGCD.
- Link "Ver no PNCP" das atas abre a página da própria ata (antes era
  genérico); busca ampliada (fornecedor e números de instrumento).

## 0.2.0 — 2026-07-29

- **PCA**: 4ª aba com os itens do Plano de Contratações Anual por órgão
  (endpoint `/v1/pca/atualizacao`; atenção: usa `dataInicio`/`dataFim`,
  diferente dos demais). Itens achatados com contexto do plano.
- **Ordenação por clique** no cabeçalho de todas as listas (whitelist de
  colunas no backend; ▲/▼ com aria-sort).
- **Objetos em caixa alta** nas listas e no detalhe.
- **Aviso de versão nova**: checagem da última release do GitHub ao abrir,
  com link no rodapé; falha em silêncio.
- Busca dos contratos agora cobre também o fornecedor.

## 0.1.2 — 2026-07-29

- Nova tentativa de arquivamento no Zenodo após reset do vínculo GitHub↔Zenodo
  (indisponibilidade do serviço travou o arquivamento das v0.1.0/v0.1.1 —
  afetou também os demais sistemas da família no mesmo período).

## 0.1.1 — 2026-07-29

- Versão no título do MANUAL.html (nome sugerido do PDF na impressão) e no
  cabeçalho impresso de página.
- `.zenodo.json` com metadados explícitos (o arquivamento automático da
  v0.1.0 no Zenodo falhou por metadados).

## 0.1.0 — 2026-07-29

Primeira versão funcional.

- Sync em 2 fases com o PNCP: contratações por município (todas as modalidades
  da Lei 14.133) e contratos/atas por CNPJ dos órgãos descobertos.
- Sync incremental ao abrir, com catch-up desde a última execução e bootstrap
  histórico desde 2021 na primeira configuração.
- Wizard de primeira execução com os 5.571 municípios do IBGE embutidos.
- Listagem com filtros (ano, modalidade, situação, busca no objeto), detalhe
  completo com JSON bruto do PNCP e link para a página oficial.
- KPIs (contratações, total homologado no ano, contratos vigentes).
- Órgãos monitorados: descoberta automática + cadastro manual por CNPJ.
- Exportação CSV do filtro atual.
- Três temas (Portal, Pergaminho, Observatório); identidade Licitarium completa
  (ver design/IDENTIDADE.md).
- Cliente PNCP só com stdlib: pacing de 0,5 s entre requisições, retry com
  backoff e respeito a Retry-After.
