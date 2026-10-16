# Design dos Relatórios

**Status:** Implementado no núcleo e nas telas — Fases 2, 10 a 12, 12.1, 12.2 e 13.6 do
[desktop-mvp-plan.md](desktop-mvp-plan.md), rotas `reports.*`. Os relatórios serão refinados depois do MVP; as regras
abaixo valem para esta primeira versão.
**Relacionado:** [desktop-mvp-plan.md §3](desktop-mvp-plan.md#3-regras-de-negócio-dos-relatórios)
— onde as regras foram decididas; [database-design.md](database-design.md) — extratos,
faturas e o sinal das transações; [backend-design.md §3.2](backend-design.md#32-o-cálculo-não-é-pesado-o-risco-é-exatidão)
— por que a agregação fica no SQL.

Este documento é o lugar das regras de negócio dos relatórios e das decisões tomadas ao
implementá-las. A [§2](#2-regra-mestra-o-período-é-o-do-pagamento) vale para todos os
relatórios; as seções seguintes, para cada um. Mudou uma regra aqui, mudam junto o código
citado e o teste de mesa correspondente.

---

## 1. Onde cada regra mora

| Peça | Arquivo | Papel |
|---|---|---|
| Mês de pagamento | `infrastructure/sqlite/periodSql.ts` (`REPORT_SOURCES_CTE`) | Fonte única do período de todo relatório |
| Somas | `SqliteReportRepository` | `SUM`/`COUNT` agrupados pelo mês de pagamento; só leitura |
| Regras | `domain/report/*` | Comparação, variação, peso, árvore, grade — funções puras |
| Orquestração | `ReportService` | Lê numa unidade de trabalho e chama os montadores |
| Contrato | `requests/reportRequests.ts`, `dto/reports/*` | Entrada validada e saída serializável |

## 2. Regra-mestra: o período é o do pagamento

Regra de negócio (Relatórios): **todo relatório agrupa pelo mês em que o dinheiro de fato
sai (ou entra) na conta** — o regime de caixa —, não pela data da compra.

| Situação | Mês em que conta |
|---|---|
| Transação de conta paga | Mês do `payment_date` |
| Transação de conta em aberto | Mês do `due_date` |
| Compra no cartão com fatura paga | Mês do extrato em que a fatura foi paga (`invoices.bank_statement_id`) |
| Compra no cartão com fatura em aberto | Mês do **vencimento** da fatura |

É a mesma regra do extrato: a transação de conta já está no extrato do mês da sua data de
caixa — pagamento, ou vencimento em aberto (database-design §4.13) —, então o relatório lê
o mês do próprio extrato, e as faturas pesam no extrato do pagamento ou no vencimento.
Relatório e extrato concordam por construção sobre em que mês um valor pesa.

Pagar ou reabrir uma fatura move suas compras de mês no relatório, e isso é o esperado.
Uma fatura cujo extrato de pagamento foi excluído volta a contar como em aberto, como no
saldo.

O critério é **uma CTE só**, `REPORT_SOURCES_CTE`, usada por todas as consultas de
relatório e pela lista do drill-down. O mês de vencimento da fatura em aberto é calculado
em SQL pela mesma regra de `BillingCycle.dueDateOf`, e um teste confere a equivalência com
o domínio para todos os 961 pares de dias de fechamento e vencimento em meses de 28 a 31
dias (`test/infrastructure/periodSql.test.ts`).

### 2.1 Relatório e extrato concordam

O teste de propriedade (`reports.property.test.ts`) verifica a concordância: operações
aleatórias só com despesas — pagamento em qualquer mês, marcar e desmarcar pago, pagar e
reabrir faturas — e, em todo mês, total da árvore = saída prevista das contas lida dos
extratos.

## 3. Relatório por categoria (`reports.byCategory`, `reports.categoryTransactions`)

| # | Pergunta | Regra |
|---|---|---|
| R1 | Período | Regra-mestra da [§2](#2-regra-mestra-o-período-é-o-do-pagamento) |
| R2 | Quais tipos entram? | **Só despesas**. Estorno (valor negativo) abate a mesma subcategoria. Receita, transferência e investimento ficam fora |
| R3 | Encargos entram? | **Sim**, pelo mesmo cálculo do efeito no saldo (`originEffect`: valor + encargos) — o relatório não reimplementa a regra de sinal |
| R4 | Contas com "considerar no saldo" desligado? | **Entram**: o valor já está na moeda do perfil e o gasto aconteceu. Contas e cartões desativados também |
| R5 | Comparações | Mês anterior; mesmo mês do ano anterior; **média simples dos 3 meses anteriores, contando mês sem lançamento como zero** |
| R6 | Variação % com base zero | **"novo"** em vez de % (divisão por zero não vira ∞ nem 0%) |

Decisões de implementação:

- **Quais linhas aparecem:** a subcategoria com ao menos um lançamento no mês **ou** na
  base de comparação. A categoria que zerou no mês, mas teve gasto antes, aparece com 0 —
  é o estado "sem lançamentos no período mas com na comparação" da tela.
- **Os dois lados zerados** (compra e estorno que se anulam): variação de 0%, não "novo".
- **Base negativa** (estornos maiores que as compras): a proporção é calculada sobre o
  módulo da base, para não inverter o sinal da variação.
- **Agregação:** a categoria soma as subcategorias e o total soma as categorias; a base da
  categoria é a soma das bases, porque a média é linear.
- **Ordem:** maior gasto primeiro, desempate pela base e depois pelo nome.
- **Drill-down:** a lista usa a mesma CTE e o mesmo cálculo de gasto da árvore, então o
  total da lista é sempre o valor da linha. Aceita a categoria inteira ou uma subcategoria
  (exatamente uma das duas) e recusa id de outro perfil com `NOT_FOUND`.

## 4. Impacto do cartão (`reports.cardImpact`)

| # | Pergunta | Regra |
|---|---|---|
| C1 | "Faturas de out" é qual fatura? | As **pagas em out** mais as **em aberto que vencem em out** |
| C2 | Total de uma fatura | **Despesas líquidas de estornos, com encargos, sem descontar pagamentos parciais**: o pagamento parcial já saiu da conta, então ainda é peso do cartão |
| C3 | Peso nas entradas | Total das faturas do mês ÷ **receitas** do perfil no mesmo critério de período (transferências internas fora, porque somam zero no perfil; a transferência recebida de outro perfil entra como receita — database-design §4.13, "Transferência entre perfis") |
| C4 | Situação de cada célula | Paga (com o mês do extrato de pagamento e o dia do pagamento), Em aberto (com o vencimento), Aberta ou Futura |
| C5 | Janela | Mês de referência, os **3 anteriores** (para a média) e o **seguinte** |

Decisões de implementação:

- **Em aberto × Aberta × Futura:** sem pagamento, a fatura está **em aberto** (`open`)
  depois de fechada, **aberta** (`receiving`) enquanto recebe as compras de hoje — hoje
  (`Clock`) entre o fechamento anterior, inclusive, e o próprio — e **futura** (`future`)
  antes de começar a recebê-las (só parcelas ou compras postas nela à mão). No dia do
  fechamento ela já fechou, porque a compra desse dia vai para a fatura seguinte
  (database-design §4.5). O fechamento anterior vem do ciclo do cartão, e não da fatura
  anterior, que pode nem existir; é a mesma regra das fases da tela Cartões
  (`invoiceStage` no `client`). Até a Fase 12 do MVP, aberta e futura eram uma só.
- **Dia do pagamento:** a paga traz, além do mês do extrato, o dia (`invoices.payment_date`),
  que a tela mostra no mês de referência ("Paga em 07/10"). É `null` nas faturas pagas antes
  da migration `0003`, que não gravavam o dia, e só existe quando a fatura conta como paga —
  com o extrato de pagamento excluído ela volta a ser em aberto.
- **Uma célula pode ter mais de uma fatura:** a de setembro paga com atraso em outubro e a
  de outubro que vence em outubro pesam as duas em outubro. A célula soma as duas.
- **Fatura sem nenhuma transação viva** não aparece (sobra de lançamentos excluídos).
- **C2 conta só despesas:** receitas lançadas no cartão e encargos de pagamento parcial
  não entram no total.
- **Peso indefinido:** receita zero ou negativa (só devoluções) dá peso `null`.
- **Média dos 3 meses anteriores:** total = soma ÷ 3 (mês sem fatura conta zero); peso =
  soma dos totais ÷ soma das receitas dos três meses.
- **Colunas:** todos os cartões vivos do perfil, ativos e desativados.

## 5. Visão geral (`reports.monthSummary`, `reports.balanceEvolution`)

- **Receitas e despesas do mês:** pela regra-mestra, da mesma fonte do relatório por
  categoria — o total de despesas da Visão geral e o do relatório nunca discordam.
  Receitas descontam as próprias tarifas (database-design §4.13, Encargos).
- **Variação das despesas:** contra o mês anterior, com a regra R6.
- **Faturas em aberto:** as em aberto que **vencem** no mês de referência, pelo **valor a
  pagar** — líquido dos pagamentos parciais, fatura credora contando zero (`amountDue`, a
  mesma regra da lista de cartões). É diferente do total C2 de propósito: aqui a pergunta
  é quanto ainda vai sair da conta.
- **Evolução do saldo:** consolidado e previsto do perfil no fim de cada mês, lidos dos
  extratos já calculados, sem recalcular. Mês sem extrato repete o fechamento anterior;
  antes do primeiro extrato vale o saldo inicial da conta. Entram só as contas com
  "considerar no saldo" ligado, inclusive desativadas; excluídas saem. A série tem de 1 a
  24 meses, 6 por padrão (o gráfico do mockup).

## 6. Fluxo por conta (`reports.accountFlow`)

| # | Pergunta | Regra |
|---|---|---|
| F1 | Janela | A mesma do impacto do cartão (C5): os **3 meses anteriores**, o de referência e o **seguinte** — `accountFlowWindow` reaproveita `cardImpactWindow` |
| F2 | De onde vêm os números? | Do **extrato** de cada conta (`StatementConsolidationService.getStatement`), o mesmo da tela Contas: inicial + entradas + saídas + faturas = final, no consolidado e no previsto |
| F3 | O que é "Faturas"? | As faturas pagas no extrato, as em aberto que vencem no mês (só no previsto) e os pagamentos parciais que saem da conta. Entradas e saídas são os outros movimentos, pelo sinal do efeito |
| F4 | "Todas as contas do total" | **Soma simples dos extratos** das contas com "considerar no saldo" ligado, desativadas incluídas: a transferência entre duas delas aparece em entradas e em saídas |
| F5 | Consolidado × previsto | As linhas de movimento vão com os dois saldos; a tela mostra o previsto e quanto está em aberto. Cada mês traz a situação em relação a hoje (`past`, `current`, `future`, pelo `Clock`); no futuro o consolidado final é "—" |
| F6 | Conta fora do total | Pode ser pedida sozinha; não entra na soma |

Decisões de implementação:

- **Uma lista de movimentos só:** `statementMovements` (domínio do extrato) reduz cada linha do
  extrato ao efeito, se já aconteceu e se é fatura. O extrato separa entradas e saídas dela, e o
  fluxo separa as faturas da mesma lista — um movimento novo entra nos dois de uma vez.
- **Conta de outro perfil** é recusada com `NOT_FOUND`.
- **Arredondamento:** cada linha é arredondada uma vez, no DTO, a partir das somas sem
  arredondar, como as entradas e saídas do extrato.

## 7. Por tag (`reports.byTag`, `reports.tagTransactions`)

| # | Pergunta | Regra |
|---|---|---|
| T1 | Período | Regra-mestra da [§2](#2-regra-mestra-o-período-é-o-do-pagamento). `month` (o mês de referência) ou `all` (padrão): **todo o histórico, futuro incluído** — parcelas e lançamentos em aberto, cada um no mês em que vai pesar |
| T2 | Quais tipos entram? | **Despesas menos receitas** (total líquido). Estorno abate o próprio lado; encargos pelo efeito no saldo (despesa: valor + encargos; receita: valor − tarifa). Transferência e investimento ficam fora, inclusive a transferência entre perfis |
| T3 | Lista de tags | Só as com lançamento no período; ordem pelo líquido (maior primeiro), desempate pelo nome |
| T4 | Por categoria | Líquido de cada categoria. Participação = líquido ÷ soma dos líquidos positivos; categoria com líquido ≤ 0 fica com participação `null` |
| T5 | Lançamentos | Os da tag no período, com a mesma CTE e os mesmos tipos das somas: a lista soma o total líquido |

Decisões de implementação:

- **Agregação:** `tagTotalsByCategory` soma por tag, categoria e tipo, com o primeiro e o último
  mês de pagamento; a lista de tags e a divisão por categoria saem da mesma consulta.
- **Vínculo vivo:** o vínculo com a tag e a própria tag precisam estar vivos — excluir a tag a
  tira do relatório. Os nomes de categoria são só rótulos, como no relatório por categoria.
- **Tag de outro perfil** é recusada com `NOT_FOUND` na lista de lançamentos.
- **Sinais na saída:** `expense`, `income` e `net` vão cada um no seu sentido (`net` positivo é
  gasto). A tela mostra o gasto sem sinal ("Total gasto") e a entrada líquida com `+`; com receita
  o indicador vira "Total líquido" e explica as duas partes.

## 8. Por sócio (`reports.byPartner`, `reports.entriesWithoutPartner`)

Só em perfil empresarial: no pessoal as duas rotas recusam com `partner-requires-business-profile`.
Revisto na Fase 13.8 do [desktop-mvp-plan.md](desktop-mvp-plan.md): o relatório deixou de dividir
as despesas e passou a dividir os **aportes**. Toda despesa de um perfil empresarial é paga com o
dinheiro da empresa; o que cada sócio põe na empresa é o dinheiro que entra vinculado a ele.

| # | Pergunta | Regra |
|---|---|---|
| P1 | Período | Os aportes de **todos os períodos** formam o total e a divisão. O mês de referência só recorta os indicadores do mês ("Aportes em out/2026", "Entradas sem sócio em out/2026") e a lista de entradas sem sócio, pela regra-mestra da [§2](#2-regra-mestra-o-período-é-o-do-pagamento) |
| P2 | O que é aporte? | **Receita** do perfil empresarial e **transferência que chega a ele de outro perfil**, com sócio. A receita vale o que entrou no saldo (valor − encargos), a transferência, o valor (os encargos são da origem). Despesa, investimento e transferência entre contas do próprio perfil não são aporte |
| P3 | "Deveria ter aportado" | Total de aportes **com sócio** × participação. Ex.: Matheus (60%) e Gustavo (40%) aportaram R$ 1.000,00 cada; do total de R$ 2.000,00, Matheus deveria R$ 1.200,00 e Gustavo R$ 800,00. Entradas sem sócio ficam **fora da divisão**: a receita de serviço é lucro, não aporte (a distribuição do lucro pela participação é assunto futuro). Com as participações somando 100%, a sobra do arredondamento vai para os maiores restos e a divisão soma exatamente o total |
| P4 | Acerto | Diferença = aportou − deveria. O maior devedor paga o maior credor até zerar um dos dois — no exemplo, "Matheus transfere R$ 200,00 para Gustavo". **Sem acerto** quando as participações não somam 100%: as diferenças não fechariam em zero |
| P5 | Entradas sem sócio | As entradas do mês (P2) sem sócio vivo do perfil, com a mesma CTE das somas (`PARTNER_ENTRIES_CTE`): a lista soma o indicador. A transferência aparece como "Transferência recebida", com a conta de origem do outro perfil |

Decisões de implementação:

- **Onde o sócio pode ser vinculado** (`TransactionComposer.assertPartner`): só no aporte (P2). Em
  outro lançamento a gravação recusa com `partner-requires-contribution`; numa entrada de perfil
  pessoal, com `partner-requires-business-profile`. Na transferência entre perfis a linha é do perfil
  de origem (database-design §4.13), mas o sócio é do perfil **de destino**.
- **Despesa com sócio gravada antes da revisão** fica como está: não conta como aporte, e editar a
  despesa mantém o sócio enquanto perfil e destino não mudam. Só não ganha um sócio novo.
- **Sócio excluído** (soft delete) ou de outro perfil conta como sem sócio: o vínculo morto não diz
  mais quem aportou, e a lista pede para atribuir de novo.
- **Todos os sócios vivos aparecem**, mesmo sem aporte, pela participação (maior primeiro) e depois
  pelo nome.
- **Centavos inteiros:** a divisão e o acerto trabalham em unidades menores, para que a soma das
  partes seja o total e o acerto zere as diferenças sem sobra.
- **Atribuir pelo relatório:** a rota `transactions.setPartner` troca só o sócio de uma transação,
  como `transactions.setPaid` troca o pagamento — numa série, só a ocorrência. Confere a mesma regra
  de aporte. Não recalcula saldo: o sócio não pesa em nenhum.
- **Atribuir no lançamento:** o formulário mostra "Sócio que aportou" só quando o lançamento é aporte,
  com os sócios do perfil certo — o de destino, na transferência para outro perfil.
- **Cadastro de sócios:** criar, editar, remover e conferir a soma de 100% ficam no cadastro
  (rotas `partners.list` e `partners.save`, desktop-mvp-plan Fase 13.7), que mostra o "Aportou" e o
  "Deveria ter aportado" de cada sócio. Remover um sócio apaga o vínculo dos lançamentos e das
  séries ligados a ele, que voltam a ser entradas sem sócio.

## 9. Rotas

| Rota | Entrada | Saída |
|---|---|---|
| `reports.monthSummary` | `profileId`, `period` | Receitas, despesas, variação, faturas em aberto do mês |
| `reports.balanceEvolution` | `profileId`, `period`, `months` (1–24, padrão 6) | Consolidado e previsto do perfil por mês |
| `reports.byCategory` | `profileId`, `period`, `comparison` (padrão `previousMonth`) | Árvore categoria → subcategoria com base e variação |
| `reports.categoryTransactions` | `profileId`, `period`, `categoryId` **ou** `subCategoryId` | Despesas do drill-down e o total |
| `reports.cardImpact` | `profileId`, `period` | Grade mês × cartão, receitas, peso e indicadores |
| `reports.accountFlow` | `profileId`, `period`, `accountId` opcional (sem ele, as contas do total) | Linhas de cada mês da janela no consolidado e no previsto, com a situação do mês |
| `reports.byTag` | `profileId`, `period`, `range` (`all` padrão, ou `month`) | Tags com despesas, receitas, líquido, lançamentos, intervalo de meses e divisão por categoria |
| `reports.tagTransactions` | `profileId`, `period`, `range`, `tagId` | Receitas e despesas da tag e o total líquido |
| `reports.byPartner` | `profileId` (empresarial), `period` | Total de aportes (todos os períodos), aportes e entradas sem sócio do mês, cada sócio (participação, aportou, deveria, diferença), soma das participações e o acerto |
| `reports.entriesWithoutPartner` | `profileId` (empresarial), `period` | Entradas do mês sem sócio (receitas e transferências vindas de outro perfil) e o total |

Valores monetários vão arredondados (`MoneyResponse`); proporções vão como número (0,322
para 32,2%) e a tela formata.

## 10. Testes

| Arquivo | Cobre |
|---|---|
| `test/domain/reports.test.ts` | Bases de comparação com virada de ano, variação (base zero, base negativa), peso, janelas |
| `test/infrastructure/periodSql.test.ts` | Mês de vencimento em SQL = `BillingCycle.dueDateOf` |
| `test/services/reports.category.test.ts` | Testes de mesa da Fase 2.3 e o drill-down |
| `test/services/reports.cardImpact.test.ts` | Testes de mesa da Fase 2.4 |
| `test/services/reports.overview.test.ts` | Indicadores do mês e evolução do saldo |
| `test/services/reports.property.test.ts` | Árvore do mês = saída prevista das contas ([§2.1](#21-relatório-e-extrato-concordam)) |
| `test/services/reports.accountFlow.test.ts` | Cadeia dos saldos, concordância com o extrato, faturas e parciais, em aberto só no previsto, soma das contas do total |
| `test/services/reports.tag.test.ts` | Mês do pagamento, futuro em "todo o período", reembolso, estorno, encargos, transferência fora, participação, ordem, lista = total |
| `test/services/reports.partner.test.ts` | Exemplo dos aportes, todos os períodos × mês, receita de serviço e despesa fora, encargos e devolução, despesa antiga com sócio, sócio sem aporte, sócio excluído, maior resto, acerto com três sócios, participações fora de 100%, lista = indicador, onde o sócio pode ser vinculado, `setPartner` numa ocorrência e recusas |
