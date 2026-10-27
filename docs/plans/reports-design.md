# Design dos Relatórios

**Status:** Em implementação — Fase 15 do [desktop-mvp-plan.md](desktop-mvp-plan.md#fase-15--relatórios-personalizados).
Substitui os relatórios fixos do MVP (Por categoria, Fluxo por conta, Impacto do cartão, Por sócio,
Por tag e os blocos da Visão geral que dependiam deles), descartados a pedido do usuário: em vez de
uma tela por pergunta, o usuário monta a pergunta. Ficam **fixos**, no topo da lista, só os que o
editor não expressa: a distribuição por sócio, que voltou (§8), e a projeção de saldo (§9).
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
  delete conferido em toda tabela envolvida, e a **transferência que chega de outro perfil**. Ela é
  uma linha do perfil de origem (database-design §4.13), mas o dinheiro entra numa conta do
  destino, e sem ela o relatório de transferências do destino não via o que recebeu. No destino
  ela entra pela conta de destino (é a "origem" dela em A3 e na dimensão de origem) e pelo sócio,
  que é do destino. A categoria, a subcategoria, as tags e a meta são do perfil de origem: ela cai
  em "Sem categoria", "Sem subcategoria" e "Sem tag", e um filtro por esses cadastros não a inclui.
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
| L1 | Formatos | **Tabela** (sempre agrupada), **gráfico de barras**, **gráfico de linha** ou **gráfico de pizza** |
| L2 | Agrupamento | Uma **dimensão principal** obrigatória e uma **secundária** opcional. Na tabela, a principal são as linhas e a secundária, as colunas. No gráfico, a principal é o eixo e a secundária, as séries |
| L3 | Dimensões | Mês (pela data do F3), tipo, entrada ou saída, categoria, subcategoria, origem (conta ou cartão), tag, sócio, situação, recorrência |
| L4 | Medida | **Soma do valor** ou **quantidade de lançamentos** |
| L5 | Principal e secundária iguais | Recusado (`report-dimensions-repeated`): agrupar duas vezes pela mesma coisa só repete a diagonal |
| L6 | Recorrência | **Fixas**, **parceladas** e **avulsas**: a ocorrência de uma série conta pelo tipo da regra (database-design §4.12), e a transação sem `recurrence_id` é avulsa |
| L7 | Pizza | Só a **dimensão principal**, uma fatia por grupo; com secundária, recusado (`report-pie-secondary`), porque um círculo só divide um todo |
| L8 | Entrada ou saída | **Entrada** e **saída** pelo efeito no saldo das contas do perfil, qualquer que seja o tipo |
| L9 | Análise | Campo do formato, desligado por padrão: cada configuração ganha uma informação a mais, definida caso a caso pelo usuário (ver "Análise" abaixo) |

Decisões de implementação:

- **Soma do valor:** soma o `value` como gravado. O estorno (negativo) abate o próprio grupo e os
  encargos ficam fora, porque são custo do meio de pagamento e mudam de sentido conforme o tipo
  (database-design §4.13, Encargos). Somar receitas e despesas no mesmo grupo dá o volume
  movimentado, não o saldo. Para ver entradas × saídas, agrupa-se por entrada ou saída (L8).
- **Entrada e saída (L8):** cada transação vira um movimento por conta do perfil que ela toca: a
  origem (a receita soma; despesa, transferência e investimento subtraem; o `value` negativo
  inverte) e o destino da transferência ou do investimento, quando é do perfil (soma o `value`).
  A transferência entre contas do perfil conta **nos dois lados**, como saída e como entrada; a que
  vem de outro perfil só como entrada, e a que vai para outro perfil só como saída. Com essa
  dimensão a soma é o **efeito no saldo**, com a saída negativa, também nos totais em que ela não
  aparece: o total da linha e o geral são o líquido (entradas − saídas), e a transferência interna
  se anula nele. A quantidade conta cada transação uma vez. Na dimensão de origem, cada movimento
  fica com a própria conta: a chegada de uma transferência interna é da conta de destino. Pelo
  mesmo motivo, o filtro de conta e de cartão (A3) vale para cada movimento: filtrando a corrente,
  a transferência dela para a corretora entra só como saída, e a que chega a ela, só como entrada.
  Na pizza vale o tamanho de cada lado.
- **Recorrência:** a avulsa é um grupo de verdade (chave `single`), não um grupo "sem". A regra
  excluída continua valendo para a ocorrência que ficou viva: a parcela que sobrou continua sendo
  parcela, assim como o nome de um cadastro excluído continua legível.
- **Pizza:** só grupo de soma positiva vira fatia — um negativo (estorno maior que a compra) não
  tem ângulo e deixaria as participações sem somar 100%; a tela avisa e a tabela traz todos. A
  participação é sobre a soma das fatias. Como nas séries, os grupos além do quarto maior viram
  "Outros", e as fatias mantêm a ordem do resultado. No editor, o campo da segunda divisão some
  na pizza, mas fica guardado no rascunho para quem volta a barras ou tabela.
- **Análise (L9):** um campo liga/desliga do formato, gravado no JSON com padrão desligado (a
  definição de antes dele lê sem análise, ainda na `version: 1`). O que ela acrescenta depende da
  configuração, e cada caso novo é uma regra nova aqui. O editor diz, embaixo da caixa, o que a
  análise acrescenta no formato escolhido. Os cálculos ficam no `client` (`reportView`), a partir
  do resultado do núcleo, para que o celular mostre o mesmo:
  - **Entrada ou saída, na soma:** o **resultado**, entradas menos saídas. Na tabela, o total
    dessa divisão passa a se chamar "Resultado" (a linha do rodapé ou a coluna do total); no
    gráfico, é um ponto a mais no eixo (entrada e saída nas linhas) ou uma série a mais (nas
    séries); na pizza, uma linha a mais na legenda. Na quantidade não há resultado: a diferença
    entre quantidades não mede nada.
  - **Mês numa das divisões, na tabela:** cada valor ganha o **percentual de variação** em
    relação ao mesmo grupo no mês anterior — a linha de cima quando o mês são as linhas, a coluna
    à esquerda quando são as colunas —, e os totais do mês também. A conta é
    `(atual − anterior) / |anterior|`: a saída (negativa) que fica mais negativa aparece como
    redução do valor. Sem mês anterior ou com ele zerado não há percentual. A variação aparece
    também na tabela que acompanha os gráficos, com seta, sinal e a cor da direção: o aumento nos
    tokens `in` e a redução em `out`, as cores do + e do − no app, e não verde e vermelho, porque
    subir é bom ou ruim conforme o que se mede.
- **Grupo sem valor:** transação sem tag cai em "Sem tag", sem sócio em "Sem sócio". O grupo tem
  chave `null`, e a tela dá o rótulo.
- **Tag como dimensão:** a transação com duas tags conta nas duas. Por isso o **total geral é
  calculado à parte**, contando cada transação uma vez. Nesse caso ele é menor que a soma das
  linhas, e a tela avisa. Os totais por linha e por coluna seguem a mesma regra.
- **Ordem:** o mês é cronológico e traz **todos os meses da janela**, inclusive os sem lançamento
  (com zero), para que o gráfico de linha não pule meses. As demais dimensões vão do maior número
  para o menor na medida escolhida (o valor absoluto da soma, ou a quantidade), com desempate pelo
  rótulo, e o grupo "sem" (sem tag, sem sócio) por último. O tipo, a situação e a recorrência
  (fixas, parceladas, avulsas) seguem a ordem fixa do domínio.
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
| `reports.byPartner` | `profileId` (empresarial), `period` | Total de aportes (todos os períodos), aportes e entradas sem sócio do mês, cada sócio (participação, aportou, deveria, diferença), soma das participações e o acerto (§8) |
| `reports.entriesWithoutPartner` | `profileId` (empresarial), `period` | Entradas do mês sem sócio (receitas e transferências vindas de outro perfil) e o total (§8) |
| `reports.balanceProjection` | `profileId`, `basis` (`12` padrão, `6`, `3` ou `1`) | Saldo de hoje; os meses da estimativa com o resultado, as séries e os avulsos; a média e o desvio-padrão dos avulsos; e, para o fim do mês corrente e os 12 seguintes, o já lançado, o estimado, o saldo e os cenários pessimista e otimista (§9) |

O resultado traz os meses da janela, os grupos da dimensão principal (e da secundária, se houver),
as células (`valor` arredondado como `MoneyResponse` e `quantidade`), os totais por linha, por
coluna e o geral, e o aviso de que os totais não são a soma das linhas quando a tag é uma das
dimensões.

## 6. Testes

| Arquivo | Cobre |
|---|---|
| `test/domain/reportDefinition.test.ts` | Janela de meses (virada de ano, mês fixo × referência, limites de N), dimensões repetidas, nome, ordem e preenchimento dos meses |
| `test/services/reports.definitions.test.ts` | Cadastro: nome único, referências de outro perfil recusadas, cadastro excluído que continua na definição, soft delete |
| `test/services/reports.run.test.ts` | As três bases de data (pagamento sem em aberto, vencimento, lançamento), cada filtro e a combinação E/OU, estorno, tag com duas tags e o total à parte, grupos "sem", fixas × parceladas × avulsas, entrada × saída com a transferência interna nos dois lados e o líquido, transferência recebida de outro perfil, perfil vizinho fora, `preview` = `run` |
| `packages/client/test/reportEditor.test.ts`, `reportView.test.ts` | Leitura do rascunho do editor, reabrir e regravar a definição, descrição dos filtros, rótulos dos grupos, tabela, gráfico e "Outros", o mês com o ano quando a janela atravessa anos, pizza |
| `test/services/reports.partner.test.ts` | Distribuição por sócio (§8): exemplo dos aportes, todos os períodos × mês, receita de serviço e despesa fora, encargos e devolução, sócio sem aporte, sócio excluído, maior resto, acerto com três sócios, participações fora de 100%, lista = indicador, `setPartner` numa ocorrência e recusas |
| `test/infrastructure/periodSql.test.ts` | Mês de vencimento da fatura em SQL = `BillingCycle.dueDateOf`, usado pelo mês de pagamento do §8 |
| `test/services/reports.projection.test.ts` | Projeção (§9): meses da janela com virada de ano e perfil novo; histórico separado em séries e avulsos, com a conta fora do total fora; já lançado de cada mês (série fixa, parcelas que acabam, conta em aberto, ocorrência vencida, transferência para outro perfil) e a fração do mês corrente; faixa pela raiz do horizonte; janela de um mês sem faixa; sem histórico; perfil empresarial |
| `packages/client/test/partnerReport.test.ts`, `balanceProjection.test.ts` | Telas dos relatórios fixos: diferença e acerto; indicadores, linhas do projetado e dos cenários a partir de hoje, já lançado × estimado, avisos de histórico curto e de falta de faixa |
| `packages/client/test/invalidation.test.ts` | Toda escrita invalida os resultados de relatório que muda, fixos incluídos |
| `apps/desktop/e2e/reports.spec.ts` | Montar com o resultado ao vivo, salvar, editar para gráfico por mês e excluir; a pizza sem a segunda divisão e com a participação na legenda; a análise com o resultado e a variação; o gráfico de 13 meses com os dois meses de mesmo nome separados; a projeção fixada no topo, com a janela da média |
| `apps/desktop/e2e/partnerReport.spec.ts` | A distribuição por sócio fixada no perfil empresarial: aportes, acerto, entradas sem sócio atribuídas e o sócio no lançamento |

Telas (desktop, sem mockup): `/reports` lista os relatórios — os fixos no topo (§8 e §9), depois
os salvos — e mostra o aberto (`report` na URL: o id do salvo ou a chave do fixo, `projection` ou
`partners`; sem ele, abre a projeção);
`/reports/edit` é o editor, com o resultado ao vivo pela rota `reports.preview`. O gráfico vem sempre
com a alternância para a tabela equivalente e desenha até cinco séries — as quatro maiores e
"Outros" —, com as cores dos tokens `accent`, `out`, `dot`, `muted` e `ink2`.

O eixo do gráfico é pela **chave** do grupo, e o rótulo só entra na hora de escrever: o Recharts
junta categorias de mesmo texto, e numa janela de 13 meses os dois "jan" viravam um só, com os
números do ano anterior nos dois. Pela mesma razão, o mês só perde o ano no eixo quando a janela
inteira cabe num ano.

## 7. Próximos passos

- Busca por texto no nome e na descrição (§2.2).
- Medida **líquida** (entradas − saídas), que hoje se monta agrupando pelo tipo.
- Comparações entre períodos e drill-down até os lançamentos de um grupo.
- Os relatórios no celular.

## 8. Distribuição por sócio — relatório fixo (`reports.byPartner`, `reports.entriesWithoutPartner`)

Relatório **fixo**: fica no topo da lista de Relatórios do perfil empresarial e não se monta no
editor, porque a divisão pela participação e o acerto não são um filtro com agrupamento. Voltou a
pedido do usuário depois da troca pelos personalizados, com as mesmas regras. Só em perfil
empresarial: no pessoal a lista não o oferece, e as duas rotas recusam com
`partner-requires-business-profile`.
Revisto na Fase 13.8 do [desktop-mvp-plan.md](desktop-mvp-plan.md): o relatório deixou de dividir
as despesas e passou a dividir os **aportes**. Toda despesa de um perfil empresarial é paga com o
dinheiro da empresa; o que cada sócio põe na empresa é o dinheiro que entra vinculado a ele.

| # | Pergunta | Regra |
|---|---|---|
| P1 | Período | Os aportes de **todos os períodos** formam o total e a divisão. O mês de referência só recorta os indicadores do mês ("Aportes em out/2026", "Entradas sem sócio em out/2026") e a lista de entradas sem sócio, pelo **mês de pagamento** (regime de caixa: o mês do extrato em que o dinheiro entrou, `REPORT_SOURCES_CTE`) |
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
- **Tela:** os indicadores, a tabela dos sócios, "Aportou × deveria" com o acerto e as entradas
  sem sócio ficam empilhados no detalhe: ao lado da lista de relatórios, a tabela e o gráfico lado a
  lado não cabem.
- **Atribuir pelo relatório:** a rota `transactions.setPartner` troca só o sócio de uma transação,
  como `transactions.setPaid` troca o pagamento — numa série, só a ocorrência. Confere a mesma regra
  de aporte. Não recalcula saldo: o sócio não pesa em nenhum.
- **Atribuir no lançamento:** o formulário mostra "Sócio que aportou" só quando o lançamento é aporte,
  com os sócios do perfil certo — o de destino, na transferência para outro perfil.
- **Cadastro de sócios:** criar, editar, remover e conferir a soma de 100% ficam no cadastro
  (rotas `partners.list` e `partners.save`, desktop-mvp-plan Fase 13.7). Remover um sócio apaga o vínculo dos lançamentos e das
  séries ligados a ele, que voltam a ser entradas sem sócio.

## 9. Projeção de saldo — relatório fixo (`reports.balanceProjection`)

Relatório **fixo** de todo perfil, no topo da lista de Relatórios: o saldo das contas do total no
fim do mês corrente e de cada um dos 12 meses seguintes. Segue o **método direto** das projeções de
fluxo de caixa: o que já está comprometido entra pelo valor lançado, só o que ainda não existe é
estimado pelo histórico, e a estimativa vem com uma faixa de incerteza. A primeira versão somava só
a média do resultado de todos os meses, e a linha saía reta: tratava o aluguel, as parcelas e o
salário como incerteza, e não sabia quando uma parcela acabava.

| # | Pergunta | Regra |
|---|---|---|
| B1 | Janela da estimativa | Os últimos **12** (padrão), **6**, **3** ou **1** mês **fechado** — o corrente fica fora, porque está pela metade. Escolhida na tela e **não gravada**. Os meses antes do primeiro extrato das contas do total não entram (o app não era usado neles); a tela avisa quando a estimativa usou menos meses que os pedidos |
| B2 | Já lançado (comprometido) | A **variação do saldo previsto** das contas do total no mês: tudo o que está lançado — parcelas (gravadas inteiras), séries fixas (gravadas 12 meses à frente, database-design §4.12), contas em aberto, faturas no mês do vencimento, transferências para outros perfis e para contas fora do total. No mês corrente entra o que falta: previsto do fim do mês − consolidado do fim do mês, inclusive o que venceu e não foi pago |
| B3 | Estimado (não lançado) | A **média dos avulsos** (lançamentos sem série) **pagos** nos meses da janela, pelo efeito no saldo das contas do total e pelo mês de caixa. As séries ficam fora da média porque já estão no B2 — contá-las nos dois seria contar duas vezes. No mês corrente vale a fração dos dias que faltam |
| B4 | Partida e horizonte | Do saldo **consolidado de hoje** das contas do total (o mesmo da tela de Contas) até 12 meses depois do corrente: `saldo(k) = saldo(k−1) + já lançado(k) + estimado(k)` |
| B5 | Faixa | **Cenário pessimista e otimista** = saldo ∓ `σ × √t`, com σ o desvio-padrão amostral mensal dos avulsos e *t* os meses desde hoje (o corrente conta a fração que falta). Meses independentes somam variâncias, então a incerteza cresce com a raiz do horizonte, como num intervalo de previsão. Com menos de dois meses na janela não há como medir a variação, e a faixa fica fechada (a tela avisa); com mais meses e avulsos iguais em todos (um perfil só de séries), σ é zero e a faixa também fecha, com um aviso próprio |

Decisões de implementação:

- **Resultado do histórico pela variação do saldo:** o resultado de um mês fechado é quanto o
  consolidado das contas do total mudou nele, pelos fechamentos dos extratos
  (`SqliteFixedReportRepository.closingHistories`), a mesma cadeia que dá o saldo de partida. A
  parte dos avulsos vem de `nonRecurringResults`, e a das séries é a diferença — a tela mostra as
  duas, para que se veja por que só os avulsos formam a estimativa.
- **Avulsos pelo mês de caixa e pelo efeito no saldo** (`nonRecurringResults`): o lançamento de
  conta no mês do extrato (a receita soma, os demais tipos subtraem, os encargos saem; a
  transferência ou o investimento para outra conta do total soma também no destino, e as duas
  pernas se anulam); a transferência que chega de fora do total só soma; a compra no cartão conta
  no mês em que a fatura foi paga por uma conta do total. O pagamento parcial de fatura
  (database-design §4.7) sai da conta do total no mês do próprio pagamento e abate as compras no
  mês em que a fatura é paga, que entra líquida dele — sem isso ele caía nas séries.
- **Contas do total:** só as com "considerar no saldo" ligado, desativadas incluídas — o mesmo
  recorte do saldo do perfil. A transferência para uma conta fora do total é saída.
- **Sem o mês de referência:** a projeção parte de hoje (o `Clock`), e não do mês da barra.
- **Arredondamento:** a estimativa e os saldos são acumulados sem arredondar e arredondados só na
  saída, para que o erro não cresça a cada mês.
- **Limites conhecidos:** um avulso já lançado para um mês futuro conta no B2 e a média do B3 ainda
  é somada inteira nesse mês; uma série nova que o usuário ainda vai criar (uma assinatura, uma
  compra parcelada) só aparece pela parte de avulsos que a média traz. Sazonalidade (13º salário,
  IPVA) fica para depois: com 12 meses de histórico, o mesmo mês do ano anterior poderia pesar na
  estimativa.
- **Tela:** três indicadores (saldo hoje; avulsos por mês, com a cor e o sinal de entrada ou saída;
  saldo no último mês com a faixa), as linhas do saldo projetado e dos cenários de hoje até o 12º
  mês com a alternância para a tabela (já lançado, avulsos estimados, saldo e faixa por mês) e a
  tabela dos meses da estimativa (resultado, séries e avulsos).
