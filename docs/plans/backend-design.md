# Design do Backend Compartilhado

**Status:** Design concluído — não implementado. Fecha as três questões que bloqueavam o
início da implementação: linguagem e runtime da lógica de negócio, estratégia de
migrations do banco embarcado e estratégia de testes da camada Service.
**Fonte da verdade visual:** [docs/drawio/backend-layers.drawio](../drawio/backend-layers.drawio)
— camadas, portas, adaptadores por plataforma e armazenamento. Quando o diagrama e este
documento divergirem, ambos são atualizados.
**Relacionado:** [database-design.md](database-design.md) — o schema que este backend
lê e escreve; [sync-design.md](sync-design.md) — a replicação que roda sobre ele.

Este documento é o lugar de toda decisão sobre o código de aplicação compartilhado
entre as plataformas. A [§2](#2-decisões-em-resumo) é o resumo; as seções seguintes
guardam o raciocínio. Onde ele toca os outros dois documentos, os três são atualizados
juntos ([§6](#6-impacto-nos-outros-documentos)).

---

## 1. Escopo e restrições

Herdadas do [README](../../README.md) e dos dois documentos anteriores:

- Um **único backend** (Request → Controller → Service → Repository → Model) precisa
  servir o desktop, o mobile (Android e iOS) e, eventualmente, um serviço web — sem
  reescrever a lógica de negócio por plataforma.
- O banco é **SQLite embarcado**, um arquivo por dispositivo, acessado por uma **porta
  estreita** com um adaptador por plataforma
  ([database-design.md §3.3](database-design.md#33-a-camada-repository-abstrai-o-driver-não-apenas-o-banco)).
- **Dinheiro é `REAL`** (double IEEE-754), por decisão deliberada; validação e
  arredondamento são da aplicação
  ([database-design.md §3.7](database-design.md#37-dinheiro)). Este documento não
  reabre essa decisão — ele define *como* a aplicação a cumpre.
- Não existe administrador nem DBA: o schema evolui sozinho no aparelho do usuário,
  e dispositivos sincronizados podem estar em versões diferentes do app.

Fora do escopo: a camada de UI ([desktop-shell-design.md](desktop-shell-design.md)), o
shell mobile em detalhe (só a consequência da
[§3.8](#38-consequência-o-mobile-é-react-native--expo); o resto em
[mobile-shell-design.md](mobile-shell-design.md)) e a biblioteca de criptografia da
sincronização ([mobile-shell-design.md §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo)).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Seção |
|---|---|---|
| Node.js/TypeScript serve para a camada Service? | Sim — **TypeScript**, mas como um núcleo que **não depende do Node**: roda no Electron, no React Native e num servidor | [§3](#3-linguagem-e-runtime) |
| E a natureza "intensiva em cálculo"? | O volume é pequeno e a agregação pesada fica no SQL; o risco real é **exatidão**, tratado por um Value Object `Money` e por saldos sempre recalculados, nunca incrementados | [§3.2](#32-o-cálculo-não-é-pesado-o-risco-é-exatidão), [§3.3](#33-aritmética-monetária-no-núcleo) |
| Como o núcleo fala com a plataforma? | Por portas: `Database` (síncrona), `Clock`, `IdGenerator`, `FileStore` | [§3.4](#34-o-núcleo-só-enxerga-portas) |
| Qual driver SQLite? | `better-sqlite3` no desktop e nos testes; `expo-sqlite` (API síncrona) no mobile | [§3.7](#37-drivers) |
| Como o schema é versionado? | `PRAGMA user_version`; migrations **somente para a frente**, imutáveis, embutidas no bundle, executadas por um runner próprio na abertura do app, com backup antes | [§4](#4-migrations-no-banco-embarcado) |
| E dispositivos em versões diferentes? | Banco mais novo que o app não abre; sessões de sincronização entre versões de schema diferentes são recusadas | [§4.8](#48-banco-mais-novo-que-o-app), [§4.9](#49-migrations-e-sincronização) |
| Como testar saldos e extratos? | Vitest + SQLite real em memória (sem mocks de Repository), **testes de mesa** escritos à mão, **testes de propriedade** com a rotina de recálculo como oráculo, e mutation testing no núcleo de saldos | [§5](#5-testes-da-camada-service) |

---

## 3. Linguagem e runtime

### 3.1 O núcleo é TypeScript, não "Node"

O Electron implica Node.js no desktop, mas **a lógica de negócio não pode depender do
Node**. No mobile, o código JavaScript roda no Hermes (o motor do React Native), que não
tem `fs`, `crypto` do Node, `Buffer` nem módulos nativos do Node. Um núcleo que importe
qualquer um deles quebra o objetivo de um único backend exatamente onde ele deveria se
pagar.

**Decisão:** o backend é um pacote `core` em **TypeScript puro**, que só usa a
linguagem e a biblioteca padrão do ECMAScript. Tudo que é da plataforma — banco,
relógio, geração de ids, sistema de arquivos — entra por portas
([§3.4](#34-o-núcleo-só-enxerga-portas)). A regra é verificada por lint
(`no-restricted-imports` para `node:*`, `fs`, `path`, `electron`, `react-native` dentro
de `core`), não por disciplina.

**Por que TypeScript e não outra linguagem:**

- É a **única linguagem que roda nativamente nos três destinos** — processo do Electron,
  React Native e um servidor Node — sem ponte, sem segunda toolchain e sem FFI.
- **O número do JavaScript é o `REAL` do SQLite.** Os dois são o mesmo double IEEE-754,
  então um valor lido do banco, somado no núcleo e gravado de volta não passa por
  nenhuma conversão de representação. Um núcleo em outra linguagem com outro tipo
  numérico adicionaria uma fronteira de conversão a cada leitura.
- A sincronização já foi projetada como código do núcleo TypeScript
  ([sync-design.md §3](sync-design.md#3-motor-sqlite-puro-sincronização-no-núcleo-compartilhado)).

### 3.2 O cálculo não é pesado; o risco é exatidão

A preocupação com "lógica intensiva em cálculo" não se sustenta em números. A escala do
projeto é de **dezenas de milhares de transações** em anos de uso
([database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids)). Recalcular
os saldos de todos os meses de uma conta é somar algumas centenas de linhas por mês — na
casa de milissegundos em qualquer runtime moderno, JavaScript incluído.

Além disso, **a agregação pesada fica no SQL**, que roda no código C do SQLite e não no
JavaScript: `SUM` por contêiner mensal, window functions para saldo acumulado, CTEs para
comparações mês a mês ([database-design.md §3.1](database-design.md#31-motor-de-armazenamento--sqlite)).
O núcleo orquestra e aplica regras; ele não itera sobre o histórico inteiro.

Onde os bugs realmente moram é na **exatidão**: em qual fatura cai uma compra, como uma
parcela é arredondada, se uma transação com soft delete entrou num total, se o saldo de
fechamento de abril acompanhou a edição de março. Nenhuma linguagem mais rápida resolve
isso; contratos explícitos ([§3.3](#33-aritmética-monetária-no-núcleo)) e testes
([§5](#5-testes-da-camada-service)) resolvem.

**Se um dia houver de fato um gargalo** — relatórios analíticos de muitos anos no
desktop —, a saída já registrada é consultar o mesmo arquivo com DuckDB
([database-design.md §3.1](database-design.md#31-motor-de-armazenamento--sqlite)), não
trocar a linguagem do núcleo.

### 3.3 Aritmética monetária no núcleo

O banco guarda `REAL` e não protege contra desvio de arredondamento; a aplicação
protege. Isso é feito em **um único lugar**:

- **`Money` é um Value Object imutável** — valor (`number`) mais a moeda do perfil, que
  carrega a precisão decimal (2 para BRL e USD, 0 para JPY, 3 para KWD). Nenhum `number`
  solto representa dinheiro fora do Repository; somar `Money` de moedas diferentes é erro
  de tipo, não de execução.
- **Arredondar acontece só nas fronteiras** — ao persistir e ao apresentar —, nunca em
  valores intermediários acumulados ([database-design.md §3.7](database-design.md#37-dinheiro)).
  O modo é **meio para longe do zero** (`2,345 → 2,35`; `-2,345 → -2,35`), o que o usuário
  espera de um extrato bancário. A implementação não usa `Math.round(x * 100) / 100`, que
  erra casos como `1,005` (o double guarda `1,00499999…`) e arredonda negativos para o
  lado errado; ela arredonda sobre a representação decimal mais curta do número
  (`Number.prototype.toPrecision` com 15 dígitos significativos), que é o valor que o
  usuário digitou.
- **Igualdade é sempre com epsilon**, metade da menor unidade da moeda
  (`0,005` em BRL). `Money.equals` é o único comparador; `===` em dinheiro é proibido
  por lint.
- **Divisão distribui o resto.** Dividir R$ 1.000,00 em 3 parcelas gera
  `333,34 + 333,33 + 333,33`: cada parcela é arredondada e a diferença para o total vai
  para a **primeira** parcela, para que a soma das parcelas seja sempre exatamente o
  total na precisão da moeda. Regra de negócio (Recorrências, `value_type = total`):
  "1200 em 12x" precisa somar 1200 na fatura, não 1199,99. Depois de geradas, as parcelas
  são editáveis uma a uma e o app não reequilibra as demais
  ([database-design.md §4.12](database-design.md#412-recurrences)).
- **Saldos em cache nunca são incrementados.** Os saldos de `bank_statements`,
  `invoices` e `accounts` — consolidado e previsto, inicial e final
  ([database-design.md §3.7](database-design.md#37-dinheiro)) — são sempre **recalculados a partir das
  transações** do mês afetado (um `SUM` no SQL), nunca atualizados com `saldo += valor`.
  Incrementar acumula erro de float a cada escrita e transforma qualquer bug pontual em
  desvio permanente; recalcular torna o cache uma função pura dos fatos. O custo é uma
  consulta agregada por mês afetado — desprezível na escala do projeto.
- **O saldo de fechamento se propaga para a frente.** Como o fechamento de um mês
  depende do fechamento do anterior, editar uma transação de março recalcula março e
  **todos os meses seguintes** daquela conta. É a mesma rotina usada pela sincronização
  ([sync-design.md §5.9](sync-design.md#59-após-a-aplicação)) e pela verificação de
  integridade ([database-design.md §3.10](database-design.md#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante)):
  existe **uma** rotina de recálculo, chamada de três lugares.

Somar doubles acumula erro, mas o recálculo nunca soma o histórico inteiro de uma vez:
ele soma **um mês** e encadeia os fechamentos. O limite pior caso de uma soma de `n`
parcelas é cerca de `n × 10⁻¹⁶ × total`. Um mês com 500 lançamentos totalizando
R$ 500 mil erra no máximo `500 × 10⁻¹⁶ × 5·10⁵ ≈ 3·10⁻⁸`; trinta anos de fechamentos
encadeados (360 meses) com saldo de R$ 10 milhões, no máximo `360 × 10⁻¹⁶ × 10⁷ ≈ 4·10⁻⁷`
— ambos mais de dez mil vezes menores que meio centavo, e cada fechamento ainda é
arredondado ao ser persistido, o que zera o erro acumulado a cada mês. Por isso não há
soma compensada (Kahan) nem biblioteca decimal: elas protegeriam contra um erro que não
chega a aparecer, ao custo de um segundo tipo numérico convertendo de e para o `REAL` do
banco em toda fronteira.

### 3.4 O núcleo só enxerga portas

| Porta | O que oferece | Por que é porta e não chamada direta |
|---|---|---|
| `Database` | `run`, `get`, `all`, `transaction(fn)`, `pragma` | O driver muda por plataforma ([database-design.md §3.3](database-design.md#33-a-camada-repository-abstrai-o-driver-não-apenas-o-banco)) |
| `Clock` | `now()` (instante UTC) e `today()` (data local do usuário) | Datas são a maior fonte de bug em finanças; os testes precisam congelar e mover o tempo ([§5.7](#57-tempo-e-fuso-horário)). `new Date()` dentro do `core` é proibido por lint |
| `IdGenerator` | `random()` (UUID v4) e `derived(chave)` (UUID v5, [database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids)) | O React Native não tem `crypto.randomUUID()`; cada plataforma fornece uma fonte de aleatoriedade segura. O v5 é implementado no núcleo, em TypeScript puro, porque precisa dar o mesmo resultado em todo dispositivo |
| `FileStore` | ler, gravar e verificar arquivos de anexo por caminho relativo | Os anexos vivem em disco ([database-design.md §4.15](database-design.md#415-attachments)) e o sistema de arquivos é diferente em cada plataforma |

Os adaptadores são finos e não têm regra de negócio. Cada um passa pela mesma suíte de
contrato ([§5.10](#510-contrato-dos-adaptadores)).

A sincronização acrescenta mais quatro portas — `Transport`, `Discovery`, `KeyStore` e
`RandomSource` —, porque o protocolo e a criptografia do canal também ficam no núcleo
([mobile-shell-design.md §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo)).
Elas entram no diagrama junto com a implementação da sincronização.

### 3.5 A porta de banco é síncrona

`Database` expõe chamadas **síncronas**, e `transaction(fn)` recebe uma função síncrona.

**Por quê:** a unidade de trabalho é sagrada neste design — as duas pernas de uma
transferência, a série inteira de uma recorrência, o recálculo de saldos e a captura da
sincronização ([sync-design.md §5.4](sync-design.md#54-a-captura-acontece-na-fronteira-do-repository))
precisam acontecer na **mesma** transação de banco. Com uma API assíncrona sobre uma
única conexão, outro trecho de código pode intercalar um `await` no meio da transação de
alguém e escrever dentro dela; evitar isso exige uma fila ou um mutex em volta de toda
escrita. Com uma API síncrona, nada intercala por construção. Os dois drivers escolhidos
oferecem API síncrona com transação ([§3.7](#37-drivers)).

**O custo** é que uma consulta bloqueia a thread onde o núcleo roda. É por isso que o
núcleo **não roda na thread de UI** no desktop ([§3.6](#36-onde-o-núcleo-roda)); no mobile,
as consultas desta escala levam milissegundos e a renderização do React Native acontece
em outra thread.

Os Controllers continuam devolvendo `Promise`: a assincronia existe na fronteira de
transporte (IPC, ponte do React Native, HTTP), não dentro da regra de negócio.

### 3.6 Onde o núcleo roda

| Destino | Processo | Controller exposto como |
|---|---|---|
| Desktop (Electron) | Um `utilityProcess` dedicado, dono da única conexão com o banco | Handlers de IPC; a janela (renderer) nunca acessa o banco |
| Mobile (React Native) | A thread JavaScript do app | Chamadas diretas, encapsuladas no mesmo formato de Controller |
| Serviço web (futuro) | Um processo Node | Rotas HTTP |

**Por que um `utilityProcess` e não o processo principal do Electron:** o processo
principal coordena janelas e menus; uma consulta síncrona lenta ali congela a aplicação
inteira. Um processo separado isola o banco e mantém uma única conexão escritora — que é
o modelo de concorrência que o SQLite prefere.

A camada **Request** valida a entrada na fronteira do transporte, com schemas
declarativos que produzem os DTOs tipados que os Controllers repassam aos Services. O
renderer do Electron é tratado como entrada não confiável, como um cliente HTTP seria.

### 3.7 Drivers

| Plataforma | Driver | Por quê |
|---|---|---|
| Desktop e testes | **`better-sqlite3`** | API síncrona madura com `transaction()`, embarca a própria versão do SQLite (fixar ≥ 3.37 para `STRICT`, [database-design.md §3.9](database-design.md#39-tipos-e-domínios-de-colunas)) e é o mesmo driver em produção e na suíte de testes. Exige recompilar o módulo nativo para o Electron — custo de build, resolvido uma vez |
| Mobile | **`expo-sqlite`** | Mantido pelo Expo, com API síncrona (`runSync`, `getAllSync`, `withTransactionSync`) que encaixa na porta sem adaptação de modelo |

**`node:sqlite` foi considerado e adiado.** Ele dispensa módulo nativo, mas ainda está
saindo do estado experimental e teve em 2026 um bug de truncamento silencioso de `TEXT`
com caractere NUL — exatamente o tipo de falha silenciosa que um arquivo financeiro não
pode ter. Com a porta, trocar o adaptador do desktop depois é uma mudança local.

### 3.8 Consequência: o mobile é React Native / Expo

Escolher um núcleo TypeScript compartilhado **decide a tecnologia mobile**: só um shell
JavaScript reaproveita o núcleo sem reescrita. Flutter ou nativo exigiriam reimplementar
toda a camada Service em Dart, Kotlin ou Swift — o problema que o README existe para
evitar. Entre os shells JavaScript, o Capacitor já foi desfavorecido por não hospedar
bem um listener TCP ([sync-design.md §7.5](sync-design.md#75-restrições-de-plataforma));
o **React Native com Expo** atende os requisitos de sincronização e é o caminho que
preserva o núcleo. O inventário do que é compartilhado e o acesso ao banco no celular
estão em [mobile-shell-design.md](mobile-shell-design.md).

O Electron continua sendo o shell desktop — confirmado frente ao Tauri em
[desktop-shell-design.md §3](desktop-shell-design.md#3-electron-ou-tauri). O que é
compartilhado é a **lógica**, não a UI — exatamente a ressalva que o README já fazia.

### 3.9 Estrutura e ferramentas

Um monorepo com workspaces do **pnpm**:

```
packages/core            domínio, Services, Repositories, portas, runner de migrations
packages/sqlite-better   adaptador Database para better-sqlite3 (desktop e testes)
packages/sqlite-expo     adaptador Database para expo-sqlite (mobile)
packages/client          contrato tipado, hooks e view-models compartilhados pelas UIs
apps/desktop             Electron: utilityProcess do núcleo, IPC, UI em React DOM
apps/mobile              React Native / Expo: núcleo na thread JS, UI em React Native
apps/mobile-contract     app de teste: contrato do expo-sqlite e vetores de ouro no Hermes
db/migrations            os arquivos .sql — fonte da verdade do schema
```

- **TypeScript no modo mais estrito:** `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`. Ids são tipos marcados
  (`AccountId`, `TransactionId`), para que passar o id de uma conta onde se espera o de
  uma fatura seja erro de compilação.
- **ESLint com `typescript-eslint`** carregando as regras de fronteira das
  [§3.1](#31-o-núcleo-é-typescript-não-node), [§3.3](#33-aritmética-monetária-no-núcleo)
  e [§3.4](#34-o-núcleo-só-enxerga-portas).
- **Node LTS fixado** na mesma linha que o Electron escolhido embarca (hoje, Node 24),
  para que os testes rodem no mesmo runtime que o desktop.

### 3.10 Alternativas rejeitadas

| Opção | Por que não |
|---|---|
| Núcleo em Rust compilado para WASM e nativo | Velocidade que o projeto não precisa ([§3.2](#32-o-cálculo-não-é-pesado-o-risco-é-exatidão)), ao custo de duas toolchains, de uma fronteira de serialização em cada chamada e de bindings por plataforma. |
| Kotlin Multiplatform | Compartilha Android e iOS, mas não roda no Electron; o desktop precisaria de outro shell ou de uma segunda implementação. |
| Flutter / Dart | Mesmo problema no sentido inverso: o desktop em Electron não reaproveita Dart. Trocar o Electron por Flutter desktop é possível, mas descarta o único runtime que também serve um futuro serviço web sem reescrita. |
| Biblioteca decimal (`decimal.js`, `big.js`) no núcleo | Protege contra um erro abaixo do epsilon ([§3.3](#33-aritmética-monetária-no-núcleo)) e adiciona um segundo tipo numérico a converter de e para o `REAL` do banco em toda leitura e escrita. |
| ORM (Prisma, TypeORM, Drizzle) | Prisma e TypeORM não rodam no React Native com um driver síncrono; todos querem ser donos do schema, que aqui é escrito à mão e documentado ([database-design.md](database-design.md)). O SQL escrito no Repository é o contrato. |
| Porta de banco assíncrona | Exige serializar transações à mão para manter a unidade de trabalho atômica ([§3.5](#35-a-porta-de-banco-é-síncrona)). |

---

## 4. Migrations no banco embarcado

### 4.1 O problema

Não existe um momento de "rodar as migrations em produção": cada aparelho do usuário é
uma produção, atualizada quando a loja de apps ou o instalador decide, possivelmente
pulando versões, sem ninguém olhando. Um aparelho pode ficar meses parado e abrir um app
três versões à frente; dois aparelhos sincronizados podem estar em versões diferentes.
Uma migration que falha no meio deixa o usuário sem acesso ao próprio histórico
financeiro. As regras abaixo partem disso.

### 4.2 A versão do schema é `PRAGMA user_version`

O número da última migration aplicada fica no `PRAGMA user_version` do arquivo — um
inteiro no cabeçalho do banco, que toda ferramenta SQLite consegue ler.

**Por quê:** a escrita do `user_version` é transacional — ela entra no journal como
qualquer página —, então aplicar a migration e avançar a versão é atômico. Uma tabela
`schema_migrations` daria o mesmo resultado com mais uma tabela para excluir da
sincronização, do snapshot e da verificação de integridade. A rastreabilidade que essa
tabela daria (quando cada migration rodou) não tem leitor neste projeto.

### 4.3 Migrations são somente para a frente e imutáveis

- **Não existe `down`.** Não há quem a execute num aparelho de usuário, e uma migration
  de volta que apaga uma coluna apaga dados. A volta é o backup
  ([§4.6](#46-backup-antes-de-migrar)).
- **Uma migration publicada nunca é editada.** Um erro é corrigido por uma migration
  nova. Aparelhos que já rodaram a versão antiga não rodariam a corrigida, e os bancos
  divergiriam em silêncio. Um teste compara o hash de cada arquivo com um arquivo de
  trava commitado (`db/migrations/checksums.lock`); editar uma migration existente
  quebra o build.
- **Numeração sequencial de quatro dígitos** (`0002_…`), já usada em `0001`. Sem
  timestamps: há um único desenvolvedor e uma única linha de versões, e a sequência é
  o próprio `user_version`.

### 4.4 Formato e empacotamento

- **SQL puro é o padrão.** Os arquivos em `db/migrations/*.sql` continuam sendo a fonte
  da verdade do schema, legíveis sem o app. Um passo de build os embute no bundle do
  `core` como strings — o mobile não tem um diretório de arquivos para varrer em tempo de
  execução, e o desktop empacotado também não deveria depender de um.
- **Migrations em TypeScript existem só quando o SQL não alcança** — por exemplo, um
  backfill que precisa derivar um UUID v5 ([§3.4](#34-o-núcleo-só-enxerga-portas)), que
  o SQLite não calcula. Elas recebem apenas a porta `Database`, nunca um Service: a
  regra de negócio de hoje não pode reescrever dados de uma versão antiga do schema que
  ela não conhece. Mesma numeração, mesma sequência.

### 4.5 A sequência de abertura

Toda abertura do banco passa por um único caminho, nesta ordem:

1. Abrir a conexão e aplicar a configuração obrigatória
   ([database-design.md §3.2](database-design.md#32-a-configuração-da-conexão-faz-parte-do-contrato-do-schema)).
2. Ler `user_version`. Se for **maior** que a última migration conhecida, parar
   ([§4.8](#48-banco-mais-novo-que-o-app)). Se for igual, ir para o passo 5.
3. Fazer o backup ([§4.6](#46-backup-antes-de-migrar)).
4. Aplicar cada migration pendente **na sua própria transação**: executar, rodar
   `PRAGMA foreign_key_check`, gravar o novo `user_version`, confirmar. Qualquer falha
   faz rollback daquela migration, mantém as anteriores e abre o app em modo de erro com
   a opção de restaurar o backup — nunca com o banco pela metade.
5. Rodar a verificação de integridade
   ([database-design.md §3.10](database-design.md#310-o-que-o-banco-garante-e-o-que-a-aplicação-garante))
   e só então o complemento de recorrências
   ([database-design.md §4.12](database-design.md#412-recurrences)), que não pode rodar
   antes de o banco estar pronto.

No desktop, qualquer falha da sequência bloqueia a abertura — inclusive a falha ao montar
o núcleo ou ao rodar a verificação de integridade (os desvios encontrados por ela só vão
para o log). A restauração do backup copia a cópia para um arquivo provisório antes de
tirar o banco do lugar, desfaz as etapas se uma falhar e grava uma marca
(`restore-pending.json`) enquanto não termina: com a marca presente, a abertura bloqueia
em vez de criar um banco vazio no lugar do que saiu. A primeira migration que falha também
grava uma marca (`migration-failed.json`) com o backup daquela tentativa: as aberturas
seguintes oferecem esse backup, e não o novo — gravado depois das migrations que passaram, que
a versão anterior do app recusaria —, e a rotação não o apaga até a migration passar.

Uma transação por migration, e não uma para todas: um aparelho que pula da versão 3
para a 9 e falha na 7 fica na 6, utilizável pela versão anterior do app, em vez de
voltar à 3.

### 4.6 Backup antes de migrar

Antes de aplicar qualquer migration, o app grava uma cópia consistente com
`VACUUM INTO` em `backups/pre-v{versão}-{data}-{hora}.sqlite`, ao lado do banco. Guardam-se as
**três** mais recentes. A hora (UTC, `HHMMSS`) entra no nome porque o `VACUUM INTO` não
sobrescreve arquivo existente: duas tentativas de migrar no mesmo dia colidiriam. Banco
novo (versão 0) não é copiado — não há dado a preservar. A pasta entra no núcleo pela
porta `BackupDirectory`, e uma falha na cópia impede a migration (`MigrationBackupError`). É a mesma operação usada no snapshot de pareamento
([sync-design.md §6.4](sync-design.md#64-entrando-no-grupo-um-novo-dispositivo-começa-vazio)).

Sem DBA, o backup automático é o único `down` que existe. O custo é espaço em disco
proporcional ao banco — alguns megabytes nesta escala. Os anexos não entram: migrations
não mexem em arquivos.

### 4.7 Mudanças que o `ALTER TABLE` não faz

O SQLite não altera `CHECK`, chave estrangeira nem `STRICT` de uma tabela existente
([database-design.md §3.9](database-design.md#39-tipos-e-domínios-de-colunas)) — o
caso previsível é aumentar um enum. Essas mudanças seguem o procedimento de reconstrução
documentado pelo SQLite: criar a tabela nova, copiar as linhas, apagar a antiga,
renomear, recriar índices.

Duas exigências do procedimento viram regras do runner:

- `PRAGMA foreign_keys` só pode ser desligado **fora** de uma transação. A migration
  declara que reconstrói tabelas; o runner desliga as chaves antes de abrir a transação,
  roda `PRAGMA foreign_key_check` antes de confirmar e religa depois. Uma migration
  nunca mexe nesse pragma por conta própria.
- **A reconstrução preserva os ids**, de modo que chaves estrangeiras, caminhos de anexo
  e metadados de sincronização continuam apontando para as mesmas linhas.

### 4.8 Banco mais novo que o app

Se o `user_version` do arquivo for maior que a última migration que o app conhece — um
backup restaurado em uma instalação antiga, um downgrade manual —, o app **não abre o
banco**, nem para leitura, e pede para atualizar.

**Por quê:** um app antigo não conhece as colunas novas e escreveria linhas que violam
regras que ele nunca viu; ler sem escrever ainda mostraria saldos calculados por uma
regra desatualizada. Recusar é a única resposta que não produz número errado.

### 4.9 Migrations e sincronização

- **A versão do schema entra no handshake da sessão**
  ([sync-design.md §7.4](sync-design.md#74-uma-sessão)), ao lado da verificação de
  relógio, e **a sessão é recusada quando as versões diferem**, com uma mensagem dizendo
  qual aparelho atualizar. É a mesma postura da divergência de relógio: nada é trocado
  até que concordem. Aceitar células de uma coluna que o receptor não tem, ou ignorar uma
  coluna nova que o emissor tem, quebraria a convergência byte a byte que o design
  promete.
- **Migrations não passam pela captura da sincronização.** Elas escrevem pela porta
  `Database`, abaixo do Repository, então não geram entradas em `sync_rows` ou
  `sync_cells` ([sync-design.md §5.4](sync-design.md#54-a-captura-acontece-na-fronteira-do-repository)).
  Por isso **toda migration de dados precisa ser determinística e depender só dos dados
  locais**: cada aparelho a roda por conta própria e chega ao mesmo resultado, em vez de
  receber o resultado pela rede. Uma migration que precisasse de um valor aleatório ou do
  relógio produziria bancos diferentes em cada aparelho; ela é rejeitada na revisão.
- O snapshot de pareamento carrega o `user_version` de quem convida; um aparelho só entra
  num grupo estando na mesma versão.

### 4.10 Runner próprio

O runner é código do `core`, escrito sobre a porta `Database` — da ordem de cem linhas.

| Opção | Por que não |
|---|---|
| Drizzle Kit / Prisma Migrate | Geram a DDL a partir de um schema em TypeScript; aqui o schema é escrito à mão e documentado, e a geração viraria uma segunda fonte da verdade. Também não rodam no aparelho mobile. |
| Migrator do Kysely, Umzug | Pressupõem API assíncrona e, no caso do Umzug, leitura de diretório com `fs`; não cobrem backup, recusa de versão mais nova nem o tratamento de `foreign_keys` da [§4.7](#47-mudanças-que-o-alter-table-não-faz), que são a parte que importa. |
| Migrations dentro de cada adaptador | Duas implementações do mesmo procedimento crítico, uma por plataforma. |

---

## 5. Testes da camada Service

### 5.1 Onde o risco está

Os bugs prováveis deste sistema não são exceções: são **números errados que parecem
certos**. Concretamente:

- Uma compra cair na fatura errada por causa do dia de fechamento — inclusive o dia 31 em
  meses de 30 dias e em fevereiro.
- Uma transação com soft delete entrar num total
  ([database-design.md §3.6](database-design.md#36-colunas-presentes-em-todas-as-tabelas)).
- Editar março e o fechamento de abril não acompanhar
  ([§3.3](#33-aritmética-monetária-no-núcleo)).
- Uma transação mudar de contêiner e só o contêiner novo ser recalculado.
- Uma fatura paga não entrar no extrato do mês do pagamento
  ([database-design.md §4.7](database-design.md#47-invoices)).
- Parcelas que não somam o total; ocorrências de recorrência duplicadas ou recriadas
  depois de excluídas ([database-design.md §4.12](database-design.md#412-recurrences)).
- Os escopos "esta", "esta e as futuras" e "todas" tocarem linhas a mais ou a menos.
- Transferências contadas duas vezes no total do perfil
  ([database-design.md §4.13](database-design.md#413-transactions)).

Cada técnica abaixo existe para pegar uma parte dessa lista.

### 5.2 Ferramentas

| Ferramenta | Papel |
|---|---|
| **Vitest** | Runner. TypeScript nativo, rápido, modo watch, e o mesmo runner em todos os pacotes. |
| **fast-check** | Testes baseados em propriedades ([§5.6](#56-invariantes-e-testes-de-propriedade)). |
| **better-sqlite3 `:memory:`** | Banco real por teste, com todas as migrations aplicadas — em torno de milissegundos. |
| **Stryker** | Mutation testing do núcleo de saldos ([§5.11](#511-mutation-testing-no-núcleo-de-saldos)). |

### 5.3 As camadas da suíte

| Camada | O que cobre | Banco |
|---|---|---|
| Domínio puro | `Money`, arredondamento, divisão de parcelas, cálculo da fatura de uma compra, expansão de recorrências, HLC | Nenhum |
| Service | Cada caso de uso, de ponta a ponta até o SQL | SQLite real em memória |
| Testes de mesa | Cenários financeiros escritos à mão com resultado conhecido ([§5.5](#55-testes-de-mesa)) | SQLite real em memória |
| Propriedades | Sequências aleatórias de operações contra invariantes ([§5.6](#56-invariantes-e-testes-de-propriedade)) | SQLite real em memória |
| Migrations | Instalação limpa, atualização e integridade ([§5.9](#59-testes-de-migration)) | Arquivos reais |
| Contrato de adaptador | A mesma suíte contra cada driver ([§5.10](#510-contrato-dos-adaptadores)) | Cada driver |
| Convergência | Réplicas sincronizando em ordens aleatórias ([sync-design.md §11](sync-design.md#11-próximos-passos)) | Várias em memória |

### 5.4 SQLite real, não mocks

Os testes da camada Service **não mockam o Repository**. Cada teste abre um banco em
memória, aplica as migrations com o runner de produção e chama o Service com os
adaptadores reais.

**Por quê:** metade dos bugs da [§5.1](#51-onde-o-risco-está) mora no SQL — o
`deleted_at IS NULL` esquecido, o `WHERE` do escopo "esta e as futuras", o `SUM` que
pega o contêiner errado. Um mock de Repository devolve o que o teste mandou devolver e
esconde exatamente essas falhas. O banco em memória é rápido o bastante para não haver
troca a fazer. Também é o único jeito de cobrir os testes que o design do banco já
exige: a configuração da conexão
([database-design.md §3.2](database-design.md#32-a-configuração-da-conexão-faz-parte-do-contrato-do-schema))
e o hard delete de um perfil totalmente populado
([database-design.md §6](database-design.md#6-próximos-passos)).

`Clock` e `IdGenerator` são as únicas portas substituídas, por implementações
determinísticas de teste — não mocks, mas adaptadores de verdade cujo comportamento o
teste controla.

Os dados de teste são montados por **builders** (`aTransaction().paid().on('2026-03-10')`)
que preenchem padrões válidos, para que cada teste declare só o que importa para ele.

### 5.5 Testes de mesa

São a base de confiança do resto: **cenários financeiros concretos, com o resultado
calculado à mão** antes de o código existir, escritos como tabelas (dado → quando →
então). Uma conta, alguns meses de lançamentos, e os saldos de fechamento esperados de
cada mês. Catálogo inicial:

1. Mês simples: receitas e despesas pagas e em aberto numa conta corrente.
2. Compra no cartão antes, **no** e depois do dia de fechamento, e lançada à mão numa
   fatura diferente da sugerida — inclusive numa fatura já paga.
3. Cartão com fechamento no dia 31 em abril, em fevereiro e em fevereiro bissexto.
4. Fatura de março paga em abril, entrando no extrato de abril.
5. Parcelamento de R$ 1.000,00 em 3x (`total`) e de 12x R$ 100,00 (`per_installment`),
   atravessando a virada do ano.
6. Recorrência mensal no dia 31; recorrência anual em 29/02.
7. Transferência entre duas contas do perfil: saldo de cada conta e total do perfil;
   pagamento parcial de fatura e sua exclusão; reabertura de uma fatura paga.
8. Edição de uma transação de janeiro com o fechamento de dezembro em diante já
   calculado.
9. Transação movida de uma fatura para um extrato.
10. Os três escopos de edição e de exclusão de recorrência, com ocorrências pagas.
11. Conta com `consider_balance = 0` fora do consolidado; conta cadastrada com saldo
    inicial e edição desse saldo depois de meses lançados.
12. Estorno: despesa de cartão negativa reduzindo a fatura; saldo consolidado e previsto
    do mesmo mês com transações pagas e em aberto.
13. Transação com soft delete em cada um dos cenários acima.

**Esses cenários dependem de regras de negócio que ainda não estão escritas** — elas
precisam ser fechadas antes do primeiro teste de mesa
([§7](#7-próximos-passos)). Um teste de mesa que codifica uma regra adivinhada só prova
que o código concorda com o palpite.

### 5.6 Invariantes e testes de propriedade

O design do banco já define o oráculo: a **rotina de recálculo** reconstrói os saldos a
partir das transações ([database-design.md §3.7](database-design.md#37-dinheiro)). Os
testes de propriedade usam isso assim: o fast-check gera uma sequência aleatória de
operações — criar, editar, mover, pagar e excluir transações; criar e editar
recorrências em cada escopo; pagar faturas — executa todas pelos Services e, depois de
**cada** operação, verifica:

- Todo saldo em cache é igual (dentro do epsilon) ao que a rotina de recálculo produz do
  zero.
- A verificação de integridade não encontra nada.
- Toda transação viva está em exatamente um contêiner.
- O saldo do perfil é a soma das contas com `consider_balance = 1`, e transferências
  internas somam zero no perfil.
- O saldo inicial de cada extrato é o saldo final do extrato vivo anterior da mesma
  conta — ou o `opening_balance` da conta, no primeiro —, no consolidado e no previsto;
  o final é o inicial mais o movimento do mês.
- Consolidado e previsto só diferem por transações em aberto e faturas não pagas.
- As parcelas vivas de uma série `total` somam o total da regra.
- Nenhuma ocorrência excluída reaparece depois do complemento de recorrências.

**O oráculo só vale se for confiável**, e uma rotina de recálculo com bug aprova o mesmo
bug no cache. Por isso a rotina de recálculo é o código com mais testes de mesa da
[§5.5](#55-testes-de-mesa), e sua implementação é deliberadamente a mais simples
possível — um `SUM` por contêiner, sem atalho incremental.

Toda falha encontrada pelo fast-check imprime a semente e a sequência mínima que a
reproduz; essa sequência vira um teste fixo de regressão.

### 5.7 Tempo e fuso horário

- **Nada no núcleo lê o relógio do sistema** ([§3.4](#34-o-núcleo-só-enxerga-portas)).
  Testes que dependem de "hoje" — complemento de recorrências, escopo "futuras",
  fatura em aberto — fixam o `Clock` numa data explícita.
- **A suíte roda duas vezes no CI**, com `TZ=UTC` e com `TZ=America/Sao_Paulo`. Datas
  são `TEXT` sem fuso e timestamps são UTC
  ([database-design.md §3.9](database-design.md#39-tipos-e-domínios-de-colunas)); um
  `Date` construído no lugar errado só aparece como bug perto da meia-noite, num fuso
  diferente de UTC. Rodar nos dois faz esse bug aparecer no CI e não às 22h de um
  dia 31.

### 5.8 Comparando dinheiro nos testes

Um matcher próprio, `expect(saldo).toEqualMoney('1234.56')`, compara com o epsilon da
moeda usando o mesmo `Money.equals` de produção. `toBe` em dinheiro é proibido pelo
mesmo lint da [§3.3](#33-aritmética-monetária-no-núcleo). Os valores esperados são
escritos como strings decimais, para que o teste diga o que um humano conferiria no
extrato.

### 5.9 Testes de migration

- **Instalação limpa = atualização.** O schema obtido aplicando `0001…N` num banco vazio
  é comparado com o obtido atualizando um banco da versão anterior com dados. Os dois
  `sqlite_schema` normalizados precisam ser idênticos.
- **Bancos de cada versão publicada ficam no repositório** (`db/fixtures/vN.sqlite`),
  populados com o cenário completo dos testes de mesa. Cada um é atualizado até a versão
  atual e precisa passar em `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, na
  verificação de integridade do app e manter todos os saldos recalculados idênticos aos
  de antes da migration — salvo quando a migration existe justamente para mudá-los.
- **Imutabilidade** pelo `checksums.lock` ([§4.3](#43-migrations-são-somente-para-a-frente-e-imutáveis)).
- **Os caminhos de falha** — banco mais novo que o app, migration que falha no meio,
  restauração do backup — têm testes próprios.
- O exercício já feito manualmente sobre a `0001`
  ([database-design.md §6](database-design.md#6-próximos-passos)) vira o primeiro
  desses testes.

### 5.10 Contrato dos adaptadores

Uma única suíte de contrato verifica o que o núcleo espera da porta `Database`:
transação com rollback em exceção, tipos devolvidos (`REAL` como `number`, `NULL` como
`null`), `foreign_keys` ligado, `STRICT` respeitado, `RETURNING` funcionando e a versão
mínima do SQLite. Ela roda contra o `better-sqlite3` no CI desde o início e contra o
`expo-sqlite` dentro de um app de teste quando o mobile começar — a diferença entre
drivers aparece ali, e não como um saldo diferente entre o celular e o desktop.

### 5.11 Mutation testing no núcleo de saldos

Cobertura de linhas não diz se os testes detectariam um bug: uma linha pode ser
executada por um teste que não verifica nada sobre ela. O **Stryker** altera o código
(troca `<` por `<=`, `+` por `-`, apaga uma condição) e confere se algum teste falha.
Ele roda sobre os módulos de saldo, fatura, parcelamento e recorrência — a área de maior
risco —, não sobre o código todo, para manter o tempo de execução razoável. Meta
inicial: **90%** de mutantes mortos nesses módulos; abaixo disso o CI falha.

### 5.12 O que bloqueia um merge

Lint (com as regras de fronteira), checagem de tipos, a suíte completa nos dois fusos,
os testes de migration e o mutation testing dos módulos de saldo. Nenhuma métrica de
cobertura de linhas é exigida: o mutation testing mede o que ela fingiria medir.

---

## 6. Impacto nos outros documentos

- **[database-design.md §3.5](database-design.md#35-chaves-primárias-são-uuids):** os
  ids v4 vêm da porta `IdGenerator`, não de `crypto.randomUUID()` diretamente — o React
  Native não o oferece.
- **[database-design.md §6](database-design.md#6-próximos-passos):** o runner de
  migrations está escolhido ([§4.10](#410-runner-próprio)).
- **[sync-design.md §7.4](sync-design.md#74-uma-sessão):** o handshake também compara
  a versão do schema ([§4.9](#49-migrations-e-sincronização)).
- **[sync-design.md §7.5](sync-design.md#75-restrições-de-plataforma):** a tecnologia
  mobile passa a ser React Native / Expo ([§3.8](#38-consequência-o-mobile-é-react-native--expo)).
- **[README](../../README.md):** a stack deixa de estar em aberto.

---

## 7. Próximos passos

1. **Fechar as regras de negócio que os testes de mesa pressupõem.** Já registradas no
   [database-design.md](database-design.md): compra no dia do fechamento vai para a
   fatura seguinte, com escolha manual da fatura (§4.5, §4.7); dia inexistente vira o
   último dia do mês (§4.5); `value` positivo com o tipo dando a direção e negativo como
   estorno (§4.13); resto das parcelas na primeira (§4.12); arredondamento meio para
   longe do zero (§3.7); saldo consolidado e previsto, inicial e final em cada extrato
   (§3.7, §4.6); fatura paga ou em aberto, com pagamento parcial como transferência e
   fatura em aberto no previsto do mês do vencimento (§4.7); transferência numa linha só
   (§4.13); saldo anterior ao primeiro extrato em `accounts.opening_balance` (§4.4).
   Nenhuma regra pendente.
2. ~~**Montar o monorepo**~~ — feito: `packages/core` e `packages/sqlite-better`, com
   lint (regras de fronteira incluídas), tipos e Vitest, e o CI (GitHub Actions) rodando
   `pnpm check` nos dois fusos da [§5.7](#57-tempo-e-fuso-horário).
3. ~~**Implementar as portas, o adaptador `better-sqlite3` e o runner de migrations**~~ —
   feito, com a suíte de contrato, os testes de migration, o backup com `VACUUM INTO`
   ([§4.6](#46-backup-antes-de-migrar)) e o `checksums.lock`
   ([§4.3](#43-migrations-são-somente-para-a-frente-e-imutáveis)). Pendente no runner: o
   tratamento de `foreign_keys` para reconstrução de tabelas
   ([§4.7](#47-mudanças-que-o-alter-table-não-faz)).
4. ~~**Implementar `Money` e o domínio puro de datas**~~ — feito para a fatura de uma
   compra e o vencimento; falta a expansão de recorrências e a divisão de parcelas.
5. ~~**Implementar a rotina de recálculo**~~ — feita (`BalanceRecalculationService`), com
   testes de mesa e teste de propriedade contra um oráculo independente. A
   **verificação de integridade** cobre o desvio de saldo (rota `integrity.verifyBalances`,
   que roda o recálculo numa transação desfeita e só relata); faltam órfãs e anexos ausentes.
6. ~~Os Services de lançamento~~ — CRUD de transações (escopo "somente esta"), consolidação
   de extrato, pagamento e reabertura de fatura e saldo do perfil, expostos pelo mapa de
   rotas. Faltam o serviço de recorrências (escopos "esta e as futuras" e "todas"), os
   cadastros (perfil, conta, cartão, categorias, tags), anexos e o Stryker
   ([§5.11](#511-mutation-testing-no-núcleo-de-saldos)).
