# Plano do MVP Desktop — CRUD e primeiros relatórios

**Status:** Em andamento — Fases 0 a 13.5 concluídas (ficaram pendentes só o `Ctrl K` da Fase 4, a pendência da Fase 9.2 que depende da sincronização, o XLSX da Fase 13.1 e a decisão da Fase 11.1 sobre a data dos lançamentos de conta em Transações). Primeira entrega com tela do projeto: o app desktop
(Electron) com os cadastros e lançamentos básicos e os dois primeiros relatórios
personalizados, que são a motivação original do projeto ([README](../../README.md#motivação)).
O mobile fica inteiro para depois.
**Relacionado:** [desktop-shell-design.md](desktop-shell-design.md) — shell, UI, `client` e
fronteira IPC que este plano implementa; [backend-design.md](backend-design.md) — o núcleo
que ganha os cadastros e os relatórios; [database-design.md](database-design.md) — as
regras de negócio de contas, faturas e transações;
[mockups](../design/mockups/README.md) — as telas aprovadas;
[reports-design.md](reports-design.md) — as regras dos relatórios como implementadas;
[import-design.md](import-design.md) — as regras da importação de transações (Fase 13.1).

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
| Cadastros | `DesktopCadastros`, `DesktopTags`, `DesktopAnotacoes`, `DesktopSocios` | Perfis, contas, cartões, categorias e subcategorias, tags, anotações e, no perfil empresarial, sócios (Fase 13.7) |
| Contas | `DesktopContas` | Lista com consolidado e previsto → extrato do mês |
| Cartões | `DesktopCartoes` | Lista com fatura do mês → detalhe da fatura, pagar, pagamento parcial, reabrir, próximas faturas |
| Transações | `DesktopTransacoes` | Tabela do mês, filtros, diálogo de criação/edição, marcar pago, excluir, atalhos |
| Recorrências (Fase 9.1) | `DesktopTransacoes`, adaptando `MobileParcelar` e `MobileEscopo` | Parcelado e fixo, com os escopos "somente esta", "esta e as futuras" e "todas" |
| Metas (Fase 9.3) | `DesktopMetas` | Lista com progresso → detalhe com quanto falta, data-alvo, ritmo necessário e transações vinculadas; campo "Meta" no lançamento |
| Visão geral | `Main` | KPIs, evolução do saldo, maiores categorias, contas e cartões |
| **Relatório por categoria** | `DesktopRelCategoria` | Drill-down categoria → subcategoria → lançamentos, comparação com outro período, gráfico + tabela |
| **Impacto do cartão** | `DesktopRelCartao` | Faturas por mês e cartão, extrato onde foram pagas, peso nas entradas |
| Fluxo por conta (Fase 12.1) | `DesktopRelFluxo` | Extratos encadeados de uma conta, ou das contas do total somadas, nos 3 meses antes e 1 depois do de referência |
| Por tag (Fase 12.2) | `DesktopRelTag` | Total líquido por tag no mês ou em todo o período, divisão por categoria e lançamentos da tag |
| Por sócio (Fases 13.6 e 13.8) | `DesktopRelSocio` | Só em perfil empresarial: aportou × deveria pela participação no total de aportes, acerto e entradas do mês sem sócio, atribuíveis na própria tela |
| Ajustes | `DesktopAjustes` | Tema, exportar e importar (Fase 13.9) a cópia do banco, local do arquivo, atalhos, versões |

### Fora do escopo (próximas entregas)

- **Mobile inteiro** (React Native / Expo).
- **Sincronização e Dispositivos** (`DesktopDispositivos`): o indicador da barra lateral
  mostra só "Dados só neste aparelho".
- Anexos. Tags e anotações entraram em Cadastros (Fase 6), Metas, na Fase 9.3, os relatórios
  D5 (fluxo por conta) e D8 (tag), nas Fases 12.1 e 12.2, o D7 (sócio), na Fase 13.6, e o
  cadastro de sócios, na Fase 13.7.
- ~~Importação do histórico do app atual~~ — entrou na Fase 13.1, a pedido.
- Instalador de macOS (o MVP empacota para Linux e, a pedido, para Windows — Fase 14).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Por quê |
|---|---|---|
| Bundler do Electron | **electron-vite** (main, preload, utility e renderer num só build) | O design pede Vite no renderer ([desktop-shell §4.1](desktop-shell-design.md#41-o-critério-o-que-o-mobile-também-usa)); o electron-vite resolve os quatro alvos com HMR, sem montar quatro configs à mão |
| Empacotamento | **electron-builder**, alvos deb (Ubuntu) e NSIS (Windows) | É o caminho mais curto para Linux, onde o projeto é desenvolvido. O `better-sqlite3` 13 é N-API (com binários prontos no pacote, inclusive o do Windows), e o mesmo `.node` carrega no Node e no Electron: não há recompilação para o ABI do Electron (Fase 3.3), e o `.exe` sai do Linux — com o Wine, que o NSIS usa para montar o desinstalador |
| Versão do Tailwind | **Tailwind v4**, com o "preset" como CSS gerado (`@theme`) | É a versão do shadcn/ui atual; o NativeWind 5 lê o mesmo CSS. Os tokens são dados, então uma saída em JS para o NativeWind 4 sai do mesmo gerador se o mobile precisar |
| Roteamento | **TanStack Router** com histórico em hash | Rotas e *search params* tipados (mês de referência, filtros, drill-down); hash porque o app é servido de `file://` |
| Dados na UI | **TanStack Query** dentro de `packages/client` | Já decidido ([desktop-shell §4.2](desktop-shell-design.md#42-o-que-é-compartilhado-é-a-camada-headless)) |
| Formulários | **react-hook-form** + os schemas Zod da camada Request do núcleo | Validação de conforto com a mesma regra do `utilityProcess` ([desktop-shell §5.4](desktop-shell-design.md#54-validação-na-fronteira)) |
| Gráficos | **Recharts**, pelo componente *Chart* do shadcn/ui | Fecha o pendente da [desktop-shell §6](desktop-shell-design.md#6-próximos-passos): o volume dos relatórios é de dezenas de pontos (SVG sobra), o *Chart* do shadcn lê as cores das variáveis CSS (tema claro/escuro sem código), e todo gráfico já vem acompanhado da tabela equivalente exigida |
| Onde ficam preferências do aparelho | Arquivo JSON em `userData` (tema, último perfil, último mês aberto e, desde a Fase 13, a data da última cópia exportada) | São do **aparelho**, não do perfil: no banco, seriam replicadas pela sincronização |
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
| C4 | Situação de cada célula | Paga (e o extrato onde foi paga), Em aberto (com vencimento), Aberta (recebendo compras) ou Futura |
| C5 | Janela | Mês de referência, os **3 anteriores** (para a média) e o **seguinte** (futura) |

### 3.4 Fluxo por conta

Decididas antes da Fase 12.1, que trouxe o relatório para dentro do MVP.

| # | Pergunta | Regra |
|---|---|---|
| F1 | Janela | A mesma da C5: os **3 meses anteriores**, o de referência e o **seguinte** |
| F2 | De onde vêm os números? | Do **extrato** de cada conta (o mesmo de Contas): inicial + entradas + saídas + faturas = final, no consolidado e no previsto. O relatório não tem consulta própria de saldo, então nunca discorda da tela Contas |
| F3 | O que é "Faturas"? | As faturas pagas no extrato, as em aberto que vencem no mês (só no previsto) e os pagamentos parciais de fatura que saem da conta. Entradas e saídas são os outros movimentos, pelo sinal do efeito — a mesma regra do extrato |
| F4 | "Todas as contas do total" | **Soma simples dos extratos** das contas com "considerar no saldo" ligado, desativadas incluídas. Transferência entre duas delas aparece em entradas e em saídas; os saldos não mudam |
| F5 | Consolidado × previsto nas linhas | As linhas de movimento mostram o previsto (tudo que pesa no mês) e, quando parte ainda não aconteceu, quanto está em aberto. O saldo inicial mostra o consolidado, com o previsto quando difere. Nos meses depois do mês corrente o consolidado final é "—": ainda não há o que consolidar |
| F6 | Conta fora do total | Pode ser escolhida e mostra o próprio extrato; aparece apagada, com "fora do total", e não entra na soma |

### 3.5 Por tag

Decididas antes da Fase 12.2, que trouxe o relatório para dentro do MVP.

| # | Pergunta | Regra |
|---|---|---|
| T1 | Período | Regra-mestra da [§3.1](#31-regra-mestra-o-período-é-o-do-pagamento). "Só o mês de referência" ou **"Todo o período"**, que inclui o futuro — parcelas e lançamentos em aberto, cada um no mês em que vai pesar: o custo total de uma tag como "viagem" inclui as parcelas que ainda vão vencer |
| T2 | Quais tipos entram? | **Despesas menos receitas** — o "total líquido" da tag: o reembolso marcado com "reembolsável" abate o gasto. Estorno abate (R2); encargos pelo efeito no saldo (R3); transferência e investimento ficam fora, inclusive a transferência entre perfis |
| T3 | Lista de tags | Só as com ao menos um lançamento no período, pelo total líquido (maior primeiro, desempate pelo nome), com o número de lançamentos e de categorias |
| T4 | Por categoria | Total líquido de cada categoria da tag. A participação é sobre a soma das categorias com gasto líquido; a categoria em que as receitas superam as despesas mostra o valor como entrada (+) e não tem participação |
| T5 | Lançamentos | Os da tag no período, com a mesma fonte e o mesmo critério do total: a lista soma o total líquido. Contas e cartões desativados entram |

### 3.6 Por sócio

Decididas antes da Fase 13.6, que trouxe o relatório para dentro do MVP, e revistas na Fase 13.8,
que trocou as despesas pelos aportes. Só em perfil empresarial. Regras completas em
[reports-design.md §8](reports-design.md#8-por-sócio-reportsbypartner-reportsentrieswithoutpartner).

| # | Pergunta | Regra |
|---|---|---|
| P1 | Período | Os aportes de **todos os períodos**; o mês de referência só recorta os indicadores do mês e a lista de entradas sem sócio |
| P2 | O que entra? | **Aportes**: receitas do perfil e transferências que chegam de outro perfil, com sócio. Toda despesa é paga pela empresa e fica fora |
| P3 | "Deveria ter aportado" | Total de aportes com sócio × participação. Entradas sem sócio (receita de serviço) ficam fora da divisão. A sobra de centavo vai para os maiores restos |
| P4 | Acerto ("Para equilibrar os aportes") | Quem aportou a menos transfere para quem aportou a mais, o maior devedor primeiro para o maior credor. Sem acerto quando as participações não somam 100% — a tela avisa |
| P5 | Entradas sem sócio | As do mês sem sócio vivo, pelo mesmo critério das somas: a lista soma o indicador. "Quem aportou" grava só aquele lançamento |

---|---|---|
| P1 | Período | Regra-mestra da [§3.1](#31-regra-mestra-o-período-é-o-do-pagamento), só o mês de referência |
| P2 | Quais tipos entram? | **Só despesas** ("Despesas do mês" do mockup): estorno abate (R2), encargos pelo efeito no saldo (R3). Quem pagou é o sócio gravado na transação; receitas, transferências e investimentos ficam fora |
| P3 | "Deveria pagar" | Despesas **com sócio** × participação. As sem sócio ficam numa linha própria, **fora da divisão**, até serem atribuídas. A sobra de centavo da divisão vai para os maiores restos, e a divisão soma a base |
| P4 | Acerto ("Para equilibrar o mês") | Quem pagou a menos transfere para quem pagou a mais, o maior devedor primeiro para o maior credor. Sem acerto quando as participações não somam 100% — a tela avisa |
| P5 | Lançamentos sem sócio | Os do mês sem sócio vivo, pelo mesmo critério das somas: a lista soma o indicador. "Quem pagou" grava só aquele lançamento |

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
| Itens do menu sem tela no MVP (Dispositivos) | Aparecem no menu normalmente e levam a uma **tela em branco**, já com a rota e o mês de referência. Fluxo por conta, Por tag e Por sócio saíram da lista nas Fases 12.1, 12.2 e 13.6; "Por sócio" continua só no perfil empresarial |
| Excluir conta ou cartão | Ver [§5.1](#51-desativar-e-excluir-conta-ou-cartão) |
| Trocar a moeda do perfil | Só enquanto o perfil não tem lançamentos: a moeda é a unidade de todo valor gravado e a troca não converte nada (database-design §4.1). Renomear continua livre |
| Limite usado do cartão | Valor a pagar somado das faturas em aberto até a **fatura aberta hoje**; das faturas depois dela, só o comprometido (parcelas e compras lançadas adiante), sem as ocorrências de séries fixas (Fase 13.5); fatura credora conta zero |

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
| Conta | Seus extratos e transações; os cartões que ela paga, com as faturas e os lançamentos deles; as transferências e investimentos em que ela é a **conta de destino**; as recorrências que têm a conta como origem ou destino, ou um cartão que ela paga como origem (Fase 9.1) |
| Cartão | Suas faturas e os lançamentos delas, incluindo os pagamentos parciais; as recorrências que têm o cartão como origem (Fase 9.1) |

Uma recorrência excluída em cadeia para de gerar lançamentos, e o alerta a conta à parte
("N repetições, que param de gerar lançamentos"). Desativar a conta ou o cartão **não**
para a recorrência: ela continua emitindo, porque desativar não muda nenhum saldo
(database-design §4.12).

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
- [x] Renderer: React 19, TanStack Router (hash), TanStack Query, Tailwind com o preset de `tokens`, shadcn/ui inicializado (Button, Input, Select, Dialog, Sheet, Popover, DropdownMenu, ContextMenu, Table, Tabs, Tooltip, Sonner, Chart; o `Sheet` saiu depois da Fase 9.1, quando o lançamento passou a abrir em diálogo) — classes traduzidas para os tokens, `Chart` reescrito com cor de série restrita a token e sem `Intl`
- [x] Scripts `pnpm dev:desktop`, `pnpm build:desktop`; `pnpm check` cobrindo lint e tipos do app
- [x] Teste de fumaça com Playwright (`_electron`): abre, cria perfil, lança uma despesa, vê no extrato — tudo pela tela desde a Fase 9 (o perfil pelo primeiro uso, a despesa em Transações, o extrato em Contas); também confere o isolamento do renderer, a CSP e a tela de bloqueio. No devcontainer e no CI roda com `FINANCE_ELECTRON_NO_SANDBOX=1`, porque o container bloqueia os namespaces de usuário do sandbox de processo do Chromium
- [x] Medir memória e tempo de abertura ([desktop-shell §6.4](desktop-shell-design.md#6-próximos-passos)) e registrar o número — `pnpm --filter @finance/desktop measure`; resultado em [desktop-shell §6](desktop-shell-design.md#6-próximos-passos)

### Fase 4 — Shell e navegação

- [x] Layout: barra lateral (marca, seletor de perfil, menu, rodapé "Dados só neste aparelho"), barra superior fixa — só a área de conteúdo rola
- [x] Menu completo do mockup, com subitens de Relatórios (Por categoria, Fluxo por conta, Impacto do cartão, Por sócio só no perfil empresarial, Por tag) — os subitens se abriam com a seção ativa, como nos mockups, e depois deram lugar à lista na página de Relatórios ([Fase 13.10](#fase-1310--lista-de-relatórios-na-página)); o mapa do menu (`shell/navigation.ts`) é o mesmo tipo (`AppPath`) dos caminhos do roteador
- [x] Rotas de Metas, Dispositivos, Fluxo por conta, Por sócio e Por tag levando a uma **tela em branco** dentro do shell ([§5](#5-decisões-de-produto)), para que a navegação já esteja pronta quando as telas chegarem — as telas do MVP ainda não feitas também têm rota com tela em branco, substituída na fase de cada uma; "Por sócio" aberto num perfil pessoal explica que só existe no empresarial
- [x] Mês de referência global (‹ mês ›, "Voltar ao mês atual") como *search param* tipado (`period`), preservado ao navegar (`retainSearchParams`); sem ele na URL, abre o último mês do aparelho (`lastPeriod`) ou o corrente. **Decisão:** escondido em Cadastros, Dispositivos e Ajustes — os mockups dessas telas desenham a barra, mas a regra do README dos mockups ("não aparece em fluxos de configuração") prevaleceu; Metas mantém a barra
- [x] Tema claro/escuro/seguir o sistema, persistido nas preferências do aparelho. **Decisão:** o botão do mockup (que só alterna claro/escuro) virou um menu com as três opções, com o tema escolhido no rótulo
- [x] Seletor de perfil (troca o perfil ativo, grava `lastProfileId`, invalida todas as queries); sem perfil no banco, o shell não abre e uma tela provisória ocupa a janela até o primeiro uso (Fase 5)
- [x] "+ Lançamento" global (atalho `N`) abrindo o painel de transação — o painel é do shell; o formulário entrou na Fase 9 e, depois da 9.1, passou do `Sheet` ao diálogo de lançamento
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

- [x] Página `DesktopCadastros` com lista lateral de tipos e contadores (Contas, Cartões, Categorias, Tags, Perfis, Anotações) — o tipo aberto é o *search param* `kind` de `/registry` (`registry/registryKinds.ts`), e o mês de referência, escondido na tela, continua na URL. **Decisões:** Contas e Cartões são geridos aqui, e não levam às telas Contas/Cartões como no mockup; o "Reordenar" das categorias ficou fora do MVP, porque o núcleo não guarda ordem de categorias
- [x] Contas: lista (desativadas e fora do total marcadas), criar/editar em diálogo (nome, tipo, saldo inicial, moeda, considerar no total), desativar/reativar — sem confirmação, porque se desfazem e não mudam saldo; o saldo inicial é lido na moeda do perfil, e a moeda da conta é só rótulo
- [x] Excluir conta: alerta com o resultado de `accounts.deletionImpact` (o que será apagado e quais outras contas mudam de saldo) e confirmação forte antes de excluir — digitar o nome; o alerta também oferece "Desativar em vez disso". As frases do alerta são o view-model `describeAccountDeletion` do `client`
- [x] Cartões: lista, criar/editar (nome, conta pagadora só entre as ativas — na edição, a atual continua mesmo desativada —, limite, fechamento, vencimento; aviso de fechamento em dia 29–31), desativar/reativar
- [x] Excluir cartão: mesmo alerta, com `creditCards.deletionImpact` (`describeCreditCardDeletion`, que cita os pagamentos parciais)
- [x] Categorias: árvore com subcategorias e contagem de lançamentos, criar/renomear/excluir, "+ Subcategoria"; excluir subcategoria em uso abre o diálogo de mover — a exclusão da categoria fica no diálogo de "Editar", e o destino já exclui as subcategorias que somem junto
- [x] Perfis: lista, criar, renomear (e trocar a moeda, que o núcleo recusa com lançamentos); tipo empresarial sem sócios no MVP (aviso) — o tipo não muda depois de criado, e o perfil criado pode ser aberto pelo aviso de sucesso
- [x] Mensagens de validação vindas do schema compartilhado e do `CoreError` — os formulários validam com os schemas da camada Request (`creditCardContentShape` passou a ser exportado, como o `accountContentShape`), as frases saem de `lib/formIssues.ts` (compartilhado com o primeiro uso), e a recusa do núcleo que aponta um campo (nome repetido, moeda travada, conta pagadora desativada) aparece abaixo dele (`registry/coreErrorField.ts`)
- [x] Tags (mockup `DesktopTags`): lista com lançamentos, total e último uso de todo o período; criar no cabeçalho; painel para renomear e excluir, com o aviso de quantos lançamentos perdem a tag e os atalhos para Transações e para o relatório por tag (hoje as telas em branco). No núcleo: domínio `Tag`, `TagService` (nome único sem diferenciar maiúsculas; excluir tira a tag dos lançamentos, que continuam), rotas `tags.list/create/update/delete`, e `tagIds` em `transactions.create/update/get` — opcional ao criar, obrigatório na edição completa —, com o vínculo `transactions_tags` de id derivado do par (sync-design §5.6). **Decisões:** o total é a soma dos valores **em módulo** de qualquer tipo, sem encargos; o último uso é o maior vencimento
- [x] Anotações (mockup `DesktopAnotacoes`): lista da editada mais recentemente para a mais antiga, com busca no texto inteiro (sem diferenciar maiúsculas nem acentos), título pela primeira linha (`summarizeNote` no `client`, decisão de interface 9) e editor com salvar, descartar e excluir com confirmação; sair da anotação com alteração não salva (outra anotação, outro cadastro ou tela, troca de perfil) abre um diálogo que pede salvar ou descartar antes de sair; depois de salvar, o editor mostra o texto como o núcleo o gravou (aparado). No núcleo: domínio `Note`, `NoteService` e rotas `notes.list/create/update/delete`
- [x] Testes: unitários dos formulários e das regras da tela (`test/registry.test.ts`), do alerta de exclusão e do título da anotação no `client`, de tags e anotações no núcleo (`test/services/tags.test.ts`, `notes.test.ts`) e ponta a ponta (`e2e/registry.spec.ts`: contas e cartões, exclusão em cadeia, categorias com mover, perfis, tags e anotações)

### Fase 7 — Contas (extrato)

- [x] Lista de contas com consolidado e previsto do mês; conta fora do total marcada e fora da soma; conta desativada marcada; totais consolidado e previsto — como no mockup, a conta fora do total aparece apagada e só com o consolidado. A conta aberta é o *search param* `account` de `/accounts` (`accounts/accountsSearch.ts`); sem ele, ou com uma conta que não existe mais, abre a primeira da lista. "+ Nova conta" usa o diálogo de Cadastros e abre o extrato da conta criada
- [x] Detalhe: cabeçalho (tipo, se entra no total), "Editar conta" — o diálogo de Cadastros; o "⋯" do mockup leva desativar/reativar e excluir (com o mesmo alerta da exclusão em cadeia). O cabeçalho é o `formatAccountHeading` do `client`
- [x] Quatro números do extrato: saldo inicial e final, consolidado e previsto; entradas e saídas. **Decisão:** entradas e saídas também mostram consolidado e previsto (decisão de interface 6), e cada movimento conta pelo **sinal do efeito** na conta, não pelo tipo — estorno é entrada, pagamento parcial de fatura é saída. Elas vêm do núcleo (`inflows`/`outflows` no `statements.get`, regra `statementFlows`), somadas sem arredondar, com a propriedade inicial + entradas + saídas = final testada nos dois saldos
- [x] Tabela de movimentos: transações, transferências recebidas, faturas pagas/em aberto ("ver fatura" navega para o cartão) — view-model `buildStatementTable` do `client`, por data de caixa; o valor é o efeito nesta conta (o `TransactionResponse` passou a trazer o `destinationEffect`). "ver fatura" leva a `/cards` com `card` e `invoice` (`cards/cardsSearch.ts`), que a Fase 8 lê. **Decisão:** a fatura paga mostra o dia do pagamento, que passou a ser gravado — migration `0003` (`invoices.payment_date`, database-design §4.7), exposto como `paymentDate` no `InvoiceResponse`; nas faturas pagas antes dela o dia é `—` e a linha vai para o fim do mês
- [x] Nota da fatura em aberto no previsto; mês sem movimento (inicial = final)
- [x] Testes: núcleo (`balances.table.test.ts`: entradas e saídas, pagamento parcial, dia do pagamento gravado e apagado ao reabrir, fatura sem dia; `balances.property.test.ts`: dia coerente com o vínculo e inicial + entradas + saídas = final), `client` (tabela do extrato e cabeçalho) e ponta a ponta (`e2e/accounts.spec.ts`); o teste de fumaça passou a conferir o extrato na tela

### Fase 8 — Cartões (fatura)

- [x] Lista de cartões com fatura do mês, situação e totais — "Em aberto · vence 10/10", "Paga em 07/10" (ou "Paga no extrato de out" sem o dia gravado) e, no mês em que nada caiu, "Sem lançamentos" com o valor `—` (`formatInvoiceSituation`/`formatInvoiceAmount`, view-model `invoiceView.ts` do `client`); rodapé com os totais do núcleo; cartão desativado marcado. Sem `card` na URL, abre o primeiro da lista (o núcleo ordena por nome). "+ Novo cartão" usa o diálogo de Cadastros e abre a fatura do cartão criado
- [x] Detalhe da fatura: total a pagar (em módulo), situação, fechamento, vencimento (com a nota de onde a fatura pesa: previsto da pagadora em aberto, extrato do pagamento quando paga), limite usado (`describeLimitUsage`: percentual, barra limitada a 100%, `—` no cartão sem limite) e lançamentos (`buildInvoiceTable`). **Decisão:** cada linha mostra quanto soma à fatura — o oposto do efeito na conta —, então a compra é positiva e o estorno e o pagamento parcial são negativos, com etiqueta e `⇄`; a soma fecha com o total a pagar. O "⋯" leva editar, desativar/reativar e excluir o cartão, como em Contas
- [x] Pagar fatura (conta pagadora sugerida, data) → fatura "Paga em dd/mm", extrato do mês do pagamento atualizado — data sugerida é hoje (`currentDate`), e a confirmação mostra o extrato que recebe a fatura e o consolidado da conta antes → depois (`describeInvoicePayment`, do mockup `MobilePagarFatura`). **Decisão:** a conta não se escolhe no pagamento: o vínculo da fatura é com o extrato da conta pagadora do cartão (database-design §4.7; o `ImpactCalculator` recalcula sempre essa conta), e pagar por outra mudaria o modelo. O diálogo mostra a pagadora; trocá-la é editar o cartão
- [x] Ler os *search params* `card` e `invoice` de `/cards` (`cards/cardsSearch.ts`), que o "ver fatura" do extrato já envia — fatura fora do mês de referência mostra um aviso com o link para a do mês. **Decisão:** trocar o mês na barra superior tira o `invoice` da URL (`shouldDropInvoice`), para o detalhe acompanhar a lista; voltar no histórico ou seguir um link, que mudam mês e fatura juntos, mantêm a fatura pedida
- [x] Pagamento parcial (diálogo de valor → transferência negativa na fatura) — `readPartialPaymentForm` monta a transferência já paga, com a conta que pagou como destino, validada pelo `createTransactionRequest`. **Decisões:** a conta sugerida é a pagadora do cartão, mas qualquer conta ativa pode ter pago (é um lançamento comum, não o vínculo da fatura); o diálogo pede a subcategoria, porque toda transação tem uma e não há subcategoria de sistema (transferências ficam fora do relatório por categoria, R2); o valor é maior que zero e **menor** que o valor a pagar — igual ou maior deixaria a fatura zerada ou credora e ainda em aberto, e quitar tudo é "Pagar fatura". Sem valor a pagar, o botão fica desabilitado
- [x] Reabrir fatura com confirmação explicando que o saldo da conta volta — `describeInvoiceReopening`: de qual extrato o pagamento sai e em que mês e dia a fatura volta a pesar no previsto
- [x] Próximas faturas do cartão — só as que existem depois da aberta, cada uma levando ao detalhe (`invoice`). A fase segue o mockup: "aberta" é a que recebe as compras de hoje, "futura" a que ainda não começou; também "fechada · vence dd/mm" e "paga" (`invoiceStage`, pelo dia de fechamento com o ajuste de fim de mês)
- [x] Testes: `client` (`test/invoiceView.test.ts`: situação, lançamentos com estorno e parcial, fases das próximas faturas com o dia do fechamento e o fim de mês, limite usado, frases de pagar e reabrir), desktop (`test/cards.test.ts`: cartão e fatura abertos, troca do mês, formulários de pagar e de pagamento parcial) e ponta a ponta (`e2e/cards.spec.ts`: lista e totais, detalhe, parcial, pagar com a prévia do saldo e o extrato da conta, reabrir, "ver fatura" de outro mês, troca do mês, cartão novo e desativado)

### Fase 9 — Transações

- [x] Tabela densa (TanStack Table + Table do shadcn): data, nome, categoria › sub, conta/fatura, valor, situação; números tabulares à direita — `TransactionGrid.tsx`, com a TanStack Table 9 só para o estado da ordenação; a junção dos nomes e a situação continuam no view-model `buildTransactionTable` do `client`. A situação das compras no cartão lê as faturas de cada cartão a partir da mais antiga que o mês usa (`useInvoicesByCards`, sobre o novo `useCoreQueries`). **Decisões (perguntadas):** a coluna de seleção em lote do mockup saiu (não há ação em lote no MVP); "Rec." ficou, e desde a Fase 9.1 mostra "3/12" ou "Fixa"
- [x] Entrada/saída sem depender de cor: sinal, `⇄` em transferência, rótulo de estorno — `formatTransactionAmount` no `client`, o mesmo da prévia do formulário
- [x] Ordenação por coluna; filtros conta/cartão, categoria, situação e busca; linha-resumo "N lançamentos · resultado" — a ordem de cada coluna é `compareTransactionRows` (sem diferenciar acentos; empate pela data e pelo nome), o primeiro clique é sempre crescente e a ordenação nunca é removida. Os filtros ficam na URL (`transactions/transactionsSearch.ts`: `q`, `account`, `card`, `category`, `subCategory`, `tag`, `situation`), para o histórico e para outras telas abrirem Transações filtrada. **Decisão (perguntada):** entrou o filtro de Tag do mockup (`TransactionFilters.tagId`), e o "Ver lançamentos em Transações" do painel de Tags passou a abrir a tela filtrada pela tag. Estado vazio distingue o mês sem lançamento ("+ Lançamento") do filtro sem resultado ("Limpar filtros")
- [x] Formulário de criação/edição: tipo, valor (com inversão de sinal), nome, descrição, data, pago + data de pagamento, encargos, conta **ou** cartão (só ativos em lançamento novo), conta de destino (transferência/investimento), subcategoria com busca, tags (o núcleo já aceita `tagIds` desde a Fase 6) — `TransactionForm.tsx`, validado pelos schemas de `transactions.create`/`update` (`transactions/transactionForm.ts`); as escolhas oferecidas são view-models do `client` (`transactionSourceOptions`, `destinationAccountOptions`, `subCategoryOptions`), e a prévia do valor usa a regra de sinal do núcleo (`originEffect`, agora exportado). **Decisão (pedida pelo usuário depois da Fase 9.1, divergindo do mockup):** criar e editar abrem o diálogo de lançamento (`TransactionDialog.tsx`), como os de contas e cartões, no lugar da coluna de 340px ao lado da tabela; nas outras telas, "+ Lançamento" e `N` abrem o mesmo diálogo pelo shell, que antes usava um `Sheet`. A tela de Transações continua registrada como *host* (`useTransactionPanelHost`) para sugerir a origem do filtro e selecionar na tabela o lançamento gravado. O rodapé segue o dos cadastros: "Excluir" à esquerda, que abre a confirmação por cima da edição, e "Cancelar" e "Salvar" à direita. **Decisões:** o valor é digitado sem sinal e maior que zero — o "±" grava o negativo (estorno); encargos não têm sinal; "Pago" só aparece numa conta, porque no cartão quem decide é a fatura; o seletor de tipo usa "Transf." e "Invest.", como o `MobileLancamento`, porque os nomes inteiros não cabem na coluna; num lançamento novo, o filtro de conta ou cartão da tela vira a origem sugerida; na edição o seletor de tipo fica travado no tipo gravado, porque o núcleo recusa a troca (`transaction-type-locked`, database-design §4.13)
- [x] Despesa no cartão: fatura sugerida (`invoices.suggest`) com troca para outra fatura do cartão; aviso quando a escolhida está paga (será reaberta) — a sugestão passou a trazer o fechamento e o vencimento da competência (`closingDate`, `dueDate`), para o painel dizer "Sugerida pela data da compra: nov/2026, vence 10/11" antes de a fatura existir. A troca oferece a anterior, a sugerida e as duas seguintes, mais a atual na edição (`invoiceChoices`); o aviso de reabertura (`invoiceReopenWarning`) diz de qual extrato o pagamento sai, e não aparece quando o lançamento já está na fatura paga
- [x] Excluir com confirmação; editar mês passado avisa que os meses seguintes serão recalculados — a confirmação diz de onde o valor sai e quais saldos mudam (`describeTransactionDeletion`; o pagamento parcial volta para a fatura e para a conta). O aviso de recálculo (`recalculationNotice`) vale para o mês de onde o lançamento sai e para onde vai, também num lançamento novo em mês passado
- [x] Teclado: `↑↓` navegar, `Enter` editar, `P` marcar pago, `Del` excluir; menu de contexto com as mesmas ações — a linha selecionada é a única no `Tab` (*roving tabindex*); clique abre a edição. **Decisão:** `P` numa compra no cartão não marca nada e avisa que a situação é a da fatura (pagar ou reabrir em Cartões); no menu de contexto a ação fica desabilitada
- [x] Atualização otimista ou invalidação pelo mapa da Fase 3.2 — saldos da barra e relatórios refletem a escrita sem recarregar: invalidação pelo mapa (as escritas de transação já invalidam `MONEY`); o teste de ponta a ponta lança num mês passado pelo painel e vê o saldo inicial do extrato mudar sem recarregar
- [x] Testes: `client` (`test/transactionEditor.test.ts`: origens e destinos com desativados, busca de subcategoria, troca e aviso de fatura, aviso de recálculo, prévia do valor, confirmação de exclusão; `viewModels.test.ts`: filtro de tag e ordenação; `hooks.test.tsx`: várias consultas invalidadas pelo mapa), núcleo (`creditCards.test.ts`: datas do ciclo na sugestão), desktop (`test/transactions.test.ts`: filtros na URL e leitura do formulário) e ponta a ponta (`e2e/transactions.spec.ts`: lançar, editar, `P` e `Del`; cartão com fatura sugerida, aviso de reabertura e estorno; filtros na URL, ordenação, menu de contexto e o atalho do painel de Tags; o painel das outras telas e o aviso de mês passado); o teste de fumaça passou a lançar pela tela

### Fase 9.1 — Recorrências

Entrou depois da Fase 9, a pedido. As regras estão em
[database-design.md §4.12](database-design.md#412-recurrences); as decisões tomadas antes do
código foram:

- **Perguntadas:** dia âncora que não existe no mês cai no último dia, e a seguinte volta ao
  dia âncora; tags e descrição são copiadas para todas as ocorrências; trocar a data em "esta
  e as futuras" muda o dia **dentro do mês** de cada ocorrência (semanal: o dia da semana
  dentro da semana; diária: só "somente esta"); mudar frequência, parcelas ou fim regenera as
  ocorrências futuras (revisto na [Fase 9.2](#fase-92--revisão-da-edição-de-recorrências)); transferência e investimento podem ser recorrentes; a regra guarda o
  modelo do lançamento em colunas próprias; série com conta ou cartão desativado continua
  emitindo; no desktop, "Repetir" é uma seção do formulário (adaptando `MobileParcelar`) e o
  escopo é um diálogo (adaptando `MobileEscopo`).
- **Técnicas:** o id da ocorrência é derivado do **número** dela, e não da data gerada, e a
  marca d'água virou contagem (`materialized_count`) — com a data mudando de dia, a chave pela
  data duplicaria ocorrências entre aparelhos (sync-design §5.6). Parceladas são gravadas
  inteiras; fixas, com ou sem fim, pelo horizonte de 12 meses. A fatura de cada parcela é a
  sugerida pela data dela, mais o deslocamento que o usuário escolheu na 1ª.

**Núcleo**
- [x] Migration `0004`: `recurrences` recriada com o modelo e o calendário (vazia em todo banco; a migration aborta se não estiver), `recurrences_tags`, `transactions.occurrence` e o índice único `(recurrence_id, occurrence)`; `pnpm embed:migrations`
- [x] Domínio puro: `RecurrenceSchedule` (data da ocorrência *n*, último dia do mês, 29/02, semana ISO), divisão do total em parcelas com o resto na 1ª (`Money.split`), `Recurrence` com invariantes por tipo; aritmética de datas sem `Date` (`LocalDate.plusDays`/`dayOfWeek`, `YearMonth.plusMonths`)
- [x] `RecurrenceRepository` (regra e tags do modelo), `listOccurrences` no repositório de transações e id determinístico da ocorrência (`occurrenceIdFor`); gerar de novo um número excluído revive a linha
- [x] `RecurrenceService`: criar a série com o lançamento (`transactions.create` com `repeat`), complemento (`recurrences.topUp`), editar e excluir nos três escopos, troca de dia âncora, regeneração das futuras, recálculo de todos os meses afetados numa unidade de trabalho. As regras de montar um lançamento saíram do `TransactionService` para o `TransactionComposer`, que os dois serviços usam. **Decisão:** nos escopos de série vai para as outras ocorrências só o que **mudou** na editada (database-design §4.12) — renomear a parcela 3 de "1.000,00 em 3x" não pode copiar 333,33 para a 1ª, que tem 333,34
- [x] Rotas `recurrences.list`, `recurrences.occurrences`, `recurrences.preview` e `recurrences.topUp`; `scope` e `repeat` em `transactions.update`, `scope` em `transactions.delete`; `occurrence` no `TransactionResponse`. Regras novas no `BusinessRule`, com mensagem no `describeError`
- [x] Cadeias: excluir conta ou cartão exclui as regras que os usam (o alerta conta "N repetições, que param de gerar lançamentos"), mover a subcategoria move o modelo, excluir a tag a tira das regras. **Decisão:** uma série viva sem ocorrência viva conta como uso da subcategoria, para a exclusão pedir para onde mover
- [x] Testes de mesa (`test/services/recurrences.test.ts`, `test/domain/recurrence.test.ts`): 1.000,00 em 3x e 12x 100,00 virando o ano; mensal no dia 31 e anual em 29/02; os três escopos de edição e de exclusão com ocorrências pagas; troca de dia (mensal e semanal) e a diária recusada; regeneração sem baixar a marca d'água; ocorrência excluída não volta no complemento; complemento idempotente; parcelas no cartão com deslocamento de fatura; prévia igual ao gravado; conta desativada continua gerando; cadeias de conta, cartão, subcategoria e tag; integridade dos saldos depois de cada caso

**Desktop**
- [x] Complemento na abertura, depois da verificação de integridade, no `utilityProcess` (`openCore.ts`). O complemento que nem consegue rodar bloqueia a abertura, como o resto da sequência; a falha de uma série só vai para o log (`recurrences.top-up-partial`), porque cada série é complementada na própria transação e a que falha é desfeita sozinha (backend-design §4.5)
- [x] Seção "Repetir" no formulário (`RepeatSection.tsx`): Não repetir / Parcelado / Fixo, frequência, parcelas (2 a 360), valor total ou por parcela, fim da fixa, prévia das parcelas com a fatura de cada uma (`describeRepeatPreview`, sobre `recurrences.preview`). **Decisões:** na edição de uma ocorrência o tipo da série não muda (revisto na Fase 9.2) e o valor é o da ocorrência (por parcela); o resumo da prévia não repete o nome da conta ou do cartão, que está logo acima
- [x] Coluna "Rec." ("3/12", "Fixa") e subtítulo do painel ("parcela 3 de 12 (valor total …)", "fixa mensal"), com o aviso do mockup de que salvar pergunta o escopo
- [x] Diálogo de escopo ao salvar e ao excluir uma ocorrência (`ScopeDialog.tsx`; teclado e menu de contexto inclusos), com o aviso das ocorrências pagas e dos meses e contas cujos saldos mudam (`scopeChoices`); mudar a série deixa "somente esta" desabilitado. **Decisão:** clicar numa linha abre a edição sem levar o foco para o valor, para `↑↓`, `P` e `Del` continuarem valendo na tabela; o foco automático ficou só no lançamento novo
- [x] Testes: `client` (`test/recurrenceView.test.ts`, invalidação com as rotas novas, alerta de exclusão), desktop (`test/transactions.test.ts`: repetição no formulário; `test/openCore.test.ts`: complemento na abertura) e ponta a ponta (`e2e/recurrences.spec.ts`: parcelar no cartão com a prévia e "Rec."; fixa em "esta e as futuras", repetição mudada sem "somente esta" e "excluir todas" com o aviso das pagas)

### Fase 9.2 — Revisão da edição de recorrências

Entrou depois da Fase 9.1, a partir de uma revisão de código que encontrou quatro bugs na
edição de séries. As regras resultantes estão em
[database-design.md §4.12](database-design.md#412-recurrences), e as decisões de tela, nos
itens abaixo.

**Núcleo**
- [x] Migration `0004` remove também `uq_transactions_recurrence_due_date` (antes numa `0005` à parte, desfeita no code review de 2026-10-07) — duas ocorrências da série podem vencer no mesmo dia, e o complemento não falha mais na abertura por uma data ocupada; saem `assertOccurrenceDateFree`, `hasOccurrenceOn` e a regra `recurrence-occurrence-date-taken`
- [x] "Futuras" pelo número da ocorrência na edição, na exclusão e na mudança da série
- [x] Quantidade de parcelas e término da fixa mantêm a regra e só criam ou apagam o que a mudança exige (`reshapeSeries`); periodicidade e tipo encerram a regra e começam outra na editada (`restartSeries`), até o horizonte de 12 meses. Mudar a série só vale para "esta e as futuras". Regra nova `recurrence-end-before-occurrence`; sai `recurrence-kind-locked`
- [x] A ocorrência revivida ganha `created_at` novo
- [x] Plano do diálogo de revisão: `recurrences.planCreate`, `planUpdate` e `planDelete` (`SeriesPlanner`), que ensaiam a escrita numa transação desfeita (`UnitOfWork.rehearse`) e comparam a série antes e depois; a ocorrência conta como editada à mão quando `updated_at` passa de `created_at` em mais de 1 segundo
- [x] Testes: `test/services/recurrences.test.ts` (futuras pelo número, mesma data, parcelas, término, periodicidade, tipo, recomeço na 1ª) e `test/services/seriesPlans.test.ts`

**Client e desktop**
- [x] `scopeChoices` pelo número e só com a escolha; `describeSeriesPlan` monta o resumo, os avisos (pagas, editadas à mão) e os grupos excluídas/criadas/alteradas, com 5 linhas e "e mais n transações"
- [x] `SeriesReviewDialog.tsx`: toda criação, edição e exclusão de transação recorrente passa por ele, depois do escopo quando há escolha; mudar a série vai direto para a revisão. "Repetir" na edição oferece Parcelado e Fixo, e a fixa que vira parcelada pede a quantidade e a leitura do valor
- [x] Testes: `client` (`test/recurrenceView.test.ts`, invalidação com as rotas de plano), desktop (`test/transactions.test.ts`) e ponta a ponta (`e2e/recurrences.spec.ts`)
- [ ] Pendência: a duplicação vinda de um aparelho offline quando a série é recomeçada fica para a sincronização (sync-design §5.6)

### Fase 9.3 — Metas

Entrou depois da Fase 9.2, a pedido: o mockup `DesktopMetas` (D9) já existia, mas Metas estava
fora do escopo. As regras estão em [database-design.md §4.11](database-design.md#411-goals); as
decisões tomadas antes do código foram:

- **Perguntadas:** a meta é um objetivo de **economia** (guardar um valor), e só **receitas e
  transferências** são vinculadas a ela; o progresso soma as vinculadas **pagas até hoje**, num
  valor só, independente do mês de referência (série fixa é gerada 12 meses à frente e
  inflaria o progresso); o vínculo é pelo campo "Meta" do lançamento; prazo, ritmo necessário e
  projeção contam a partir do **fim do mês de referência**.
- **Técnicas:** o valor entra com sinal (estorno desconta) e sem encargos, como o total das
  tags; num cartão, conta o dia em que a fatura foi paga; os meses até a data-alvo são meses
  médios (dias ÷ 30,44), para não depender do tamanho de cada mês; a média mensal vai do mês da
  1ª contribuição até o de referência (ou o atual, se o de referência for futuro), com mês sem
  aporte valendo zero.
- **Revisão (2026-10-08, item 2):** o ritmo e a projeção partem do guardado **no fim do mês de
  referência** (`paceBase`), e não do total de hoje, que contava duas vezes os aportes entre um
  mês passado e hoje e deixava de fora os meses entre hoje e um mês futuro. Num mês encerrado,
  vale o que estava pago no fim dele; no atual, o de hoje; num futuro, o de hoje mais a média
  por mês inteiro até ele. Fora do mês atual, a nota da projeção diz essa base ("No fim de
  jan/2026 havia R$ 500,00 guardados.") para não contradizer o total do progresso.
- **Revisão (2026-10-08, item 5):** o campo "Meta" do lançamento lê a rota `goals.options` (só
  id e nome, sem mês de referência), e não `goals.list`, que mede o progresso de todas as metas.
  Ela é invalidada só por criar, editar e excluir meta, e não pelas escritas de dinheiro.

**Núcleo**
- [x] Domínio `Goal` (nome até 45, valor-alvo maior que zero, data-alvo opcional) e o cálculo puro `measureGoalProgress` (progresso, falta, percentual, pendentes, meses restantes, ritmo necessário, média e projeção)
- [x] Regra `goal-requires-saving-type` nos invariantes da transação (`feedsGoal`, exportada para o formulário), valendo também para as ocorrências das séries; a posse da meta saiu do `ReferenceRepository` para o `GoalRepository`
- [x] `GoalService` e rotas `goals.list` (com o progresso no mês), `goals.contributions` (as transações que contam, pelo dia do pagamento), `goals.create`, `goals.update` e `goals.delete` — excluir limpa `goal_id` das transações e dos modelos de recorrência
- [x] Testes: `test/domain/goal.test.ts` (cenário do mockup, pagas até hoje, estorno, meta atingida, sem prazo, prazo encerrado, média com mês vazio e mês futuro) e `test/services/goals.test.ts` (cadastro, regra do tipo na criação e na edição, outro perfil, progresso com pendentes, cartão pela fatura paga e reaberta, transação excluída, exclusão da meta com a série e o complemento)

**Client e desktop**
- [x] Rotas no mapa de invalidação: escritas de transação invalidam `goals.list` e `goals.contributions` (que entra no conteúdo de transação, porque carrega transações inteiras); excluir a meta invalida o conteúdo de transação e as séries. Hooks `useGoals` e `useGoalContributions`; mensagens da regra nova e da meta não encontrada no `describeError`
- [x] View-model `goalView.ts`: item da lista (percentual, barra limitada, "R$ x de R$ y · até dd/mm/aaaa"), os três números com a nota de cada situação (sem prazo, prazo encerrado, atingida), a frase da projeção, o aviso das pendentes, o aviso da exclusão e a tabela das vinculadas
- [x] Tela `GoalsScreen.tsx` no lugar da tela em branco: lista à esquerda, meta aberta no *search param* `goal` (`goals/goalsSearch.ts`), detalhe com progresso, números, projeção e tabela com total; "+ Nova meta" e "Editar meta" em diálogo (`goalForm.ts`, validado pelo `goalContentShape`), "⋯" com excluir e a confirmação que diz quantos lançamentos perdem o vínculo. **Decisões:** o rótulo "Meta de economia" do mockup ficou fixo; as vinculadas ainda em aberto ficam fora da tabela (a soma dela é o progresso) e aparecem numa nota no rodapé
- [x] Campo "Meta" no formulário de lançamento, só em receita e transferência; trocar para outro tipo descarta a meta
- [x] Testes: `client` (`test/goalView.test.ts`, invalidação com as rotas novas), desktop (`test/goals.test.ts`: formulário e URL; `test/transactions.test.ts`: meta no lançamento) e ponta a ponta (`e2e/goals.spec.ts`: criar, vincular pelo lançamento, progresso, editar e excluir)

### Fase 10 — Visão geral

- [x] KPIs: consolidado, previsto, receitas, despesas (com variação), faturas em aberto — view-model `overviewView.ts` no `client`. **Decisões:** consolidado e previsto vêm do total do `accounts.list`, o mesmo número do rodapé de Contas, e a contagem do subtítulo conta só as contas que entram no total; despesas sem base no mês anterior dizem "Sem despesas no mês anterior" em vez de "novo" (R6); com mais de uma fatura vencendo no mês, o subtítulo diz "a primeira vence dd/mm"
- [x] Evolução do saldo (6 meses, consolidado × previsto) com alternância Gráfico/Tabela — primeiro uso do `Chart`: barras do consolidado cheias e do previsto tracejadas, na mesma cor, como no mockup. **Decisão:** o eixo mostra o mês abreviado (`mai` … `out`), com o de referência em destaque, no lugar dos "−5 … mês ref." do mockup; sem eixo de valores, que ficam na dica e na tabela. A escolha Gráfico/Tabela não é guardada
- [x] Maiores categorias do mês (de `reports.byCategory`) com link para o relatório — as 4 maiores, na ordem do núcleo, com a barra relativa à maior; categoria zerada ou negativa por estornos fica fora (R2)
- [x] Resumo de contas e de cartões com navegação para os detalhes — cada linha leva à conta (`/accounts?account=`) ou ao cartão (`/cards?card=`); conta fora do total apagada e só com o consolidado, desativadas com etiqueta, perfil sem cartão com o estado vazio
- [x] Testes: `client` (`test/overviewView.test.ts`) e ponta a ponta (`e2e/overview.spec.ts`: indicadores, gráfico e tabela, maiores categorias, resumos, navegação e troca de mês)

### Fase 11 — Relatório por categoria

- [x] Seletor de comparação (mês anterior, mesmo mês do ano anterior, média dos 3 meses) — no *search param* `comparison` (`reports/categoryReportSearch.ts`), validado pela lista do domínio (`COMPARISON_MODES`, agora exportada pelo núcleo); a padrão fica fora da URL. Trocar a comparação não fecha o nível aberto
- [x] Trilha de navegação (Todas › Categoria › Subcategoria) — o nível aberto fica na URL (`category` ou `subCategory`), e cada nível é uma entrada no histórico: "Voltar" sobe um nível. O id que sumiu do relatório (mês novo sem gasto nem na comparação) volta à raiz (`resolveCategorySelection` no `client`)
- [x] Tabela expansível categoria → subcategoria com período, comparação, variação (▲▼= e sinal, não só cor) e %; total de despesas. **Decisão:** o ▸/▾ só abre e fecha as subcategorias, e o nome é o link que desce no drill-down — duas ações, dois controles, para que abrir a lista não troque o gráfico nem os lançamentos; abrir uma categoria pelo drill-down também a expande
- [x] Gráfico de barras agrupadas (período × comparação) da categoria aberta, com tooltip, clique para descer um nível e alternância para tabela equivalente — barras horizontais como no mockup (período cheio, comparação tracejada, na mesma cor). **Decisões:** na raiz, o gráfico mostra as categorias (o clique abre a categoria); na subcategoria, mostra as irmãs com a selecionada em destaque, porque o último nível não tem para onde descer. O clique vale para a linha inteira, não só para a barra (que pode ter largura zero); a tabela equivalente tem os nomes como links, o caminho pelo teclado. Subcategoria só com estorno desenha a barra negativa. O `ViewToggle` da Visão geral foi para `components/ViewToggle.tsx`
- [x] Lista de lançamentos da subcategoria selecionada, com "Abrir em Transações →" levando os filtros — da rota `reports.categoryTransactions` (mês do pagamento), com Data, Nome, Conta / fatura, Tags e Valor e o total do núcleo (`buildCategoryTransactionList`, que reaproveita a linha da tabela de Transações). **Decisões:** a lista também aparece com a categoria inteira aberta, com a coluna Subcategoria; a data é o vencimento, a mesma da tela de Transações. O link leva o mês e a categoria ou subcategoria como filtro; com o filtro, Transações mostra as compras no cartão uma a uma (Fase 11.1). Continua uma diferença: a lista filtrada de Transações é pelo vencimento (`transactions.listByPeriod`), então a compra de um mês anterior numa fatura paga neste mês aparece no relatório deste mês e, em Transações, no mês da compra
- [x] Estados: mês sem despesas; categoria sem lançamentos no período mas com na comparação — sem gasto no período nem na comparação, o estado vazio com o link para Transações; sem gasto só no período, a tabela com as linhas da comparação e um aviso acima dela; a categoria ou subcategoria aberta sem lançamentos no mês explica que a linha aparece pelo gasto da comparação
- [x] Testes: `client` (`test/categoryReport.test.ts`: árvore, seleção, trilha, gráfico por nível, estados e a lista contra o núcleo real — a compra de agosto na fatura paga em outubro, estorno e tags), desktop (`test/categoryReport.test.ts`: URL do relatório) e ponta a ponta (`e2e/categoryReport.spec.ts`: estado vazio, valores e variação, drill-down pela tabela, pelo gráfico e pela trilha, abrir e fechar subcategorias, "Abrir em Transações", "Voltar" subindo um nível, troca da comparação e o mês sem gasto)

### Fase 11.1 — Transações agrupadas por fatura

Entrou depois da Fase 11, a pedido: listadas uma a uma, as compras no cartão poluem a lista do
mês de Transações. Diverge do mockup `DesktopTransacoes`, que lista as compras com "Roxinho · fat.
nov" — o mockup é referência, e a divergência foi aprovada. Decisões tomadas antes do código:

- **Sem nenhum filtro**, as compras e os estornos do cartão saem da lista e cada fatura que pesa no
  mês vira uma linha ("Fatura Roxinho · out", categoria "Fatura do cartão", a conta que paga);
  clicar nela, ou `Enter`, abre a fatura em Cartões. **Com qualquer filtro** (busca, conta ou
  cartão, categoria, tag, situação), quem filtra procura um item, e as compras voltam uma a uma —
  o painel de Tags e o "Abrir em Transações" do relatório continuam achando as compras no cartão.
- **Data da linha:** a do pagamento, quando a fatura foi paga; senão, a do vencimento — a mesma
  regra do extrato e dos relatórios. **Valor:** o que falta pagar (`balance`), líquido dos
  pagamentos parciais, como no extrato.
- **Pagamento parcial** continua como linha própria, porque saiu da conta noutro dia; com a
  situação dele (Pago/Pendente), e não a da fatura. Na lista agrupada ele conta no resultado, pelo
  efeito na conta pagadora, já que a fatura vem líquida dele; na lista filtrada, não, porque as
  compras já contam.
- **Editar e excluir** compras no cartão passaram a existir também na fatura em Cartões (clique ou
  `Enter` editam, `Del` e o "⋯" excluem), com os mesmos diálogos de Transações.

**Núcleo**
- [x] Rota `statements.profileInvoices` (perfil, mês): as faturas que pesam no mês em todas as contas do perfil, com a conta pagadora e a data de caixa. Sai da mesma consulta do extrato (`StatementConsolidationService.monthInvoices`), para que Transações e extrato concordem por construção
- [x] Testes: `test/services/profileInvoices.test.ts` (paga com atraso conta no mês do pagamento, em aberto no vencimento, parcial abatendo o valor, concordância com os extratos, perfil inexistente)

**Client e desktop**
- [x] Rota no mapa de invalidação (`MONEY`) e hook `useProfileInvoices`
- [x] `buildTransactionTable` agrupa sem filtro (`TransactionTableRow` = lançamento ou fatura; `grouped` na tabela); a linha da fatura abre a fatura, `P` e `Del` nela explicam onde agir; a tela avisa acima da tabela que as compras estão nas faturas, e o lançamento novo no cartão avisa em que fatura caiu, com "Ver fatura"
- [x] Lançamentos da fatura em Cartões com editar e excluir
- [x] Testes: `client` (`test/transactionGrouping.test.ts`: agrupado, parcial, filtros e o resultado), ponta a ponta (`e2e/transactions.spec.ts`: a linha da fatura e o link; a compra nova avisa a fatura e aparece pelo filtro; `e2e/recurrences.spec.ts`: parcelas pela busca; `e2e/cards.spec.ts`: editar e excluir pela fatura)
- [ ] **A decidir:** os lançamentos de conta continuam listados pelo **vencimento** (`transactions.listByPeriod`), e não pela data do pagamento como a linha da fatura — a despesa que vence em 28/10 e é paga em 02/11 aparece em outubro em Transações e em novembro no extrato

### Fase 12 — Impacto do cartão

- [x] KPIs: faturas do mês (cartões, quantas em aberto), peso nas entradas, média dos 3 meses anteriores — os do `cardImpactGrid` do `client`; "em aberto" conta toda fatura do mês ainda não paga
- [x] Grade mês × cartão com valor, situação ("paga no extrato de jul", "Em aberto · vence 10/10", "Aberta", "Futura"), total e peso — tabela com o cartão desativado marcado no cabeçalho
- [x] Decidido com o mockup (as duas a favor do mockup, resolvidas no núcleo): **(1)** o `reports.cardImpact` passou a trazer o dia do pagamento (`invoices.payment_date`) na situação paga, e o mês de referência mostra "Paga em 07/10"; os anteriores continuam "paga no extrato de jul", e a fatura paga antes da migration `0003`, sem o dia, mostra "Paga no extrato de out" também no de referência. **(2)** A situação C4 ganhou `receiving` ("Aberta": recebe as compras de hoje) ao lado de `future` ("Futura": ainda não começou a recebê-las), decidida no domínio pelo `Clock` e pelo ciclo do cartão, com a mesma regra do `invoiceStage` da tela Cartões (reports-design §4)
- [x] Linha do mês de referência destacada; links de cada célula para a fatura — o link fica em cada situação, e não na célula inteira, porque uma célula pode ter duas faturas (a do mês anterior paga com atraso e a do mês); leva a `/cards?card=&invoice=` com a competência da fatura, que pode não ser o mês da linha
- [x] Nota explicando que a fatura em aberto pesa no previsto no vencimento e, paga, no extrato do pagamento
- [x] Estados: perfil sem cartão (estado vazio com o link para Cartões); mês sem receitas (peso "—")
- [x] Testes: núcleo (`test/services/reports.cardImpact.test.ts`: dia do pagamento, fatura sem o dia, aberta × futura), `client` (`test/viewModels.test.ts`: textos de cada situação, competência do link, fatura sem o dia) e ponta a ponta (`e2e/cardImpact.spec.ts`: estado vazio, indicadores, situações, peso sem receita e o link para a fatura)

### Fase 12.1 — Fluxo por conta

Entrou depois da Fase 12, a pedido: D5 estava fora do escopo (§1). Regras na [§3.4](#34-fluxo-por-conta).
**Decisões:** sem o botão "Exportar tabela" do mockup; o cabeçalho marca o mês de referência em
destaque, o mês corrente com "atual" e os meses depois dele com "previsto" — o mockup junta
"atual" e referência porque desenha o mês corrente; a linha "Faturas pagas" do mockup virou
"Faturas", porque também leva as em aberto que vencem no mês (só no previsto).

**Núcleo**
- [x] Domínio `AccountFlowReport`: janela (F1), separação de um extrato em entradas, saídas e faturas (F3) e soma das contas do total (F4), funções puras
- [x] Rota `reports.accountFlow` (perfil, mês, conta opcional — sem ela, as contas do total) montada sobre o extrato de cada conta (`StatementConsolidationService.getStatement`, F2), com a situação de cada mês (passado, corrente, futuro) pelo `Clock`
- [x] Testes de mesa (`test/services/reports.accountFlow.test.ts`): cadeia inicial → final nos cinco meses; concordância com `statements.get`; fatura paga, em aberto (só no previsto) e pagamento parcial na linha das faturas; lançamento em aberto só no previsto; soma das contas do total com transferência interna nos dois lados e a conta fora do total fora da soma; conta desativada dentro; conta de outro perfil recusada

**Client e desktop**
- [x] Rota no mapa de invalidação (`MONEY`) e hook `useAccountFlow`. O domínio do extrato ganhou `statementMovements`, a lista única de movimentos que o extrato e o fluxo leem
- [x] View-model `accountFlowTable.ts`: colunas com o rótulo de cada mês, linhas com o previsto e a nota do que está em aberto, consolidado "—" no futuro (F5)
- [x] Tela `AccountFlowScreen.tsx` no lugar da tela em branco: lista de contas à esquerda (fora do total apagada, desativada com etiqueta) mais "Todas as contas do total"; a escolha fica no *search param* `account` (`reports/accountFlowSearch.ts`), e a conta que sumiu volta à primeira
- [x] Testes: `client` (`test/accountFlowTable.test.ts`), desktop (`test/reportSearch.test.ts`) e ponta a ponta (`e2e/accountFlow.spec.ts`)

### Fase 12.2 — Por tag

Entrou depois da Fase 12, a pedido: D8 estava fora do escopo (§1). Regras na [§3.5](#35-por-tag).

**Núcleo**
- [x] Domínio `TagReport`: total líquido por tag e por categoria, participação e ordem (T2–T4), funções puras
- [x] Rota `reports.byTag` (perfil, mês, período `month` ou `all`): as tags com total líquido, despesas, receitas, lançamentos, primeiro e último mês e a divisão por categoria — agregada no SQL sobre a `REPORT_SOURCES_CTE`
- [x] Rota `reports.tagTransactions` (perfil, mês, período, tag): os lançamentos da tag e o total, pelo mesmo critério (T5); tag de outro perfil recusada com `NOT_FOUND`
- [x] Testes de mesa (`test/services/reports.tag.test.ts`): compra no cartão pelo mês do pagamento da fatura; parcelas futuras só em "todo o período"; receita abatendo; estorno; encargos; transferência fora; categoria com receita maior sem participação; lista soma o total; tag sem lançamento no período fora; ordem

**Client e desktop**
- [x] Rotas no mapa de invalidação (`MONEY`; `reports.byTag` também com os nomes de categoria e com renomear e excluir tag) e hooks `useTagReport`, `useTagTransactions`
- [x] View-model `tagReport.ts`: itens da lista, indicadores ("em 2 contas e 1 cartão", categorias envolvidas, intervalo dos meses), tabela por categoria e a lista de lançamentos (reaproveitando a linha de Transações, como o relatório por categoria)
- [x] Tela `TagReportScreen.tsx` no lugar da tela em branco: lista de tags com o seletor de período, indicadores, tabela por categoria com alternância para gráfico (`ViewToggle`) e lançamentos com "Abrir em Transações →" (tag como filtro); tag e período nos *search params* `tag` e `range` (`reports/tagReportSearch.ts`). **Decisões:** a divisão por categoria abre na tabela, como no mockup, e o "Ver como gráfico" virou a alternância Tabela/Gráfico dos outros relatórios; em "Todo o período" a data dos lançamentos leva o ano; o "Abrir em Transações" leva a tag e o mês de referência, porque Transações é mensal; sem receita o indicador é "Total gasto", como no mockup, e com receita vira "Total líquido" com as duas partes
- [x] Estados: perfil sem tag (link para Cadastros › Tags); nenhuma tag com lançamento no período
- [x] Testes: `client` (`test/tagReport.test.ts`), desktop (`test/reportSearch.test.ts`) e ponta a ponta (`e2e/tagReport.spec.ts`)

### Fase 13 — Ajustes

Tela `settings/SettingsScreen.tsx` no lugar da tela em branco, sem a barra do mês (Fase 4).
**Decisões** (divergências do mockup `DesktopAjustes`, aprovadas antes do código): sem a seção
"Perfil atual" — o perfil se edita só em Cadastros › Perfis, num lugar só —, e sem o "Lembrete
de exportação", que fica fora do MVP.

- [x] Tema (seguir o sistema, claro, escuro) — grupo de opções que grava a mesma preferência do menu da barra superior
- [x] ~~Perfil atual: nome, tipo, moeda~~ — fora, pela decisão acima
- [x] Exportar cópia do banco (`VACUUM INTO` no `utilityProcess`, diálogo de salvar do main), registrando a data da última cópia — a operação é do núcleo (`copyDatabaseTo`), para o mobile exportar pela mesma regra (mobile-shell-design §6.2). O main pergunta o destino (nome sugerido `financas-AAAA-MM-DD.sqlite` em Documentos) e pede a cópia ao `utilityProcess` (`export-database`), que grava num temporário ao lado e renomeia: o `VACUUM INTO` recusa arquivo existente, e a substituição confirmada no diálogo fica atômica. O próprio banco (ou o `-wal`/`-shm`), por qualquer caminho, é recusado como destino. A data (`lastExportAt`) fica no `preferences.json` do aparelho, gravada só pelo main depois de a cópia existir — o pedido de preferências do renderer não a aceita. Cada falha diz o que fazer, na própria linha; cancelar o diálogo não avisa nada
- [x] Local do arquivo SQLite (só leitura, com "mostrar na pasta") — o caminho e o `showItemInFolder` são do main; o renderer não manda caminho algum
- [x] Lista de atalhos de teclado — os globais (`N`, `[` `]`), os da tabela de Transações (↑ ↓, `Enter`, `P`, `Del`) e os da fatura em Cartões (`Enter`, `Del`), de uma lista só (`settingsView.ts`) que o teste confere contra o `shortcutFor`. O `Ctrl K` do mockup fica de fora enquanto a busca estiver pendente (Fase 4)
- [x] Versão do app e do schema — o app pelo `app.getVersion()`; o schema pelo `user_version` depois de migrar, que o estado `ready` da abertura passou a levar (`schemaVersion`)
- [x] Ponte: `about.info()` (versões, caminho do banco, última cópia), `database.exportCopy()` e `database.showInFolder()`, uma exportação por vez no main
- [x] Testes: núcleo (`test/infrastructure/databaseCopy.test.ts`), desktop (`test/settings.test.ts`: cópia substituindo a anterior, recusa do próprio banco por link simbólico e `..`, falha sem deixar temporário, banco bloqueado, textos e atalhos; `test/main.test.ts`: data da última cópia só pelo main) e ponta a ponta (`e2e/settings.spec.ts`, com o diálogo de salvar e o "mostrar na pasta" trocados no processo principal)
- [ ] **Fora do MVP:** lembrete de exportação (mensal, semanal, desligado) do mockup — falta decidir como e quando o app avisa

### Fase 13.1 — Importação de transações

Entrou depois da Fase 13, a pedido: a importação do histórico estava fora do escopo (§1).
Regras em [import-design.md](import-design.md); telas nos mockups `DesktopImportArquivo`,
`DesktopImportMapear` e `DesktopImportRevisar`, com entrada por Ajustes › Dados e por
"Importar arquivo…" em Transações. **Decisões** (tomadas antes do código): a fatura com compra
paga é paga na maior Efetivação das compras dela; só CSV nesta fase; sem registro de
proveniência — a proteção contra importar duas vezes é a cópia do banco antes; entram o modelo
de mapeamento, o arquivo com coluna de tipo e as `#palavras` como tags.

**Núcleo**
- [x] `BillingCycle.invoicePeriodDueIn`: a competência da fatura que vence num mês, para pôr a compra na fatura que o arquivo diz
- [x] Domínio `domain/import/`: linhas normalizadas e `analyzeImport` — séries (chave, número da ocorrência, repetidas e fora da faixa como avulsas), fim da fixa pelo horizonte, ocorrências futuras, data da compra de cada linha de cartão, vencimento e fechamento prováveis dos cartões, categorias e `#palavras`, problemas por linha. O horizonte das fixas saiu do `RecurrenceService` para o domínio (`fixedSeriesHorizon`), para a análise e o complemento usarem a mesma regra
- [x] `RecurrenceService.importSeries` e `InvoiceService.markPaid`: gravar uma série com as ocorrências do arquivo (número, pagamento e fatura de cada uma) e pagar a fatura devolvendo o impacto, sem recalcular. A série importada segue as regras de sempre depois da última ocorrência: o parcelamento incompleto ganha as parcelas que faltam
- [x] Rota `imports.run` (`ImportService`): cria contas, cartões, categorias e tags, grava avulsos e séries, paga as faturas e recalcula uma vez, numa unidade de trabalho. Conta ligada de outro perfil ou desativada é recusada, e nada fica gravado
- [x] Testes (`test/domain/importAnalysis.test.ts`, `test/services/imports.test.ts`). Conferido também com os três arquivos reais (2.265 linhas, gravadas em cerca de 150 ms, verificação de integridade sem desvio), fora do repositório porque os dados são pessoais

**Client**
- [x] `src/import/`: CSV, detecção (separador, decimal, data, tipo, cabeçalho), campos por tipo com sugestão pelo cabeçalho, interpretação das linhas, revisão (`importReview.ts`) e o modelo de mapeamento. A decodificação dos bytes ficou no renderer: o `client` não tem `TextDecoder` (sem DOM), e a importação é só do desktop
- [x] Rota no mapa de invalidação (`EVERYTHING`) e testes (`test/importFile.test.ts`, `test/importReview.test.ts`, escrita no `test/invalidation.test.ts`)

**Desktop**
- [x] Ponte: `importFile.open()` (diálogo do main, devolve nome e bytes, sem caminho; até 20 MB), `importFile.templates()` e `importFile.saveTemplate()` (no `preferences.json`, validados no main, até 30 modelos)
- [x] Telas `import/` (Arquivo, Colunas, Revisar e a confirmação) em `/settings/import`, sem a barra do mês e com "Ajustes › Importar dados" no lugar dela; "Importar…" em Ajustes (o cartão "Cópia dos dados" virou "Dados", como no mockup) e "Importar arquivo…" em Transações
- [x] Testes: desktop (`test/import.test.ts`, `test/shell.test.ts`) e ponta a ponta (`e2e/import.spec.ts`, com os diálogos de abrir e de salvar trocados no processo principal)
- [ ] **Fora desta fase:** XLSX e a escolha da aba; proveniência da importação

**Decisões da implementação** (divergências ou complementos aos mockups `DesktopImport*`):

- O indicador das etapas fica no topo da tela, e não na barra superior: a barra é do shell e mantém o "+ Lançamento" de toda tela; o "Cancelar" fica no rodapé da etapa Arquivo.
- "Efetivação" e "Lançamento" ficam como **dica** na coluna, como no mockup, e não ligam sozinhos. Sem a coluna de pagamento ligada, a revisão oferece "Considerar pagas as que vencem até hoje" (o arquivo real de transferências não tem a coluna).
- O dia de fechamento do cartão novo continua obrigatório, mas a revisão mostra o **provável** pelas datas de compra ("provável: dia 8"), quando há a coluna de data da compra.
- A "Exportar uma cópia do banco antes de importar" usa o diálogo de salvar de Ajustes; cancelar ou falhar a cópia não importa nada.
- Parcelamentos são separados também pelo total de parcelas e pela data da compra: o arquivo real tem 32 séries, e não as 30 do mockup (duas compras com o mesmo nome em totais diferentes).
- O arquivo também pode ser arrastado para a etapa Arquivo; o conteúdo vem do próprio arrastar, sem caminho.

### Fase 13.2 — Melhorias antes do empacotamento

Entrou depois da Fase 13.1, a pedido, antes da fase final. **Decisões** (perguntadas antes do
código):

- **Mover entre perfis** pelo campo **"Perfil"** no próprio formulário de lançamento (e não
  num diálogo à parte): trocar o perfil esvazia conta ou cartão, fatura, destino, categoria,
  tags e meta, que passam a ser escolhidos entre os do outro perfil; voltar ao perfil original
  devolve as escolhas. Só aparecem perfis da **mesma moeda**. Numa ocorrência de série, a
  **série inteira** vai junto ("todas", direto para a revisão, sem a escolha do escopo). Regras
  em [database-design.md §4.13](database-design.md#413-transactions) ("Mover para outro perfil")
  e §4.12 ("Pertence diretamente ao perfil").
- **"Somente esta"** grava direto do diálogo de escopo, sem o diálogo de revisão, na edição e
  na exclusão: o botão vira "Salvar"/"Excluir"; "esta e as futuras" e "todas" continuam com
  "Continuar" e a revisão.
- **Atalho de pagar:** a situação "Pendente"/"Pago" é um **botão** na linha — o atalho de mouse
  do `P` —, onde marcar pago vale (não na compra do cartão nem na transferência recebida de
  outro perfil).
- **Listagem única** em Transações, no extrato de Contas e na fatura de Cartões: o mesmo
  componente, o mesmo teclado (`↑↓`, `Enter`, `P`, `Del`), o mesmo menu de contexto, o "⋯" e a
  ordenação por coluna. As colunas se adaptam: "Conta / fatura" só em Transações; a fatura não
  tem a situação, que é a da fatura. O valor continua o de cada tela (efeito no perfil, efeito
  nesta conta, quanto soma à fatura). A coluna do extrato passou a ter Valor antes de Situação,
  como em Transações, e ganhou "Rec.".
- **Seletor com busca** (`Combobox`) em toda escolha de **cadastro** nos formulários — perfil,
  conta ou cartão, conta de destino, categoria, tags, meta, conta pagadora, conta do pagamento
  parcial e destino ao mover lançamentos. Listas curtas e fixas (tipo de conta, as quatro
  moedas, frequência, as faturas sugeridas) continuam no `Select`, e a importação continua com o
  seletor nativo das tabelas de revisão.
- **Visão geral** ganhou dois blocos, sem mockup: **Metas** (nome, percentual, barra e "quanto
  de quanto · prazo", como na lista de Metas) e **Anotações** (só o título das 6 mais recentes,
  com "Ver todas"); o título abre a anotação no editor de Cadastros pelo *search param* `note`
  de `/registry`.

**Núcleo**
- [x] `profileId` opcional em `transactions.update` (`TransactionComposer.resolveOwner`), regras
  `transaction-move-currency-mismatch` e `recurrence-move-requires-all`; a série movida grava
  `profile_id` na regra e leva as referências do perfil para todas as ocorrências
  (`profileReferencesOf`)
- [x] Testes: `test/services/moveProfile.test.ts` (avulsa na conta e no cartão, referência que
  ficou no perfil antigo, outra moeda, transferência que vira interna, série em "somente esta" e
  "esta e as futuras" recusada, série inteira com ocorrência de subcategoria própria e o plano,
  complemento no perfil de destino)

**Client e desktop**
- [x] View-model `movementList.ts` (`movementsFromTransactions`, `movementsFromStatement`,
  `movementsFromInvoice`, `compareMovementRows`, `movementPermissions`); a linha do extrato
  ganhou a data de caixa crua (`cashDate`). `overviewNotes` no `overviewView.ts`
- [x] `MovementGrid.tsx` no lugar da `TransactionGrid.tsx`, e `useTransactionActions.tsx` com
  editar, pagar, excluir e abrir a fatura, usados pelas três telas
- [x] `Combobox.tsx` (escolha única e múltipla, com grupos), sobre o qual ficaram o
  `SubCategoryPicker` e o `TagPicker`
- [x] Formulário: campo "Perfil", cadastros relidos do perfil escolhido; escopo "somente esta"
  sem revisão no formulário e na exclusão; atalhos de Ajustes num grupo só
- [x] Testes: `client` (`test/movementList.test.ts`), desktop (`test/transactions.test.ts`:
  perfil no envio; `test/registry.test.ts`: `note` na URL) e ponta a ponta
  (`e2e/movements.spec.ts`: situação e edição no extrato, "somente esta" sem revisão, mover de
  perfil, blocos da Visão geral; os demais specs seguiram a ordem nova das colunas e o seletor
  com busca)

### Fase 13.3 — Tipos de meta e retirada

Entrou depois da Fase 13.2, a pedido: guardar numa poupança e retirar para um imprevisto
precisa descontar da meta, e uma meta pode ser simplesmente o saldo de uma conta de
investimento. Regras em [database-design.md §4.11](database-design.md#411-goals). **Decisões**
(perguntadas antes do código):

- A meta tem um **tipo**, escolhido no formulário de criação e de edição: **por lançamentos**
  (como até aqui) ou **saldo de uma conta**.
- Na meta por lançamentos, a transferência vinculada tem **"Guardar na meta" / "Retirar da
  meta"**; a retirada desconta do progresso e aparece negativa, com a etiqueta "retirada", na
  tabela das vinculadas. **Só a transferência retira**; a receita sempre guarda.
- Na meta vinculada a conta, o progresso é o **saldo consolidado de hoje**; ritmo e projeção
  saem da variação mensal do consolidado. Só **contas de investimento**, e a mesma conta pode
  servir a várias metas. O detalhe troca a tabela das vinculadas pelo link para o extrato.
- Trocar para a vinculada a conta **desfaz os vínculos**, com o aviso de quantos antes de
  salvar. Excluir a conta exclui a meta, e o alerta da exclusão a conta.

**Núcleo**
- [x] Migration `0005` (`goals.kind`, `goals.account_id`, `goal_withdrawal` em `transactions` e
  `recurrences`); `pnpm embed:migrations`
- [x] Domínio: `GoalFunding` na meta, `goalWithdrawal` na transação e no modelo da série
  (`withdrawsFromGoal`, exportada para o formulário); o cálculo do progresso ganhou o saldo
  inicial fora da média (`startingBalance`) e vínculos sem transação (os meses da conta)
- [x] Regras `goal-withdrawal-requires-transfer`, `goal-funded-by-account`,
  `goal-account-not-investment` e `account-type-funds-goal` (a conta que é o saldo de uma meta não
  deixa de ser de investimento; o erro vai para o campo "Tipo" do diálogo da conta); `goals.options` só com as metas por lançamentos; metas na
  exclusão em cadeia da conta (`goals` no `accounts.deletionImpact`)
- [x] Testes: `test/services/goalFunding.test.ts` (retirada no guardado e no mês passado, receita
  recusada, marca descartada sem meta, série de retirada, saldo consolidado de hoje e do fim de um
  mês passado, lançamento recusado e fora das opções, conta corrente recusada, troca de tipo
  desfazendo vínculos, exclusão da conta, troca do tipo da conta recusada com meta vinculada,
  inclusive arquivada)

**Client e desktop**
- [x] `describeGoalFunding`, `describeGoalFundingChange`, a retirada nas vinculadas e a meta no
  alerta da exclusão da conta; `goals.update` invalida
  também o conteúdo de transação e as séries
- [x] Formulário da meta com o tipo e a conta (`goalForm.ts`), detalhe com a origem do progresso
  e o link para o extrato; "Guardar/Retirar" no lançamento
- [x] Testes: `client` (`test/goalView.test.ts`, `test/deletionImpact.test.ts`), desktop
  (`test/goals.test.ts`, `test/transactions.test.ts`) e ponta a ponta (`e2e/goals.spec.ts`: meta
  vinculada ao Tesouro pelo diálogo e a transferência de retirada pelo lançamento)

**Ajustes pedidos depois** (mesma rodada)
- [x] As vinculadas da meta usam a listagem comum de movimentos (`MovementGrid`, via
  `movementsFromGoalContributions`), no lugar da tabela só de leitura: editar, marcar pago e
  excluir como em Transações. Colunas: data do pagamento, nome, categoria, conta e valor — sem a
  situação, porque só as pagas contam; o total é o guardado
- [x] Filtros de Transações com busca (`Combobox`) em conta ou cartão, categoria e tag; a situação,
  lista curta e fixa, continua no `Select`
- [x] Cabeçalho da listagem fixo no topo ao rolar: a barra superior saiu da área que rola
  (`AppShell`), a tabela perdeu a rolagem horizontal do contêiner e as seções em volta recortam
  com `overflow-clip`, que não prende o `sticky`
- [x] Telas em painéis (Contas, Cartões, Metas, Cadastros, Fluxo por conta e Por tag) com rolagem
  separada por painel (`PaneLayout`): a lista lateral rola sozinha, com o cabeçalho e o rodapé
  dos totais (consolidado e previsto das contas, faturas dos cartões) fixos; o detalhe rola à
  parte, e o cabeçalho fixo das listagens gruda no topo dele

### Fase 13.4 — Visualizações das listas e metas arquivadas

Entrou depois da Fase 13.3, a pedido. Regras em
[database-design.md §4.11](database-design.md#411-goals). **Decisões** (perguntadas antes do
código):

- Metas ganham o estado **arquivada** ("Arquivar meta"/"Reativar meta" no "⋯" do detalhe). No
  campo "Meta" do lançamento, a arquivada **só aparece na edição do lançamento já vinculado**,
  marcada "(arquivada)", como a conta desativada.
- A lista de Metas tem três **visualizações**: ativas (padrão), atingidas e arquivadas; a meta
  atingida e arquivada aparece **nas duas**. No campo "Meta", as atingidas ficam num **grupo à
  parte**.
- Contas e Cartões ganham a mesma escolha entre **ativos e desativados**; o estado continua se
  chamando "desativado" (não foi renomeado para "arquivado"). Os totais do rodapé continuam os
  do perfil inteiro.
- A visualização fica na URL (`view`). Sem ela, a conta, o cartão ou a meta pedida por um link
  abre a lista em que aparece — o "Ver extrato da conta" de uma conta desativada abre as
  desativadas.

**Núcleo**
- [x] Migration `0006` (`goals.archived_at`); `pnpm embed:migrations`
- [x] `Goal.archive`/`unarchive`, rotas `goals.archive`/`goals.unarchive`, `archived` no
  `GoalResponse`; `goals.options` com `reached` e `archived`; regra `goal-archived`
- [x] Testes: `test/services/goalArchive.test.ts`

**Client e desktop**
- [x] `listViews.ts` (`goalInView`, `registryInView`, `goalChoices`...), invalidação das rotas
  novas e a mensagem da regra
- [x] `ListViewSwitch` nas listas de Contas, Cartões e Metas; `view` em `accountsSearch.ts`,
  `cardsSearch.ts` e `goalsSearch.ts`; etiqueta "Arquivada" na lista e no detalhe; o resumo das
  metas da Visão geral mostra só as ativas, como a visualização padrão de Metas
- [x] Testes: `client` (`test/listViews.test.ts`), desktop (`test/accounts.test.ts`,
  `test/cards.test.ts`, `test/goals.test.ts`) e ponta a ponta (`e2e/goals.spec.ts`,
  `e2e/accounts.spec.ts`)

### Fase 13.5 — Limite usado sem as séries fixas futuras

Entrou depois da Fase 13.4, a pedido: as séries fixas no cartão (assinaturas) são gravadas 12
meses à frente ([database-design.md §4.12](database-design.md#412-recurrences)) e inflavam o
limite usado com um ano de cobranças que ainda não aconteceram.

- [x] Regra: o limite usado soma inteiras as faturas em aberto até a **fatura aberta hoje** (a
  que recebe uma compra feita hoje, pelo dia de fechamento); das faturas depois dela, só o já
  comprometido — parcelas e compras avulsas lançadas adiante —, sem as ocorrências de séries
  fixas (`BalanceLedgerRepository.committedInvoiceTypeTotals`, `CreditCardService.limitUsed`)
- [x] Teste: `test/services/creditCards.test.ts` (assinatura, parcelas e compra adiante)

### Fase 13.6 — Por sócio

Entrou depois da Fase 13.5, a pedido: D7 estava fora do escopo (§1). O cadastro de sócios ainda
não existe (o mockup está em preparação), e o relatório lê os sócios já gravados. Regras na
[§3.6](#36-por-sócio) e em [reports-design.md §8](reports-design.md#8-por-sócio-reportsbypartner-reportsentrieswithoutpartner).

**Núcleo**
- [x] Domínio `Partner` (só `restore`, por enquanto) e `PartnerRepository.listByProfile`
- [x] Domínio `PartnerReport`: divisão pela participação em centavos inteiros (maior resto), diferença e acerto (P3, P4), funções puras
- [x] Rota `reports.byPartner` (perfil empresarial, mês): despesas, base com sócio, sem sócio, cada sócio e o acerto — somas no SQL sobre a `REPORT_SOURCES_CTE`, que passou a trazer o `partner_id`
- [x] Rota `reports.expensesWithoutPartner`: as despesas sem sócio e o total (P5). As duas recusam perfil pessoal com `partner-requires-business-profile`
- [x] Rota `transactions.setPartner` (id, sócio ou `null`): troca só o sócio, como `setPaid`; confere perfil empresarial e posse pelo `TransactionComposer.assertPartner`
- [x] Testes de mesa (`test/services/reports.partner.test.ts`)

**Client e desktop**
- [x] Rotas no mapa de invalidação (`MONEY` e `TRANSACTION_CONTENT`; `setPartner` invalida só as transações e o relatório por sócio) e hooks `usePartnerReport`, `useExpensesWithoutPartner`
- [x] View-model `partnerReport.ts`: indicadores, tabela com a diferença por seta, sinal e palavras (decisão de interface 7), barras pagou × deveria, acerto e o aviso de participações fora de 100%
- [x] Tela `PartnerReportScreen.tsx` no lugar da tela em branco. **Decisões:** o "Ver tabela" do gráfico virou a alternância Gráfico/Tabela dos outros relatórios; a escolha de "Quem pagou" grava na hora, sem botão por linha; com mais de dois sócios o acerto lista uma transferência por linha; sem sócios cadastrados a tela explica e a coluna "Quem pagou" fica vazia
- [x] Testes: `client` (`test/partnerReport.test.ts`, `test/invalidation.test.ts`) e ponta a ponta (`e2e/partnerReport.spec.ts`, que semeava os sócios direto no banco até a Fase 13.7 trazer a rota `partners.save`)

### Fase 13.7 — Cadastro de sócios

Entrou depois da Fase 13.6, a pedido, com o mockup `DesktopSocios` (Cadastros › Sócios, só em
perfil empresarial). Regras na decisão de interface 10 dos mockups e em
[database-design.md §4.2](database-design.md#42-partners).

| # | Pergunta | Regra |
|---|---|---|
| S1 | Como grava? | A **lista inteira** de uma vez (`partners.save`): cria os novos, regrava os editados e remove os que saíram, numa transação só. Sócio a sócio, cada passo de uma redivisão (60/40 → 50/50) seria recusado pela soma |
| S2 | Soma das participações | Precisa dar **100%** para salvar, conferida em centésimos inteiros (até duas casas decimais: 33,33 + 33,33 + 33,34). Recusa com `partner-shares-not-100`. A **lista vazia** é aceita: é o estado de todo perfil empresarial novo, e remover todos precisa ter volta |
| S3 | Nome | De 1 a 100 caracteres, aparado; **pode repetir** (duas pessoas com o mesmo nome) |
| S4 | Remover sócio | Soft delete; os lançamentos e as séries que ele pagou ficam **sem sócio atribuído** (o vínculo é apagado, e não só ignorado, para que editar o lançamento não esbarre num sócio excluído). A tela avisa quantos antes de salvar |
| S5 | Perfil pessoal | `partners.list` e `partners.save` recusam com `partner-requires-business-profile`; o tipo Sócios some da lista lateral |
| S6 | Participação no histórico | A participação atual vale para todo o histórico (decisão 10 dos mockups, "regra a confirmar") |

**Núcleo**
- [x] Domínio `Partner.create`/`revise` (nome até 100, participação de 0 a 100 com até duas casas), `assertSharesComplete` (S2) e `byLargestShare`, que passou a ser a ordem do cadastro e do relatório
- [x] `PartnerRepository`: `save`, `softDelete` (S4, tira o sócio de `transactions` e `recurrences`) e `transactionCounts`
- [x] `PartnerService` e rotas `partners.list` (maior participação primeiro, com os lançamentos de cada um) e `partners.save` (S1); só regrava o sócio que mudou
- [x] `allocateByShares` exportada, para a prévia da tela dividir pela mesma conta do relatório
- [x] Testes: `test/services/partners.test.ts`

**Client e desktop**
- [x] Rotas no mapa de invalidação (`partners.save` invalida a lista, o relatório por sócio, as séries e o conteúdo das transações; `partners.list` entrou no `MONEY` e no `setPartner`, pela contagem de lançamentos) e hook `usePartners`
- [x] View-model `partnerRoster.ts`: soma ao vivo, barra de divisão, "Pagou" e "Deveria pagar" do mês com a participação digitada, avisos de soma e de remoção, e a entrada da gravação
- [x] Seção `PartnersSection.tsx` em Cadastros, e "Editar sócios e participações" no relatório por sócio, como no mockup `DesktopRelSocio` revisto. **Decisões:** "Pagou" e "Deveria pagar" são do mês de referência, que continua escondido em Cadastros (Fase 4) — o cabeçalho da coluna diz o mês; as cores `--s1` a `--s4` do mockup são os tokens `accent`, `out`, `muted` e `dot` (mesmos valores nos dois temas), e a cor de cada sócio não muda quando outro sai
- [x] Testes: `client` (`test/partnerRoster.test.ts`, `test/invalidation.test.ts`), `desktop` (`test/registry.test.ts`) e ponta a ponta (`e2e/partners.spec.ts`)

### Fase 13.8 — Aportes no lugar das despesas

Entrou depois da Fase 13.7, a pedido: toda despesa de um perfil empresarial é paga com o dinheiro
da empresa, e o sócio aparece no dinheiro que **entra** — a receita do perfil empresarial e a
transferência que chega a ele de outro perfil. O relatório por sócio passou a dividir o total de
aportes de todos os períodos pela participação (§3.6; reports-design §8). **Diverge** do mockup
`DesktopRelSocio`, desenhado sobre as despesas do mês, por decisão do usuário. A receita de serviço
fica sem sócio e fora da divisão: é lucro, cuja distribuição pela participação fica para depois.

**Núcleo**
- [x] `TransactionComposer.assertPartner`: sócio só em aporte — receita de perfil empresarial ou transferência para um perfil empresarial vinda de outro, com o sócio do perfil de destino; o resto recusa com `partner-requires-contribution`. Vale para criar, editar, séries e `transactions.setPartner`
- [x] Despesa com sócio já gravada: fica como está, não conta como aporte e mantém o sócio na edição enquanto perfil e destino não mudam (decisão do usuário: recusar só o sócio novo, sem limpar o histórico)
- [x] `PARTNER_ENTRIES_CTE` (receitas e transferências recebidas, pelo efeito no saldo), `ReportRepository.contributionTotalsByPartner` (todos os períodos e o mês) e `buildPartnerReport` sobre os aportes
- [x] Rota `reports.expensesWithoutPartner` renomeada para `reports.entriesWithoutPartner` (`TransactionRepository.listEntriesWithoutPartner`)
- [x] Testes: `test/services/reports.partner.test.ts` reescrito sobre os aportes; `test/services/partners.test.ts` com receitas

**Client e desktop**
- [x] View-model `partnerReport.ts`: indicadores "Total de aportes", "Aportes em <mês>" e "Entradas sem sócio em <mês>"; a linha "Sem sócio atribuído" saiu da tabela, que só divide aportes; lista com a transferência recebida e o total. `partnerRoster.ts`: "Aportou" e "Deveria ter aportado"
- [x] Formulário de lançamento: campo "Sócio que aportou" (`contributionProfileId`), só na receita de perfil empresarial e na transferência para um perfil empresarial, com os sócios do perfil de destino ("Sócio que aportou em Estúdio GO")
- [x] Testes: `client` (`test/partnerReport.test.ts`, `test/partnerRoster.test.ts`, `test/invalidation.test.ts`), `desktop` (`test/transactions.test.ts`) e ponta a ponta (`e2e/partnerReport.spec.ts`, com o Pix do perfil pessoal e o sócio escolhido no formulário; `e2e/partners.spec.ts`)

### Fase 13.9 — Importar cópia do banco

Entrou depois da Fase 13.8, a pedido: a Fase 13 exporta a cópia do banco, mas não havia como
trazê-la de volta. Linha "Importar cópia do banco" em Ajustes › Dados, logo após "Exportar cópia
do banco" — o mockup `DesktopAjustes` não tem a linha; a posição foi a pedida.

Regra de negócio (Cópia do banco): a cópia **substitui** os dados do aparelho, não se soma a eles
— juntar dois bancos duplicaria tudo o que têm em comum —, e o banco que sai vai para
`backups/antes-da-importacao-{instante}.sqlite`, fora da rotação automática (backend-design
§4.6), para o usuário voltar a ele se escolheu a cópia errada. Só entra cópia legível, gravada
pelo app e de versão igual ou anterior à dele; a anterior migra na reabertura, com backup antes.

- [x] Núcleo: `inspectDatabaseCopy` (ao lado de `copyDatabaseTo`, para o mobile importar pela mesma regra) — `quick_check`, `user_version` e a tabela `profiles`; recusa com `unreadable`, `not-app-database` ou `newer-than-app`, sem lançar e sem gravar no arquivo. `BetterSqliteDatabase.open` ganhou `readOnly`
- [x] `utilityProcess` (`prepare-import`): com o banco ainda aberto, recusa o próprio banco (pelos caminhos reais, como a exportação), confere a cópia numa conexão somente leitura e a grava por `VACUUM INTO` em `finance.sqlite.importando`, ao lado do banco — o `-wal` de uma cópia em WAL entra junto, e a troca vira um `rename`
- [x] Main: pede confirmação na tela, abre o diálogo de abrir (o caminho nunca vem do renderer), pede o preparo, fecha o banco e troca os arquivos por `replaceDatabase`, a mesma troca da restauração de backup, com a marca `restore-pending.json` contra o app cair no meio. Depois de fechar o banco, qualquer resultado reabre o núcleo num processo novo (`CoreProcess.restart`), que migra e verifica a integridade como em toda abertura, e recarrega as janelas; o resultado fica guardado para a tela ler uma vez (`database.takeImportNotice`), porque a resposta da chamada some com o renderer que recarregou
- [x] Tela: alerta de confirmação antes do diálogo; o resultado fica escrito na linha — o sucesso com o caminho do banco anterior, cada falha dizendo se algo mudou e o que fazer; cancelar não avisa nada
- [x] Testes: núcleo (`test/infrastructure/databaseCopy.test.ts`), desktop (`test/settings.test.ts`: preparo, recusas e textos; `test/main.test.ts`: a troca e o desfazer) e ponta a ponta (`e2e/settings.spec.ts`, com o diálogo de abrir trocado no processo principal)

### Fase 13.10 — Lista de relatórios na página

Entrou depois da Fase 13.9, a pedido, antes dos relatórios personalizados: "Relatórios" deixa de
abrir subitens no menu lateral e passa a ser um item como Contas e Cartões. A página tem a lista
dos relatórios à esquerda e o relatório aberto à direita; no menu, a lista que vai crescer com os
personalizados empurraria Metas, Cadastros e Ajustes para baixo. Diverge da decisão de interface 5
dos mockups, que foi atualizada.

- [x] `shell/navigation.ts`: o menu perdeu os subitens; `visibleReports` dá a lista do perfil ativo — "Por sócio" só no perfil empresarial
- [x] Rota de layout sem caminho (`_reports`, `reports/ReportsLayout.tsx`) com a lista à esquerda; cada relatório mantém o caminho (`/reports/...`) e desenha o lado direito: Por categoria, Impacto do cartão e Por sócio num `DetailPane`; Fluxo por conta e Por tag, que já tinham lista própria, em painéis aninhados (`NestedPanes`), com a lista deles mais estreita (`w-60`, e a de relatórios em `w-48`) para que a tabela dos cinco meses do Fluxo por conta caiba sem rolagem a 1440px
- [x] Testes: unitário do menu e da lista (`test/shell.test.ts`) e ponta a ponta (`e2e/shell.spec.ts`)

### Fase 14 — Empacotamento e validação

- [x] electron-builder (`apps/desktop/electron-builder.yml`): `.deb` para Ubuntu (`pnpm dist:linux`) e instalador NSIS para Windows (`pnpm dist:win`; no Linux, exige o Wine), nome "Finanças" e versão (1.0.0) a partir do `package.json`; `better-sqlite3` fora do `asar` (`asarUnpack`), porque o `.node` não carrega de dentro do arquivo, e só com o binário pronto do sistema do instalador. O AppImage saiu do escopo, a pedido: o alvo é o Ubuntu
  - `dependencies` do desktop ficou só com o `better-sqlite3`, o único módulo que o app carrega do disco; o resto entra no bundle do electron-vite, e o `asar` leva ~4 MB em vez da árvore inteira do renderer
  - A pasta de dados continua `userData` com o `name` do `package.json` (`~/.config/@finance/desktop`, `%APPDATA%\@finance\desktop`), a mesma do desenvolvimento: o app instalado abre o banco já usado
  - Achado: o executável fica em `/opt/Finanças`, e o Electron sai sem aviso quando o caminho do próprio executável tem acento e o locale é `C` (só em container; a sessão desktop é UTF-8). O teste do pacote roda com `LANG=C.UTF-8`
- [ ] Ícone do app (adiado, a pedido)
- [x] Build empacotado abre um banco existente, migra com backup e funciona sem a árvore do repositório: `pnpm test:packaged` gera o `.deb`, extrai numa pasta temporária fora do repositório e abre um banco parado na penúltima migration, com perfil; confere o backup `pre-v{N-1}`, o `user_version` final, a versão em Ajustes e a reabertura (`e2e/packaged.spec.ts`). O `.exe` não tem teste automatizado: conferir à mão num Windows
- [X] Rodada de uso real: lançar um mês verdadeiro e conferir os dois relatórios contra o extrato do banco e a fatura do cartão

---

## 7. Critério de pronto do MVP

- Do primeiro uso ao relatório, tudo sem tocar no banco à mão.
- Os dois relatórios conferem, centavo a centavo, com um mês real conferido à mão.
- Tema claro e escuro em todas as telas; nenhuma cor literal fora de `packages/tokens`.
- `pnpm check` verde, com os testes de mesa dos relatórios e o teste de fumaça do Electron.
- Renderer sem acesso a Node: o preload expõe só o `CoreClient`, as preferências, o estado da abertura, o relato de problema, as ações de Ajustes sobre o arquivo do banco (exportar e, desde a Fase 13.9, importar a cópia) e a abertura do arquivo a importar com os modelos de mapeamento (Fase 13.1) — nenhuma recebe caminho do renderer.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Recompilar `better-sqlite3` para o Electron quebrar no CI ou no empacotamento | Resolvido na Fase 3.3: o binário N-API do pacote carrega no Electron sem recompilar, e o teste de fumaça cobre. Na Fase 14, o `.node` saiu do `asar` e o `pnpm test:packaged` cobre o `.deb` |
| Regra de período mudar no refinamento dos relatórios | O mês de pagamento é uma expressão SQL única (Fase 2.1); os testes de mesa documentam a regra atual |
| Exclusão em cadeia apagar mais (ou menos) do que o alerta mostrou | `deletionImpact` e a exclusão usam as mesmas consultas; teste confere que o que foi apagado é exatamente o que foi contado |
| Invalidação incompleta deixar saldo velho na tela | Mapa de invalidação centralizado e testado (Fase 3.2), não `invalidateQueries` espalhado |
| Escopo crescer com recorrências e tags | Recorrências entraram numa fase própria (9.1), com as regras fechadas antes do código (database-design §4.12). Tags entraram como cadastro e marcação; o relatório por tag entrou depois, numa fase própria (12.2), também com as regras fechadas antes do código ([§3.5](#35-por-tag)) |
