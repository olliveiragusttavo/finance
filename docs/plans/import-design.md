# Design da Importação de Transações

**Status:** Implementado — Fase 13.1 do [desktop-mvp-plan.md](desktop-mvp-plan.md), rota `imports.run` e telas em `apps/desktop/src/renderer/src/import/`.
**Relacionado:** [mockups](../design/mockups/README.md#importação-desktop) — o assistente de
3 passos aprovado; [database-design.md](database-design.md) — faturas (§4.7), recorrências
(§4.12) e transações (§4.13), cujas regras a importação segue sem exceção.

Este documento é o lugar das regras de negócio da importação e das decisões tomadas ao
implementá-las. Mudou uma regra aqui, mudam junto o código citado e o teste correspondente.

---

## 1. Escopo

Trazer o histórico de outro app ou de uma planilha para o app, **um arquivo por vez**, só no
desktop. O caso que motivou a fase é o export do app atual: três CSVs (Despesas, Receitas e
Transferências), com séries fixas até dez/2030, parcelamentos e compras em dois cartões.

| Entra | Fica para depois |
|---|---|
| CSV em UTF-8 ou Latin-1, separador `,` `;` ou tabulação, decimal com ponto ou vírgula | XLSX (o mockup pede; não há leitor no repositório e o arquivo real é CSV) |
| Arquivo de um tipo (despesas, receitas, transferências) ou com coluna de tipo | Proveniência: reimportar o mesmo arquivo duplica, e a proteção é a cópia do banco antes ([§7](#7-segurança-da-escrita)) |
| Contas e cartões novos ou ligados a existentes, em qualquer perfil já criado | Criar perfil dentro do assistente |
| Séries fixas e parceladas agrupadas numa recorrência do app | Sócio e meta (o arquivo não traz) |
| Faturas pagas pela data de pagamento das compras | |
| Modelo de mapeamento salvo no aparelho | |

## 2. Onde cada regra mora

| Peça | Arquivo | Papel |
|---|---|---|
| Leitura do arquivo | `packages/client/src/import/` | Codificação, separadores, CSV, formato de data e de número, ligação de colunas: só formato, nenhuma regra de negócio |
| Análise | `packages/core/src/domain/import/` | Funções puras: séries, números das ocorrências, fim da fixa, fatura pelo vencimento, problemas por linha. A tela de revisão e o Service usam a **mesma** função, para que a prévia nunca discorde do que é gravado |
| Escrita | `ImportService` (rota `imports.run`) | Cria cadastros, grava lançamentos e séries e paga faturas numa unidade de trabalho, com **um** recálculo no fim |
| Telas | `apps/desktop/src/renderer/src/import/` | Assistente Arquivo → Colunas → Revisar |

O client entrega ao núcleo **linhas normalizadas** (datas `YYYY-MM-DD`, números, textos
aparados), nunca o arquivo: o núcleo não sabe nada de CSV, e o formato do arquivo não chega às
regras.

## 3. Leitura do arquivo

- **Codificação:** UTF-8 quando o arquivo decodifica sem erro; senão Latin-1 (windows-1252). O
  BOM é descartado.
- **Separador de colunas:** o que dá o mesmo número de colunas (maior que 1) no maior número das
  primeiras linhas, entre `,`, `;` e tabulação. Campos entre aspas podem ter separador, aspas
  dobradas e quebras de linha (as observações do arquivo real têm).
- **Separador decimal e formato de data:** detectados pelas amostras e ajustáveis na tela.
  `-`, `—` ou vazio numa data = sem data.
- **Tipo do arquivo:** pelo nome (despesa, receita, transferência) e, sem nome que decida, pelas
  colunas (Origem/Destino = transferências; Cartão ou Encargos = despesas). O usuário confirma.
- **Linha com problema** (data ou valor ilegível, campo obrigatório vazio) aparece listada na
  revisão e **não é importada**; o botão diz quantas ficam de fora.

## 4. Ligação de colunas

Mockup `DesktopImportMapear`. Cada campo liga a uma coluna só; colunas sem campo são
ignoradas. A sugestão automática compara o cabeçalho normalizado (sem acento, minúsculo) com
uma lista de sinônimos por campo; "Efetivação" sugere Data de pagamento e "Lançamento" sugere
Data da compra nas despesas.

| Campo | Tipos | Obrigatório |
|---|---|---|
| Nome, Valor, Vencimento | todos | sim |
| Conta | despesas, receitas, vários tipos | sim |
| Categoria, Subcategoria | despesas, receitas, vários tipos | sim |
| Conta de origem, Conta de destino | transferências | sim |
| Conta de destino | vários tipos | só nas linhas de transferência |
| Tipo | vários tipos | sim |
| Cartão, Encargos | despesas, vários tipos | não |
| Data da compra | despesas, receitas, vários tipos | não |
| Observação, Tags, Data de pagamento, Recorrência, Nº da parcela, Total de parcelas | todos | não |

- **Recorrência:** texto com "fix" = fixa, "parcel" = parcelada, o resto ("Nenhuma", vazio) =
  avulsa; "diária", "semanal", "anual" dão a frequência, mensal é o padrão.
- **Tipo** (vários tipos): "receita"/"entrada"/"crédito" = receita, "despesa"/"saída"/"débito" =
  despesa, "transf…" = transferência; outro texto é problema da linha.
- **Modelo:** o mapeamento pode ser salvo com um nome nas preferências do **aparelho**
  (`preferences.json`), como o tema — não é dado financeiro, e no banco seria replicado pela
  sincronização. Um arquivo cujos cabeçalhos e tipo batem com um modelo salvo é ligado por ele.

## 5. Regras de negócio da importação

### 5.1 Perfil, contas e cartões

- Regra de negócio (Importação): **o lançamento vai para o perfil da sua conta de origem**; o
  cartão fica no perfil da conta que paga a fatura. O perfil é escolhido por conta na revisão,
  entre os perfis existentes, com um padrão e "aplicar a todas".
- Cada conta do arquivo é **criada** (corrente ou investimentos, "considerar no saldo" ligado,
  saldo inicial zero) ou **ligada** a uma conta ativa do perfil escolhido. Conta desativada não
  aparece, pela regra de lançamento novo (desktop-mvp-plan §5.1).
- Cada cartão é criado ou ligado a um cartão ativo. O **dia de vencimento** é o dia mais comum
  nos vencimentos das compras dele; o **dia de fechamento é obrigatório** e não vem no arquivo —
  a tela sugere o provável pelas datas de compra, mas o usuário confirma. A conta pagadora
  padrão é a conta mais comum nas linhas do cartão.
- Nas linhas de cartão, a coluna Conta é a conta que paga a fatura e não decide nada além da
  sugestão acima.
- Transferência para conta de outro perfil é aceita nas mesmas condições do lançamento manual
  (database-design §4.13): sai de uma conta e os perfis têm a mesma moeda.

### 5.2 Categorias e tags

- Categoria e subcategoria são procuradas **pelo nome no perfil da linha** (mesma comparação
  do cadastro: sem diferença de caixa, acento composto igual) e criadas quando faltam. A mesma
  categoria usada em perfis diferentes é criada em cada um.
- Transferência não tem categoria no arquivo: usa a categoria e a subcategoria padrão
  escolhidas na revisão (sugestão "Transferências › Entre contas"), criadas no perfil de origem.
- Tags vêm da coluna Tags (separadas por vírgula, ponto e vírgula ou `#`) e, com a opção
  marcada, das `#palavras` da Observação. São procuradas pelo nome e criadas no perfil da linha.
  A Observação entra inteira na descrição.

### 5.3 Datas, pagamento e valor

- **Conta:** vencimento = Vencimento; pagamento = Data de pagamento. Sem data de pagamento, a
  linha fica **em aberto**.
- **Sem a coluna de pagamento** (o arquivo de transferências real não a tem), a revisão oferece
  "considerar pagas as que vencem até hoje": cada uma é paga no próprio vencimento. Sem a
  opção, todo o histórico ficaria em aberto e só pesaria no previsto.
- **Valor:** como no lançamento manual, positivo, e o negativo é estorno ou devolução
  (database-design §4.13). Encargos entram em `charges`.
- **Nome:** o sufixo " 3/10" sai do nome quando a linha entra numa série parcelada, porque o
  número da parcela passa a ser a ocorrência. Na linha avulsa o nome fica como está.

### 5.4 Compras no cartão e faturas

O arquivo real confirma o que o app de origem grava: numa compra no cartão, **Vencimento é o
vencimento da fatura** e **Efetivação é o dia em que a fatura foi paga** — igual em todas as
compras da mesma fatura.

- Regra de negócio (Importação): **a fatura da compra é a que vence no mês do Vencimento da
  linha** (`BillingCycle.invoicePeriodDueIn`), e não a sugerida pela data da compra: o arquivo
  diz em que fatura a compra de fato caiu, e a fatura escolhida é a verdade (database-design
  §4.7). O ciclo do cartão (fechamento e vencimento) só converte o mês do vencimento na
  competência da fatura.
- A data da compra (o `due_date` da compra no cartão) é a Data da compra da linha; na parcela
  *n* de um parcelamento, a data da compra mais *n* − 1 meses, como o app gera. Sem ela (e nas
  fixas, cuja coluna "Lançamento" é a data em que a série foi criada), é o Vencimento.
- Regra de negócio (Importação): **a fatura com alguma compra paga é paga na maior data de
  pagamento entre as compras importadas nela**, contra a conta pagadora (database-design §4.7).
  A fatura sem nenhuma compra paga fica em aberto. Uma fatura que já existia paga e recebe
  compras é reaberta pelo lançamento (§4.7) e paga de novo pela mesma regra.

### 5.5 Séries

Com "Agrupar numa recorrência do app" (o padrão), as linhas da mesma série viram **uma
recorrência e as ocorrências dela**; sem a opção, cada linha é um lançamento avulso.

- **Mesma série:** mesmo tipo, nome (sem o sufixo de parcela), conta ou cartão, conta de destino
  e frequência; no parcelamento, também o total de parcelas e a data da compra — duas compras
  "Mouse" em 10x em datas diferentes são duas séries.
- **Número da ocorrência:** no parcelamento, o Nº da parcela (de 1 ao total, com total entre 2 e
  360). Na fixa, a distância em períodos do Vencimento da linha até o da primeira linha da série,
  mais um — então o mês que falta no arquivo é uma ocorrência excluída, e o complemento não a
  recria (database-design §4.12, marca d'água).
- Linha que repete um número já ocupado na série, ou parcela fora de 1…total, é importada como
  **avulsa**: não há como saber qual das duas é a ocorrência.
- **Calendário e modelo:** a referência é a última ocorrência da série (`startsAt` = o número
  dela, dia âncora = o dia dela, ou o dia original quando ela caiu no último dia de um mês curto —
  o aluguel do dia 31 que termina em 30/09 continua no dia 31), e o modelo da regra é essa
  linha — nome, valor, encargos, subcategoria, tags, descrição e o deslocamento da fatura. É o que o app gera daqui para a
  frente; as ocorrências importadas guardam cada uma o próprio conteúdo.
- **Parcelamento:** valor por parcela (`perInstallment`): o arquivo já traz o valor de cada
  parcela, inclusive o ajuste do arredondamento, que o app de origem põe na última.
- Regra de negócio (Importação): **a fixa termina na última ocorrência do arquivo quando ela
  vence antes do horizonte de 12 meses** (`endAt` = essa data); quando passa do horizonte, a
  fixa continua sem fim. Um export traz as fixas vivas até bem à frente (dez/2030 no arquivo
  real), então a que para antes do horizonte foi encerrada na origem — e continuá-la criaria
  lançamentos que o usuário não tem.
- **Ocorrências futuras:** "Manter as ocorrências futuras do arquivo" (padrão) grava todas;
  desmarcado, as das fixas que vencem depois do horizonte são descartadas, e o complemento do
  app segue gerando 12 meses à frente.
- Marca d'água = o maior número gravado.

## 6. Prévia e números da revisão

`analyzeImport` (domínio, pura) devolve tudo o que a revisão mostra — avulsos, séries fixas e
parceladas com o número de linhas, pagas e pendentes, linhas por conta e por cartão, dia de
vencimento e fechamento provável de cada cartão, categorias usadas por conta, `#palavras` e as
linhas com problema — e é chamada de novo pelo `ImportService` sobre a mesma entrada.

## 7. Segurança da escrita

- A importação inteira é **uma unidade de trabalho**: ou tudo entra, ou nada. O recálculo dos
  saldos roda uma vez, no fim, sobre o impacto acumulado (o padrão do `RecurrenceService`); um
  recálculo por lançamento tornaria quadrática a importação de milhares de linhas.
- "Exportar uma cópia do banco antes de importar" vem marcado e usa a exportação de Ajustes
  (Fase 13): cancelar o diálogo ou falhar a cópia **não** importa.
- Reimportar o mesmo arquivo duplica os lançamentos: a proveniência não foi modelada
  (database-design §6), e a cópia é o caminho de volta. Decisão da Fase 13.1.
