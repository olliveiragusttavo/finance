# Sistema de Finanças Pessoais

Um sistema de finanças pessoais criado para obter os relatórios que os aplicativos de
finanças prontos não oferecem. É um projeto hobby / de uso pessoal: não há monetização
planejada, e o design evita deliberadamente qualquer custo recorrente (bancos de dados
hospedados, servidores, serviços pagos).

## Motivação

Uso aplicativos comerciais de controle financeiro há algum tempo, mas os relatórios
embutidos neles não respondem às perguntas que eu realmente tenho sobre o meu próprio
dinheiro — detalhamentos personalizados por categoria/subcategoria, visões entre contas,
o impacto da fatura do cartão de crédito no saldo mensal etc. Em vez de contornar essa
limitação, o objetivo é ser dono dos dados e da camada de relatórios.

## Objetivos

- Controle preciso do dia a dia de contas, cartões e transações.
- Geração de relatórios pessoais flexíveis, sem as limitações da interface de um app de
  terceiros.
- Propriedade dos dados: tudo fica no(s) meu(s) próprio(s) dispositivo(s), em um formato
  que eu controlo.
- Capacidade de importar o histórico de transações já acumulado no app que uso
  hoje.

## Foco

- **Uso diário no celular** (Android e iPhone, ambos suportados) — lançar transações,
  consultar saldos, consultas rápidas.
- **Relatórios no desktop** — o trabalho de análise mais pesado e flexível acontece em
  uma tela maior, onde relatórios e visões personalizados fazem mais sentido.
- **Sem infraestrutura paga** — sem bancos de dados gerenciados, sem hospedagem em
  nuvem, sem assinaturas. O que for escolhido precisa poder rodar de graça,
  indefinidamente.

### Fora do escopo (por enquanto)

- Implantação multi-tenant / SaaS.
- Integrações com bancos/open finance ou importação automática de transações das
  instituições.
- Qualquer coisa que exija um servidor sempre ligado para funcionar no dia a dia.

## Arquitetura

### Forma geral

- **Dados local-first**: o banco de dados fica no dispositivo do usuário. Não há
  exigência de um servidor central para o app funcionar.
- **Sincronização entre dispositivos, somente na mesma rede**: os dispositivos de um
  usuário (desktop, Android, iOS) são pares iguais, cada um com o conjunto completo de
  dados e escrevendo offline. Os dispositivos são vinculados por QR code ou código curto
  e sincronizam diretamente — com criptografia, sem servidor — somente enquanto ambos
  estão na mesma rede local com o app aberto. A sincronização remota é recusada por
  design. Edições concorrentes são resolvidas por campo, e a edição mais recente vence.
  Projetado, ainda não implementado:
  **[docs/plans/sync-design.md](docs/plans/sync-design.md)**.
- **Lógica de backend compartilhada**: o desejo de não reescrever a mesma lógica de
  negócio duas vezes (uma para mobile, outra para desktop) é o principal motivo para
  avaliar o **Electron** como forma de reutilizar um único backend/código-base tanto em
  um app desktop quanto, eventualmente, em um shell mobile — com um futuro serviço web
  como outro possível consumidor desse mesmo backend.

A direção foi confirmada no design do backend: o Electron é o shell desktop, o React
Native / Expo é o shell mobile, e o que se compartilha entre eles é um núcleo TypeScript
com a lógica de negócio, não a UI
([docs/plans/backend-design.md](docs/plans/backend-design.md)). O Electron foi confirmado
frente ao Tauri, e a UI é React nas duas pontas — React DOM no desktop, React Native no
mobile —, compartilhando a camada de apresentação headless, não os componentes
([docs/plans/desktop-shell-design.md](docs/plans/desktop-shell-design.md)). No celular,
o núcleo roda no próprio runtime JavaScript do app e acessa o mesmo SQLite embarcado,
sem servidor local nem segundo runtime
([docs/plans/mobile-shell-design.md](docs/plans/mobile-shell-design.md)).

### Camadas do backend (MVC)

O backend segue uma divisão em camadas no estilo MVC, escolhida por ser o padrão mais
familiar e mais fácil de raciocinar para este tipo de aplicação de CRUD e relatórios:

| Camada | Responsabilidade |
|---|---|
| **Request** | Valida permissões e os dados de formulário/requisição recebidos antes que cheguem à lógica de negócio. |
| **Controller** | Recebe as requisições, delega para a camada de serviço, formata e devolve as respostas. |
| **Service** | Concentra toda a lógica de negócio (cálculo de saldos, consolidação de faturas, regras de categoria etc.). |
| **Repository** | Concentra todo o acesso a dados/consultas — a única camada que conversa com o banco de dados. |
| **Model** | As classes de objeto que representam o domínio (User, Account, Transaction, Card, Statement, ...). |

### Visão geral do domínio

O sistema segue a forma comum à maioria das ferramentas de finanças pessoais:

- Um **Usuário** (User) possui uma ou mais **Contas** (Accounts).
- Cada **Conta** registra mensalmente **despesas**, **receitas**, **transferências** e
  **investimentos** — modelados coletivamente como **Transações** (Transactions).
- Toda transação tem nome, descrição, valor, categoria, subcategoria e uma conta
  associada.
- Cada *tipo* de transação adiciona seus próprios atributos sobre essa base comum — por
  exemplo, uma despesa no cartão de crédito é vinculada a uma **Fatura** (Statement),
  uma transferência tem uma conta de destino, um investimento pode acompanhar um
  ativo/posição etc. (Os atributos exatos de cada tipo serão definidos durante o design
  do banco de dados.)
- **Contas** podem ter **Cartões de Crédito** ou **de Débito**. A movimentação dos
  cartões é consolidada em **Faturas** mensais, que por sua vez entram no saldo mensal
  da conta à qual pertencem.

## Escolhas de tecnologia

O banco de dados, o backend compartilhado e os shells desktop e mobile estão definidos.

### Banco de dados — SQLite

**SQLite**, armazenado como um único arquivo no dispositivo do usuário. Esta é a única
peça da stack que está fechada, e foi escolhida justamente porque não restringe as
escolhas que ainda estão em aberto:

- **Ele já está presente em todas as plataformas-alvo.** Android e iOS já vêm com
  SQLite, então qualquer tecnologia mobile escolhida depois consegue abrir o mesmo
  schema. A decisão sobre o mobile não tem como invalidar o modelo de dados.
- **Ele se encaixa no objetivo de relatórios.** Os relatórios que este projeto existe
  para produzir são relacionais e orientados a mês; window functions e CTEs transformam
  saldos acumulados e comparações mês a mês em consultas comuns, em vez de código de
  aplicação.
- **A propriedade dos dados passa a ser literal** — um arquivo para copiar, fazer backup
  e inspecionar com qualquer uma de centenas de ferramentas, em um formato com
  compromisso de continuar legível por décadas. Para um arquivo financeiro pensado para
  abranger anos, essa longevidade é justamente o ponto.
- **Zero infraestrutura e zero custo recorrente**, permanentemente.
- **A sincronização continua alcançável** sem trocar de motor depois.

Uma consequência que vale deixar clara desde já: o schema é idêntico entre plataformas,
mas o *driver* do SQLite não — um shell desktop e um shell mobile usam bindings
diferentes, com APIs diferentes. Por isso a camada Repository é escrita contra uma porta
interna estreita, com um adaptador fino específico de cada plataforma por trás, de modo
que o SQL continua compartilhado e só o adaptador é reescrito.

O raciocínio completo, as alternativas rejeitadas e as convenções de tipos e de
configuração estão em **[docs/plans/database-design.md](docs/plans/database-design.md)**,
que é o lugar de toda decisão de banco de dados do projeto.

### Backend compartilhado — núcleo TypeScript

A lógica de negócio é um núcleo em **TypeScript puro**, sem dependência do Node, que
roda igual no **Electron** (desktop), no **React Native / Expo** (mobile) e, no futuro,
num servidor. Tudo que é da plataforma — driver SQLite, relógio, geração de ids,
sistema de arquivos — entra por portas com um adaptador fino por plataforma. O volume de
cálculo é pequeno e a agregação pesada fica no SQL; o risco real é a exatidão dos
saldos, tratada com um Value Object `Money` e saldos sempre recalculados a partir das
transações. O schema evolui por migrations somente para a frente, versionadas em
`PRAGMA user_version` e aplicadas na abertura do app com backup prévio.

Raciocínio, alternativas rejeitadas, estratégia de migrations e estratégia de testes em
**[docs/plans/backend-design.md](docs/plans/backend-design.md)**.

### Shell desktop e UI — Electron + React

O **Electron** foi confirmado como shell desktop. O Tauri foi avaliado e descartado: o
JavaScript dele só roda na webview, onde o SQLite chega por IPC assíncrono ou como WASM
fora de um arquivo comum — ou exige um sidecar Node, que anula a economia de recursos. O
Electron hospeda o núcleo num `utilityProcess` com o `better-sqlite3` síncrono e o
transporte da sincronização, e embarca o mesmo Chromium em todo sistema operacional.

A UI é **React**, por ser o framework que o mobile (React Native) também usa. O que se
compartilha é um pacote `client` headless — contrato tipado dos Controllers, hooks de
dados, view-models dos relatórios e formatadores —, não os componentes visuais.

Raciocínio, custos aceitos e o que reabriria a decisão em
**[docs/plans/desktop-shell-design.md](docs/plans/desktop-shell-design.md)**.

### Shell mobile — React Native + Expo

O **React Native com Expo** foi confirmado como shell mobile pela régua do que seria
reimplementado: é a única opção em que nenhuma regra de negócio nem de convergência da
sincronização existe duas vezes. Nativo, Flutter e Kotlin Multiplatform reescreveriam o
núcleo; o Capacitor compartilharia até a UI, mas rodaria o núcleo numa webview com SQLite
assíncrono — o mesmo problema do Tauri. O que o mobile escreve são adaptadores sem regra
e as telas.

O app fala com o banco pelo **mesmo mecanismo embarcado**: o núcleo roda na thread
JavaScript e chama o SQLite pela API síncrona do `expo-sqlite`, via JSI. Uma API local
(servidor HTTP no aparelho, Node embarcado) foi descartada: o único consumidor é o próprio
app. A criptografia da sincronização também é código do núcleo (Noise e CPace em
TypeScript puro), o banco fica fora do backup em nuvem do iCloud e do Google, e a
distribuição no iOS ainda depende de uma escolha entre conta gratuita e programa pago da
Apple.

Raciocínio, orçamento de desempenho e paridade entre runtimes em
**[docs/plans/mobile-shell-design.md](docs/plans/mobile-shell-design.md)**.

## Diagramas

Os diagramas de arquitetura e de design são feitos com [draw.io](https://draw.io) e
ficam em [docs/drawio/](docs/drawio/). O diagrama entidade-relacionamento em
[project.drawio](docs/drawio/project.drawio) é a fonte da verdade visual do modelo de
dados; [docs/plans/database-design.md](docs/plans/database-design.md) traz o raciocínio
por trás dele. Da mesma forma, [backend-layers.drawio](docs/drawio/backend-layers.drawio)
mostra as camadas do backend, as portas e os adaptadores de cada plataforma, com o
raciocínio em [docs/plans/backend-design.md](docs/plans/backend-design.md). Quando um
diagrama e seu documento divergem, ambos são atualizados.

## Design de interface

As telas aprovadas ficam em [docs/design/mockups/](docs/design/mockups/), uma por
arquivo em `screens/`, e são a referência de layout, conteúdo e navegação — não código
para copiar. O [README dos mockups](docs/design/mockups/README.md) explica como lê-los e
reúne as decisões de interface e os tokens de cor (tema claro e escuro). Esses tokens
alimentam o Tailwind do desktop, com shadcn/ui, e o NativeWind do mobile; o raciocínio
está em [desktop-shell-design.md §4.5](docs/plans/desktop-shell-design.md#45-estilo-e-tokens-de-design)
e [mobile-shell-design.md §9](docs/plans/mobile-shell-design.md#9-telas-e-estilo). As
regras de negócio por trás das telas estão no
[brief de design](docs/design/claude-design-brief.md).

## Status

Fase inicial de design. O motor de banco de dados foi escolhido e o schema está
totalmente especificado — entidades, tipos, restrições, ações de chave estrangeira e
índices — em [docs/plans/database-design.md](docs/plans/database-design.md), e
transcrito na primeira migration,
[db/migrations/0001_initial_schema.sql](db/migrations/0001_initial_schema.sql).
A sincronização entre dispositivos está projetada em
[docs/plans/sync-design.md](docs/plans/sync-design.md), e o backend compartilhado —
runtime, migrations e testes — em
[docs/plans/backend-design.md](docs/plans/backend-design.md); o shell desktop e a UI em
[docs/plans/desktop-shell-design.md](docs/plans/desktop-shell-design.md); o shell mobile
em [docs/plans/mobile-shell-design.md](docs/plans/mobile-shell-design.md). As telas do
desktop e do celular estão desenhadas e aprovadas em
[docs/design/mockups/](docs/design/mockups/).

O núcleo começou a ser implementado em `packages/core`, nas camadas Request → Controller
→ Service → Repository → Model: modelos de domínio, Repositories SQLite, CRUD de
transações, cálculo de saldo (consolidado e previsto) e consolidação de extratos e
faturas, com o adaptador `better-sqlite3` em `packages/sqlite-better`. O que falta está
em [backend-design.md §7](docs/plans/backend-design.md#7-próximos-passos).

### Desenvolvimento

Requer Node 24 e pnpm 12. `pnpm install` e depois `pnpm check` (lint, tipos e testes).
Depois de alterar `db/migrations`, `pnpm embed:migrations` regenera as migrations
embutidas no núcleo — um teste falha se elas divergirem dos arquivos `.sql`.
