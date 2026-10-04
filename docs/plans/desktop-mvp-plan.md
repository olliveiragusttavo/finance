# Plano do MVP Desktop — CRUD e primeiros relatórios

**Status:** Em andamento — Fases 0 a 5 concluídas (só o `Ctrl K` da Fase 4 ficou pendente). Primeira entrega com tela do projeto: o app desktop
(Electron) com os cadastros e lançamentos básicos e os dois primeiros relatórios
personalizados, que são a motivação original do projeto ([README](../../README.md#motivação)).
O mobile fica inteiro para depois.
**Relacionado:** [desktop-shell-design.md](desktop-shell-design.md) — shell, UI, `client` e
fronteira IPC que este plano implementa; [backend-design.md](backend-design.md) — o núcleo
que ganha os cadastros e os relatórios; [database-design.md](database-design.md) — as
regras de negócio de contas, faturas e transações;
[mockups](../design/mockups/README.md) — as telas aprovadas;
[reports-design.md](reports-design.md) — as regras dos relatórios como implementadas.

A [§2](#2-decisões-em-resumo) é o resumo; a [§6](#6-lista-de-tarefas) é a lista de
tarefas, em ordem de execução.

---

## 1. Objetivo e escopo

**Pergunta que o MVP responde:** consigo lançar o meu mês real no desktop e ver, num
relatório que os apps comerciais não dão, **para onde foi o dinheiro por
categoria/subcategoria** e **quanto as faturas do cartão pesam no saldo do mês**?

### Dentro do escopo

| Área | Telas (mockup) | O que entra |
|---|---|---|
| Primeiro uso | `DesktopPrimeiroUso` | Criar perfil e primeira conta. "Entrar num grupo" aparece desabilitado |
| Shell | todas (barra lateral e superior) | Navegação, mês de referência fixo, seletor de perfil, tema claro/escuro, "+ Lançamento" |
| Cadastros | `DesktopCadastros` | Perfis, contas, cartões, categorias e subcategorias |
| Contas | `DesktopContas` | Lista com consolidado e previsto → extrato do mês |
| Cartões | `DesktopCartoes` | Lista com fatura do mês → detalhe da fatura, pagar, pagamento parcial, reabrir, próximas faturas |
| Transações | `DesktopTransacoes` | Tabela do mês, filtros, painel de criação/edição, marcar pago, excluir, atalhos |
| Visão geral | `Main` | KPIs, evolução do saldo, maiores categorias, contas e cartões |
| **Relatório por categoria** | `DesktopRelCategoria` | Drill-down categoria → subcategoria → lançamentos, comparação com outro período, gráfico + tabela |
| **Impacto do cartão** | `DesktopRelCartao` | Faturas por mês e cartão, extrato onde foram pagas, peso nas entradas |
| Ajustes | `DesktopAjustes` | Tema, perfil atual, exportar cópia do banco, local do arquivo, atalhos |

### Fora do escopo (próximas entregas)

- **Mobile inteiro** (React Native / Expo).
- **Sincronização e Dispositivos** (`DesktopDispositivos`): o indicador da barra lateral
  mostra só "Dados só neste aparelho".
- **Recorrências e parcelamento** (escopos "esta e as futuras"/"todas"): o formulário não
  tem "Repetir"; transações de recorrência só existem quando o serviço de recorrências
  existir.
- Tags, metas, sócios, anotações, anexos e os relatórios D5 (fluxo por conta), D7 (sócio)
  e D8 (tag).
- Importação do histórico do app atual.
- Instaladores de Windows e macOS (o MVP empacota para Linux).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Por quê |
|---|---|---|
| Bundler do Electron | **electron-vite** (main, preload, utility e renderer num só build) | O design pede Vite no renderer ([desktop-shell §4.1](desktop-shell-design.md#41-o-critério-o-que-o-mobile-também-usa)); o electron-vite resolve os quatro alvos com HMR, sem montar quatro configs à mão |
| Empacotamento | **electron-builder**, alvo AppImage/deb | É o caminho mais curto para Linux, onde o projeto é desenvolvido. O `better-sqlite3` 13 é N-API (com binários prontos no pacote), e o mesmo `.node` carrega no Node e no Electron: não há recompilação para o ABI do Electron (Fase 3.3) |
| Versão do Tailwind | **Tailwind v4**, com o "preset" como CSS gerado (`@theme`) | É a versão do shadcn/ui atual; o NativeWind 5 lê o mesmo CSS. Os tokens são dados, então uma saída em JS para o NativeWind 4 sai do mesmo gerador se o mobile precisar |
| Roteamento | **TanStack Router** com histórico em hash | Rotas e *search params* tipados (mês de referência, filtros, drill-down); hash porque o app é servido de `file://` |
| Dados na UI | **TanStack Query** dentro de `packages/client` | Já decidido ([desktop-shell §4.2](desktop-shell-design.md#42-o-que-é-compartilhado-é-a-camada-headless)) |
| Formulários | **react-hook-form** + os schemas Zod da camada Request do núcleo | Validação de conforto com a mesma regra do `utilityProcess` ([desktop-shell §5.4](desktop-shell-design.md#54-validação-na-fronteira)) |
| Gráficos | **Recharts**, pelo componente *Chart* do shadcn/ui | Fecha o pendente da [desktop-shell §6](desktop-shell-design.md#6-próximos-passos): o volume dos relatórios é de dezenas de pontos (SVG sobra), o *Chart* do shadcn lê as cores das variáveis CSS (tema claro/escuro sem código), e todo gráfico já vem acompanhado da tabela equivalente exigida |
| Onde ficam preferências do aparelho | Arquivo JSON em `userData` (tema, último perfil, último mês aberto) | São do **aparelho**, não do perfil: no banco, seriam replicadas pela sincronização |
| Filtros da tela de Transações | No `client` (view-model), sobre a lista do mês | Um mês tem centenas de linhas; filtrar no SQL só acrescentaria rotas sem ganho |
| Agregação dos relatórios | **No SQL**, num Repository de relatórios | Regra do projeto ([backend-design §3.2](backend-design.md#32-o-cálculo-não-é-pesado-o-risco-é-exatidão)) |

---

## 3. Regras de negócio dos relatórios

Os relatórios serão refinados depois do MVP; as regras abaixo valem para esta primeira
versão e precisam estar nos testes de mesa antes do código
([backend-design §5.5](backend-design.md#55-testes-de-mesa)). Estão registradas, com as
decisões tomadas na implementação, em [reports-design.md](reports-design.md).

### 3.1 Regra-mestra: o período é o do pagamento

Regra de negócio (Relatórios): **todo relatório agrupa pelo mês em que o dinheiro de fato
sai (ou entra) na conta** — o regime de caixa —, não pela data da compra.

| Situação | Mês em que conta |
|---|---|
| Transação de conta paga | Mês do `payment_date` |
| Compra no cartão | Mês do extrato em que a **fatura** foi paga (`invoices.bank_statement_id`), não o da compra nem o do `payment_date` da compra |
| Transação de conta em aberto | Mês do `due_date` — a data prevista do pagamento |
| Compra no cartão com fatura em aberto | Mês do **vencimento** da fatura |

O extrato segue a mesma regra: a transação de conta paga cai no extrato do mês do
`payment_date` (database-design §4.13). As duas últimas linhas são a projeção do
pagamento: é a mesma regra que o saldo previsto já usa (fatura em aberto entra no previsto do mês do vencimento — database-design §4.7),
para que o relatório e o extrato da conta nunca discordem sobre em que mês um valor pesa.
Pagar ou reabrir uma fatura move suas compras de mês no relatório, e isso é o esperado.

Consequência: o drill-down do relatório por categoria **não** reaproveita o
`transactions.listByPeriod`, que filtra por `due_date`; ele tem rota própria com o mesmo
critério do relatório.

### 3.2 Relatório por categoria

| # | Pergunta | Regra |
|---|---|---|
| R1 | Período | Regra-mestra da [§3.1](#31-regra-mestra-o-período-é-o-do-pagamento) |
| R2 | Quais tipos entram? | **Só despesas** no MVP. Estorno (valor negativo) abate a mesma subcategoria. Transferência e investimento ficam fora |
| R3 | Encargos entram? | **Sim**, pelo mesmo cálculo do efeito no saldo (`originEffect`: valor + encargos) — o relatório não reimplementa a regra de sinal |
| R4 | Contas com "considerar no saldo" desligado? | **Entram**: o valor já está na moeda do perfil e o gasto aconteceu |
| R5 | Comparações | Mês anterior; mesmo mês do ano anterior; **média simples dos 3 meses anteriores, contando mês sem lançamento como zero** |
| R6 | Variação % com base zero | Exibe "novo" em vez de % (divisão por zero não vira ∞ nem 0%) |

### 3.3 Impacto do cartão

| # | Pergunta | Regra |
|---|---|---|
| C1 | "Faturas de out" é qual fatura? | Pela regra-mestra: as faturas **pagas em out** mais as **em aberto que vencem em out** |
| C2 | Total de uma fatura | **Despesas líquidas de estornos, sem descontar pagamentos parciais**: o pagamento parcial é dinheiro que já saiu da conta, então ainda é peso do cartão |
| C3 | Peso nas entradas | Total das faturas do mês ÷ **receitas** do perfil no mesmo critério de período (transferências internas fora, porque somam zero no perfil) |
| C4 | Situação de cada célula | Paga (e o extrato onde foi paga), Em aberto (com vencimento) ou Futura |
| C5 | Janela | Mês de referência, os **3 anteriores** (para a média) e o **seguinte** (futura) |

---

## 4. Arquitetura da entrega

```
packages/core          + cadastros (perfil, conta, cartão, categoria) e relatórios
packages/sqlite-better (sem mudança)
packages/tokens        NOVO — cores claro/escuro, tipografia, preset do Tailwind
packages/client        NOVO — CoreClient, hooks (TanStack Query), view-models, formatadores
apps/desktop           NOVO — Electron: main, preload, utilityProcess do núcleo, renderer React
```

Fluxo de uma chamada: componente → hook do `client` → `CoreClient.call` →
`MessagePort` (preload) → `utilityProcess` → `core.dispatch` → Controller → Service →
Repository → SQLite. O processo principal só cria a janela, o `utilityProcess` e o
`MessageChannelMain` ([desktop-shell §5.2](desktop-shell-design.md#52-o-renderer-fala-direto-com-o-núcleo)).

Como a UI só enxerga `CoreClient`, cada tela pode ser desenvolvida e testada contra um
`DirectCoreClient` sobre SQLite em memória, sem abrir o Electron.

---

## 5. Decisões de produto

Nenhuma decisão de produto está aberta. Ficaram decididas:

| Decisão | Regra |
|---|---|
| Período dos relatórios | Mês do pagamento ([§3.1](#31-regra-mestra-o-período-é-o-do-pagamento)) |
| Itens do menu sem tela no MVP (Metas, Dispositivos, Fluxo por conta, Por sócio, Por tag) | Aparecem no menu normalmente e levam a uma **tela em branco**, já com a rota e o mês de referência; "Por sócio" continua só no perfil empresarial |
| Excluir conta ou cartão | Ver [§5.1](#51-desativar-e-excluir-conta-ou-cartão) |
| Trocar a moeda do perfil | Só enquanto o perfil não tem lançamentos: a moeda é a unidade de todo valor gravado e a troca não converte nada (database-design §4.1). Renomear continua livre |
| Limite usado do cartão | Valor a pagar somado de **todas** as faturas em aberto do cartão, futuras de parcelas incluídas; fatura credora conta zero |

Pendência técnica: o backup `VACUUM INTO` antes de migrar
([backend-design §4.6](backend-design.md#46-backup-antes-de-migrar)) precisa existir antes
do uso com dados reais (Fase 0).

### 5.1 Desativar e excluir conta ou cartão

Regra de negócio (Contas e Cartões): a ação padrão é **desativar**. Uma conta ou um cartão
desativado:

- some das escolhas de novos lançamentos (conta, cartão, conta de destino, conta pagadora);
- continua nos extratos, faturas, saldos e relatórios, porque o histórico não muda;
- aparece nas listas marcado como "desativada" e pode ser reativado.

Desativar não apaga nada e não muda nenhum saldo; por isso é o padrão.

**Excluir** é a ação explícita. Antes, o app mostra um alerta com **tudo o que será
apagado junto** — e só depois da confirmação exclui a cadeia inteira:

| Excluir | Apaga em cadeia |
|---|---|
| Conta | Seus extratos e transações; os cartões que ela paga, com as faturas e os lançamentos deles; as transferências e investimentos em que ela é a **conta de destino** |
| Cartão | Suas faturas e os lançamentos delas, incluindo os pagamentos parciais |

O alerta conta cada item e **nomeia as outras contas cujo saldo vai mudar** — uma
transferência apagada mexe também na conta do outro lado, e um pagamento de fatura apagado
devolve o valor à conta pagadora. Mesmo princípio do brief (§4, regra 9): nada de aviso
genérico.

A exclusão é **soft delete** (`deleted_at`) em toda a cadeia, numa única unidade de
trabalho, seguida do recálculo de todas as contas afetadas. É soft, e não `DELETE`, porque
a sincronização propaga exclusões por `deleted_at`
([database-design §3.6](database-design.md#36-colunas-presentes-em-todas-as-tabelas)).

O schema não tem como marcar "desativado": a Fase 1 inclui a migration `0002` com uma
coluna `disabled_at` em `accounts` e `credit_cards` (nula = ativo), registrada no
`database-design.md`.

---

## 6. Lista de tarefas

Ordem pensada para que cada fase entregue algo testável. As fases 1–2 (núcleo) e 3
(fundação do desktop) podem andar em paralelo. Todo item segue o padrão Elite do
`CLAUDE.md`: contratos explícitos, docblock com motivação e testes no mesmo commit.

### Fase 0 — Pendências do núcleo que o app real precisa

- [x] Backup com `VACUUM INTO` em `backups/pre-v{versão}-{data}-{hora}.sqlite` antes de migrar, mantendo os 3 mais recentes — porta `BackupDirectory` (adaptador Node: `NodeBackupDirectory` no `sqlite-better`), obrigatória em `openDatabase`
- [x] `db/migrations/checksums.lock` (gravado pelo `pnpm embed:migrations`, que recusa migration travada editada) e o teste de imutabilidade das migrations
- [x] Verificação de integridade mínima na abertura (saldo em cache × recálculo): rota `integrity.verifyBalances`, que recalcula numa unidade de trabalho desfeita e devolve os desvios sem corrigi-los; o shell registra o resultado no log (Fase 3.3)
- [x] CI (GitHub Actions) rodando `pnpm check` com `TZ=UTC` e `TZ=America/Sao_Paulo`

### Fase 1 — Núcleo: cadastros

**1.1 Perfis**
- [x] `Profile.create` / `rename` / troca de moeda no domínio, com invariantes (nome ≤ 45, moeda ISO maiúscula)
- [x] `ProfileRepository`: `list`, `save`
- [x] `ProfileService` + `ProfileController` + requests — troca de moeda só sem lançamentos ([§5](#5-decisões-de-produto))
- [x] Rotas `profiles.list`, `profiles.create`, `profiles.update`
- [x] Rota `onboarding.start` (perfil + primeira conta na mesma unidade de trabalho — o primeiro uso não pode deixar perfil sem conta)
- [x] Testes de Service (SQLite em memória)

**1.2 Contas**
- [x] `Account.create` / `revise` no domínio (nome, tipo, moeda, `consider_balance`, `opening_balance`)
- [x] `AccountRepository.save` (dados do usuário, separado do `saveBalances` que já existe)
- [x] Migration `0002`: `disabled_at` em `accounts` e `credit_cards` ([§5.1](#51-desativar-e-excluir-conta-ou-cartão)), com `pnpm embed:migrations` e registro no `database-design.md`
- [x] `AccountService`: criar, editar, desativar, reativar e excluir em cadeia ([§5.1](#51-desativar-e-excluir-conta-ou-cartão)) — a exclusão em cadeia ficou no `CascadeDeletionService`, compartilhado com cartões
- [x] Editar `opening_balance` recalcula a cadeia inteira da conta (`BalanceRecalculationService`)
- [x] Conta desativada recusada como origem, destino ou conta pagadora em **novos** lançamentos e cartões (editar lançamento antigo continua permitido)
- [x] Rota `accounts.deletionImpact`: contagem de extratos, transações, cartões, faturas e transferências, e a lista das **outras** contas cujo saldo muda
- [x] Exclusão em cadeia: soft delete de tudo numa unidade de trabalho + recálculo de todas as contas afetadas — alerta e exclusão partem do mesmo `DeletionScope` (`DeletionRepository`), e o teste confere que o apagado é exatamente o contado
- [x] Rotas `accounts.list` (com consolidado e previsto do mês pedido e a flag de desativada), `accounts.create`, `accounts.update`, `accounts.disable`, `accounts.enable`, `accounts.delete`
- [x] Testes de mesa: saldo inicial editado depois de meses lançados; conta fora do total; conta desativada mantém saldos; excluir conta com transferência para outra conta e com cartão cuja fatura foi paga por ela — os saldos da outra conta voltam

**1.3 Cartões de crédito**
- [x] `CreditCard.create` / `revise` (limite, fechamento e vencimento 1–31, conta pagadora do mesmo perfil)
- [x] `CreditCardRepository`: `listByProfile`, `save`
- [x] Mudar o dia de fechamento **não** move lançamentos existentes (`invoice_id` gravado é a verdade — database-design §4.7)
- [x] Cartão desativado recusado em novos lançamentos; faturas e relatórios continuam
- [x] Rota `creditCards.deletionImpact` e exclusão em cadeia (faturas, lançamentos, pagamentos parciais) com recálculo da conta pagadora
- [x] Rotas `creditCards.list` (com a fatura do mês: total, situação, vencimento, limite usado), `creditCards.create`, `creditCards.update`, `creditCards.disable`, `creditCards.enable`, `creditCards.delete`
- [x] Rota `invoices.listByCard` (fatura do mês e as próximas, para "Próximas faturas")
- [x] ~~Rota `invoices.payPartial`~~ — `transactions.create` já cobre: transferência na fatura, `destinationAccountId` da conta que pagou, valor negativo e paga (database-design §4.7); confirmado por teste em `creditCards.test.ts`

**1.4 Categorias e subcategorias**
- [x] Domínio `Category` / `SubCategory` com nome ≤ 45
- [x] `CategoryRepository` (substitui o trecho de subcategoria do `ReferenceRepository`)
- [x] Unicidade sem diferenciar maiúsculas vira erro de domínio legível, não `SQLITE_CONSTRAINT`
- [x] Excluir subcategoria em uso exige `moveTo` (mockup: "pede para mover os lançamentos antes"); mover recalcula nada (categoria não afeta saldo), mas é uma unidade de trabalho
- [x] Rotas `categories.tree` (com contagem de lançamentos por subcategoria), `categories.create/update/delete`, `subCategories.create/update/delete`
- [x] Categorias iniciais sugeridas no primeiro uso (lista do mockup; `onboarding.start` cria por padrão, `suggestedCategories: false` dispensa)

**1.5 Transações — complementos para a tela**
- [x] Rota `transactions.setPaid` (atalho `P`: marca/desmarca pago com a data de hoje do `Clock`)
- [x] Exportar os schemas da camada Request por um subcaminho (`@finance/core/requests`) para os formulários
- [x] Revisar `ErrorCode`: `CONFLICT` incluído (`NameConflictError`, com `details.field = 'name'`) — a UI aponta o campo do nome em vez de mostrar uma violação genérica

### Fase 2 — Núcleo: relatórios

**2.1 Fundação**
- [x] Registrar as regras da [§3](#3-regras-de-negócio-dos-relatórios) num documento de design — [reports-design.md](reports-design.md)
- [x] Expressão SQL única do **mês de pagamento** ([§3.1](#31-regra-mestra-o-período-é-o-do-pagamento)) em `periodSql.ts`, usada por todos os relatórios — um só lugar para refinar depois (`REPORT_SOURCES_CTE`, com teste de equivalência do vencimento contra o `BillingCycle`)
- [x] `ReportRepository` (SQL de agregação, só leitura) e `ReportService`, `ReportController`, DTOs em `dto/reports/`
- [x] Builders de cenário para relatórios no `TestWorld`

**2.2 Visão geral**
- [x] Rota `reports.monthSummary`: receitas, despesas (pelo mês de pagamento), variação vs mês anterior, faturas em aberto
- [x] Rota `reports.balanceEvolution`: consolidado e previsto do perfil nos N meses até o de referência (lê os extratos já calculados, não recalcula)

**2.3 Relatório por categoria**
- [x] Rota `reports.byCategory` (perfil, período, modo de comparação): árvore categoria → subcategoria com valor do período, valor de comparação, variação absoluta e %, e total
- [x] Rota `reports.categoryTransactions` (subcategoria ou categoria + período) para a lista do drill-down, com o critério da [§3.1](#31-regra-mestra-o-período-é-o-do-pagamento) — não o `due_date` do `listByPeriod`
- [x] Testes de mesa: compra de set em fatura paga em out conta em out; a mesma fatura reaberta passa para o mês do vencimento; transação de conta paga em mês diferente do vencimento; em aberto pelo `due_date`; estorno abatendo a subcategoria (R2); transferência fora; encargos (R3); virada de ano nas três comparações; mês sem lançamento na média (R5); base zero (R6); transação excluída e conta excluída fora; conta desativada dentro
- [x] Propriedade: soma das despesas da árvore no mês = efeito das despesas no saldo previsto das contas naquele mês — vale para qualquer data de pagamento, porque o extrato também segue o `payment_date` (database-design §4.13)

**2.4 Impacto do cartão**
- [x] Rota `reports.cardImpact` (perfil, período): linhas por mês (3 anteriores, referência, seguinte) × cartão, com total, situação, extrato de pagamento; total do mês; receitas; peso; KPIs (faturas do mês, peso, média dos 3 anteriores)
- [x] Testes de mesa: fatura de set paga em out conta em out (C1); fatura em aberto pelo vencimento; pagamento parcial (C2); reabertura muda o mês; cartão sem fatura no mês; cartão desativado continua; mês sem receita (peso indefinido, não 0% nem ∞)

### Fase 3 — Fundação do desktop

**3.1 `packages/tokens`**
- [x] Tokens do README dos mockups como dados (claro e escuro), IBM Plex Sans, escala de espaçamento — mais `dot` (já nas variáveis dos mockups) e `scrim`, o véu de diálogos e painéis, que os mockups não desenham. Tamanho de fonte e raio têm escala fechada nomeada pelo px do mockup (`text-13`, `rounded-8`); espaçamento usa a unidade de 4px do Tailwind
- [x] Gerador do CSS de variáveis (`:root` e `.dark`) e preset do Tailwind — no Tailwind v4 o preset é o bloco `@theme` do mesmo CSS (`theme.generated.css`, versionado e regenerado por `pnpm tokens:css`); as escalas padrão do Tailwind são zeradas, então classe fora dos tokens não gera estilo
- [x] Teste: todo token tem valor nos dois temas, e o CSS versionado está em dia com os dados

**3.2 `packages/client`**
- [x] `CoreClient` (interface) e `DirectCoreClient` (para testes e, depois, mobile)
- [x] Erro tipado: `CoreCallError` com tratamento exaustivo por `ErrorCode` e mensagens pt-BR — as regras de `BUSINESS_RULE_VIOLATION` viraram a união fechada `BusinessRule` no núcleo, com mensagem por regra num `Record` exaustivo
- [x] Chaves de query e **mapa de invalidação** — invalida por rota, não pelo mês (a escrita de um mês muda a cadeia de saldos dos meses seguintes e as comparações dos relatórios); o teste executa cada rota de escrita contra o núcleo real e confere que toda leitura que mudou está no mapa
- [x] Hooks por rota (`useAccounts`, `useInvoice`, `useCategoryReport`...) para as leituras; as escritas usam `useCoreMutation(rota)`, que aplica o mapa
- [x] Formatadores sem `Intl`: `R$ 1.234,56`, `−R$`, valor em módulo para fatura, datas `01/10`, `out/2026`, `Outubro de 2026`, percentual e variação (`▲ +R$ 162,40`, `novo`) — com testes de ouro
- [x] Parser de valor digitado em pt-BR (`1.234,56`) com a mesma regra de arredondamento do `Money`
- [x] View-models: tabela de transações (join com nomes de conta, cartão e categoria, filtros, resultado do filtro), árvore do relatório por categoria, grade do impacto do cartão
- [x] Lint de fronteira: `client` não importa `react-dom`, `react-native`, `electron` nem Node, e não usa `Intl`

**3.3 `apps/desktop` — esqueleto**
- [x] electron-vite com alvos main, preload, utility e renderer; TypeScript estrito igual ao do núcleo
- [x] Janela com `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP `default-src 'self'`, navegação externa e novas janelas bloqueadas ([desktop-shell §3.6](desktop-shell-design.md#36-segurança-do-renderer))
- [x] `utilityProcess`: abre `userData/finance.sqlite` com `better-sqlite3`, roda `openDatabase` com `NodeBackupDirectory(userData/backups)`, monta `createCore` com `Clock`/`IdGenerator` reais, roda `integrity.verifyBalances` e registra no log (`userData/logs/core.log`) os desvios e os erros inesperados
- [x] `MessageChannelMain` entre renderer e `utilityProcess`; `IpcCoreClient` com correlação de requisição/resposta
- [x] Preload expõe **só** o `CoreClient`, as preferências do aparelho e o estado da abertura (com "restaurar backup", a única ação que as telas de bloqueio pedem) via `contextBridge`
- [x] Telas de bloqueio: banco mais novo que o app; falha de migration com "restaurar backup" (o banco que falhou vai para `backups/falha-*.sqlite` e o app pede para usar a versão anterior); falha do backup; arquivo que não abre
- [x] ~~Recompilação do `better-sqlite3` para o Electron em `postinstall`~~ — desnecessária: o `better-sqlite3` 13 é N-API 10 e traz os binários no pacote; o teste de fumaça prova que o mesmo `.node` abre o banco no `utilityProcess`. Recompilar no lugar ainda quebraria os testes do núcleo, que usam a mesma cópia no Node
- [x] Renderer: React 19, TanStack Router (hash), TanStack Query, Tailwind com o preset de `tokens`, shadcn/ui inicializado (Button, Input, Select, Dialog, Sheet, Popover, DropdownMenu, ContextMenu, Table, Tabs, Tooltip, Sonner, Chart) — classes traduzidas para os tokens, `Chart` reescrito com cor de série restrita a token e sem `Intl`
- [x] Scripts `pnpm dev:desktop`, `pnpm build:desktop`; `pnpm check` cobrindo lint e tipos do app
- [x] Teste de fumaça com Playwright (`_electron`): abre, cria perfil, lança uma despesa, vê no extrato — enquanto as telas das Fases 7 e 9 não existem, pela mesma ponte que elas vão usar (o perfil, desde a Fase 5, pela tela de primeiro uso); também confere o isolamento do renderer, a CSP e a tela de bloqueio. No devcontainer e no CI roda com `FINANCE_ELECTRON_NO_SANDBOX=1`, porque o container bloqueia os namespaces de usuário do sandbox de processo do Chromium
- [x] Medir memória e tempo de abertura ([desktop-shell §6.4](desktop-shell-design.md#6-próximos-passos)) e registrar o número — `pnpm --filter @finance/desktop measure`; resultado em [desktop-shell §6](desktop-shell-design.md#6-próximos-passos)

### Fase 4 — Shell e navegação

- [x] Layout: barra lateral (marca, seletor de perfil, menu, rodapé "Dados só neste aparelho"), barra superior fixa — só a área de conteúdo rola
- [x] Menu completo do mockup, com subitens de Relatórios (Por categoria, Fluxo por conta, Impacto do cartão, Por sócio só no perfil empresarial, Por tag) — os subitens se abrem com a seção ativa, como nos mockups; o mapa do menu (`shell/navigation.ts`) é o mesmo tipo (`AppPath`) dos caminhos do roteador
- [x] Rotas de Metas, Dispositivos, Fluxo por conta, Por sócio e Por tag levando a uma **tela em branco** dentro do shell ([§5](#5-decisões-de-produto)), para que a navegação já esteja pronta quando as telas chegarem — as telas do MVP ainda não feitas também têm rota com tela em branco, substituída na fase de cada uma; "Por sócio" aberto num perfil pessoal explica que só existe no empresarial
- [x] Mês de referência global (‹ mês ›, "Voltar ao mês atual") como *search param* tipado (`period`), preservado ao navegar (`retainSearchParams`); sem ele na URL, abre o último mês do aparelho (`lastPeriod`) ou o corrente. **Decisão:** escondido em Cadastros, Dispositivos e Ajustes — os mockups dessas telas desenham a barra, mas a regra do README dos mockups ("não aparece em fluxos de configuração") prevaleceu; Metas mantém a barra
- [x] Tema claro/escuro/seguir o sistema, persistido nas preferências do aparelho. **Decisão:** o botão do mockup (que só alterna claro/escuro) virou um menu com as três opções, com o tema escolhido no rótulo
- [x] Seletor de perfil (troca o perfil ativo, grava `lastProfileId`, invalida todas as queries); sem perfil no banco, o shell não abre e uma tela provisória ocupa a janela até o primeiro uso (Fase 5)
- [x] "+ Lançamento" global (atalho `N`) abrindo o painel de transação — o painel (`Sheet`) já é do shell; o formulário entra na Fase 9
- [x] Atalhos globais: `[` `]` mês anterior/seguinte, `N` novo lançamento — não disparam em campo de texto, com modificador, com tecla segurada nem dentro de menu ou diálogo; `[` `]` não valem nas telas sem mês
- [ ] `Ctrl K` busca — **pendente:** não há mockup do que a busca abre (paleta de navegação, busca de lançamentos ou foco no filtro de Transações); decidir antes de implementar
- [x] Estados genéricos: carregando (esqueleto), erro com código (mensagem do `describeError` e "Tentar de novo"), vazio — e `QueryState`, que escolhe entre eles para uma consulta
- [x] O app respeita `prefers-reduced-motion` (sem animações); os testes de ponta a ponta emulam movimento reduzido porque, na janela fora da tela do container, a animação de saída de menus e painéis nunca termina
- [x] Testes: unitários do menu, do mês de referência, dos atalhos e da escolha do perfil ativo; ponta a ponta (`e2e/shell.spec.ts`) da navegação com o mês preservado, dos atalhos, da troca de perfil, do tema e da reabertura

### Fase 5 — Primeiro uso

- [x] Detecta banco sem perfil e abre `DesktopPrimeiroUso` fora do shell — é o `whenEmpty` do `ActiveProfileProvider`, e não uma rota: o roteador só é criado com um perfil ativo, e a tela provisória da Fase 4 saiu
- [x] Formulário perfil (nome, tipo, moeda) + primeira conta (nome, tipo, saldo inicial) → `onboarding.start` — react-hook-form com um *resolver* que valida pelo `startOnboardingRequest` do núcleo (`firstUse/onboardingForm.ts`) e traduz os problemas do Zod para pt-BR por campo; saldo em branco é zero; a conta nasce na moeda do perfil (a moeda própria fica para Cadastros). Moedas oferecidas: as do mockup, BRL e USD. `formatAccountType` entrou no `client`
- [x] "Entrar num grupo existente" visível e desabilitado, com a explicação ligada ao botão por `aria-describedby`; o resto do cartão segue o mockup
- [x] Ao concluir, entra na Visão geral do mês atual — antes de invalidar os perfis (é a invalidação que monta o shell), grava o perfil criado como o aberto, zera o último mês do aparelho e leva a URL a `#/`, para que rota e mês guardados de um banco anterior não valham. O menu de tema saiu da barra superior para `ThemeMenu.tsx`, porque a tela tem o mesmo botão no topo
- [x] Testes: unitários do formulário (`test/firstUse.test.ts`) e ponta a ponta (`e2e/firstUse.spec.ts`: tela fora do shell, erros por campo sem chamar o núcleo, conclusão com rota e mês antigos no aparelho, reabertura); o teste de fumaça passou a criar o perfil pela tela

### Fase 6 — Cadastros

- [ ] Página `DesktopCadastros` com lista lateral de tipos e contadores (Contas, Cartões, Categorias, Perfis)
- [ ] Contas: lista (desativadas marcadas), criar/editar em diálogo (nome, tipo, saldo inicial, moeda, considerar no total), desativar/reativar
- [ ] Excluir conta: alerta com o resultado de `accounts.deletionImpact` (o que será apagado e quais outras contas mudam de saldo) e confirmação forte antes de excluir
- [ ] Cartões: lista, criar/editar (nome, conta pagadora só entre as ativas, limite, fechamento, vencimento; aviso de fechamento em dia 29–31), desativar/reativar
- [ ] Excluir cartão: mesmo alerta, com `creditCards.deletionImpact`
- [ ] Categorias: árvore com subcategorias e contagem de lançamentos, criar/renomear/excluir, "+ Subcategoria"; excluir subcategoria em uso abre o diálogo de mover
- [ ] Perfis: lista, criar, renomear; tipo empresarial sem sócios no MVP (aviso)
- [ ] Mensagens de validação vindas do schema compartilhado e do `CoreError`

### Fase 7 — Contas (extrato)

- [ ] Lista de contas com consolidado e previsto do mês; conta fora do total marcada e fora da soma; conta desativada marcada; totais consolidado e previsto
- [ ] Detalhe: cabeçalho (tipo, se entra no total), "Editar conta"
- [ ] Quatro números do extrato: saldo inicial e final, consolidado e previsto; entradas e saídas
- [ ] Tabela de movimentos: transações, transferências recebidas, faturas pagas/em aberto ("ver fatura" navega para o cartão)
- [ ] Nota da fatura em aberto no previsto; mês sem movimento (inicial = final)

### Fase 8 — Cartões (fatura)

- [ ] Lista de cartões com fatura do mês, situação e totais
- [ ] Detalhe da fatura: total a pagar (em módulo), situação, fechamento, vencimento, limite usado, lançamentos
- [ ] Pagar fatura (conta pagadora sugerida, data) → fatura "Paga em dd/mm", extrato do mês do pagamento atualizado
- [ ] Pagamento parcial (diálogo de valor → transferência negativa na fatura)
- [ ] Reabrir fatura com confirmação explicando que o saldo da conta volta
- [ ] Próximas faturas do cartão

### Fase 9 — Transações

- [ ] Tabela densa (TanStack Table + Table do shadcn): data, nome, categoria › sub, conta/fatura, valor, situação; números tabulares à direita
- [ ] Entrada/saída sem depender de cor: sinal, `⇄` em transferência, rótulo de estorno
- [ ] Ordenação por coluna; filtros conta/cartão, categoria, situação e busca; linha-resumo "N lançamentos · resultado"
- [ ] Painel lateral de criação/edição: tipo, valor (com inversão de sinal), nome, descrição, data, pago + data de pagamento, encargos, conta **ou** cartão (só ativos em lançamento novo), conta de destino (transferência/investimento), subcategoria com busca
- [ ] Despesa no cartão: fatura sugerida (`invoices.suggest`) com troca para outra fatura do cartão; aviso quando a escolhida está paga (será reaberta)
- [ ] Excluir com confirmação; editar mês passado avisa que os meses seguintes serão recalculados
- [ ] Teclado: `↑↓` navegar, `Enter` editar, `P` marcar pago, `Del` excluir; menu de contexto com as mesmas ações
- [ ] Atualização otimista ou invalidação pelo mapa da Fase 3.2 — saldos da barra e relatórios refletem a escrita sem recarregar

### Fase 10 — Visão geral

- [ ] KPIs: consolidado, previsto, receitas, despesas (com variação), faturas em aberto
- [ ] Evolução do saldo (6 meses, consolidado × previsto) com alternância Gráfico/Tabela
- [ ] Maiores categorias do mês (de `reports.byCategory`) com link para o relatório
- [ ] Resumo de contas e de cartões com navegação para os detalhes

### Fase 11 — Relatório por categoria

- [ ] Seletor de comparação (mês anterior, mesmo mês do ano anterior, média dos 3 meses)
- [ ] Trilha de navegação (Todas › Categoria › Subcategoria)
- [ ] Tabela expansível categoria → subcategoria com período, comparação, variação (▲▼= e sinal, não só cor) e %; total de despesas
- [ ] Gráfico de barras agrupadas (período × comparação) da categoria aberta, com tooltip, clique para descer um nível e alternância para tabela equivalente
- [ ] Lista de lançamentos da subcategoria selecionada, com "Abrir em Transações →" levando os filtros
- [ ] Estados: mês sem despesas; categoria sem lançamentos no período mas com na comparação

### Fase 12 — Impacto do cartão

- [ ] KPIs: faturas do mês (cartões, quantas em aberto), peso nas entradas, média dos 3 meses anteriores
- [ ] Grade mês × cartão com valor, situação ("paga no extrato de jul", "Em aberto · vence 10/10", "Futura"), total e peso
- [ ] Decidir com o mockup duas diferenças achadas no view-model da Fase 3.2: o mockup mostra "Paga em 07/10" (data) no mês de referência, e o `reports.cardImpact` só traz o mês do extrato; e distingue "Aberta" (ciclo recebendo compras) de "Futura", que o núcleo junta em `future` (reports-design §4)
- [ ] Linha do mês de referência destacada; links de cada célula para a fatura
- [ ] Nota explicando que a fatura em aberto pesa no previsto no vencimento e, paga, no extrato do pagamento
- [ ] Estados: perfil sem cartão; mês sem receitas (peso "—")

### Fase 13 — Ajustes

- [ ] Tema (seguir o sistema, claro, escuro)
- [ ] Perfil atual: nome, tipo, moeda
- [ ] Exportar cópia do banco (`VACUUM INTO` no `utilityProcess`, diálogo de salvar do main), registrando a data da última cópia
- [ ] Local do arquivo SQLite (só leitura, com "mostrar na pasta")
- [ ] Lista de atalhos de teclado
- [ ] Versão do app e do schema

### Fase 14 — Empacotamento e validação

- [ ] electron-builder: AppImage e deb, ícone, nome, versão a partir do `package.json`; `better-sqlite3` fora do `asar` (`asarUnpack`), porque o `.node` não carrega de dentro do arquivo
- [ ] Build empacotado abre um banco existente, migra com backup e funciona sem a árvore do repositório
- [ ] Rodada de uso real: lançar um mês verdadeiro e conferir os dois relatórios contra o extrato do banco e a fatura do cartão
- [ ] `change-validator` sobre a entrega e atualização do README (Status) e do `desktop-shell-design.md` (próximos passos)

---

## 7. Critério de pronto do MVP

- Do primeiro uso ao relatório, tudo sem tocar no banco à mão.
- Os dois relatórios conferem, centavo a centavo, com um mês real conferido à mão.
- Tema claro e escuro em todas as telas; nenhuma cor literal fora de `packages/tokens`.
- `pnpm check` verde, com os testes de mesa dos relatórios e o teste de fumaça do Electron.
- Renderer sem acesso a Node: o preload expõe só o `CoreClient`, as preferências e o estado da abertura.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Recompilar `better-sqlite3` para o Electron quebrar no CI ou no empacotamento | Resolvido na Fase 3.3: o binário N-API do pacote carrega no Electron sem recompilar, e o teste de fumaça cobre. Resta tirar o `.node` do `asar` no empacotamento (Fase 14) |
| Regra de período mudar no refinamento dos relatórios | O mês de pagamento é uma expressão SQL única (Fase 2.1); os testes de mesa documentam a regra atual |
| Exclusão em cadeia apagar mais (ou menos) do que o alerta mostrou | `deletionImpact` e a exclusão usam as mesmas consultas; teste confere que o que foi apagado é exatamente o que foi contado |
| Invalidação incompleta deixar saldo velho na tela | Mapa de invalidação centralizado e testado (Fase 3.2), não `invalidateQueries` espalhado |
| Escopo crescer com recorrências e tags | Ficam explicitamente fora ([§1](#1-objetivo-e-escopo)); o formulário não mostra "Repetir" |
