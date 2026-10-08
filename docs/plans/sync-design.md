# Design de Sincronização

**Status:** Design concluído — não implementado. Nada aqui exige uma migration hoje; a
única regra que precisa valer desde a primeira linha de código é a regra de ids
determinísticos da
[§5.6](#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos), já
incorporada à [database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids).
**Relacionado:** [docs/plans/database-design.md](database-design.md) — o schema que este
design replica; [docs/plans/backend-design.md](backend-design.md) — o núcleo onde a
sincronização roda e a política de versões de schema entre dispositivos.

Este documento é o lugar de toda decisão sobre como os dispositivos de um usuário
compartilham dados. A [§2](#2-decisões-em-resumo) é o resumo; as seções seguintes guardam
o raciocínio. Onde este documento e o design do banco de dados se tocam, ambos são
atualizados juntos.

---

## 1. Escopo e restrições

Herdadas do [README](../../README.md): o banco de dados é local e embarcado, o sistema
não pode custar nada, nunca, ele roda no desktop, **Android e iOS**, e nada pode exigir
um servidor sempre ligado.

Acrescentadas por este design:

- **A sincronização acontece apenas entre dispositivos na mesma rede local**, enquanto os
  dois apps estão abertos. Não há caminho pela internet, nem relay, nem pasta na nuvem.
  Esta é uma regra de produto, não uma limitação da v1 — ela mantém os dados fora de toda
  rede que não pertença ao usuário ([§7.1](#71-somente-a-mesma-rede-local)).
- Todo dispositivo guarda o **conjunto completo de dados** e **escreve offline**.
- **Qualquer dispositivo pareado** pode adicionar ou remover dispositivos.
- Edições concorrentes são resolvidas como **a edição mais recente vence, por campo**.

Fora do escopo: sincronização pela internet, sincronização em segundo plano, uma "caixa
postal" para dispositivos que nunca estão online ao mesmo tempo, e a purga física de
linhas com soft delete ([§9](#9-impacto-no-design-do-banco-de-dados)).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Seção |
|---|---|---|
| Motor com sincronização embutida, ou SQLite puro? | SQLite puro; a sincronização é uma camada fina no núcleo TypeScript compartilhado | [§3](#3-motor-sqlite-puro-sincronização-no-núcleo-compartilhado) |
| Onde fica a verdade? | Em lugar nenhum em particular — todo dispositivo é uma réplica completa e igual | [§4](#4-topologia-todo-dispositivo-é-um-par-igual) |
| Como edições concorrentes são reconciliadas? | Last-writer-wins **por coluna**, ordenado por um relógio lógico híbrido | [§5](#5-modelo-de-replicação) |
| Como linhas criadas em dois dispositivos evitam colidir? | UUIDs; linhas identificadas pelo conteúdo recebem um UUID v5 **determinístico** | [§5.6](#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos) |
| Como os dispositivos são vinculados? | QR code ou código curto; um par de chaves por dispositivo; qualquer membro pode convidar ou remover | [§6](#6-membros-e-pareamento) |
| Como os dados trafegam? | Conexão direta e criptografada na mesma rede local, com os dois apps em primeiro plano | [§7](#7-transporte-somente-a-mesma-rede-local) |

---

## 3. Motor: SQLite puro, sincronização no núcleo compartilhado

O motor continua sendo **SQLite puro**
([database-design.md §3.1](database-design.md#31-motor-de-armazenamento--sqlite)).
A sincronização é implementada como código de aplicação no núcleo TypeScript
compartilhado, falando SQL puro por meio da porta do Repository
([database-design.md §3.3](database-design.md#33-a-camada-repository-abstrai-o-driver-não-apenas-o-banco)).

**Por quê:** nada com sincronização embutida satisfaz ao mesmo tempo gratuito, sem
servidor, desktop + as duas plataformas mobile, e um schema relacional com chaves
estrangeiras e índices únicos parciais. Uma camada escrita contra a porta não precisa de
extensão nativa, então ela acompanha qualquer binding SQLite que cada plataforma use — o
mesmo motivo pelo qual a porta existe.

**Alternativas consideradas e rejeitadas:**

| Opção | Por que não |
|---|---|
| Litestream | Faz streaming do banco de **um único escritor** para um object storage. Uma ferramenta de backup, não sincronização com múltiplos escritores; sem suporte a mobile. |
| cr-sqlite | O mais próximo em espírito (CRDT LWW em nível de coluna sobre tabelas SQLite), mas é uma extensão nativa carregável — difícil no iOS, que proíbe carregar bibliotecas dinâmicas —, com desenvolvimento parado desde 2024, e não comporta índices únicos fora da chave primária nem chaves estrangeiras garantidas, dos quais o schema depende. |
| libSQL/Turso, PowerSync, ElectricSQL | Cada um precisa de um serviço hospedado ou de um banco no servidor. Falham nas restrições de sem servidor e sem custo. |
| Evolu | SQLite local-first com sincronização por CRDT, mas é dono do schema e da camada de consultas e sincroniza por meio de um relay — substituiria o contrato do schema e levaria os dados para fora da rede local. |
| Extensão de sessão do SQLite | Embutida no SQLite e exposta pelo `node:sqlite`, mas não pelos bindings mobile típicos; seu modelo de conflito é "ordem de aplicação", não um relógio. |
| PouchDB/RxDB | Já rejeitados na [database-design.md §3.1](database-design.md#31-motor-de-armazenamento--sqlite). |

---

## 4. Topologia: todo dispositivo é um par igual

**Não existe fonte da verdade.** Todo dispositivo guarda o conjunto de dados completo,
aceita escritas offline e pode sincronizar com qualquer outro membro do seu grupo —
desktop↔celular e celular↔celular igualmente.

O primeiro dispositivo tem exatamente um papel especial: quando o usuário ativa a
sincronização, ele **cria o grupo** ([§6.2](#62-o-grupo)). Depois disso, é um membro
como qualquer outro.

**Por quê:** o caso de uso principal — lançar transações no celular, longe do desktop —
exige que o celular escreva offline, o que descarta um cliente fino. E as regras de merge
([§5](#5-modelo-de-replicação)) convergem para o mesmo estado independentemente da ordem
em que as mudanças chegam, então nenhum dispositivo precisa atuar como árbitro. É essa
simetria que permite que qualquer par de dispositivos sincronize, e que um terceiro ou
quarto dispositivo entre, sem casos especiais.

**Rejeitado:**

| Opção | Por que não |
|---|---|
| Desktop como autoridade, celular como cliente fino | O celular não poderia funcionar offline — o caso de uso principal falha. |
| Um "dono" cujos dados vencem os conflitos | Descarta trabalho mais novo: uma correção feita no celular às 10:00 seria sobrescrita por uma edição mais antiga do desktop, das 09:00, que ainda não tinha sido sincronizada. |

**Consequência:** um dispositivo que entra em um grupo **começa vazio** e recebe uma
cópia completa ([§6.4](#64-entrando-no-grupo-um-novo-dispositivo-começa-vazio)). Dois
bancos que cresceram de forma independente nunca são mesclados — sem um histórico de
mudanças, não há forma correta de fazer isso.

---

## 5. Modelo de replicação

### 5.1 A unidade de merge é a coluna; a escrita mais recente vence

Cada coluna de cada linha — uma **célula** — é resolvida de forma independente: vence a
escrita com o maior relógio ([§5.2](#52-o-relógio-é-um-relógio-lógico-híbrido)).

**Por que por coluna e não por linha:** se o celular recategoriza uma transação enquanto
o desktop corrige seu valor, as duas edições são intencionais e nenhuma deveria se
perder. Last-writer-wins em nível de linha descartaria uma delas silenciosamente.

**Por que não um CRDT mais rico** (Automerge, Yjs): eles resolvem a edição concorrente
de texto e de documentos aninhados. Toda coluna aqui é um escalar, e os únicos valores
que se agregam — saldos — são derivados e nunca mesclados
([§5.5](#55-colunas-que-nunca-sincronizam)). Last-writer-wins sobre um escalar é a
semântica correta para ele.

**Exclusão é só uma coluna.** `deleted_at` é mesclado como qualquer outra célula. Uma
edição concorrente em uma coluna *diferente* não desfaz uma exclusão; restaurar é uma
escrita de `deleted_at = NULL` com um relógio mais novo.

### 5.2 O relógio é um relógio lógico híbrido

Toda transação de escrita local é carimbada com um **relógio lógico híbrido** (HLC,
*hybrid logical clock*): o relógio de parede em milissegundos, mais um contador que
mantém o valor estritamente crescente quando o relógio de parede para ou volta, mais o id
do dispositivo como desempate final. Ele é armazenado como uma string de largura fixa,
para que a comparação seja uma simples comparação de strings:

```
{milissegundos, 13 dígitos}.{contador, 5 dígitos}.{device_id}
```

A cada mudança recebida, o HLC local avança para além dela, então a causalidade é
preservada: uma mudança feita depois de ver outra sempre fica ordenada depois dela.

**Por que não `updated_at`:** ele tem precisão de um segundo, é uma coluna visível no
domínio e confia cegamente no relógio de parede. `updated_at` continua sendo o que é — o
rastro legível de "última revisão" — e sincroniza como uma coluna comum.

**Proteção contra divergência de relógio.** Um HLC mantém a ordenação consistente, mas
"a mais recente vence" só significa o que o usuário espera se os relógios dos
dispositivos concordarem aproximadamente: um celular cujo relógio está um dia adiantado
venceria todo conflito durante um dia. Como as sessões são ao vivo
([§7.4](#74-uma-sessão)), os dois dispositivos comparam os relógios no handshake, e
**uma sessão é recusada quando eles divergem além de um limite (proposto: 2 minutos)**,
com uma mensagem dizendo ao usuário o relógio de qual dispositivo corrigir. Nada é
trocado até que concordem.

### 5.3 O que é registrado: relógios de linha e de célula, não um log

O estado da sincronização vive em tabelas próprias. **As tabelas de domínio não mudam.**

| Tabela | Escopo | Guarda |
|---|---|---|
| `sync_rows` | sincronizada | Uma entrada por linha: o relógio, o dispositivo de origem e a sequência de origem da sua criação |
| `sync_cells` | sincronizada | Uma entrada por célula alterada **após** a criação: relógio, dispositivo de origem, sequência de origem |
| `sync_members` | sincronizada | Os dispositivos do grupo ([§6](#6-membros-e-pareamento)) — replicados como dados de domínio |
| `sync_vector` | local | Por dispositivo de origem, a maior sequência de origem que este dispositivo possui |
| `sync_state` | local | O id deste dispositivo, o id do grupo, o HLC e o próximo número de sequência |

O relógio efetivo de uma célula é sua entrada em `sync_cells`, se existir; caso
contrário, a entrada da sua linha em `sync_rows`. A maioria das linhas — especialmente
transações — é escrita uma vez e raramente editada, então isso custa cerca de uma entrada
por linha em vez de uma por célula.

**Não existe log de mudanças.** Sob last-writer-wins, um valor superado nunca mais é
necessário; só importa o vencedor atual de cada célula, e seu valor já está na tabela de
domínio. O que falta a um par é exatamente "toda entrada cuja sequência de origem é maior
do que a que o par possui para aquela origem", e as tabelas de relógio respondem isso
diretamente (indexadas em `(origin, seq)`). O histórico é compactado por construção.

**A sequência é por transação de escrita local.** Toda entrada escrita por uma mesma
transação de banco compartilha uma sequência de origem e um HLC, então uma unidade de
trabalho — as duas pernas de uma transferência, a série completa de uma recorrência —
trafega e é aplicada junta.

O repasse (relaying) sai disso naturalmente: quando um celular sincroniza com o desktop,
o desktop entrega ao celular toda entrada que possui, de *qualquer* origem, que falte ao
celular, então as mudanças de um terceiro dispositivo chegam ao celular por meio do
desktop.

### 5.4 A captura acontece na fronteira do Repository

Toda escrita já passa pela porta do Repository, que já carimba `updated_at`
([database-design.md §3.6](database-design.md#36-colunas-presentes-em-todas-as-tabelas)).
O mesmo ponto registra as entradas de sincronização, **na mesma transação de banco** da
escrita: pega a próxima sequência e o HLC e, então, escreve uma entrada em `sync_rows`
para cada insert e uma entrada em `sync_cells` para cada coluna alterada de cada update.
Updates em massa — o escopo "esta e as futuras ocorrências", um soft delete de perfil —
usam `UPDATE … RETURNING id` para saber quais linhas tocaram.

**Por que não triggers:** pelo mesmo motivo que `updated_at` não é carimbado por um —
isso mantém um único lugar dono das escritas, e um trigger não tem forma limpa de receber
o HLC da transação.

**Consequência:** uma escrita que contorna a porta — uma edição manual em um navegador de
banco de dados — é invisível para a sincronização. Ela fica local e pode ser sobrescrita
por qualquer escrita sincronizada posterior na mesma célula. Aceito e documentado.

### 5.5 Colunas que nunca sincronizam

| Coluna | Regra |
|---|---|
| `accounts.balance`, `accounts.projected_balance`, `bank_statements.opening_balance`, `closing_balance`, `projected_opening_balance`, `projected_closing_balance`, `invoices.balance` | **Não sincronizadas.** Caches derivados ([database-design.md §3.7](database-design.md#37-dinheiro)); uma linha recebida é gravada com `0` e recalculada após a aplicação ([§5.9](#59-após-a-aplicação)). Mesclar dois caches seria mesclar duas respostas em vez dos fatos por trás delas. |
| `recurrences.materialized_count` | **Sincronizada, mesclada como máximo**, e não por last-writer-wins. A marca d'água só avança; ficar com a maior das duas nunca pode reemitir uma ocorrência. (Era `materialized_through`, uma data, até a migration `0004` — database-design §4.12.) |

Todo o resto — `created_at`, `updated_at` e `accounts.opening_balance`, que é dado do
usuário e não cache, incluídos — sincroniza como uma célula comum.
Um insert recebido traz o `created_at` da origem; o receptor nunca deixa o próprio
default preenchê-lo.

### 5.6 Linhas identificadas pelo conteúdo recebem ids determinísticos

UUIDs garantem que dois dispositivos nunca gerem o mesmo id para linhas diferentes
([database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids)). Mas
algumas linhas são identificadas pelo **que são**, não por quem as criou, e um índice
único parcial garante isso. Dois dispositivos trabalhando offline vão criar, cada um, "o
extrato de março da conta X" com UUIDs aleatórios diferentes, e o merge então viola
`uq_bank_statements_account_period`.

**Regra:** essas linhas recebem um **UUID v5** — um hash de um namespace fixo da
aplicação e da chave natural da linha — para que todo dispositivo derive o mesmo id de
forma independente, e o merge veja uma linha editada duas vezes em vez de duas linhas
colidindo.

| Tabela | Chave natural usada no hash |
|---|---|
| `bank_statements` | `account_id`, `year`, `month` |
| `invoices` | `credit_card_id`, `year`, `month` |
| `transactions` emitidas por uma recorrência | `recurrence_id`, número da ocorrência (`occurrence`) |
| `recurrences_tags` | `recurrence_id`, `tag_id` |
| `transactions_tags` | `transaction_id`, `tag_id` |
| Dados padrão semeados no primeiro uso (categorias, subcategorias) | `profile_id`, uma chave de semente estável |

Toda outra linha mantém um UUID v4 aleatório.

Consequências:

- Um UUID v5 continua tendo 36 caracteres — `CHECK (length(id) = 36)` se mantém e nenhuma
  DDL muda.
- **Recriar uma linha com soft delete significa revivê-la.** Recriar o extrato de março
  deriva o id antigo, então a Service limpa `deleted_at` na linha existente em vez de
  inserir.
- O id de uma ocorrência vem do **número** dela na série, e não da data: a data de uma
  série muda ("esta e as futuras" troca o dia âncora — database-design §4.12), e dois
  dispositivos, um trocando o dia e o outro completando a série offline, gerariam a mesma
  ocorrência com datas diferentes. Mover uma ocorrência para outra data não muda sua
  identidade — um id nunca é recalculado. (A chave era a data como gerada até a Fase 9.1
  do desktop-mvp-plan, antes de existir qualquer ocorrência gravada.)
- Dois dispositivos rodando o top-up de recorrências offline agora emitem as **mesmas**
  ocorrências com os mesmos ids; elas são mescladas em vez de colidir.
- **Pendência — série encerrada por mudança de periodicidade ou de tipo.** Essa mudança
  encerra a regra e cria outra, com id aleatório (database-design §4.12). Um dispositivo
  que completou a regra antiga offline traz, ao sincronizar, ocorrências dela além do novo
  término, que ficam vivas em duplicidade com as da regra nova. A correção prevista é a
  mesclagem da regra excluir as ocorrências vivas com número além do término; fica para a
  implementação da sincronização (desktop-mvp-plan Fase 9.2).
- **Esta regra é barata agora e cara depois.** Uma vez que existam linhas com ids
  aleatórios — especialmente após a importação do histórico —, adotá-la significa
  reescrever ids e toda chave estrangeira que aponta para eles. Ela vale desde a primeira
  linha de código, quer a sincronização já tenha sido entregue ou não.

### 5.7 Colisões de nomes no vocabulário do usuário

Categorias, subcategorias e tags são únicas por nome entre as linhas vivas
([database-design.md §3.11](database-design.md#311-índices)), mas seus nomes são
digitados pelo usuário, então nenhum id determinístico é possível — uma renomeação o
mudaria. Dois dispositivos que criam "Mercado" offline produzem dois ids e uma colisão.

**Resolução durante a aplicação:** quando uma linha recebida colidiria com uma linha
local viva na mesma chave natural, sobrevive a linha com o **menor id**. A outra é
gravada já com soft delete, de modo que o índice único nunca é violado, e todo filho que
aponta para ela é redirecionado para a sobrevivente. Como o "menor id" é decidido apenas
pelos ids, todo dispositivo chega à mesma sobrevivente por conta própria, e suas
correções convergem. Renomeações que colidem são resolvidas da mesma forma.

Transações não têm caso residual. Duas ocorrências vivas da mesma recorrência na mesma
data de vencimento são permitidas desde a migration `0004`, que removeu o índice único por
`(recurrence_id, due_date)` (database-design §4.12), e a unicidade que ficou —
`(recurrence_id, occurrence)` — nunca colide entre aparelhos, porque a mesma chave deriva
o mesmo id ([§5.6](#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos)) e as
duas versões são mescladas numa linha só. (Até a `0004`, a colisão pela data era resolvida
**desvinculando** a ocorrência perdedora da sua recorrência; esse caso deixou de existir.)

### 5.8 Filhos vivos sob pais excluídos

O merge por campo não enxerga relações entre linhas. O celular adiciona uma transação a
uma conta que o desktop excluiu nesse meio-tempo: após o merge, uma transação viva fica
no extrato de uma conta com soft delete.

**Regra:** a passada de integridade pós-aplicação encontra linhas vivas cujo pai
**dono** — uma chave estrangeira de propriedade,
[database-design.md §3.8](database-design.md#38-o-perfil-é-a-raiz-do-tenant-e-as-chaves-estrangeiras-seguem-o-relacionamento)
— está com soft delete, **revive o pai** e avisa o usuário. Reviver é uma escrita local
comum com um relógio novo, então se propaga. Dados financeiros nunca são excluídos por um
merge que o usuário não viu; excluir a conta de novo está a uma ação deliberada de
distância.

### 5.9 Após a aplicação

Um lote recebido é aplicado em **uma transação de banco**, com
`PRAGMA defer_foreign_keys = ON`, para que a ordem das linhas dentro do lote não importe.
Cada célula é comparada com seu relógio efetivo local e só é gravada se o relógio
recebido for maior. Depois, ainda dentro da transação:

1. Resolver colisões de nomes ([§5.7](#57-colisões-de-nomes-no-vocabulário-do-usuário))
   e filhos órfãos ([§5.8](#58-filhos-vivos-sob-pais-excluídos)).
2. Recalcular os saldos de todo mês afetado — para uma transação que mudou de lugar,
   tanto o contêiner **antigo** quanto o **novo**.
3. Rodar a rotina de verificação de integridade
   ([database-design.md §3.10](database-design.md#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)).
4. Avançar `sync_vector` para cada origem recebida.

Se algo falhar, a transação sofre rollback, o vetor não se move e a próxima sessão tenta
de novo a partir do mesmo ponto. Aplicar é idempotente: receber de novo uma célula que já
se possui não muda nada.

---

## 6. Membros e pareamento

### 6.1 Cada dispositivo tem seu próprio par de chaves

No primeiro uso, cada dispositivo gera um id de dispositivo (UUID v4) e um par de chaves.
A **chave privada fica no armazenamento seguro da plataforma** — Keychain no iOS,
Keystore no Android, o armazenamento de credenciais do sistema operacional no desktop —
nunca no arquivo SQLite, para que uma cópia ou backup do banco não carregue a capacidade
de se passar pelo dispositivo.

**Por que uma chave por dispositivo e não uma chave compartilhada do grupo:** remover um
celular perdido passa a significar retirar sua chave pública da lista de membros. Com uma
chave compartilhada, todos os dispositivos restantes teriam de receber chaves novas.

### 6.2 O grupo

Quando o usuário ativa a sincronização no primeiro dispositivo, ele cria um **id de
grupo** e se torna o primeiro membro do grupo. `sync_members` guarda, por dispositivo:
id, nome de exibição, plataforma, chave pública, quem o adicionou e `removed_at`. Ela é
replicada exatamente como dados de domínio, então todo membro converge para a mesma lista
de membros.

### 6.3 Pareamento — qualquer membro pode convidar

Em qualquer membro, "adicionar dispositivo" abre um convite válido por **5 minutos** e
para **um** dispositivo:

- **QR code** — carrega o id do grupo, o id do dispositivo que convida, sua chave pública
  e seu endereço local, e um segredo de uso único de 128 bits aleatórios. O novo
  dispositivo lê o código, se conecta, prova que conhece o segredo e envia sua própria
  chave pública.
- **Código digitado** — para quando usar a câmera não é prático. Um código curto (8
  caracteres) não pode ser usado com segurança diretamente como chave, então ele alimenta
  uma **troca de chaves autenticada por senha** (um PAKE como CPace ou SPAKE2): quem
  escuta a comunicação não obtém nada contra o que tentar adivinhar offline, e as
  tentativas online são limitadas a **3** antes de o convite expirar. O dispositivo que
  convida é encontrado por descoberta ([§7.2](#72-descoberta)), já que o código não
  carrega endereço.

De qualquer forma, os dois dispositivos terminam com a chave pública um do outro, e o
dispositivo que convidou grava o novo membro em `sync_members`.

### 6.4 Entrando no grupo: um novo dispositivo começa vazio

Um dispositivo só pode entrar em um grupo se não tiver **nenhum dado**. Se tiver, o
usuário precisa descartá-los explicitamente antes — dois históricos independentes não
podem ser mesclados ([§4](#4-topologia-todo-dispositivo-é-um-par-igual)).

O dispositivo que convidou envia então um **snapshot completo**: uma cópia consistente do
banco produzida com `VACUUM INTO`, contendo as tabelas de domínio e as tabelas de
sincronização sincronizadas, seguida da árvore de anexos. O receptor substitui seu banco
vazio por ela, **reinicia as tabelas somente locais** (`sync_state`, `sync_vector`) com
sua própria identidade e com o vetor que o snapshot representa e, daí em diante,
sincroniza de forma incremental. Inicializar por snapshot, em vez de reproduzir cada
entrada, é mais rápido e usa o mesmo caminho de código de uma restauração.

### 6.5 Removendo um dispositivo

Qualquer membro pode remover qualquer outro, inclusive a si mesmo ("sair do grupo"). A
remoção carimba `removed_at` na linha do membro e se propaga como qualquer escrita. Os
membros recusam sessões com um dispositivo removido. **A remoção é permanente para
aquele id de dispositivo**: voltar significa parear de novo como um novo membro, com o
banco vazio.

Limites, ditos com clareza:

- Um dispositivo removido **mantém sua cópia local**. A remoção interrompe
  sincronizações futuras; ela não consegue apagar dados que já estão no dispositivo.
- A remoção chega a cada membro na sua próxima sessão. Até lá, um membro que ainda não
  soube dela aceitaria o dispositivo removido — o que exige que esse dispositivo esteja
  na mesma rede local ([§7.1](#71-somente-a-mesma-rede-local)).

---

## 7. Transporte: somente a mesma rede local

### 7.1 Somente a mesma rede local

Dois dispositivos só sincronizam quando estão na **mesma rede local**, com os dois apps
abertos.

**Por quê:** nenhum servidor é necessário, nenhum terceiro jamais transporta os dados, e
um dispositivo precisa estar fisicamente presente na rede do usuário para sincronizar — o
acesso remoto não está apenas não implementado, ele é recusado.

Como a regra é garantida:

- Um dispositivo **só escuta enquanto o app está em primeiro plano** — no iOS a
  plataforma exige isso de qualquer forma.
- Ele **só aceita e só disca para endereços locais**: faixas privadas IPv4 (`10/8`,
  `172.16/12`, `192.168/16`), link-local (`169.254/16`), e os endereços IPv6 link-local
  (`fe80::/10`) e unique-local (`fc00::/7`). Endereços públicos e a faixa de
  carrier-grade NAT (`100.64/10`, que VPNs overlay como o Tailscale também usam) são
  rejeitados.

**O que isto é e o que não é:** uma forte redução da exposição, não uma prova de
co-localização física — um usuário que deliberadamente interliga redes com uma VPN
consegue fazer um dispositivo remoto parecer local. A segurança se apoia nas chaves dos
dispositivos e no canal criptografado ([§7.4](#74-uma-sessão)); a localidade é a segunda
camada, por cima.

### 7.2 Descoberta

Cada dispositivo se anuncia via **mDNS / DNS-SD** — o mecanismo de descoberta local por
trás de impressoras e do AirPlay — como um serviço que carrega seu id de dispositivo e um
**hash** do id do grupo, para que vizinhos na rede possam ver que um dispositivo existe,
mas não a qual grupo ele pertence.

**Alternativa:** algumas redes bloqueiam multicast (redes de convidados, redes com
isolamento de clientes, alguns roteadores). O usuário pode então digitar à mão o endereço
local do par — sujeito à mesma regra de faixas locais — e cada dispositivo **lembra o
último endereço que funcionou** para cada membro. O convite por QR já carrega o endereço
de quem convida.

### 7.3 Quem se conecta a quem

Enquanto está em primeiro plano, todo dispositivo tanto escuta quanto se anuncia. Para
evitar duas conexões por par, **o dispositivo com o menor id disca** e o outro aceita.
Quaisquer dois membros podem sincronizar; não há hub.

### 7.4 Uma sessão

1. **Handshake** sobre TCP: autenticação mútua com as chaves dos dispositivos obtidas no
   pareamento, que também estabelece um canal criptografado — um handshake do protocolo
   **Noise KK**, implementado no núcleo em TypeScript puro sobre as bibliotecas
   `@noble` ([mobile-shell-design.md §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo)).
   Os dados nunca trafegam sem criptografia, nem mesmo na rede doméstica. Um par que não
   seja um membro ativo é recusado.
2. **Verificação de relógio** ([§5.2](#52-o-relógio-é-um-relógio-lógico-híbrido)) —
   recusar em caso de divergência excessiva — **e de versão do schema**: recusar quando
   os `user_version` diferem, dizendo qual aparelho atualizar
   ([backend-design.md §4.9](backend-design.md#49-migrations-e-sincronização)).
3. **Membros primeiro:** trocar e aplicar as entradas de `sync_members`, para que uma
   remoção aprendida de um par tenha efeito antes de qualquer troca de dados.
4. **Trocar vetores:** cada lado informa a maior sequência de origem que possui por
   origem.
5. **Enviar o que falta,** em ordem de sequência de origem, agrupado por transação de
   origem.
6. **Aplicar** ([§5.9](#59-após-a-aplicação)) e confirmar o recebimento.
7. **Anexos** ([§7.6](#76-anexos)).
8. **Modo ao vivo:** enquanto os dois apps permanecem em primeiro plano, cada escrita
   local confirmada é enviada imediatamente; a sessão termina quando qualquer um dos
   apps sai do primeiro plano.

### 7.5 Restrições de plataforma

| Plataforma | Restrição |
|---|---|
| iOS | Escuta somente em primeiro plano; um pedido de permissão de Rede Local no primeiro uso, e o tipo de serviço declarado no manifesto do app. |
| Android | Descoberta pelo network service discovery da plataforma; um multicast lock durante a descoberta. |
| Desktop | O firewall do sistema operacional pode pedir permissão na primeira vez que o app escutar. |

**Entrada para a decisão de stack:** a tecnologia mobile precisa conseguir rodar um
listener e um cliente TCP, fazer descoberta via mDNS, ler QR codes com a câmera, usar o
armazenamento seguro de chaves e rodar a criptografia. React Native / Expo, Flutter e
nativo conseguem; o Capacitor é fraco para hospedar um listener, o que conta contra ele.
**Decidido:** React Native / Expo, o único dos três que reaproveita o núcleo TypeScript
([backend-design.md §3.8](backend-design.md#38-consequência-o-mobile-é-react-native--expo));
os adaptadores, as permissões e o ciclo de vida do celular estão em
[mobile-shell-design.md §5](mobile-shell-design.md#5-a-sincronização-no-celular).

### 7.6 Anexos

Os arquivos de anexo ficam fora do banco
([database-design.md §4.15](database-design.md#415-attachments)), então trafegam como
uma etapa separada no mesmo canal. Depois que os dados são aplicados, o receptor lista as
linhas de anexo vivas cujo arquivo está ausente no caminho derivado e os solicita; cada
transferência carrega o tamanho e o SHA-256 do arquivo, para que um arquivo truncado seja
rejeitado em vez de armazenado. Os arquivos são gravados uma única vez — um recibo
substituído é um novo anexo — então nunca há conflito de arquivo a resolver.

---

## 8. Alternativas rejeitadas

Reunidas em um só lugar:

| Opção | Por que não |
|---|---|
| Sincronizar o arquivo `.sqlite` via Dropbox / Syncthing | Dois escritores no mesmo arquivo produzem cópias em conflito ou, em modo WAL, corrupção. Aceitável apenas como backup unidirecional feito com `VACUUM INTO`. |
| "Caixa postal" em pasta na nuvem | Leva os dados para fora da rede local e por meio de um terceiro; contradiz a [§7.1](#71-somente-a-mesma-rede-local). |
| Peer-to-peer pela internet (WebRTC, hole punching) | Precisa de servidores de rendezvous e de relay; contradiz a [§7.1](#71-somente-a-mesma-rede-local). |
| VPN overlay (Tailscale, ZeroTier) | Faz dispositivos remotos parecerem locais; recusada pela regra de endereços da [§7.1](#71-somente-a-mesma-rede-local). |
| Last-writer-wins em nível de linha sobre `updated_at` | Precisão de segundos, confia no relógio de parede, perde edições concorrentes em colunas diferentes. |
| Bibliotecas CRDT completas | Feitas para texto colaborativo; toda coluna aqui é um escalar. |
| Reproduzir operações de negócio | Toda sincronização reexecuta a lógica de negócio; invasivo em todo o código-base. |
| Um dono cujos dados vencem, ou um cliente fino | [§4](#4-topologia-todo-dispositivo-é-um-par-igual). |
| Uma chave compartilhada do grupo | Remover um dispositivo exigiria trocar as chaves de todos os outros. |

---

## 9. Impacto no design do banco de dados

- **Ids:** a [database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids)
  agora traz a regra de UUID v5 da
  [§5.6](#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos).
  Nenhuma DDL muda.
- **As tabelas de domínio não são tocadas.** As tabelas de sincronização da
  [§5.3](#53-o-que-é-registrado-relógios-de-linha-e-de-célula-não-um-log) chegam em sua
  própria migration quando a sincronização for implementada, e no diagrama draw.io ao
  mesmo tempo.
- **`updated_at` não é o relógio da sincronização** — o HLC é. `updated_at` continua
  sendo o rastro humano de "última revisão".
- **Linhas com soft delete não podem ser purgadas livremente.** Um hard delete não deixa
  nada para replicar, e um par que nunca viu a lápide (tombstone) manteria a linha viva.
  Qualquer purga futura só pode remover linhas cuja exclusão todos os membros atuais já
  confirmaram.
- **Edições manuais contornam a sincronização**
  ([§5.4](#54-a-captura-acontece-na-fronteira-do-repository)).

---

## 10. Até a sincronização ser entregue

- A **regra de ids determinísticos vale agora** — todo id gerado antes de a
  sincronização existir já precisa segui-la.
- **Use um único dispositivo, ou inicialize o segundo a partir do primeiro.** Na primeira
  vez que a sincronização é ativada em um dispositivo que já tem dados, toda linha
  existente recebe uma entrada em `sync_rows` (origem = este dispositivo, relógio =
  agora). Um segundo dispositivo então entra vazio e recebe um snapshot
  ([§6.4](#64-entrando-no-grupo-um-novo-dispositivo-começa-vazio)).

---

## 11. Próximos passos

1. ~~Escolher a biblioteca do canal e a implementação de PAKE.~~ Decidido: Noise KK
   sobre `@noble`, com CPace no código digitado
   ([mobile-shell-design.md §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo)).
2. ~~**Fixar o namespace do UUID v5**~~ — feito: `APP_UUID_NAMESPACE`, em
   `packages/core/src/domain/shared/DeterministicIds.ts`, gerado uma vez e nunca alterado.
3. **Escrever a migration de sincronização** (`sync_rows`, `sync_cells`, `sync_members`,
   `sync_vector`, `sync_state`) quando a sincronização for implementada, e adicionar as
   tabelas ao diagrama.
4. **Testes de convergência antes de existir qualquer transporte:** operações aleatórias
   em várias réplicas em memória, trocadas em ordens e partições aleatórias, precisam
   terminar idênticas byte a byte em todas as tabelas de domínio; além de testes
   direcionados para divergência de relógio, colisões de nomes, filhos órfãos, a mesma
   ocorrência de recorrência gerada em dois aparelhos (inclusive com o dia da série
   trocado em um deles), a série recomeçada com a regra antiga completada offline
   ([§5.6](#56-linhas-identificadas-pelo-conteúdo-recebem-ids-determinísticos)) e uma linha
   com soft delete que precisa continuar excluída.
