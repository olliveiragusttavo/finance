# Design do Shell Desktop e da UI

**Status:** Design concluído — não implementado. Fecha as duas questões que o
[backend-design.md](backend-design.md) deixou abertas sobre o desktop: confirmar o
Electron frente às alternativas mais leves (Tauri em especial) e escolher o framework de
UI das telas de relatório.
**Relacionado:** [backend-design.md](backend-design.md) — o núcleo que este shell hospeda;
[sync-design.md](sync-design.md) — o transporte de rede que o shell precisa oferecer;
[database-design.md](database-design.md) — o arquivo que o shell abre.

Este documento é o lugar de toda decisão sobre o shell desktop e a camada de UI. A
[§2](#2-decisões-em-resumo) é o resumo; as seções seguintes guardam o raciocínio.

---

## 1. Escopo e restrições

Herdadas do [README](../../README.md) e dos documentos anteriores:

- O desktop é onde acontece o **trabalho de análise**: relatórios, tabelas densas,
  comparações entre meses, gráficos. O uso diário fica no celular.
- O núcleo é **TypeScript puro**, com uma porta `Database` **síncrona** e `transaction(fn)`
  síncrono ([backend-design.md §3.5](backend-design.md#35-a-porta-de-banco-é-síncrona)),
  rodando **fora da thread de UI**
  ([backend-design.md §3.6](backend-design.md#36-onde-o-núcleo-roda)).
- O banco é **um arquivo SQLite comum** no disco do usuário — copiável, inspecionável,
  com backup por `VACUUM INTO` ([backend-design.md §4.6](backend-design.md#46-backup-antes-de-migrar)).
- O shell precisa hospedar o transporte da sincronização: **listener e cliente TCP,
  mDNS, armazenamento seguro de chaves e criptografia**
  ([sync-design.md §7](sync-design.md#7-transporte-somente-a-mesma-rede-local)).
- O mobile já está decidido: **React Native / Expo**
  ([backend-design.md §3.8](backend-design.md#38-consequência-o-mobile-é-react-native--expo)).

Fora do escopo: a biblioteca de gráficos ([§6](#6-próximos-passos)). O desenho das telas
não é decidido aqui: está nos mockups aprovados em [docs/design/mockups/](../design/mockups/);
este documento decide só como elas são estilizadas ([§4.5](#45-estilo-e-tokens-de-design)).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Seção |
|---|---|---|
| Electron ou Tauri? | **Electron confirmado.** O Tauri não tem onde rodar o núcleo TypeScript com SQLite síncrono sem trazer de volta um runtime Node — e aí a economia some | [§3](#3-electron-ou-tauri) |
| O argumento do "shell mobile" ainda vale? | Não. O mobile é React Native por conta própria; a comparação passa a ser **só desktop**, e mesmo assim o Electron vence | [§3.1](#31-a-pergunta-mudou) |
| Framework de UI? | **React** (React DOM + Vite no renderer), por ser o único que o mobile também usa | [§4](#4-framework-de-ui) |
| O que se compartilha com o mobile? | **Lógica de apresentação, não componentes**: um pacote `client` headless com o contrato tipado dos Controllers, hooks de dados, view-models e formatadores | [§4.2](#42-o-que-é-compartilhado-é-a-camada-headless) |
| Como a UI é estilizada? | **Tailwind CSS + shadcn/ui**, com os tokens dos mockups num pacote `tokens` que também alimenta o NativeWind do mobile | [§4.5](#45-estilo-e-tokens-de-design) |
| Como a UI fala com o núcleo? | Por uma interface `CoreClient` com duas implementações: IPC (desktop) e chamada direta (mobile). Erros atravessam como resultado tipado, não como exceção | [§5](#5-a-fronteira-ui--núcleo) |

---

## 3. Electron ou Tauri

### 3.1 A pergunta mudou

Quando o README cogitou o Electron, o argumento era reaproveitar um único código-base no
desktop e, eventualmente, num shell mobile. Esse argumento **não existe mais**: o
Electron nunca rodou em celular, e o [backend-design.md §3.8](backend-design.md#38-consequência-o-mobile-é-react-native--expo)
fechou o mobile em React Native / Expo, que reaproveita o núcleo diretamente. O que é
compartilhado entre as plataformas é o núcleo TypeScript, e ele é indiferente ao shell
desktop.

A restrição "shell mobile multiplataforma" portanto já foi flexibilizada — e a escolha
do desktop precisa se sustentar sozinha. A pergunta certa passa a ser: **qual shell
desktop hospeda o núcleo TypeScript cumprindo as restrições da [§1](#1-escopo-e-restrições)?**

### 3.2 Onde o núcleo rodaria no Tauri

No Tauri, o processo nativo é Rust e o JavaScript só existe dentro da webview. Há quatro
lugares possíveis para o núcleo, e nenhum serve:

| Opção | Por que não |
|---|---|
| Núcleo na webview, banco pelo `tauri-plugin-sql` | A API do plugin é **assíncrona** e cada consulta atravessa o IPC. A porta `Database` síncrona deixa de ser implementável, e `transaction(fn)` atômico sobre chamadas separadas pelo IPC volta a exigir fila ou mutex — exatamente o que a [backend-design.md §3.5](backend-design.md#35-a-porta-de-banco-é-síncrona) evitou. |
| Núcleo na webview, banco em SQLite WASM | O arquivo passa a viver no armazenamento privado da webview (OPFS), não num arquivo comum no disco — a propriedade dos dados deixa de ser literal ([README](../../README.md)). Backup, inspeção e o snapshot de pareamento passam a depender de exportar o banco. |
| Núcleo num *sidecar* Node | Funciona, mas empacota um runtime Node com o módulo nativo do `better-sqlite3` **além** do processo Rust e da webview: três runtimes em vez de dois. A economia de disco e memória, que é o único motivo para preferir o Tauri, quase desaparece, e a ponte webview → Rust → sidecar adiciona um salto a cada chamada. |
| Reescrever o núcleo em Rust | Rejeitado na [backend-design.md §3.10](backend-design.md#310-alternativas-rejeitadas): duas implementações da mesma regra de negócio. |

No Electron, o núcleo roda num `utilityProcess` com Node completo e o `better-sqlite3`
síncrono — a topologia que a [backend-design.md §3.6](backend-design.md#36-onde-o-núcleo-roda)
já descreve, sem adaptação.

### 3.3 Uma engine de renderização em todo sistema operacional

O Tauri usa a webview do sistema: WebView2 no Windows, WKWebView no macOS e
**WebKitGTK no Linux**. São três motores diferentes, em versões que o app não controla,
e o WebKitGTK é o mais lento e o que mais diverge — justamente na plataforma em que este
projeto é desenvolvido. Para telas de relatório, com tabelas longas, gráficos em canvas
e layout denso, isso significa testar e contornar diferenças de renderização em cada
sistema.

O Electron embarca o Chromium: o renderer é o mesmo binário em todo sistema operacional,
na versão fixada pelo projeto.

### 3.4 O transporte da sincronização

O `utilityProcess` do Electron tem os módulos `net` e `dgram` do Node: o listener TCP e
a descoberta mDNS ([sync-design.md §7](sync-design.md#7-transporte-somente-a-mesma-rede-local))
rodam ao lado do núcleo, no mesmo processo que é dono da conexão com o banco — o que a
captura e a aplicação da sincronização exigem. O armazenamento seguro das chaves usa o
`safeStorage` do Electron, que delega ao chaveiro do sistema operacional. O canal
criptografado não usa o `crypto` do Node: ele é código do núcleo, em TypeScript puro, o
mesmo no desktop e no celular
([mobile-shell-design.md §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo));
o `utilityProcess` só fornece os adaptadores de socket, mDNS e chaveiro.

No Tauri, essa parte seria escrita em Rust (plugins próprios ou de terceiros) e
conversaria com o núcleo pelo IPC — mais uma fronteira assíncrona no caminho da
sincronização.

### 3.5 O custo do Electron, dito com clareza

- **Instalador na casa de 100 MB** e uma a duas centenas de MB de memória com a janela
  aberta, contra poucos MB e bem menos memória no Tauri.
- **Atualizações maiores** e a necessidade de acompanhar as versões do Chromium por
  segurança.
- **Recompilar o `better-sqlite3`** para o ABI do Electron — custo de build, resolvido
  uma vez ([backend-design.md §3.7](backend-design.md#37-drivers)).

Para um app pessoal, de um único usuário, aberto em sessões de análise num desktop, esse
custo é aceitável. Ele não afeta exatidão, propriedade dos dados nem custo recorrente,
que são os objetivos do projeto.

### 3.6 Segurança do renderer

O renderer é tratado como entrada não confiável
([backend-design.md §3.6](backend-design.md#36-onde-o-núcleo-roda)). Configuração
obrigatória da janela:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- O *preload* expõe **apenas** o `CoreClient` ([§5](#5-a-fronteira-ui--núcleo)) — nenhuma
  função genérica de IPC, nenhum acesso a `fs` ou `shell`.
- CSP restrita (`default-src 'self'`), sem carregar conteúdo remoto; navegação para fora
  do app e abertura de novas janelas bloqueadas.

### 3.7 O que reabriria a decisão

- **O custo de memória ou de disco virar um problema real**, medido, no uso do dia a dia.
- **Um shell com webview do sistema e runtime JavaScript com SQLite síncrono embutido
  amadurecer** — o Electrobun (Bun + webview do sistema, com o `bun:sqlite` síncrono) é o
  candidato que preservaria o núcleo e a porta síncrona. Hoje é jovem demais para hospedar
  um arquivo financeiro; fica registrado como a alternativa a observar, não a adotar.

Como o núcleo só enxerga portas, trocar de shell desktop depois custa o adaptador de
banco, o processo hospedeiro e o *preload* — não a regra de negócio nem a UI.

---

## 4. Framework de UI

### 4.1 O critério: o que o mobile também usa

O mobile é React Native. Dos candidatos — React, Vue, vanilla —, **só o React** é o mesmo
modelo de componentes, hooks e gerenciamento de estado nas duas plataformas. Escolher
outro framework no desktop significa manter dois paradigmas de UI e não compartilhar
nada da camada de apresentação.

| Opção | Por que não |
|---|---|
| Vue | Não há Vue mantido para mobile nativo; o desktop em Vue e o mobile em React Native não compartilhariam nem hooks nem estado. |
| Svelte / Solid | Mesmo problema do Vue. |
| Vanilla (DOM direto, Web Components) | Relatórios têm estado interativo rico — filtros, período, drill-down de categoria para subcategoria, comparação entre meses. Sem framework, a reatividade seria reinventada à mão, e nada seria compartilhado com o mobile. |

**Decisão:** React no renderer, com **React DOM** e **Vite** como bundler.

### 4.2 O que é compartilhado é a camada headless

React DOM e React Native não compartilham componentes visuais: um usa `div` e CSS, o
outro `View` e `StyleSheet`. O que se compartilha é tudo que fica **acima** dos
componentes. Isso vira um pacote próprio:

```
packages/client     contrato tipado do núcleo, CoreClient, hooks de dados,
                    view-models dos relatórios, formatadores (Money, datas, períodos)
```

- **Hooks de dados** com **TanStack Query** (`useMonthlyStatement`, `useInvoice`), que
  roda igual em React DOM e React Native e dá cache, invalidação após escrita e estado
  de carregamento sem código por plataforma.
- **View-models** que transformam o DTO do Controller no que a tela mostra — agrupamento
  por categoria, variação mês a mês, totais. É a parte dos relatórios que mais tem regra
  de apresentação e a que mais se paga compartilhar.
- **Formatadores** de `Money`, datas e períodos, com a mesma regra de arredondamento de
  apresentação do núcleo ([backend-design.md §3.3](backend-design.md#33-aritmética-monetária-no-núcleo)),
  para que o celular e o desktop nunca mostrem o mesmo saldo de dois jeitos. Pelo mesmo
  motivo, o dinheiro não é formatado com `Intl.NumberFormat`, cujo resultado difere entre
  o Chromium e o Hermes ([mobile-shell-design.md §8](mobile-shell-design.md#8-paridade-entre-runtimes)).

A fronteira é verificada por lint, como a do núcleo: `packages/client` não importa
`react-dom`, `react-native` nem `electron`.

### 4.3 Por que não uma UI única com react-native-web

Seria possível escrever as telas uma vez em React Native e rodá-las no desktop com
`react-native-web`. Foi descartado:

- **O desktop existe para relatórios densos** — tabelas com muitas colunas, ordenação,
  hover, menus de contexto, atalhos de teclado, várias áreas na mesma tela. Os primitivos
  do React Native são pensados para toque e telas estreitas; no desktop eles viram uma
  camada a contornar.
- **O código compartilhado seria o de layout**, que é justamente o que deve diferir entre
  um celular e um monitor. A lógica que vale a pena compartilhar já está na
  [§4.2](#42-o-que-é-compartilhado-é-a-camada-headless).
- O README já fixava a ressalva: o que se compartilha é a lógica, não a UI.

### 4.4 Bibliotecas do renderer

- **TanStack Table** para as tabelas de relatório: headless, então a lógica de colunas,
  ordenação e agrupamento é dados, e a renderização fica com o React DOM.
- **Gráficos:** escolhidos junto com o desenho dos relatórios ([§6](#6-próximos-passos)).
  Critério: renderizar em canvas ou SVG com milhares de pontos sem travar, tema claro e
  escuro, e acessibilidade dos valores (tooltip e tabela equivalente).
- **TypeScript no mesmo modo estrito** do núcleo ([backend-design.md §3.9](backend-design.md#39-estrutura-e-ferramentas)).

### 4.5 Estilo e tokens de design

As telas estão desenhadas e aprovadas em [docs/design/mockups/](../design/mockups/). Os
mockups fixam o que o estilo precisa sustentar: **tema claro e escuro desde o início**,
uma paleta de tokens de cor, IBM Plex Sans com algarismos tabulares, e o mesmo
vocabulário visual no desktop e no celular. São referência de layout e conteúdo, não
código para copiar.

**Decisão:** **Tailwind CSS** com **shadcn/ui** no renderer, e os tokens num pacote
próprio, sem dependências, consumido pelos dois apps:

```
packages/tokens     cores (claro e escuro), tipografia e espaçamentos como dados,
                    e o preset do Tailwind gerado a partir deles
```

- **Tailwind porque o mobile fala a mesma língua.** O NativeWind leva as classes do
  Tailwind para o React Native ([mobile-shell-design.md §9](mobile-shell-design.md#9-telas-e-estilo)).
  Os componentes continuam separados por plataforma ([§4.2](#42-o-que-é-compartilhado-é-a-camada-headless)),
  mas um `bg-surface text-ink` significa a mesma coisa nos dois, e os tokens vivem num
  lugar só.
- **O tema troca por variável CSS.** Cada token vira uma variável com valor claro e
  escuro; o Tailwind referencia a variável, e trocar de tema é trocar uma classe na raiz,
  sem re-renderizar a árvore.
- **shadcn/ui porque o código é nosso.** Os componentes são copiados para o repositório,
  sobre primitivos do Radix, em vez de importados de uma biblioteca fechada. O desktop
  precisa de menus de contexto, diálogos, popovers e navegação por teclado acessíveis
  ([§4.3](#43-por-que-não-uma-ui-única-com-react-native-web)), e o Radix resolve isso; o
  visual fica nos tokens, sem briga com o tema de terceiros.
- **TanStack Table** ([§4.4](#44-bibliotecas-do-renderer)) continua cuidando da lógica
  das tabelas; a renderização usa os componentes de tabela do shadcn/ui.

| Alternativa | Por que foi descartada |
|---|---|
| CSS Modules / CSS puro | Funciona no desktop, mas nada é compartilhado com o mobile: os tokens seriam escritos uma vez em CSS e outra em `StyleSheet`, e as duas cópias divergiriam. |
| CSS-in-JS (styled-components, Emotion) | O tema vira objeto JavaScript resolvido a cada render, um custo no renderer que o CSS estático do Tailwind não tem. A troca de tema re-renderiza a árvore. |
| Biblioteca de componentes pronta (MUI, Mantine, Ant) | Traz uma linguagem visual própria que teria de ser desfeita para chegar aos mockups, e não tem equivalente em React Native com a mesma API. |

O que reabriria a decisão: o NativeWind deixar de acompanhar as versões do Expo. Como os
tokens são dados em `packages/tokens`, a saída seria gerar `StyleSheet` a partir deles no
mobile, sem tocar no desktop.

---

## 5. A fronteira UI ↔ núcleo

### 5.1 Um contrato, duas implementações

O pacote `core` exporta o **mapa de rotas** dos Controllers — para cada rota, o tipo do
DTO de entrada e o do resultado. O `client` define sobre ele uma interface:

```ts
interface CoreClient {
    call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<R>>;
}
```

| Implementação | Plataforma | Como chega ao Controller |
|---|---|---|
| `IpcCoreClient` | Desktop | `MessagePort` do renderer até o `utilityProcess` |
| `DirectCoreClient` | Mobile | Chamada direta na thread JavaScript |

Os hooks da [§4.2](#42-o-que-é-compartilhado-é-a-camada-headless) só conhecem
`CoreClient`; trocar de plataforma é trocar a implementação injetada na raiz do app.

### 5.2 O renderer fala direto com o núcleo

O processo principal cria um `MessageChannelMain` e entrega uma ponta ao
`utilityProcess` e a outra ao renderer, pelo *preload*. As chamadas não passam pelo
processo principal, que fica livre para janelas e menus — e não vira um gargalo nem um
segundo lugar onde validação poderia ser esquecida.

### 5.3 Erros atravessam como resultado, não como exceção

O IPC do Electron serializa por *structured clone*: uma exceção lançada no
`utilityProcess` chega ao renderer sem a classe nem os campos próprios. Por isso os
Controllers devolvem uma união discriminada —
`{ ok: true, data } | { ok: false, error: { code, details } }` —, com `code` sendo um
conjunto fechado e tipado (`VALIDATION_FAILED`, `NOT_FOUND`, `SCHEMA_NEWER_THAN_APP`, …).
A UI trata cada código de forma exaustiva, verificada pelo compilador. Exceções ficam
para falhas inesperadas, que viram um erro genérico com log no `utilityProcess`.

### 5.4 Validação na fronteira

A camada **Request** valida toda entrada **no `utilityProcess`**, nunca só no renderer
([backend-design.md §3.6](backend-design.md#36-onde-o-núcleo-roda)). Os mesmos schemas
podem ser reaproveitados pelo `client` para validar formulários antes do envio — como
conforto de UX, não como garantia.

---

## 6. Próximos passos

1. **Incluir `packages/client` e o esqueleto de `apps/desktop`** (Electron + Vite +
   React) no monorepo da [backend-design.md §7](backend-design.md#7-próximos-passos),
   com a configuração de segurança da [§3.6](#36-segurança-do-renderer) e o lint de
   fronteira da [§4.2](#42-o-que-é-compartilhado-é-a-camada-headless) desde o primeiro
   commit, junto com `packages/tokens` e o Tailwind já configurado com o tema claro e
   escuro ([§4.5](#45-estilo-e-tokens-de-design)).
2. **Definir o mapa de rotas e o `CoreResult`** ([§5](#5-a-fronteira-ui--núcleo)) junto
   com o primeiro Controller, para que o contrato nasça tipado.
3. **Listar os relatórios do desktop** — as perguntas concretas que o README diz que os
   apps comerciais não respondem — e, a partir deles, escolher a biblioteca de gráficos
   ([§4.4](#44-bibliotecas-do-renderer)).
4. **Medir o Electron** (memória e tempo de abertura) assim que houver um esqueleto
   rodando, para que a [§3.7](#37-o-que-reabriria-a-decisão) se apoie em número e não
   em impressão.
