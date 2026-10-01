# Design do Banco de Dados

**Status:** Design concluído — motor escolhido (SQLite), contrato físico especificado
(tipos, restrições, ações de chave estrangeira, índices).
**DDL:** [db/migrations/0001_initial_schema.sql](../../db/migrations/0001_initial_schema.sql)
— uma transcrição da §4; validada contra o SQLite 3.46.
**Fonte da verdade visual:** [docs/drawio/project.drawio](../drawio/project.drawio)
**Sincronização:** [docs/plans/sync-design.md](sync-design.md) — como este schema é
replicado entre dispositivos.

Este documento é o lugar de toda decisão de banco de dados do projeto. O arquivo draw.io
guarda a imagem; este arquivo guarda o raciocínio e os contratos dos atributos. Quando
os dois divergirem, atualize ambos — nenhum dos dois pode ficar para trás.

Como ler: a [§3](#3-convenções) reúne as regras que valem para todas as tabelas. A
[§4](#4-tabelas) descreve cada tabela por completo — o que ela é, as decisões tomadas
sobre ela, suas colunas, chaves estrangeiras e índices. A DDL é uma transcrição da §4
sob as regras da §3; quando as duas divergirem, uma delas está errada e ambas são
corrigidas.

---

## 1. Escopo

O modelo cobre todo o domínio descrito no [README](../../README.md): perfis, contas,
cartões de crédito, consolidações mensais (extratos bancários e faturas de cartão),
transações com sua classificação, além das entidades de apoio (sócios, tags,
recorrências, anexos, metas, notas).

Ele **ainda não** cobre a proveniência da importação do histórico de transações que está
sendo migrado do app atual ([§6 Próximos passos](#6-próximos-passos)). A sincronização
entre dispositivos está projetada em [sync-design.md](sync-design.md); seus metadados
ficam em tabelas separadas e não alteram as tabelas abaixo.

---

## 2. Visão geral das relações entre entidades

```mermaid
erDiagram
    profiles ||--o{ accounts : "possui"
    profiles ||--o{ credit_cards : "possui"
    profiles ||--o{ partners : "tem (somente perfis empresariais)"
    profiles ||--o{ notes : "possui"
    profiles ||--o{ transaction_categories : "possui"
    profiles ||--o{ goals : "possui"
    profiles ||--o{ tags : "possui"
    profiles ||--o{ recurrences : "possui"

    accounts ||--o{ bank_statements : "um por mês"
    accounts ||--o{ credit_cards : "quita"

    credit_cards ||--o{ invoices : "uma por mês"
    bank_statements ||--o{ invoices : "absorve quando paga"

    bank_statements ||--o{ transactions : "contém"
    invoices ||--o{ transactions : "contém"

    transactions }o--|| transaction_sub_categories : "classificada por"
    transaction_sub_categories }o--|| transaction_categories : "pertence a"

    transactions }o--o| accounts : "destino (transferência / investimento)"
    transactions }o--o| partners : "paga por"
    transactions }o--o| recurrences : "gerada por"
    transactions ||--o{ transactions_tags : "tem"
    tags ||--o{ transactions_tags : "tem"
    transactions ||--o{ attachments : "tem"

    goals ||--o{ transactions : "alimentada por"
```

---

## 3. Convenções

Regras que valem para todas as tabelas. Nada aqui é repetido na [§4](#4-tabelas).

### 3.1 Motor de armazenamento — SQLite

**SQLite**, como um único arquivo de banco de dados no dispositivo do usuário.

**Por quê:** as quatro restrições herdadas do [README](../../README.md) — embarcado,
gratuito para sempre, roda no desktop *e* no mobile, não impede uma sincronização
futura — eliminam quase todo o resto, e o SQLite é mais forte justamente nas duas que
mais importam aqui:

- **Ele já está em todas as plataformas mobile.** Android e iOS já vêm com SQLite, e
  todo caminho mobile plausível chega até ele. Como a tecnologia mobile está
  explicitamente indefinida, o motor precisa ser a parte da stack que sobrevive a
  qualquer escolha feita depois.
- **Relatórios são a razão de ser deste projeto**, e eles são relacionais e orientados
  a mês. Window functions, CTEs, índices parciais e de expressão vêm de graça, então
  saldos acumulados e comparações mês a mês são consultas comuns, e não código de
  aplicação.
- **A propriedade dos dados passa a ser literal** — um arquivo que o usuário pode
  copiar, fazer backup e abrir com qualquer uma de centenas de ferramentas daqui a
  trinta anos. O formato de arquivo do SQLite carrega um compromisso público de
  continuar legível por décadas, que é o horizonte certo para um arquivo financeiro.
- **Check constraints, índices parciais e ações `ON DELETE`** permitem que as regras
  abaixo sejam garantidas pelo banco em vez de por convenção, e **`REAL` é um double
  IEEE-754**, exatamente o que a [§3.7](#37-dinheiro) pede.

**Alternativas consideradas e rejeitadas:**

| Opção | Por que não |
|---|---|
| PostgreSQL / MySQL | Exigem um servidor sempre ligado. Falham de cara nas restrições de zero infraestrutura e zero custo. |
| DuckDB | Excelente na metade analítica, mas é OLAP — ruim para as muitas escritas pequenas do lançamento diário de transações, e seu suporte a mobile é fraco. Vale revisitar *junto* com o SQLite para relatórios pesados no desktop, já que o DuckDB consegue consultar um arquivo SQLite diretamente. Não é o armazenamento principal. |
| Document stores (PouchDB/RxDB, estilo CouchDB) | A sincronização vem embutida, o que é tentador, mas eles tornam bem mais difíceis as agregações relacionais orientadas a mês que este projeto existe para produzir. Troca errada. |
| Realm / Atlas Device Sync | Descontinuado pela MongoDB. Um beco sem saída, independentemente dos méritos. |
| libSQL / Turso | Compatível com SQLite e com sincronização embutida, mas a metade da sincronização puxa para um serviço hospedado e, portanto, para um custo recorrente. Rejeitado *por enquanto* — e, por ser compatível com SQLite, ficar no SQLite puro mantém essa opção disponível no futuro sem custo de migração. |

### 3.2 A configuração da conexão faz parte do contrato do schema

Dois pragmas devem ser definidos em **toda** conexão, e nenhum deles aparece na DDL:

- **`PRAGMA foreign_keys = ON`** — o SQLite vem com chaves estrangeiras *desligadas por
  padrão*, por compatibilidade retroativa. Sem isso, toda ação `ON DELETE` do schema
  silenciosamente não faz nada, e a regra de que excluir um perfil remove tudo que está
  abaixo dele
  ([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento))
  falha em silêncio enquanto parece funcionar.
- **`PRAGMA journal_mode = WAL`** — melhor concorrência e resiliência a falhas. Definido
  uma vez; persiste no arquivo.

A configuração da conexão pertence a um único lugar na camada Repository, pelo qual toda
conexão passa, e não espalhada pelos pontos de chamada. Ela merece um teste que verifique
que um cascade de fato cascateia — o modo de falha é silencioso, e falhas silenciosas na
semântica de exclusão perdem dados.

### 3.3 A camada Repository abstrai o driver, não apenas o banco

A camada Repository já é a única camada que conversa com o banco
([README](../../README.md)). Além disso, ela é escrita contra uma **porta interna
estreita** — execute, query, transaction — com um adaptador específico de plataforma por
trás, em vez de importar um driver SQLite diretamente.

**Por quê:** o motor e o schema são os mesmos em todo lugar, mas *o driver não é*. O
desktop sob Electron usa um módulo nativo do Node; um shell mobile — seja qual for o
escolhido — usa um binding SQLite totalmente diferente, com outra API. O SQL é portável
entre eles; a biblioteca cliente não. Sem a porta, essa diferença vaza para todos os
repositórios e o objetivo de "um único backend para desktop e mobile" falha exatamente
na camada onde deveria ser resolvido.

**Consequência:** as strings SQL e o schema continuam compartilhados; só um adaptador
fino é escrito por plataforma. A camada Repository passa a ser testável contra um banco
em memória, sem nenhuma plataforma envolvida. Outras três traduções vivem nessa mesma
fronteira e em nenhum outro lugar: a caixa dos identificadores ([§3.4](#34-nomenclatura)),
o carimbo de `updated_at` ([§3.6](#36-colunas-presentes-em-todas-as-tabelas)) e a
normalização de caixa dos UUIDs ([§3.5](#35-chaves-primárias-são-uuids)). Se qualquer
uma delas aparecer em dois lugares, é um bug.

### 3.4 Nomenclatura

**Nomes de tabela ficam no plural** — `profiles`, `accounts`, `credit_cards`,
`transactions`. Uma tabela guarda muitas linhas, então o plural lê corretamente no ponto
de uso (`SELECT ... FROM transactions`). A convenção específica importa muito menos do
que ter exatamente uma. O plural vai no **substantivo principal**: uma categoria *de*
transações é `transaction_categories`, não `categories_transaction`. Tabelas de junção
seguem os dois lados: `transactions_tags`. As classes do modelo de domínio continuam no
singular — `Transaction`, `Account` — porque um objeto é uma linha, e o mapeamento
tabela↔classe é uma remoção mecânica do plural.

**Identificadores físicos são `snake_case`** — tabelas, colunas, índices, restrições. O
TypeScript mantém `camelCase`, e a camada Repository traduz entre os dois. O SQLite
preserva `camelCase` de verdade, então isso não é imposto; é uma escolha, porque toda
ferramenta SQL e todo humano que abre o arquivo à mão esperam `snake_case`, porque é
imune, a custo zero, aos problemas de normalização de identificadores de outros motores,
e porque um nome de coluna idêntico byte a byte a uma propriedade do domínio solda o
modelo de domínio ao schema de armazenamento. Um mapeamento explícito é evidência da
fronteira, não overhead. Duas colunas foram renomeadas com base nisso: `limit` →
`limit_value` (palavra-chave do SQLite) e `goals.date` → `target_date` (legibilidade).

**Colunas de chave estrangeira** se chamam `<parent_singular>_id`. **Índices** são
`idx_<table>_<columns>` quando simples e `uq_<table>_<columns>` quando únicos.
**Restrições** também têm nome — `ck_<table>_<column>` para checks,
`fk_<table>_<column>` para chaves estrangeiras — para que uma violação informe *qual*
regra falhou (`CHECK constraint failed: ck_profiles_currency`) em vez de repetir a
expressão.

### 3.5 Chaves primárias são UUIDs

Toda tabela tem `id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36)` — uma chave
substituta UUID, nunca um inteiro autoincremental.

**Por quê:** o README mantém a sincronização entre dispositivos aberta como direção
futura, e chaves autoincrementais tornam isso consideravelmente mais difícil — dois
dispositivos offline ao mesmo tempo vão ambos gerar o id `47` para registros diferentes,
e reconciliar isso significa reescrever as chaves e toda chave estrangeira que aponta
para elas. UUIDs permitem que qualquer dispositivo crie um registro a qualquer momento,
offline, sem coordenação e sem colisão.

**Consequência:**

- **Versão 4 (aleatória)**, gerada com o `crypto.randomUUID()` embutido na plataforma
  — sem biblioteca, sem relógio, sem monotonicidade para acertar. Um UUID ordenado por
  tempo (v7) foi considerado pela localidade no índice e rejeitado: na escala deste
  projeto — dezenas de milhares de linhas — a diferença é imensurável, nada ordena pela
  chave (toda consulta cronológica ordena por `due_date`), e a única propriedade sendo
  comprada é a criação sem colisão em dois dispositivos offline, que o v4 já garante.
- **Exceto linhas identificadas pelo conteúdo, que recebem uma versão 5 determinística**
  — um hash de um namespace fixo da aplicação e da chave natural da linha:
  `bank_statements` e `invoices` (dono, ano, mês), transações emitidas por uma
  recorrência (`recurrence_id`, `due_date` gerado), pares de `transactions_tags` e dados
  padrão semeados no primeiro uso. Dois dispositivos offline criando "o extrato de
  março" derivam então o mesmo id, e a sincronização mescla uma única linha em vez de
  colidir em um índice único parcial. Recriar uma linha desse tipo que sofreu soft
  delete, portanto, a **revive** em vez de inserir. A regra vale desde a primeira linha
  de código, com ou sem sincronização — adotá-la depois que já existem dados significa
  reescrever chaves. Raciocínio completo em
  [sync-design.md §5.6](sync-design.md#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos).
- **Quem gera os ids é a aplicação, não o banco.** A camada Service pode montar um grafo
  de objetos completo, ids incluídos, antes de qualquer coisa tocar o Repository, e o
  Repository o grava começando pelos pais, em uma única transação.
- **Armazenados como `TEXT`**, na forma canônica de 36 caracteres, minúscula e com
  hífens. Um `BLOB` de 16 bytes tem metade do tamanho, mas nesta escala a diferença é
  desprezível, e chaves legíveis facilitam muito a depuração e a inspeção manual do
  arquivo. A fronteira do Repository normaliza a caixa, já que o SQLite compara chaves
  byte a byte.
- **Tabelas rowid comuns**, não `WITHOUT ROWID`. A segunda busca economizada é
  imensurável aqui, e tabelas rowid são o que toda ferramenta pressupõe.

### 3.6 Colunas presentes em todas as tabelas

Presentes em todas as tabelas — incluindo a de junção — e omitidas das listagens por
tabela na [§4](#4-tabelas) e das caixas do diagrama:

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `id` | TEXT | NN, `PRIMARY KEY`, `CHECK (length(id) = 36)` | uuid — [§3.5](#35-chaves-primárias-são-uuids) |
| `created_at` | TEXT | NN, timestamp, `DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))` | UTC. O banco preenche; a aplicação nunca escreve nela |
| `updated_at` | TEXT | NN, timestamp | UTC. Carimbada pela aplicação em todo insert e update; sem trigger |
| `deleted_at` | TEXT | null, timestamp | Marcador de soft delete. Uma linha está viva quando `deleted_at IS NULL` |

**Quem carimba o quê:** `created_at` é definido exatamente uma vez, e o relógio do motor
é tão bom quanto qualquer outro; um default também mantém honestas as inserções manuais
feitas por um navegador de banco de dados. `updated_at` precisa mudar a cada escrita, e
um trigger seria lógica de negócio escondida na camada de armazenamento — a mesma
objeção que a [§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)
levanta contra check constraints para regras. Ambos são UTC; a apresentação converte
para o horário local, o armazenamento nunca. Nenhum dos dois é o relógio da
sincronização — conflitos são ordenados por um relógio lógico híbrido mantido em tabelas
separadas
([sync-design.md §5.2](sync-design.md#52-o-relógio-é-um-relógio-lógico-híbrido));
`updated_at` é o rastro legível de "última revisão" e sincroniza como uma coluna comum.

**Nada é removido fisicamente.** Excluir uma linha significa preencher `deleted_at`.
Essa decisão é maior do que parece:

- **As ações `ON DELETE` deixam de fazer o trabalho.** Um soft delete é um `UPDATE`,
  então nenhum cascade dispara. Excluir um perfil significa carimbar `deleted_at` em
  todas as tabelas descendentes, em uma transação, na camada Service, seguindo o mesmo
  grafo de propriedade que as chaves estrangeiras declaram
  ([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)).
  As ações declaradas permanecem — são a rede de segurança para um hard delete de
  verdade — mas deixam de ser o mecanismo.
- **Toda regra de unicidade é um índice único parcial** — `WHERE deleted_at IS NULL`.
  Caso contrário, excluir o extrato de março e recriá-lo colide com a linha antiga ainda
  presente. É o defeito com maior chance de ser descoberto tarde.
- **Toda leitura precisa filtrar `deleted_at IS NULL`.** Esquecer isso em uma consulta
  de saldo ressuscita silenciosamente transações excluídas nos totais — um número
  errado, não um erro. A rotina de recálculo de saldos ([§3.7](#37-dinheiro)) precisa
  ignorar linhas com soft delete, e seus testes devem incluir especificamente uma
  transação com soft delete para provar isso.
- **É o `deleted_at` que permite que uma exclusão se propague entre dispositivos** — um
  hard delete não deixa nada para replicar. Qualquer purga futura de linhas com soft
  delete só pode remover linhas cuja exclusão todos os dispositivos sincronizados já
  confirmaram ([sync-design.md §9](sync-design.md#9-impacto-no-design-do-banco-de-dados)).

### 3.7 Dinheiro

**Toda coluna monetária é `REAL`** — `transactions.value`, `transactions.charges`,
`transactions.conversion_rate`, `accounts.balance`, `bank_statements.balance`,
`invoices.balance`, `goals.value`, `credit_cards.limit_value`. O conselho comum de usar
unidades menores inteiras (centavos) é **deliberadamente rejeitado**: o sistema não se
restringe a moedas com duas casas decimais, taxas de câmbio têm precisão muito maior que
duas casas, e uma escala fixa é errada para algum valor que o app legitimamente precisa
armazenar. O banco, portanto, não protege contra desvios de arredondamento, e
**validação e arredondamento são responsabilidade da aplicação** — aplicados nas
fronteiras de persistência e de apresentação, nunca em valores intermediários
acumulados; por moeda, guiados pela precisão decimal de cada uma; e nunca comparados por
igualdade exata de float, sempre com um epsilon.

**Toda coluna monetária está denominada na moeda do perfil.** Existem três colunas de
moeda, com três papéis diferentes:

| Coluna | Significado |
|---|---|
| `profiles.currency` | A moeda de relatório — a única unidade em que qualquer coisa é armazenada. |
| `accounts.currency` | A moeda em que a conta do mundo real é mantida. Um rótulo, não uma unidade. |
| `transactions.currency` | A moeda de **origem** de onde um valor veio. Apenas proveniência — veja a [§4.13](#413-transactions). |

**Por que moeda única:** isso faz de todo saldo e de todo relatório um simples `SUM`,
sem etapa de conversão em lugar nenhum. Armazenar cada conta na sua própria moeda
empurraria uma conversão para cada total no nível do perfil — maquinário multimoeda de
verdade, para uma capacidade que o projeto explicitamente não quer. Consolidar contas é,
portanto, só soma, inclusive as estrangeiras, porque suas transações já foram
convertidas na entrada. O arredondamento fica trivialmente concreto: uma moeda, uma
precisão, a do perfil.

**Saldos armazenados são valores derivados.** `accounts.balance`,
`bank_statements.balance` e `invoices.balance` são agregados desnormalizados das
transações subjacentes — recalculá-los a partir de todo o histórico a cada leitura é a
troca errada para um app local-first que abre em uma tela de saldo no celular. Eles são
um cache, e a camada Service é responsável por mantê-los corretos. Uma rotina de
recálculo que os reconstrói a partir das transações precisa existir desde o primeiro
dia, tanto como ferramenta de reparo quanto como oráculo de testes; ela também serve
como detector de desvio — um saldo recalculado que diverge do armazenado além do epsilon
da moeda é um bug a ser exposto, não corrigido em silêncio.

### 3.8 O perfil é a raiz do tenant, e as chaves estrangeiras seguem o relacionamento

Tudo no sistema pertence a um perfil, direta ou transitivamente, e excluir um perfil
exclui todos os registros associados a ele. O app é local-first e de usuário único, mas
a mesma pessoa precisa manter finanças pessoais e empresariais estritamente separadas;
fazer do perfil a raiz dá essa separação sem multi-tenancy de verdade. Categorias, metas
e tags, portanto, **não** são um vocabulário global compartilhado — um perfil pessoal e
um empresarial mantêm cada um o seu.

Nem toda chave estrangeira cascateia, porém. A ação `ON DELETE` é escolhida pelo que o
relacionamento *significa*, e é registrada por chave na [§4](#4-tabelas):

| Tipo | Significado | Ação | Exemplos |
|---|---|---|---|
| **Propriedade** | O filho não existe sem o pai | `CASCADE` | `accounts.profile_id`, `bank_statements.account_id`, `transactions.bank_statement_id`, `attachments.transaction_id` |
| **Referência** | O filho sobrevive; só o vínculo desaparece | `SET NULL` | `transactions.goal_id`, `transactions.partner_id`, `transactions.destination_account_id`, `invoices.bank_statement_id` |
| **Vocabulário** | O pai é uma classificação de que o filho precisa | `NO ACTION` | `transactions.sub_category_id` |

**Por que `NO ACTION` e não `RESTRICT` no caso de vocabulário:** o SQLite verifica
`RESTRICT` *no instante* em que a linha pai é removida, enquanto `NO ACTION` é
verificado no **fim do comando**. Durante um hard delete de perfil, o cascade pode
chegar a `transaction_sub_categories` antes de chegar a `transactions`; com `RESTRICT` a
exclusão inteira falha, com `NO ACTION` a verificação roda depois que as transações já
foram removidas e passa. Ambos continuam rejeitando a exclusão de uma subcategoria que
esteja realmente em uso.

**Consequência:** as escolhas por chave são uma primeira versão, a ser reexaminada
quando a primeira migration for escrita — com um teste que faz hard delete de um perfil
totalmente populado e verifica que nada dele permanece. Uma transação sem nenhum
contêiner definido (o estado inválido que a
[§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante) aceita) nunca é
alcançada pelo cascade e faz essa exclusão **falhar** com um erro de chave estrangeira —
o resultado certo; a rotina de verificação de integridade existe para encontrar essas
linhas antes.

### 3.9 Tipos e domínios de colunas

O SQLite usa *afinidade* de tipo em vez de tipagem estrita, e não tem tipo nativo
booleano, de data ou de UUID. Por conta própria, ele aceita silenciosamente uma string
em uma coluna numérica, o que é incompatível com o padrão de tipagem estrita do
[CLAUDE.md](../../CLAUDE.md). Portanto:

- **Todas as tabelas são declaradas `STRICT`.** O SQLite rejeita valores que não podem
  ser convertidos sem perda para o tipo da coluna, em vez de armazená-los
  silenciosamente. Inegociável. Uma nuance: uma string com cara de número, como `'1'`,
  ainda é aceita em uma coluna `INTEGER` — o `STRICT` protege o tipo armazenado, não a
  disciplina de quem chama; a fronteira tipada do Repository faz o resto.
- **Dinheiro → `REAL`.** **Booleanos → `INTEGER`** `0`/`1`. **Enums → `INTEGER`**,
  usando os valores numéricos atribuídos no diagrama. **UUIDs → `TEXT`.**
- **Datas → `TEXT`, ISO-8601** (`YYYY-MM-DD`; timestamps `YYYY-MM-DD HH:MM:SS`), UTC.
  ISO-8601 em texto ordena e compara corretamente como string, funciona com as funções
  de data do SQLite e continua legível quando alguém abre o arquivo à mão — o que importa
  mais aqui do que os bytes economizados por inteiros de epoch.

O `STRICT` só conhece `INTEGER`, `REAL` e `TEXT`, então o **domínio** de uma coluna é
completado com uma restrição `CHECK`. O catálogo, usado literalmente na [§4](#4-tabelas):

| Domínio | Restrição |
|---|---|
| bool | `CHECK (col IN (0, 1))` |
| enum | `CHECK (col IN (1, 2, …))`, o conjunto literal do diagrama |
| date | `CHECK (col IS strftime('%Y-%m-%d', col))` — uma data inválida ou não canônica (`2024-02-30`) faz o `strftime` retornar outra coisa, então a comparação falha |
| timestamp | `CHECK (col IS strftime('%Y-%m-%d %H:%M:%S', col))` |
| uuid | `CHECK (length(col) = 36)` |
| currency | `CHECK (length(col) = 3 AND col = upper(col))` — ISO 4217 |
| `varchar(n)` | `CHECK (length(col) <= n)` |
| faixas | `month` 1–12, dia do mês 1–31, `year` 1900–9999, `installments > 0`, `percentage` 0–100 |
| filename | 1–255 bytes, sem `/` ou `\` — usado apenas por `attachments.name`, que é um componente de caminho |

**Defaults só existem onde a ausência de um valor tem significado no domínio** —
`paid = 0`, `charges = 0`, `conversion_rate = 1`, `consider_balance = 1` — nunca para
cobrir um repositório que esqueceu de escrever uma coluna.

O SQLite não consegue alterar um `CHECK` sem reconstruir a tabela, então só invariantes
que não vão mudar pertencem aqui. Aumentar um enum é a única mudança previsível, e custa
uma reconstrução de tabela — aceito, já que é raro e migrations existem para isso. Os
tamanhos e faixas escolhidos estão abertos a revisão antes da primeira migration; depois
dela, são contrato.

**Notação na §4:** *NN* = `NOT NULL`; colunas anuláveis indicam *null*. *date* e
*timestamp* em uma célula de restrição representam as verificações de formato acima.

### 3.10 O que o banco garante e o que a aplicação garante

| Garantido pelo banco | Garantido pela aplicação |
|---|---|
| Tipos — tabelas `STRICT` ([§3.9](#39-tipos-e-domínios-de-colunas)) | Regras de negócio e validade condicional de campos |
| Domínios de coluna — `CHECK` em enums, booleanos, formato de data, tamanhos, faixas ([§3.9](#39-tipos-e-domínios-de-colunas)) | Validade condicional de uma coluna em função de outra (`paid` / `payment_date`, `installments` dado o `type`) |
| Integridade referencial — chaves estrangeiras ([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)) | Arredondamento e precisão monetária ([§3.7](#37-dinheiro)) |
| Unicidade — índices parciais ([§3.11](#311-índices)) | Consistência entre colunas, incluindo os dois arcos exclusivos |

Estrutura é trabalho do banco; significado é trabalho da aplicação. Um domínio diz o que
uma única coluna pode conter, isoladamente, e nunca muda com uma regra de negócio. Tudo
que relaciona duas colunas ou duas linhas fica de fora: os arcos exclusivos em
`transactions` e `recurrences`, `paid` versus `payment_date`, sócios apenas em perfis
empresariais, a conta de um cartão pertencer ao mesmo perfil, as participações dos sócios
somarem 100, o sinal de `value`. Uma check constraint que codifique "uma transação
pertence a um extrato *ou* a uma fatura" é uma regra de negócio vivendo na camada de
armazenamento, onde fica invisível para o código que precisa satisfazê-la e é difícil de
mudar.

**A troca que está sendo aceita:** o banco vai aceitar linhas inválidas. A validação,
portanto, fica em um **único ponto de controle** na camada Service, e não em cada ponto
de chamada; os testes cobrem explicitamente os estados inválidos; e uma rotina de
verificação de integridade procura desvio de saldo ([§3.7](#37-dinheiro)), transações
órfãs ([§4.13](#413-transactions)) e arquivos de anexo ausentes
([§4.15](#415-attachments)). Três verificações, uma rotina.

### 3.11 Índices

- **Toda coluna de chave estrangeira tem seu próprio índice simples.** O SQLite não cria
  um automaticamente. Sem ele, toda verificação de cascade na exclusão de um pai e toda
  busca de "transações deste extrato" é uma varredura completa da tabela filha — e
  `transactions` tem sete chaves estrangeiras. Esses índices **não** são parciais: uma
  linha com soft delete continua sendo um filho que a verificação de chave estrangeira
  precisa encontrar.
- **Toda regra de unicidade é um índice único parcial**, `WHERE deleted_at IS NULL`
  ([§3.6](#36-colunas-presentes-em-todas-as-tabelas)).
- **Nomes são únicos dentro do seu escopo**, sem diferenciar maiúsculas de minúsculas:
  `tags` e `transaction_categories` por perfil, `transaction_sub_categories` por
  categoria, `attachments` por transação. Duas categorias chamadas "Mercado" são um bug
  de qualidade de dados que depois aparece como uma divisão em todo relatório.
  `COLLATE NOCASE` só normaliza ASCII — `Alimentação` e `alimentação` continuam
  distintas; aceito, a aplicação normaliza na entrada se isso importar. `accounts`,
  `credit_cards`, `partners` e `goals` deliberadamente **não** têm nome único — duas
  contas no mesmo banco chamadas "Corrente" são legítimas.

---

## 4. Tabelas

Uma seção por tabela, em ordem de dependência. Cada uma diz o que a tabela é, as
decisões tomadas sobre ela e, em seguida, suas colunas, chaves estrangeiras e índices.
As colunas da [§3.6](#36-colunas-presentes-em-todas-as-tabelas) são omitidas em todas.

### 4.1 profiles

A raiz do tenant — pense nela como a tabela de usuários. Todo outro registro do sistema
está pendurado em um perfil, direta ou transitivamente
([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)).

#### Um perfil é pessoal ou empresarial, e isso controla os sócios

`type` separa os dois. Sócios ([§4.2](#42-partners)) só fazem sentido para perfis
empresariais, e relatórios baseados em sócios não estão disponíveis para perfis pessoais.
A restrição "um perfil pessoal não tem sócios" relaciona duas tabelas, então é garantida
na camada Service, não pelo banco
([§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)).

#### A moeda do perfil é a unidade em que tudo é armazenado

`currency` é a moeda de relatório. Toda coluna monetária do banco está denominada nela
([§3.7](#37-dinheiro)); as colunas de moeda em `accounts` e `transactions` são rótulos,
não unidades.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |
| `type` | INTEGER | NN, `CHECK (type IN (1, 2))` | enum — `1: personal`, `2: business` |
| `currency` | TEXT | NN, currency | ISO 4217 (`BRL`, `USD`) |

Sem chaves estrangeiras. Nenhum índice além da chave primária.

### 4.2 partners

Pessoas que detêm participação em um perfil **empresarial**. Cada sócio tem um
percentual de participação, usado para exibir a distribuição de despesas e receitas.

#### Participação e pagamento são números diferentes

`percentage` é o que um sócio *possui*. Qual sócio de fato *pagou* uma determinada
transação é registrado na própria transação (`transactions.partner_id`,
[§4.13](#413-transactions)). O que um sócio pagou e o que ele deve pela sua participação
são números diferentes, e a diferença entre eles é o relatório interessante.

Que as participações de um perfil somem 100, e que o perfil seja empresarial, são regras
da aplicação ([§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)).
Nomes de sócios não são únicos — nada impede duas pessoas com o mesmo nome.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 100)` | |
| `percentage` | REAL | NN, `CHECK (percentage >= 0 AND percentage <= 100)` | Participação societária, escala de 0 a 100 |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_partners_profile_id` | `(profile_id)` | simples |

### 4.3 notes

Uma lista simples de observações e lembretes vinculada a um perfil. Não está ligada a
nenhuma transação ou conta — deliberadamente, uma lista simples.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `note` | TEXT | NN | Sem limite de tamanho |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_notes_profile_id` | `(profile_id)` | simples |

### 4.4 accounts

Uma conta corrente ou de investimentos pertencente a um perfil.

#### `balance` é um cache, na moeda do perfil

`balance` é um valor derivado, reconstruído a partir das transações pela camada Service
([§3.7](#37-dinheiro)). Ele é mantido na moeda do **perfil**, não na da conta.

#### `currency` é um rótulo, e `consider_balance` é o mecanismo de isolamento

Uma conta bancária no exterior pode legitimamente ser mantida em outra moeda; `currency`
registra esse fato, e nada mais — não muda como `balance` é armazenado. A consequência é
que o saldo armazenado de uma conta estrangeira **não** vai bater com o que o banco
informa, porque foi convertido pelas taxas aplicadas quando cada transação foi lançada,
e se afasta da realidade conforme as taxas mudam. Em vez de modelar isso, o usuário
desliga `consider_balance` e a conta sai do total consolidado, mantendo intacto o próprio
histórico. É uma válvula de escape deliberada, não um remendo. Conciliar com um banco
estrangeiro está fora do escopo.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | Não é único — duas contas "Corrente" em bancos diferentes são legítimas |
| `balance` | REAL | NN | money — saldo atual, cache derivado |
| `currency` | TEXT | NN, currency | ISO 4217. Apenas descritivo |
| `consider_balance` | INTEGER | NN, `DEFAULT 1`, `CHECK (consider_balance IN (0, 1))` | bool — entra no saldo consolidado |
| `type` | INTEGER | NN, `CHECK (type IN (1, 2))` | enum — `1: checking account`, `2: investment account` |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_accounts_profile_id` | `(profile_id)` | simples |

### 4.5 credit_cards

Pertence a um perfil e é quitado por uma conta.

#### Quitado por uma conta do mesmo perfil

`account_id` é a conta que paga as faturas do cartão ([§4.7](#47-invoices)). O cartão é
excluído junto com essa conta — ele não pode existir sem a conta que o quita — e a ação
de exclusão é `CASCADE` em vez de `RESTRICT` para não bloquear um cascade de perfil
([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)).
Que a conta pertença ao **mesmo** perfil é uma regra da aplicação.

#### Fechamento e vencimento são números de dia

`closing_date` e `due_date` são dias do mês (1–31), não datas. A fatura de um
determinado mês fecha no `closing_date` e vence no `due_date` — geralmente do mês
seguinte, e é por isso que uma fatura e o extrato que a absorve caem em meses diferentes
([§4.7](#47-invoices)).

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `account_id` | TEXT | NN, FK | A conta que quita o cartão |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |
| `limit_value` | REAL | NN | money — renomeada de `limit`, palavra-chave do SQLite |
| `closing_date` | INTEGER | NN, `CHECK (closing_date BETWEEN 1 AND 31)` | Dia do mês em que a fatura fecha |
| `due_date` | INTEGER | NN, `CHECK (due_date BETWEEN 1 AND 31)` | Dia do mês em que a fatura vence |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |
| `account_id` | accounts | NN | `CASCADE` | Propriedade — veja acima |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_credit_cards_profile_id` | `(profile_id)` | simples |
| `idx_credit_cards_account_id` | `(account_id)` | simples |

### 4.6 bank_statements

Um registro por conta por mês — o contêiner mensal da conta.

#### Consolidações mensais são materializadas, uma linha por mês

Os relatórios que o projeto existe para produzir são orientados a mês. Materializar a
consolidação mensal mantém as consultas de relatório baratas e dá um registro histórico
estável mesmo quando transações passadas são editadas. Por isso `(account_id, year,
month)` é uma chave única, e as linhas de consolidação são criadas e recalculadas pela
camada Service sempre que as transações daquele mês mudam. `balance` é o saldo de
fechamento do mês — um cache derivado ([§3.7](#37-dinheiro)). `invoices`
([§4.7](#47-invoices)) segue a mesma regra para cartões de crédito.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `account_id` | TEXT | NN, FK | |
| `month` | INTEGER | NN, `CHECK (month BETWEEN 1 AND 12)` | |
| `year` | INTEGER | NN, `CHECK (year BETWEEN 1900 AND 9999)` | |
| `balance` | REAL | NN | money — saldo de fechamento do mês, cache derivado |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `account_id` | accounts | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_bank_statements_account_id` | `(account_id)` | simples |
| `uq_bank_statements_account_period` | `(account_id, year, month)` | único, parcial |

### 4.7 invoices

Um registro por cartão de crédito por mês — o contêiner mensal do cartão, sob a mesma
regra de uma linha por mês da [§4.6](#46-bank_statements).

#### Uma fatura é quitada contra um extrato bancário

Quando uma fatura é paga, ela é vinculada à linha de `bank_statements` do mês em que é
paga, para que a movimentação do cartão entre no saldo mensal da conta dona, em vez de
ficar em um universo paralelo. O mês da própria fatura e o mês do extrato que a absorve
geralmente são diferentes — um cartão que fecha em março normalmente é pago em abril — e
o modelo não pode supor que sejam iguais. `bank_statement_id` é nulo até a fatura ser
paga, e `SET NULL` na exclusão: a fatura sobrevive ao extrato que a absorveu e
simplesmente volta a ficar em aberto.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `credit_card_id` | TEXT | NN, FK | |
| `bank_statement_id` | TEXT | null, FK | O extrato do mês em que a fatura é paga |
| `month` | INTEGER | NN, `CHECK (month BETWEEN 1 AND 12)` | |
| `year` | INTEGER | NN, `CHECK (year BETWEEN 1900 AND 9999)` | |
| `balance` | REAL | NN | money — total da fatura no mês, cache derivado |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `credit_card_id` | credit_cards | NN | `CASCADE` | Propriedade |
| `bank_statement_id` | bank_statements | null | `SET NULL` | Referência |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_invoices_credit_card_id` | `(credit_card_id)` | simples |
| `idx_invoices_bank_statement_id` | `(bank_statement_id)` | simples |
| `uq_invoices_credit_card_period` | `(credit_card_id, year, month)` | único, parcial |

### 4.8 transaction_categories

O nível superior da hierarquia de classificação de dois níveis. Pertence a um perfil,
então um perfil pessoal e um empresarial mantêm cada um seu próprio vocabulário e nenhum
enxerga o do outro
([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)).
Os nomes são únicos por perfil, sem diferenciar maiúsculas de minúsculas
([§3.11](#311-índices)).

> Renomeada de `CategoriesTransation` — grafia corrigida e plural movido para o
> substantivo principal ([§3.4](#34-nomenclatura)).

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_transaction_categories_profile_id` | `(profile_id)` | simples |
| `uq_transaction_categories_profile_name` | `(profile_id, name COLLATE NOCASE)` | único, parcial |

### 4.9 transaction_sub_categories

O nível inferior da hierarquia. Uma transação aponta para uma subcategoria; a
subcategoria pertence a uma categoria. Escopada a um perfil transitivamente, por meio da
sua categoria. Os nomes são únicos por categoria, sem diferenciar maiúsculas de
minúsculas.

> Renomeada de `SubCategoriesTransaction`, pelo mesmo motivo que a tabela pai.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `category_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `category_id` | transaction_categories | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_transaction_sub_categories_category_id` | `(category_id)` | simples |
| `uq_transaction_sub_categories_category_name` | `(category_id, name COLLATE NOCASE)` | único, parcial |

### 4.10 tags

Rótulos livres pertencentes a um perfil, em relação muitos-para-muitos com transações
por meio da [§4.14](#414-transactions_tags). Os nomes são únicos por perfil, sem
diferenciar maiúsculas de minúsculas.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_tags_profile_id` | `(profile_id)` | simples |
| `uq_tags_profile_name` | `(profile_id, name COLLATE NOCASE)` | único, parcial |

### 4.11 goals

Uma meta de economia ou de gasto pertencente a um perfil, alimentada pelas transações
vinculadas a ela (`transactions.goal_id`).

#### O progresso é calculado, nunca armazenado

`goals` tem um alvo (`value`, `target_date`), mas nenhuma coluna de progresso. Quanto já
foi destinado a uma meta é sempre derivado somando as transações vinculadas a ela.

Isso é um desvio deliberado dos saldos em cache da [§3.7](#37-dinheiro), e a diferença
está no padrão de leitura. Saldos de conta são lidos o tempo todo — o app abre neles — e
é isso que justifica o cache. O progresso de uma meta só é lido quando alguém abre a tela
de metas, e o conjunto de transações por trás de uma única meta é pequeno. Fazer cache
dele adicionaria um segundo valor desnormalizado para manter correto em troca de nada. O
vínculo meta ↔ transação é a única fonte da verdade; nenhuma rotina de recálculo é
necessária e nenhum desvio é possível.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) <= 45)` | |
| `value` | REAL | NN | money — valor alvo |
| `target_date` | TEXT | null, date | Renomeada de `date` ([§3.4](#34-nomenclatura)). Anulável: uma meta sem prazo (uma reserva de emergência) não tem data limite |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_goals_profile_id` | `(profile_id)` | simples |

### 4.12 recurrences

A regra que produz transações repetidas. Ela cobre duas formas distintas, separadas por
`type`:

- **`1: installments`** — uma compra dividida em um número fixo de partes (uma compra
  paga em 12x). A quantidade é conhecida de antemão e a série é finita.
- **`2: fixed`** — uma cobrança recorrente sem fim inerente (aluguel, uma assinatura).
  Ela segue até `end_at`, ou indefinidamente quando `end_at` é nulo.

`recurrence` é o intervalo entre ocorrências e vale para ambas.

#### Pertence diretamente ao perfil

`profile_id` é `NOT NULL` e cascateia a partir de `profiles`. A chave estrangeira entre
regras e ocorrências aponta da transação para a regra (`transactions.recurrence_id`),
então, sem seu próprio `profile_id`, uma regra **não teria caminho de volta até seu
perfil**: uma regra cujas ocorrências tivessem todas sofrido soft delete ficaria
inalcançável, um hard delete de perfil deixaria todas as regras órfãs, e ocorrências
ainda não materializadas precisam de um perfil onde ser emitidas, independentemente de
qualquer linha existente.

#### Uma regra materializa uma transação real por ocorrência

Uma recorrência emite **linhas reais de `transactions`**, uma por ocorrência. Não é um
template expandido em tempo de leitura. Toda transação precisa estar em exatamente um
contêiner mensal ([§4.13](#413-transactions)), e esses contêineres carregam um saldo
consolidado ([§4.6](#46-bank_statements)): a parcela 3 de 12 precisa cair em uma fatura
específica, poder ser marcada como paga individualmente e ser editável individualmente
quando seu valor mudar. Uma ocorrência virtual calculada em tempo de leitura não consegue
fazer nada disso. Criar uma recorrência é, portanto, uma escrita de N linhas, cada uma
com seu contêiner, `due_date` e flag `paid` — feita em uma única transação.

#### `installments` e `end_at` são exclusivos por tipo; `value_type` só se aplica a parcelamentos

As duas formas terminam de maneiras diferentes. Uma série parcelada termina por
*quantidade* (`installments`, finita e conhecida na criação); uma série fixa termina por
*data* (`end_at`), ou nunca. Cada coluna é nula para o outro tipo.

`value_type` diz como interpretar o `value` das transações que a regra emite —
`1: total` ("1200 em 12x") ou `2: per_installment` ("12x de 100"). As duas leituras são
naturais dependendo de como a compra foi apresentada, e errar o palpite distorce todo
total mensal por um fator igual ao número de parcelas, então o usuário escolhe
explicitamente. Uma recorrência `fixed` é sempre por ocorrência, por definição, então
`value_type` é nulo para ela.

Qual das três precisa estar preenchida para cada `type` é uma regra da aplicação
([§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)); as
verificações abaixo apenas limitam cada valor quando presente.

#### Séries finitas são materializadas por inteiro; as infinitas avançam aos poucos

- **Finitas** — `installments`, ou `fixed` com `end_at`: a **série inteira é gravada na
  criação**, em uma única transação de banco. A quantidade é conhecida, o número de
  linhas é limitado e trivial, e é o que o usuário espera — quem compra em 24x quer ver
  24 lançamentos e a fatura em que cada um cai. A geração parcial faria uma fatura futura
  parecer vazia até algum processo em segundo plano alcançá-la.
- **Infinitas** — `fixed` com `end_at` nulo: as ocorrências são gravadas até um
  **horizonte móvel de 12 meses**, estendido conforme o tempo passa. Doze cobre um ano
  inteiro de previsão e é o mínimo que mostra pelo menos uma ocorrência de uma regra
  `yearly`. O custo é desprezível — uma regra mensal são 12 linhas por ano.

**`materialized_through` é a marca d'água** (watermark) que registra até onde a regra
foi expandida. O complemento (top-up) gera ocorrências da marca d'água em diante até
`today + 12 months` e, então, a avança. Ele roda na abertura do app e após qualquer
edição de recorrência, e é o mesmo mecanismo para os dois casos — uma série finita
simplesmente chega ao fim e para. Uma marca d'água, em vez de "existe uma linha para esta
data?", porque:

- É **inerentemente idempotente** — rodar o top-up duas vezes não grava nada na segunda,
  sem nenhuma varredura de `transactions`.
- **Faz a exclusão valer.** Se o top-up procurasse uma linha viva, um usuário que
  excluísse o aluguel de abril o encontraria **recriado na próxima abertura**, porque o
  soft delete esconde a linha dessa consulta. Uma marca d'água que só avança nunca
  revisita uma data pela qual já passou.
- É inspecionável — "até onde esta regra foi expandida" é uma coluna, não uma
  propriedade inferida.

Consequências: o top-up escreve na abertura do app, então precisa ser transacional e não
pode rodar antes de o banco estar pronto, e é uma escrita que a sincronização precisa
reconciliar. Uma regra `fixed` com um `end_at` muito distante (o ano 2099) é finita no
papel, mas cai no comportamento móvel em vez de emitir novecentas linhas — a regra é
"trabalho limitado na criação". Dois dispositivos rodando o top-up offline emitem as
mesmas ocorrências — mas o id de cada ocorrência é derivado de
`(recurrence_id, due_date)` ([§3.5](#35-chaves-primárias-são-uuids)), então eles emitem
as **mesmas linhas** e a sincronização as mescla. O índice único
`uq_transactions_recurrence_due_date` da [§4.13](#413-transactions) continua sendo a
rede de segurança, e a própria marca d'água é mesclada como o maior dos dois valores
([sync-design.md §5.5](sync-design.md#55-colunas-que-nunca-sincronizam)).

#### Editar uma transação recorrente pergunta o escopo ao usuário

Quando o usuário edita ou exclui uma transação que veio de uma recorrência, o app
pergunta a quais ocorrências isso se aplica: **somente esta**, **esta e as futuras** ou
**todas**. Não existe um padrão que acerte mais do que cerca de metade das vezes — um
aumento no preço de uma assinatura vale daqui para a frente, um nome digitado errado vale
para a série inteira, um valor atípico em um mês vale para exatamente uma linha — e
adivinhar em silêncio reescreve dados que o usuário não pretendia tocar, o que, em um app
de finanças, significa números históricos errados.

- Isso é responsabilidade da camada Service, e o retorno de materializar linhas reais: os
  três escopos são apenas cláusulas `WHERE` diferentes sobre as linhas que compartilham
  um `recurrence_id`.
- **"Futuras" é definido por `due_date`**, nunca pela ordem de inserção ou pelo id.
- Os escopos 2 e 3 também atualizam a própria linha de `recurrences`, já que a regra que
  emite ocorrências ainda não materializadas precisa concordar com o que o usuário pediu.
  Eles não precisam mover a marca d'água — o horizonte não muda. O escopo 1 deixa a regra
  intocada.
- A exclusão segue os mesmos três escopos, carimbando `deleted_at` em todo o conjunto
  selecionado em uma única transação.
- Qualquer escopo que toque uma ocorrência passada altera um mês com saldo consolidado,
  então o recálculo roda de novo para cada mês afetado.
- **Ocorrências já pagas não são protegidas.** O app precisa **confirmar antes de
  executar** quando o conjunto selecionado contém linhas pagas, dizendo o que realmente
  está em jogo — quantas ocorrências pagas, os saldos de quais meses vão mudar — em vez
  de um aviso genérico. Valores passados neste sistema são mutáveis por design: uma
  ferramenta de finanças pessoais muitas vezes está *corrigindo* o histórico, e não
  apenas registrando-o. O custo é que um relatório gerado duas vezes pode legitimamente
  dar resultados diferentes, e `updated_at` é o único rastro de que um número passado foi
  revisado.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `profile_id` | TEXT | NN, FK | |
| `type` | INTEGER | NN, `CHECK (type IN (1, 2))` | enum — `1: installments`, `2: fixed` |
| `recurrence` | INTEGER | NN, `CHECK (recurrence IN (1, 2, 3, 4))` | enum — `1: daily`, `2: weekly`, `3: monthly`, `4: yearly` |
| `installments` | INTEGER | null, `CHECK (installments IS NULL OR installments > 0)` | Número de partes — somente `type = 1` |
| `value_type` | INTEGER | null, `CHECK (value_type IS NULL OR value_type IN (1, 2))` | enum — `1: total`, `2: per_installment` — somente `type = 1` |
| `end_at` | TEXT | null, date | Quando a regra para de emitir — somente `type = 2` |
| `materialized_through` | TEXT | NN, date | Marca d'água; só avança. Sempre preenchida, já que a criação materializa pelo menos o primeiro horizonte |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `profile_id` | profiles | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_recurrences_profile_id` | `(profile_id)` | simples |

### 4.13 transactions

A entidade central. Toda movimentação de dinheiro — receita, despesa, transferência ou
investimento — é uma transação, e toda transação é classificada por uma subcategoria.

#### Uma transação pertence a exatamente um contêiner mensal

Uma transação de conta cai em um extrato bancário; uma transação de cartão cai em uma
fatura. `bank_statement_id` e `invoice_id` são alternativas, não pais simultâneos — um
arco exclusivo implementado como duas chaves estrangeiras anuláveis. "Exatamente uma está
preenchida" é garantido na aplicação, não por um `CHECK`
([§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)). A troca: uma
linha com as duas nulas não viola nenhuma restrição, não pertence a nenhum contêiner e
desapareceria de todos os relatórios enquanto continua existindo — uma ausência
silenciosa. A rotina de verificação de integridade procura esses órfãos, e um hard delete
de perfil falha diante deles
([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)).

#### `value` é armazenado convertido; `currency` e `conversion_rate` são proveniência

`value` está **sempre já convertido** para a moeda do perfil ([§3.7](#37-dinheiro)).
Nunca é o valor em moeda estrangeira. `currency` registra a moeda de origem e
`conversion_rate` a taxa que o usuário afirma ter sido aplicada; nenhuma das duas é usada
em cálculos. Moeda estrangeira explicitamente não é um foco deste app, e armazenar o
valor convertido significa que todo relatório, saldo e consolidação é uma soma simples —
sem join com uma taxa, sem multiplicação, sem caso de borda de taxa nula.

- **Nenhum relatório multiplica por `conversion_rate`.** Se alguma consulta fizer isso,
  é um bug.
- `conversion_rate` é o que o usuário afirma ter sido usado, não uma cotação de mercado
  ao vivo, e nunca é derivada de novo. O padrão é `1` — nenhuma conversão ocorreu.
- **O valor original em moeda estrangeira não é armazenado.** Um usuário que o queira
  registra em `description` como texto livre. Não é consultável, e isso é aceito.
- Esta é a justificativa mais forte para manter dinheiro como `REAL`: `value` é de moeda
  única, mas `conversion_rate` ainda precisa de muito mais do que duas casas decimais.

#### Transferências e investimentos têm uma conta de destino

Uma transação do tipo `3: transference` ou `4: investment` se vincula a uma segunda
conta — o destino dos recursos — por meio de `destination_account_id`, nulo para todos
os outros tipos. Os relatórios precisam evitar contagem dupla: uma transferência não é
receita nem despesa líquida no nível do perfil, apenas no nível da conta.

#### Uma transação registra qual sócio a pagou

`partner_id` identifica o sócio que pagou esta transação específica — distinto da
participação societária da [§4.2](#42-partners). Ele não faz parte de nenhum arco
exclusivo: é nulo em toda transação de um perfil pessoal, e anulável também em um perfil
empresarial, já que pode não haver sócio registrado como pagador. Relatórios que dividem
por sócio precisam lidar com transações sem atribuição, em vez de supor que o vínculo
está presente.

#### Os demais vínculos

`goal_id` — uma transação pode contribuir para uma meta ou para nenhuma
([§4.11](#411-goals)). `recurrence_id` — preenchido apenas em transações emitidas por uma
regra ([§4.12](#412-recurrences)). Nenhum dos dois restringe o outro ou qualquer outra
coisa. `paid` e `payment_date` precisam concordar, o que é uma regra da aplicação.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `sub_category_id` | TEXT | NN, FK | Toda transação é classificada |
| `bank_statement_id` | TEXT | null, FK | Exclusivo com `invoice_id` |
| `invoice_id` | TEXT | null, FK | Exclusivo com `bank_statement_id` |
| `destination_account_id` | TEXT | null, FK | Somente `type` 3 e 4 |
| `partner_id` | TEXT | null, FK | Somente perfis empresariais, opcional mesmo nesses |
| `goal_id` | TEXT | null, FK | |
| `recurrence_id` | TEXT | null, FK | Somente quando emitida por uma regra |
| `name` | TEXT | NN, `CHECK (length(name) <= 100)` | O tamanho não estava especificado no diagrama; 100 foi escolhido |
| `description` | TEXT | null | Texto livre, sem limite de tamanho |
| `value` | REAL | NN | money — **sempre já convertido** para a moeda do perfil |
| `currency` | TEXT | NN, currency | ISO 4217 — a moeda de **origem**. Apenas proveniência |
| `conversion_rate` | REAL | NN, `DEFAULT 1` | A taxa aplicada. Apenas proveniência |
| `due_date` | TEXT | NN, date | |
| `paid` | INTEGER | NN, `DEFAULT 0`, `CHECK (paid IN (0, 1))` | bool |
| `payment_date` | TEXT | null, date | |
| `charges` | REAL | NN, `DEFAULT 0` | money — tarifas / juros aplicados sobre `value` |
| `type` | INTEGER | NN, `CHECK (type IN (1, 2, 3, 4))` | enum — `1: income`, `2: expense`, `3: transference`, `4: investment` |

#### Chaves estrangeiras

Esta tabela tem mais chaves estrangeiras do que qualquer outra, e a maioria é anulável
por *motivos diferentes e sem relação entre si*. Só o par de contêineres é um arco
exclusivo.

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `sub_category_id` | transaction_sub_categories | NN | `NO ACTION` | Vocabulário — deliberadamente não `RESTRICT` ([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)) |
| `bank_statement_id` | bank_statements | null | `CASCADE` | Propriedade — o contêiner |
| `invoice_id` | invoices | null | `CASCADE` | Propriedade — o contêiner |
| `destination_account_id` | accounts | null | `SET NULL` | Referência — a transação sobrevive ao seu destino |
| `partner_id` | partners | null | `SET NULL` | Referência |
| `goal_id` | goals | null | `SET NULL` | Referência — excluir uma meta não pode excluir o que a alimentou |
| `recurrence_id` | recurrences | null | `SET NULL` | Referência — as ocorrências sobrevivem à sua regra |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_transactions_sub_category_id` | `(sub_category_id)` | simples |
| `idx_transactions_bank_statement_id` | `(bank_statement_id)` | simples |
| `idx_transactions_invoice_id` | `(invoice_id)` | simples |
| `idx_transactions_destination_account_id` | `(destination_account_id)` | simples |
| `idx_transactions_partner_id` | `(partner_id)` | simples |
| `idx_transactions_goal_id` | `(goal_id)` | simples |
| `idx_transactions_recurrence_id` | `(recurrence_id)` | simples |
| `idx_transactions_due_date` | `(due_date)` | simples — relatórios por período e o escopo "esta e as futuras" |
| `uq_transactions_recurrence_due_date` | `(recurrence_id, due_date)` | único, parcial — `WHERE deleted_at IS NULL AND recurrence_id IS NOT NULL` |

### 4.14 transactions_tags

Tabela de junção que resolve o muitos-para-muitos entre transações e tags. Ela tem as
colunas comuns da [§3.6](#36-colunas-presentes-em-todas-as-tabelas) como toda outra
tabela, soft delete incluído, então o par é único apenas entre as linhas vivas.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `transaction_id` | TEXT | NN, FK | |
| `tag_id` | TEXT | NN, FK | |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `transaction_id` | transactions | NN | `CASCADE` | Propriedade |
| `tag_id` | tags | NN | `CASCADE` | Propriedade — um vínculo não pode sobreviver a nenhum dos lados |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_transactions_tags_transaction_id` | `(transaction_id)` | simples |
| `idx_transactions_tags_tag_id` | `(tag_id)` | simples |
| `uq_transactions_tags_pair` | `(transaction_id, tag_id)` | único, parcial |

### 4.15 attachments

Um arquivo anexado a uma transação — normalmente um recibo ou o PDF de uma nota fiscal.

#### Os bytes ficam em disco, em um caminho derivado

A linha armazena **apenas** `name`, extensão incluída. O arquivo fica em disco em um
caminho montado por convenção:

```
profile/{profileID}/attachments/{transactionID}/{attachmentName}
```

Fotos de recibos e PDFs chegam a megabytes. Guardá-los como blobs incharia o único
arquivo de banco que todo backup e toda sincronização futura precisam mover, para dados
que são escritos uma vez e lidos raramente. Organizar em pastas por transação também
torna a árvore navegável — tudo que pertence a uma transação fica junto, que é o que quer
alguém vasculhando um backup à mão.

Consequências:

- **O banco deixa de ser o registro completo do sistema.** Qualquer backup ou exportação
  precisa cobrir também a árvore de anexos, ou fica silenciosamente incompleto.
- **Linhas e arquivos podem se desencontrar.** Um arquivo ausente não é uma violação de
  chave estrangeira; a rotina de verificação de integridade percorre os anexos e informa
  arquivos ausentes.
- **O soft delete aumenta a distância.** A linha de um anexo excluído persiste, e o
  arquivo também. O que quer que um dia purgue linhas com soft delete precisa apagar os
  arquivos na mesma passada.
- **`name` é um componente de caminho.** Daí o limite de 255 bytes e a proibição de
  separadores na verificação de domínio, e o índice único por transação: dois arquivos
  vivos não podem compartilhar um caminho. Sem diferenciar maiúsculas de minúsculas,
  porque os sistemas de arquivos do macOS e do Windows não diferenciam. O que o banco não
  consegue ver é um anexo *com soft delete* cujo arquivo ainda está em disco com esse
  nome, então o app ainda precisa verificar o sistema de arquivos — ou renomear — no
  upload.

#### Colunas

| Coluna | Tipo | Restrições | Notas |
|---|---|---|---|
| `transaction_id` | TEXT | NN, FK | |
| `name` | TEXT | NN, `CHECK (length(name) BETWEEN 1 AND 255 AND instr(name, '/') = 0 AND instr(name, '\') = 0)` | O nome original do arquivo, extensão incluída |

#### Chaves estrangeiras

| FK | Destino | Nulo? | On delete | Por quê |
|---|---|---|---|---|
| `transaction_id` | transactions | NN | `CASCADE` | Propriedade |

#### Índices

| Índice | Colunas | Tipo |
|---|---|---|
| `idx_attachments_transaction_id` | `(transaction_id)` | simples |
| `uq_attachments_transaction_name` | `(transaction_id, name COLLATE NOCASE)` | único, parcial |

---

## 5. Notas herdadas do diagrama

Anotações literais do `project.drawio`, preservadas para que nada se perca se o diagrama
for refatorado. O texto original é mantido como está no diagrama, seguido da tradução:

- *"Profiles: think of this as a user table. All records are linked to this profile table. If a profile is deleted, everything associated with it is deleted. The profile can be personal or business."* → "Perfis: pense nisto como uma tabela de usuários. Todos os registros estão vinculados a esta tabela de perfis. Se um perfil for excluído, tudo que estiver associado a ele é excluído. O perfil pode ser pessoal ou empresarial."
- *"'Partners' defines a list of individuals associated with the profile if it is a business type. Each partner has a specific percentage share; this is used to display the distribution of expenses and revenue based on that partner's percentage."* → "'Partners' define uma lista de pessoas associadas ao perfil, se ele for do tipo empresarial. Cada sócio tem um percentual de participação específico; isso é usado para exibir a distribuição de despesas e receitas com base no percentual desse sócio."
- *"Both tables will have one record per month."* (em `bank_statements` e `invoices`) → "As duas tabelas terão um registro por mês."
- *"Transfers and investments can be linked to another account to designate the destination of the funds."* → "Transferências e investimentos podem ser vinculados a outra conta para designar o destino dos recursos."
- *"The transaction link with partners is to define who is the partner that pay that transaction."* → "O vínculo da transação com sócios serve para definir qual sócio pagou aquela transação."
- *"Lista simples de observações e lembretes"* (em `notes`)
- *"Every table also carries created_at, updated_at and deleted_at (soft delete). Left out of the boxes above to keep them readable."* → "Toda tabela também tem created_at, updated_at e deleted_at (soft delete). Deixadas de fora das caixas acima para mantê-las legíveis."
- *"Attachments store only the file name (extension included). The bytes live on disk, at a path derived by convention: profile/{profileID}/attachments/{transactionID}/{attachmentName}"* → "Anexos armazenam apenas o nome do arquivo (extensão incluída). Os bytes ficam em disco, em um caminho derivado por convenção: profile/{profileID}/attachments/{transactionID}/{attachmentName}"
- *"value is ALWAYS stored already converted. currency and conversion_rate are records of where the amount came from — reports never multiply by them. Foreign currency is not a focus of this app."* → "value é SEMPRE armazenado já convertido. currency e conversion_rate são registros de onde o valor veio — relatórios nunca multiplicam por eles. Moeda estrangeira não é foco deste app."

---

## 6. Próximos passos

**O contrato físico da [§4](#4-tabelas) está completo e nada bloqueia a DDL.**

1. **Revisar as escolhas da primeira versão** — ações de exclusão por chave
   ([§3.8](#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)),
   tamanhos, faixas e valores padrão ([§3.9](#39-tipos-e-domínios-de-colunas)). São
   baratas de mudar até a primeira migration ser entregue.
2. **A DDL existe** —
   [db/migrations/0001_initial_schema.sql](../../db/migrations/0001_initial_schema.sql),
   um arquivo `.sql` independente de runner, transcrito tabela por tabela a partir da
   [§4](#4-tabelas). Ela foi exercitada contra o SQLite 3.46: um perfil totalmente
   populado, após hard delete, deixa as tabelas vazias; uma transação órfã bloqueia essa
   exclusão; toda verificação de domínio e todo índice único parcial se comportam como
   documentado. Esse exercício precisa virar um teste permanente assim que a stack e seu
   test runner existirem, junto com o teste de configuração da conexão que verifica que
   `PRAGMA foreign_keys = ON` é de fato aplicado
   ([§3.2](#32-a-configuração-da-conexão-faz-parte-do-contrato-do-schema)).
   A escolha do runner de migrations faz parte da decisão de stack.
3. **Construir o ponto de controle de validação na camada Service** e a rotina de
   verificação de integridade
   ([§3.10](#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)): desvio de
   saldo, transações órfãs, arquivos de anexo ausentes. Três verificações, uma rotina.
4. **Não restam questões em aberto.**
5. Ainda de fato não modelado: a **proveniência da importação** do histórico que está
   sendo migrado do app atual. Os **metadados de sincronização** estão projetados em
   [sync-design.md](sync-design.md) e chegam em sua própria migration quando a
   sincronização for implementada; as tabelas acima não mudam por causa disso.
