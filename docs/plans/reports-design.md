# Design dos Relatórios

**Status:** Em implementação — Fase 15 do [desktop-mvp-plan.md](desktop-mvp-plan.md#fase-15--relatórios-personalizados).
Substitui os relatórios fixos do MVP (Por categoria, Fluxo por conta, Impacto do cartão, Por sócio,
Por tag e os blocos da Visão geral que dependiam deles), descartados a pedido do usuário: em vez de
uma tela por pergunta, o usuário monta a pergunta.
**Relacionado:** [database-design.md](database-design.md) — transações, extratos, faturas e o
sinal dos valores; [backend-design.md §3.2](backend-design.md#32-o-cálculo-não-é-pesado-o-risco-é-exatidão)
— por que a agregação fica no SQL; [sync-design.md](sync-design.md) — como a definição salva
sincroniza.

Este documento é o lugar das regras de negócio dos relatórios. Mudou uma regra aqui, mudam junto o
código citado e o teste correspondente.

---

## 1. O modelo

Um relatório é uma **definição salva**, do perfil, com três partes:

| Parte | O que o usuário escolhe |
|---|---|
| **Nome** | Como o relatório aparece na lista de Relatórios |
| **Filtro** | Quais transações entram: o intervalo de tempo, a data que decide o período e qualquer atributo da transação |
| **Formato** | Como os dados aparecem: tabela agrupada, gráfico de barras ou de linha, com o agrupamento e a medida |

Abrir o relatório roda a definição contra o banco e devolve as somas já agrupadas. A definição não
guarda resultado: o relatório reflete sempre o estado atual das transações.

| Peça | Arquivo | Papel |
|---|---|---|
| Definição | `domain/report/ReportDefinition.ts` | Entidade do perfil: nome, filtro e formato, com os invariantes |
| Filtro e formato | `domain/report/ReportFilter.ts`, `domain/report/ReportLayout.ts` | Value Objects; a janela de meses sai do filtro |
| Contrato | `requests/reportRequests.ts`, `dto/reports/*` | Entrada validada (a mesma do JSON gravado) e saída serializável |
| Gravação | `SqliteReportDefinitionRepository` | Tabela `report_definitions`, definição em JSON |
| Consulta | `SqliteReportQueryRepository` | Monta o SQL a partir de listas fechadas de filtros e dimensões; só leitura |
| Montagem | `domain/report/ReportResult.ts` | Ordena, completa os meses sem valor e calcula os totais |
| Orquestração | `ReportService` | Cadastro, conferência das referências e execução |

## 2. Filtro

### 2.1 Intervalo de tempo

| # | Pergunta | Regra |
|---|---|---|
| F1 | Qual é o mês final? | **O mês de referência** da barra superior (padrão), ou um **mês fixo** escolhido na definição. "Período atual" é o mês de referência, que abre no mês de hoje |
| F2 | Quantos meses? | O mês final **mais N meses anteriores**, N de 0 a 35 — no máximo 36 meses. N = 0 é só o mês final |
| F3 | Qual data decide o mês? | Escolha da definição: **pagamento** (`payment_date`), **vencimento** (`due_date`) ou **lançamento** (`created_at`) |

Decisões de implementação:

- **Pagamento:** a transação **em aberto** (sem `payment_date`) não tem mês de pagamento e fica
  fora. Vale a data da própria transação, inclusive na compra no cartão: a data de pagamento da
  fatura não é usada.
- **Vencimento:** é o `due_date` da transação, que na compra no cartão é a data da compra
  (database-design §4.13).
- **Lançamento:** é o dia, **em UTC**, do `created_at` — quando o registro entrou no app. A
  transação importada conta no dia da importação. O núcleo não conhece o fuso do usuário (o
  `Clock` só dá a data de hoje), então uma transação digitada depois das 21h no horário de Brasília
  pode cair no dia seguinte, e no último dia do mês, no mês seguinte.
- **Mês fixo × mês de referência:** a definição com mês fixo ignora o mês de referência. Assim um
  relatório "Ano de 2025" continua mostrando 2025 quando o usuário navega pelos meses.

### 2.2 Atributos da transação

| # | Filtro | Regra |
|---|---|---|
| A1 | Tipos | Receita, despesa, transferência, investimento |
| A2 | Categorias e subcategorias | A transação entra quando a subcategoria dela **ou** a categoria dessa subcategoria está escolhida |
| A3 | Contas e cartões | A **origem**: o extrato da conta ou a fatura do cartão em que a transação está. Contas e cartões escolhidos se somam (OU) |
| A4 | Tags | **Qualquer uma** das escolhidas (padrão) ou **todas** elas. Só vínculos e tags vivos contam |
| A5 | Sócios | O sócio vinculado à transação |
| A6 | Metas | A meta vinculada à transação |
| A7 | Situação | Todas (padrão), só pagas ou só em aberto, pelo `payment_date` |
| A8 | Valor | Mínimo e máximo, inclusivos, sobre o `value` (com sinal: estorno é negativo) |

Regra de combinação: **lista vazia não restringe**. Dentro de um filtro as escolhas se somam (OU);
entre filtros diferentes, todos precisam valer (E). Exemplo: "despesas" + "Mercado, Restaurante" +
tag "viagem" = despesas de Mercado ou Restaurante marcadas com "viagem".

Decisões de implementação:

- **Perfil:** entram as transações cujo contêiner (extrato ou fatura) é do perfil, com o soft
  delete conferido em toda tabela envolvida. A transferência que chega de outro perfil é uma linha
  do perfil de origem (database-design §4.13) e não aparece no relatório do destino.
- **Referências conferidas ao salvar:** toda categoria, subcategoria, conta, cartão, tag, sócio e
  meta do filtro precisa existir e ser do perfil, ou a gravação é recusada com `NOT_FOUND`. Um
  cadastro excluído depois continua na definição e **não casa com nada**. Ele não é removido em
  silêncio, porque um filtro "só a categoria X" que perdesse o X viraria "todas as categorias".
- **Contas e cartões desativados** entram normalmente: o histórico não muda.
- **Fora da primeira versão:** busca por texto no nome ou na descrição. O `LIKE` do SQLite só
  ignora maiúsculas em ASCII ("Açaí" não acharia "AÇAÍ"), e a busca certa pede uma função de
  comparação própria (`foldName`), registrada no adaptador.

## 3. Formato

| # | Pergunta | Regra |
|---|---|---|
| L1 | Formatos | **Tabela** (sempre agrupada), **gráfico de barras** ou **gráfico de linha** |
| L2 | Agrupamento | Uma **dimensão principal** obrigatória e uma **secundária** opcional. Na tabela, a principal são as linhas e a secundária, as colunas. No gráfico, a principal é o eixo e a secundária, as séries |
| L3 | Dimensões | Mês (pela data do F3), tipo, categoria, subcategoria, origem (conta ou cartão), tag, sócio, situação |
| L4 | Medida | **Soma do valor** ou **quantidade de lançamentos** |
| L5 | Principal e secundária iguais | Recusado (`report-dimensions-repeated`): agrupar duas vezes pela mesma coisa só repete a diagonal |

Decisões de implementação:

- **Soma do valor:** soma o `value` como gravado. O estorno (negativo) abate o próprio grupo e os
  encargos ficam fora, porque são custo do meio de pagamento e mudam de sentido conforme o tipo
  (database-design §4.13, Encargos). Somar receitas e despesas no mesmo grupo dá o volume
  movimentado, não o saldo. Para ver entradas × saídas, agrupa-se pelo tipo.
- **Grupo sem valor:** transação sem tag cai em "Sem tag", sem sócio em "Sem sócio". O grupo tem
  chave `null`, e a tela dá o rótulo.
- **Tag como dimensão:** a transação com duas tags conta nas duas. Por isso o **total geral é
  calculado à parte**, contando cada transação uma vez. Nesse caso ele é menor que a soma das
  linhas, e a tela avisa. Os totais por linha e por coluna seguem a mesma regra.
- **Ordem:** o mês é cronológico e traz **todos os meses da janela**, inclusive os sem lançamento
  (com zero), para que o gráfico de linha não pule meses. As demais dimensões vão do maior número
  para o menor na medida escolhida (o valor absoluto da soma, ou a quantidade), com desempate pelo
  rótulo, e o grupo "sem" (sem tag, sem sócio) por último. O tipo e a situação seguem a ordem fixa
  do domínio.
- **Nomes:** os rótulos de categoria, conta, tag etc. vêm do cadastro vivo. Um grupo de cadastro
  excluído (a transação continua viva) aparece com o nome que ele tinha, porque o nome continua na
  linha excluída.

## 4. Armazenamento e sincronização

- **Tabela `report_definitions`** (migration `0007`): `id`, `profile_id`, `name` (1 a 100
  caracteres), `definition` (JSON do filtro e do formato), mais `created_at`, `updated_at` e
  `deleted_at`, como toda tabela (database-design §3.6). O nome é único no perfil, sem diferenciar
  maiúsculas, conferido no Service (`sameName`), como as tags.
- **Por que JSON numa coluna:** o filtro tem uma dezena de listas de ids, e uma tabela de vínculo
  para cada uma não teria consulta além de "carregar a definição". O JSON tem `version: 1`, e quem
  lê é o mesmo schema zod da entrada da rota. Uma mudança de formato futura ganha `version: 2` e
  uma conversão na leitura, sem migration de dados.
- **Sincronização:** a unidade de merge é a coluna (sync-design §5.1). A definição inteira é uma
  célula, então duas edições concorrentes do mesmo relatório não se misturam: vence a mais recente
  inteira. Misturar campo a campo poderia produzir uma combinação que nenhum dos dois montou (a
  dimensão de um com o filtro do outro).
- **Excluir** é soft delete da definição. Nenhuma transação é tocada.

## 5. Rotas

| Rota | Entrada | Saída |
|---|---|---|
| `reports.list` | `profileId` | Definições do perfil, por nome |
| `reports.get` | `id` | A definição |
| `reports.create` | `profileId`, `name`, `filter`, `layout` | A definição criada |
| `reports.update` | `id`, `name`, `filter`, `layout` | A definição regravada |
| `reports.delete` | `id` | `null` |
| `reports.run` | `id`, `period` (mês de referência) | O resultado da definição salva |
| `reports.preview` | `profileId`, `period`, `filter`, `layout` | O resultado sem salvar, para o editor mostrar enquanto o usuário monta |

O resultado traz os meses da janela, os grupos da dimensão principal (e da secundária, se houver),
as células (`valor` arredondado como `MoneyResponse` e `quantidade`), os totais por linha, por
coluna e o geral, e o aviso de que os totais não são a soma das linhas quando a tag é uma das
dimensões.

## 6. Testes

| Arquivo | Cobre |
|---|---|
| `test/domain/reportDefinition.test.ts` | Janela de meses (virada de ano, mês fixo × referência, limites de N), dimensões repetidas, nome, ordem e preenchimento dos meses |
| `test/services/reports.definitions.test.ts` | Cadastro: nome único, referências de outro perfil recusadas, cadastro excluído que continua na definição, soft delete |
| `test/services/reports.run.test.ts` | As três bases de data (pagamento sem em aberto, vencimento, lançamento), cada filtro e a combinação E/OU, estorno, tag com duas tags e o total à parte, grupos "sem", perfil vizinho fora, `preview` = `run` |
| `packages/client/test/reportEditor.test.ts`, `reportView.test.ts` | Leitura do rascunho do editor, reabrir e regravar a definição, descrição dos filtros, rótulos dos grupos, tabela, gráfico e "Outros" |
| `packages/client/test/invalidation.test.ts` | Toda escrita invalida os resultados de relatório que muda |
| `apps/desktop/e2e/reports.spec.ts` | Montar com o resultado ao vivo, salvar, editar para gráfico por mês e excluir |

Telas (desktop, sem mockup): `/reports` lista os relatórios e mostra o aberto (`report` na URL);
`/reports/edit` é o editor, com o resultado ao vivo pela rota `reports.preview`. O gráfico vem sempre
com a alternância para a tabela equivalente e desenha até cinco séries — as quatro maiores e
"Outros" —, com as cores dos tokens `accent`, `out`, `dot`, `muted` e `ink2`.

## 7. Próximos passos

- Busca por texto no nome e na descrição (§2.2).
- Medida **líquida** (entradas − saídas), que hoje se monta agrupando pelo tipo.
- Comparações entre períodos e drill-down até os lançamentos de um grupo.
- Os relatórios no celular.
