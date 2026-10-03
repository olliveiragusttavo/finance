# Design dos Relatórios

**Status:** Implementado no núcleo (Fase 2 do [desktop-mvp-plan.md](desktop-mvp-plan.md)) —
rotas `reports.*`, sem tela ainda. Os relatórios serão refinados depois do MVP; as regras
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
| C3 | Peso nas entradas | Total das faturas do mês ÷ **receitas** do perfil no mesmo critério de período (transferências internas fora, porque somam zero no perfil) |
| C4 | Situação de cada célula | Paga (com o mês do extrato de pagamento), Em aberto (com o vencimento) ou Futura |
| C5 | Janela | Mês de referência, os **3 anteriores** (para a média) e o **seguinte** |

Decisões de implementação:

- **Futura × Em aberto:** sem pagamento, a fatura é **futura** enquanto ainda recebe
  compras — hoje (`Clock`) antes do fechamento — e **em aberto** depois de fechada. No dia
  do fechamento ela já fechou, porque a compra desse dia vai para a fatura seguinte
  (database-design §4.5).
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

## 6. Rotas

| Rota | Entrada | Saída |
|---|---|---|
| `reports.monthSummary` | `profileId`, `period` | Receitas, despesas, variação, faturas em aberto do mês |
| `reports.balanceEvolution` | `profileId`, `period`, `months` (1–24, padrão 6) | Consolidado e previsto do perfil por mês |
| `reports.byCategory` | `profileId`, `period`, `comparison` (padrão `previousMonth`) | Árvore categoria → subcategoria com base e variação |
| `reports.categoryTransactions` | `profileId`, `period`, `categoryId` **ou** `subCategoryId` | Despesas do drill-down e o total |
| `reports.cardImpact` | `profileId`, `period` | Grade mês × cartão, receitas, peso e indicadores |

Valores monetários vão arredondados (`MoneyResponse`); proporções vão como número (0,322
para 32,2%) e a tela formata.

## 7. Testes

| Arquivo | Cobre |
|---|---|
| `test/domain/reports.test.ts` | Bases de comparação com virada de ano, variação (base zero, base negativa), peso, janelas |
| `test/infrastructure/periodSql.test.ts` | Mês de vencimento em SQL = `BillingCycle.dueDateOf` |
| `test/services/reports.category.test.ts` | Testes de mesa da Fase 2.3 e o drill-down |
| `test/services/reports.cardImpact.test.ts` | Testes de mesa da Fase 2.4 |
| `test/services/reports.overview.test.ts` | Indicadores do mês e evolução do saldo |
| `test/services/reports.property.test.ts` | Árvore do mês = saída prevista das contas ([§2.1](#21-relatório-e-extrato-concordam)) |
