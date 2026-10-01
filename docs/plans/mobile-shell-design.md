# Design do Shell Mobile

**Status:** Design concluído — não implementado. Fecha as duas questões sobre o mobile
que os documentos anteriores deixaram abertas: nativo ou multiplataforma, medido pela
proporção da lógica do backend que de fato é compartilhada em vez de reimplementada; e
como o app fala com o banco local — o mesmo mecanismo embarcado ou uma camada de API
local.
**Relacionado:** [backend-design.md](backend-design.md) — o núcleo que este shell hospeda
e a consequência que já apontava o React Native
([§3.8](backend-design.md#38-consequência-o-mobile-é-react-native--expo));
[desktop-shell-design.md](desktop-shell-design.md) — o `CoreClient` e o pacote `client`
que o mobile reaproveita; [sync-design.md](sync-design.md) — o transporte que o celular
precisa hospedar; [database-design.md](database-design.md) — o arquivo que o app abre.

Este documento é o lugar de toda decisão sobre o shell mobile. A
[§2](#2-decisões-em-resumo) é o resumo; as seções seguintes guardam o raciocínio.

---

## 1. Escopo e restrições

Herdadas do [README](../../README.md) e dos documentos anteriores:

- O celular é o dispositivo do **uso diário**: lançar transações, consultar saldos,
  consultas rápidas — **Android e iOS**. Abrir o app e lançar uma despesa precisa ser
  rápido.
- O núcleo é **TypeScript puro**, com a porta `Database` **síncrona** e `transaction(fn)`
  síncrono ([backend-design.md §3.5](backend-design.md#35-a-porta-de-banco-é-síncrona)).
- O celular **escreve offline** e é uma réplica completa e igual às outras
  ([sync-design.md §4](sync-design.md#4-topologia-todo-dispositivo-é-um-par-igual)).
- O celular precisa hospedar o transporte da sincronização: **listener e cliente TCP,
  mDNS, leitura de QR code, armazenamento seguro de chaves e criptografia**
  ([sync-design.md §7.5](sync-design.md#75-restrições-de-plataforma)).
- **Os dados não saem da rede do usuário** ([sync-design.md §7.1](sync-design.md#71-somente-a-mesma-rede-local))
  e nada pode ter custo recorrente ([README](../../README.md)).

Fora do escopo: o desenho das telas e a navegação em detalhe, widgets e extensões do
sistema ([§4.5](#45-quando-uma-api-local-passaria-a-valer)) e a importação do histórico
do app atual.

---

## 2. Decisões em resumo

| Pergunta | Decisão | Seção |
|---|---|---|
| Nativo ou multiplataforma? | **React Native com Expo.** É a única opção em que nenhuma regra de negócio nem de convergência é reimplementada: o mobile escreve só adaptadores sem regra e as telas | [§3](#3-nativo-ou-multiplataforma) |
| Quanto do backend é compartilhado? | **Todo o código que tem regra**: domínio, Requests, Controllers, Services, Repositories e SQL, migrations, sincronização e — por decisão deste documento — a criptografia do canal. Fica por plataforma o que não tem regra | [§3.2](#32-o-inventário-do-que-é-compartilhado) |
| Como o app fala com o banco? | **O mesmo mecanismo embarcado**: o núcleo roda no runtime JavaScript do app e chama o SQLite pela API síncrona do `expo-sqlite`, via JSI. Sem servidor local, sem segundo runtime | [§4](#4-como-o-app-fala-com-o-banco) |
| E o bloqueio da thread JavaScript? | Orçamento medido para chamadas interativas; operações longas viram telas de progresso explícitas. Um runtime secundário fica como rota de escape atrás do `CoreClient` | [§4.3](#43-o-custo-é-a-thread-javascript) |
| Onde fica a criptografia da sincronização? | **No núcleo, em TypeScript puro**: Noise para o canal e CPace para o código digitado. Por plataforma ficam só socket, mDNS e chaveiro | [§5](#5-a-sincronização-no-celular) |
| O banco entra no backup do iCloud / Google? | **Não.** Fica fora do backup em nuvem; a recuperação de um celular perdido é parear de novo a partir de outro dispositivo | [§6.1](#61-fora-do-backup-em-nuvem) |
| Como o app é distribuído? | Android por instalação direta, de graça. **iOS ainda depende de uma escolha do usuário**: conta gratuita (reassinar a cada 7 dias) ou programa pago da Apple | [§7](#7-distribuição-sem-custo-recorrente) |

---

## 3. Nativo ou multiplataforma

### 3.1 A régua é o que seria reimplementado

A pergunta "nativo ou multiplataforma" costuma ser decidida por desempenho, aparência
nativa ou ecossistema. Aqui a régua é outra, herdada do README: **quanto da lógica de
backend o mobile reaproveita e quanto ele teria de reescrever**. Uma regra de saldo
escrita duas vezes é uma regra que pode divergir, e neste sistema a divergência aparece
como um saldo diferente no celular e no desktop — o tipo de bug que o projeto existe para
não ter.

Por isso a comparação parte de um inventário do que existe hoje no design, e só depois
olha as alternativas.

### 3.2 O inventário do que é compartilhado

| Peça | Onde vive | O mobile reimplementa? |
|---|---|---|
| Domínio: `Money` e arredondamento, ids marcados, fatura de uma compra, expansão de recorrências, divisão de parcelas | `core` | Não |
| Request (schemas de validação), Controllers, mapa de rotas, `CoreResult` | `core` | Não |
| Services: lançamento, rotina de recálculo, verificação de integridade, complemento de recorrências | `core` | Não |
| Repositories e todo o SQL | `core` | Não |
| Runner de migrations e os arquivos `.sql` | `core`, `db/migrations` | Não |
| Sincronização: HLC, captura, merge por célula, colisões, filhos órfãos, snapshot, protocolo da sessão | `core` | Não |
| Criptografia do canal e PAKE do pareamento | `core` ([§5.1](#51-protocolo-e-criptografia-ficam-no-núcleo)) | Não |
| Contrato tipado, `CoreClient`, hooks de dados, view-models, formatadores | `client` | Não |
| Adaptador `Database` | `sqlite-expo` | Sim — fino, sem regra |
| `Clock`, `IdGenerator`, `FileStore`, fonte de aleatoriedade, chaveiro | `apps/mobile` | Sim — fino, sem regra |
| Socket TCP e descoberta mDNS | `apps/mobile` | Sim — fino, sem regra |
| Câmera para o QR, permissões, ciclo de vida do app | `apps/mobile` | Sim — da plataforma por natureza |
| Telas e navegação | `apps/mobile` | Sim — por decisão ([desktop-shell-design.md §4.3](desktop-shell-design.md#43-por-que-não-uma-ui-única-com-react-native-web)) |

A linha que separa as duas metades é **ter regra ou não ter**. Tudo que decide um número,
uma data, um contêiner ou o vencedor de um conflito está acima da linha e existe uma
vez. O que o mobile escreve são adaptadores que traduzem uma porta para uma API da
plataforma — cada um verificado por uma suíte de contrato
([backend-design.md §5.10](backend-design.md#510-contrato-dos-adaptadores)) — e as telas.

Em volume, a expectativa é de algumas centenas de linhas de adaptadores contra alguns
milhares de linhas de núcleo; o número real é medido quando o monorepo existir
([§10](#10-próximos-passos)). O que importa não é a porcentagem, e sim que **nenhuma
regra de negócio nem de convergência exista duas vezes**.

### 3.3 As alternativas medidas pelo inventário

| Opção | O que precisaria ser reimplementado | Veredito |
|---|---|---|
| Nativo (Kotlin + Swift) | Toda a coluna "Não" do inventário, **duas vezes** — três implementações das regras de saldo e do merge, contando o desktop | Rejeitado |
| Flutter | Toda a coluna "Não", uma vez, em Dart — a segunda implementação ao lado do núcleo do desktop | Rejeitado |
| Kotlin Multiplatform | Igual ao Flutter; já rejeitado em [backend-design.md §3.10](backend-design.md#310-alternativas-rejeitadas) | Rejeitado |
| Capacitor | Nada — compartilharia até a UI em React DOM. Mas o núcleo rodaria na webview: o SQLite chega pelo plugin **assíncrono** pela ponte, ou como WASM fora de um arquivo comum, e o listener TCP é fraco ([sync-design.md §7.5](sync-design.md#75-restrições-de-plataforma)). É exatamente o problema do Tauri ([desktop-shell-design.md §3.2](desktop-shell-design.md#32-onde-o-núcleo-rodaria-no-tauri)) | Rejeitado |
| NativeScript | Nada no núcleo, que rodaria no runtime JavaScript. Mas não há renderer React mantido, então o pacote `client` — hooks com TanStack Query, view-models — deixaria de ser compartilhado | Rejeitado |
| **React Native / Expo** | Nada. O núcleo roda no Hermes e o `expo-sqlite` oferece a API síncrona que a porta exige ([§4.2](#42-decisão-o-mesmo-mecanismo-embarcado)) | **Escolhido** |

O Capacitor é a armadilha da lista: é a opção que **mais** compartilha código e a que
menos preserva o design. Compartilhar a UI não vale nada se o preço é a porta síncrona,
que é o que mantém a unidade de trabalho atômica.

### 3.4 A sincronização não tolera duas implementações

Duplicar código é caro; duplicar a sincronização é incorreto. O design promete que as
réplicas **convergem byte a byte** ([sync-design.md §11](sync-design.md#11-próximos-passos)),
e isso depende de todo dispositivo tomar exatamente a mesma decisão sobre:

- a comparação das strings de HLC e o desempate por id de dispositivo;
- a derivação do UUID v5 a partir da chave natural;
- o arredondamento de `Money` sobre a representação decimal mais curta do double
  ([backend-design.md §3.3](backend-design.md#33-aritmética-monetária-no-núcleo)) — um
  algoritmo que outra linguagem implementaria com outra função de formatação;
- a sobrevivente de uma colisão de nomes e o tratamento de filhos órfãos.

Com um núcleo em Dart ou Swift ao lado do TypeScript, uma diferença sutil em qualquer
desses pontos não gera erro: gera dois bancos que discordam em silêncio e que a
sincronização nunca mais reconcilia. Testar a equivalência de duas implementações seria
um projeto à parte. Com uma implementação só, a equivalência é por construção.

### 3.5 Expo, com build de desenvolvimento

**Expo**, e não React Native sem framework, porque os módulos de que o app precisa —
`expo-sqlite`, `expo-secure-store`, `expo-crypto`, `expo-file-system`, `expo-camera` —
são mantidos pela mesma equipe e versionados juntos no SDK. Para um único desenvolvedor,
atualizar o React Native é a tarefa mais cara de manter um app; o Expo a reduz a subir o
SDK.

- **Os projetos nativos são gerados, não commitados** (`expo prebuild`, com *config
  plugins* para permissões e manifestos). O que é da plataforma fica declarado em
  `app.config.ts`, e não espalhado em `ios/` e `android/` editados à mão.
- **O Expo Go não serve:** o socket TCP e o mDNS são módulos nativos fora do SDK
  ([§5.2](#52-os-adaptadores-do-mobile)). O app roda como *development build* desde o
  primeiro dia.
- **Os serviços pagos do Expo não são usados** — builds locais, sem EAS Update
  ([§6.4](#64-atualizações-sem-ota)). A exceção possível é o build de iOS
  ([§7](#7-distribuição-sem-custo-recorrente)).
- **Nova Arquitetura e Hermes**, que são o padrão do SDK. A JSI é o que permite a
  chamada síncrona ao SQLite da [§4.2](#42-decisão-o-mesmo-mecanismo-embarcado).

### 3.6 O que reabriria a decisão

- **O `expo-sqlite` perder a API síncrona** ou deixar de embarcar uma versão do SQLite
  com `STRICT`. A porta isola o impacto: outro driver síncrono via JSI (o `op-sqlite`, por
  exemplo) entra trocando só o adaptador.
- **Uma medição mostrar que o Hermes não aguenta o núcleo** na escala do projeto — o que
  a [backend-design.md §3.2](backend-design.md#32-o-cálculo-não-é-pesado-o-risco-é-exatidão)
  torna improvável, porque a agregação pesada roda no código C do SQLite. Mesmo assim, a
  primeira resposta seria o runtime secundário da [§4.3](#43-o-custo-é-a-thread-javascript),
  não outro framework.

---

## 4. Como o app fala com o banco

### 4.1 As opções

A pergunta é se o app chama o núcleo e o SQLite diretamente, no mesmo runtime, ou se
interpõe uma camada — um servidor local, outro runtime, um módulo nativo — entre a UI e o
banco.

| Opção | Como funcionaria | Por que não |
|---|---|---|
| API HTTP local | Um servidor dentro do app, em `127.0.0.1`, com o núcleo atrás de rotas | Acrescenta serialização e assincronia sem ganho: o único cliente é o próprio app. No Android, qualquer outro app do aparelho consegue conectar em `localhost` — seria preciso um token e mais uma superfície de ataque sobre os dados financeiros. |
| Backend do Electron em `nodejs-mobile` | O mesmo código do `utilityProcess` do desktop, num runtime Node embarcado no celular | Um runtime Node a mais no pacote (dezenas de MB), de manutenção comunitária irregular, com o `better-sqlite3` compilado para cada ABI móvel e uma ponte assíncrona entre o React Native e o Node. Reproduz a topologia do desktop sem o motivo dela: o núcleo não depende do Node e já roda no Hermes. |
| Módulo nativo dono do banco | Kotlin e Swift expondo operações de alto nível ao JavaScript | Ou o SQL e a regra migram para o código nativo — reimplementação, [§3.4](#34-a-sincronização-não-tolera-duas-implementações) —, ou o módulo vira só um driver, que é o que o `expo-sqlite` já é. |
| API assíncrona do `expo-sqlite` | O núcleo no mesmo runtime, com consultas assíncronas | Quebra a porta síncrona e traz de volta a fila em volta de toda escrita ([backend-design.md §3.5](backend-design.md#35-a-porta-de-banco-é-síncrona)). |
| Núcleo num runtime JavaScript secundário | O equivalente móvel do `utilityProcess`: o núcleo e a conexão numa thread própria | A melhor topologia em tese, mas os runtimes secundários com bundle completo ainda são experimentais no React Native. Fica como rota de escape ([§4.3](#43-o-custo-é-a-thread-javascript)). |

### 4.2 Decisão: o mesmo mecanismo embarcado

O núcleo roda **no runtime JavaScript principal do app** e chama o SQLite pela **API
síncrona do `expo-sqlite`** (`openDatabaseSync`, `runSync`, `getAllSync`,
`withTransactionSync`). Não existe camada de API local.

**Por quê:**

- **"Mesmo mecanismo" é literal.** O motor é o mesmo SQLite, o arquivo tem o mesmo
  schema, as migrations e o SQL são os mesmos bytes, e o núcleo é o mesmo pacote. Só o
  binding muda — e é exatamente o que a porta existe para absorver
  ([database-design.md §3.3](database-design.md#33-a-camada-repository-abstrai-o-driver-não-apenas-o-banco)).
- **A chamada síncrona é real, não emulada.** A API síncrona do `expo-sqlite` chama o
  SQLite pela JSI, sem serializar mensagens por uma ponte. A porta `Database` se
  implementa sem adaptação de modelo, e `transaction(fn)` é atômico por construção.
- **O app tem um único consumidor do núcleo**: a própria UI. Toda camada entre os dois
  seria uma fronteira de serialização e de assincronia sem quem se beneficie dela.

A sequência de abertura é a mesma de toda plataforma
([backend-design.md §4.5](backend-design.md#45-a-sequência-de-abertura)): pragmas,
backup, migrations, integridade, complemento de recorrências. O mobile não tem caminho
próprio de abertura.

### 4.3 O custo é a thread JavaScript

No desktop, o núcleo bloqueia o `utilityProcess` e a janela nem percebe. No celular, ele
bloqueia a **thread JavaScript**: a rolagem nativa e as animações dirigidas pela thread de
UI continuam, mas toques que dependem de JavaScript esperam a chamada terminar. A
[backend-design.md §3.5](backend-design.md#35-a-porta-de-banco-é-síncrona) aceitou esse
custo porque as consultas desta escala levam milissegundos; este documento o transforma
em regra verificável:

- **Chamadas interativas** — lançar, editar, consultar um mês, abrir uma fatura — têm
  orçamento de **p95 ≤ 50 ms** num aparelho de referência com um banco de dez anos de
  dados. Editar uma transação antiga recalcula os meses seguintes da conta
  ([backend-design.md §3.3](backend-design.md#33-aritmética-monetária-no-núcleo)), e esse
  é o caso que define o orçamento. A medição é um passo explícito
  ([§10](#10-próximos-passos)), não uma suposição.
- **Operações longas são telas, não chamadas escondidas.** Migrations, aplicação do
  snapshot de pareamento, o primeiro lote de uma sincronização, a importação do
  histórico e a exportação mostram uma tela de progresso com animação dirigida pela thread
  de UI, que continua viva enquanto a JavaScript trabalha.
- **Operações longas não são fatiadas em `await`s.** Seria a forma óbvia de devolver a
  thread à UI, mas o lote da sincronização e a migration são **uma** transação
  ([sync-design.md §5.9](sync-design.md#59-após-a-aplicação)); fatiar reintroduziria a
  intercalação que a porta síncrona evita.
- **O `DirectCoreClient` agenda a execução para depois do frame corrente**, para que o
  retorno visual do toque seja desenhado antes de a thread bloquear.

**Rota de escape:** se a medição estourar o orçamento, o núcleo muda para um runtime
JavaScript secundário — com a conexão do banco dentro dele — por trás de um
`WorkerCoreClient`. Os hooks e as telas só conhecem `CoreClient`
([desktop-shell-design.md §5.1](desktop-shell-design.md#51-um-contrato-duas-implementações)),
então a troca é na raiz do app, não no código de tela.

### 4.4 O contrato é o mesmo do desktop

O `DirectCoreClient` precisa se comportar como o `IpcCoreClient`; caso contrário, uma
rota funciona no celular e quebra no desktop, ou o contrário.

- **A camada Request valida toda entrada**, também no celular. Lá a UI não é uma
  fronteira de segurança, mas a validação é o único lugar onde as regras de entrada vivem;
  pular a Request num shell seria ter dois caminhos para a mesma regra.
- **DTOs são dados serializáveis por tipo.** O mapa de rotas restringe entrada e
  resultado a um tipo `CoreSerializable` — objetos simples, arrays, strings, números,
  booleanos e `null`; nada de instâncias de classe, `Date`, `Map` ou funções. Sem isso, um
  DTO que carregasse um `Money` funcionaria no celular, onde nada é serializado, e chegaria
  ao renderer do desktop sem os métodos, depois do *structured clone*
  ([desktop-shell-design.md §5.3](desktop-shell-design.md#53-erros-atravessam-como-resultado-não-como-exceção)).
  Um teste no CI passa o resultado de cada rota por `structuredClone` e compara.
- **Erros chegam como `CoreResult`**, com o mesmo conjunto fechado de códigos. Uma
  exceção inesperada é capturada pelo `DirectCoreClient` e vira o mesmo erro genérico
  com log do desktop.

### 4.5 Quando uma API local passaria a valer

Uma camada entre a UI e o banco só se justifica quando houver **mais de um processo** no
celular precisando dos dados: um widget de saldo na tela inicial, uma extensão de
compartilhamento para anexar a foto de um recibo, um atalho da Siri ou do Android para
lançar uma despesa. Extensões rodam em processos separados, e dois processos escrevendo
no mesmo arquivo SQLite, cada um com sua captura da sincronização, quebrariam a premissa
de uma única conexão escritora.

Se esses recursos vierem, a regra é: **extensões nunca escrevem no banco**. Elas leem um
arquivo de resumo que o app grava (o saldo para o widget) ou deixam pedidos numa caixa de
entrada que o app processa ao abrir, pelos Services de sempre. Mesmo nesse caso, um
servidor local continua desnecessário.

---

## 5. A sincronização no celular

### 5.1 Protocolo e criptografia ficam no núcleo

A [sync-design.md §7.4](sync-design.md#74-uma-sessão) deixou em aberto a biblioteca do
canal — Noise ou TLS 1.3 com certificados fixados — para ser escolhida com a stack. A
escolha do mobile a decide:

- **TLS fica de fora.** Um TLS com certificados fixados por dispositivo, nos dois
  sentidos, depende da pilha TLS de cada plataforma — Node no desktop, módulos nativos no
  React Native —, com APIs e comportamentos de validação diferentes. Seriam duas
  implementações da parte mais sensível da sessão.
- **Noise em TypeScript puro**, sobre as bibliotecas `@noble` (curvas, cifras e hashes,
  auditadas e sem dependência de plataforma). Depois do pareamento, os dois dispositivos já
  conhecem a chave pública um do outro, e o padrão **Noise KK** autentica os dois lados e
  abre o canal no mesmo handshake.
- **Pareamento pelo mesmo caminho.** No convite por QR, o segredo de 128 bits é usado
  como chave pré-compartilhada (PSK) de um handshake Noise; no código digitado, o
  **CPace** (sobre ristretto255) deriva essa PSK a partir do código curto
  ([sync-design.md §6.3](sync-design.md#63-pareamento--qualquer-membro-pode-convidar)).
  Há um único handshake de pareamento, alimentado por duas fontes de segredo.

Com isso, protocolo, enquadramento das mensagens, handshake e cifra ficam no `core`, sob
as mesmas regras de lint, e o que sobra por plataforma são quatro portas sem regra:

| Porta | O que oferece |
|---|---|
| `Transport` | escutar, discar e um fluxo de bytes por conexão — só endereços locais ([sync-design.md §7.1](sync-design.md#71-somente-a-mesma-rede-local)) |
| `Discovery` | anunciar e procurar o serviço via mDNS / DNS-SD |
| `KeyStore` | guardar e usar a chave privada do dispositivo no chaveiro da plataforma |
| `RandomSource` | bytes aleatórios seguros — o Hermes não oferece `crypto.getRandomValues` sozinho |

A regra de endereços locais é verificada no `core`, sobre o endereço que o `Transport`
informa, e não em cada adaptador: é regra de produto, não da plataforma.

**Risco aceito:** o Hermes não tem JIT, e uma cifra em JavaScript puro é mais lenta que a
nativa. O volume é pequeno — lotes de sincronização, um snapshot de alguns megabytes e os
anexos —, mas a vazão é medida ([§10](#10-próximos-passos)). Se não bastar, a primitiva de
cifra passa a vir de um módulo nativo por trás de uma porta, e o handshake continua
compartilhado.

### 5.2 Os adaptadores do mobile

| Porta | Implementação |
|---|---|
| `Database` | `expo-sqlite`, API síncrona, no pacote `sqlite-expo` |
| `Clock` | relógio do sistema |
| `IdGenerator`, `RandomSource` | `expo-crypto` |
| `FileStore` | `expo-file-system` |
| `KeyStore` | `expo-secure-store` com acesso `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ([§6.3](#63-criptografia-em-repouso)) |
| `Transport` | `react-native-tcp-socket` |
| `Discovery` | uma biblioteca de mDNS da comunidade; se nenhuma acompanhar a Nova Arquitetura nas duas plataformas, um módulo Expo próprio sobre o `NsdManager` (Android) e o `Network.framework` (iOS) |
| QR | leitura de código de barras do `expo-camera` |

Permissões declaradas por *config plugin*: no iOS, a descrição de uso da rede local e o
tipo de serviço Bonjour do app; no Android, o multicast lock durante a descoberta e a
permissão de rede local que as versões recentes passaram a exigir para o `targetSdk`
vigente — conferida no momento da implementação.

### 5.3 Ciclo de vida do app

A sincronização só acontece em primeiro plano
([sync-design.md §7.1](sync-design.md#71-somente-a-mesma-rede-local)), então o
ciclo de vida é o interruptor dela:

- **Ao entrar em primeiro plano:** abrir o listener, anunciar via mDNS e procurar os
  membros.
- **Ao sair do primeiro plano:** encerrar a sessão, fechar o listener e parar o anúncio —
  sem esperar o sistema operacional cortar os sockets.

A porta síncrona dá uma garantia gratuita aqui: **nenhuma transação de banco atravessa um
`await`**, então o sistema nunca suspende o app no meio de uma escrita do núcleo. Um lote
recebido foi aplicado inteiro ou não foi aplicado, e a próxima sessão recomeça do mesmo
vetor ([sync-design.md §5.9](sync-design.md#59-após-a-aplicação)).

---

## 6. O arquivo no celular

### 6.1 Fora do backup em nuvem

O banco, os anexos e a pasta `backups/` ficam no diretório privado do app e são
**excluídos do backup automático** do iCloud e do Google: `allowBackup` desligado no
Android e o atributo de exclusão de backup nos diretórios do iOS (por um módulo local de
poucas linhas, se nenhuma API do Expo expuser o atributo).

**Por quê:** o backup automático enviaria o histórico financeiro inteiro para um
terceiro, que é exatamente o que a regra de produto da
[sync-design.md §7.1](sync-design.md#71-somente-a-mesma-rede-local) recusa — e de forma
silenciosa, configurada pelo sistema e não pelo usuário.

**Consequência:** um celular perdido é recuperado **pareando um aparelho novo** a partir
de qualquer outro membro, que envia o snapshot completo
([sync-design.md §6.4](sync-design.md#64-entrando-no-grupo-um-novo-dispositivo-começa-vazio)).
Se o celular for o único dispositivo, não há de onde recuperar; nesse caso o app lembra
periodicamente de exportar uma cópia ([§6.2](#62-cópia-exportada-nunca-o-arquivo-vivo)).

### 6.2 Cópia exportada, nunca o arquivo vivo

A propriedade dos dados continua literal: o app exporta uma **cópia consistente** com
`VACUUM INTO` — a mesma operação do backup e do snapshot — e a entrega pela folha de
compartilhamento do sistema, para o destino que o usuário escolher.

O arquivo vivo **não** é exposto ao app Arquivos do iOS nem a outros apps. Outro programa
abrindo o banco enquanto o app escreve em modo WAL arrisca corrupção, e qualquer edição
externa contornaria a captura da sincronização
([sync-design.md §5.4](sync-design.md#54-a-captura-acontece-na-fronteira-do-repository)).

### 6.3 Criptografia em repouso

- **O banco não é cifrado pelo app.** Android e iOS já cifram o armazenamento do app com
  chave atrelada ao desbloqueio do aparelho. Um SQLCipher protegeria contra o mesmo
  ataque — um aparelho bloqueado nas mãos de outra pessoa — e tornaria o arquivo
  ilegível para as ferramentas SQLite comuns, quebrando a propriedade literal dos dados.
- **A chave privada do dispositivo usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`**: ela não migra
  para outro aparelho por backup ou restauração. Remover um membro
  ([sync-design.md §6.5](sync-design.md#65-removendo-um-dispositivo)) só tem sentido se a
  chave daquele dispositivo não puder reaparecer em outro.
- **Bloqueio do app por biometria é opcional**, para o caso de um aparelho desbloqueado
  emprestado. É uma trava de interface, não criptografia, e é tratado assim.

### 6.4 Atualizações sem OTA

O app não usa atualização pelo ar (EAS Update ou servidor próprio). É um serviço
hospedado, ou um servidor a manter, para um único usuário — infraestrutura que o README
recusa. Atualizar é instalar um build novo.

Como as sessões de sincronização entre versões de schema diferentes são recusadas
([backend-design.md §4.9](backend-design.md#49-migrations-e-sincronização)), um build
novo com migration precisa chegar a todos os dispositivos antes que eles voltem a
sincronizar. A mensagem de recusa já diz qual aparelho atualizar.

---

## 7. Distribuição sem custo recorrente

O mobile é o único ponto do projeto em que a restrição "sem custo recorrente" esbarra
numa plataforma — e isso independe do framework: um app nativo teria o mesmo problema.

- **Android:** build local (`expo prebuild` e Gradle, no Linux) e instalação direta do
  APK. Gratuito e sem prazo de validade. A Play Store não é necessária.
- **iOS:** compilar exige macOS — um Mac local ou o plano gratuito do EAS Build, que
  compila na nuvem só o código, nunca os dados. Para instalar no iPhone, há dois caminhos:

| Caminho | Custo | Consequência |
|---|---|---|
| Apple ID gratuito | Nenhum | O app expira a cada **7 dias** e precisa ser reassinado e reinstalado (pelo Xcode ou por ferramentas de reassinatura como o SideStore). Exige um Mac ou o SideStore para instalar. |
| Apple Developer Program | US$ 99 por ano | Assinatura válida por um ano, distribuição pelo TestFlight ou ad hoc. Contradiz a restrição de custo do README. |

**Pendente — decisão do usuário.** As duas opções são compatíveis com a arquitetura, e
nada neste documento muda entre elas. A escolha define só o processo de release do iOS
([§10](#10-próximos-passos)). Enquanto ela não sai, o Android vem primeiro: a
implementação, a suíte de contrato e a medição de desempenho começam lá.

---

## 8. Paridade entre runtimes

A suíte do núcleo roda no Node, com Vitest
([backend-design.md §5](backend-design.md#5-testes-da-camada-service)); no celular, o
mesmo código roda no Hermes, com outra implementação de `Intl`, de ordenação de strings e
de dados de localidade. Mesmo código não garante mesmo resultado, e os pontos em que isso
morde são conhecidos:

- **Formatação de dinheiro não usa `Intl.NumberFormat`.** O formatador do `client`
  monta a string a partir do valor já arredondado, com separadores vindos da
  configuração do perfil. O ICU do Chromium e o `Intl` do Hermes podem divergir em
  detalhes (espaço não separável, símbolo da moeda), e a promessa de que o celular e o
  desktop nunca mostram o mesmo saldo de dois jeitos
  ([desktop-shell-design.md §4.2](desktop-shell-design.md#42-o-que-é-compartilhado-é-a-camada-headless))
  não pode depender deles.
- **Ordenação de nomes acontece no SQL** ou com um comparador explícito do `client`,
  nunca com `localeCompare` sem argumentos, cujo resultado depende da localidade do
  runtime.
- **Datas** já são protegidas pela porta `Clock` e pela proibição de `new Date()` no
  núcleo ([backend-design.md §5.7](backend-design.md#57-tempo-e-fuso-horário)).

Para pegar o que escapar dessa lista, um **app de teste** (`apps/mobile-contract`) roda
no emulador Android, no CI:

1. A suíte de contrato do adaptador `Database` contra o `expo-sqlite`
   ([backend-design.md §5.10](backend-design.md#510-contrato-dos-adaptadores)), incluindo
   a versão mínima do SQLite e o `STRICT`.
2. **Vetores de ouro** gerados no Node — arredondamento de `Money`, divisão de parcelas,
   UUID v5, comparação de HLC, saídas dos formatadores — recalculados no Hermes e
   comparados.
3. Um handshake Noise e um CPace completos contra vetores do Node, para que celular e
   desktop provem que falam o mesmo protocolo antes de existir rede.

O iOS roda o mesmo app de teste manualmente antes de cada release, até haver um runner
macOS disponível.

---

## 9. Impacto nos outros documentos

- **[backend-design.md §3.4](backend-design.md#34-o-núcleo-só-enxerga-portas):** a
  sincronização acrescenta as portas `Transport`, `Discovery`, `KeyStore` e
  `RandomSource` ([§5.1](#51-protocolo-e-criptografia-ficam-no-núcleo)). Elas entram no
  diagrama junto com a implementação da sincronização, como as tabelas `sync_*`
  ([sync-design.md §9](sync-design.md#9-impacto-no-design-do-banco-de-dados)).
- **[backend-design.md §3.9](backend-design.md#39-estrutura-e-ferramentas):** o monorepo
  ganha `packages/sqlite-expo` e `apps/mobile-contract`.
- **[desktop-shell-design.md §3.4](desktop-shell-design.md#34-o-transporte-da-sincronização):**
  a criptografia do canal deixa de vir do `crypto` do Node e passa a ser a do núcleo; o
  `utilityProcess` continua fornecendo socket, mDNS e o `safeStorage` como adaptadores.
- **[desktop-shell-design.md §4.2](desktop-shell-design.md#42-o-que-é-compartilhado-é-a-camada-headless):**
  os formatadores de dinheiro não usam `Intl.NumberFormat` ([§8](#8-paridade-entre-runtimes)).
- **[sync-design.md §7.4 e §11](sync-design.md#74-uma-sessão):** a biblioteca do canal
  está escolhida — Noise KK sobre `@noble`, com CPace no código digitado.
- **[README](../../README.md):** o shell mobile deixa de estar em aberto.

---

## 10. Próximos passos

1. **Decidir a distribuição do iOS** ([§7](#7-distribuição-sem-custo-recorrente)) —
   Apple ID gratuito com reassinatura semanal ou programa pago.
2. **Incluir `apps/mobile` e `packages/sqlite-expo` no monorepo** depois do esqueleto do
   desktop ([desktop-shell-design.md §6](desktop-shell-design.md#6-próximos-passos)),
   com development build no Android e o `DirectCoreClient` sobre o mesmo mapa de rotas.
3. **Montar `apps/mobile-contract` no CI** com a suíte de contrato e os vetores de ouro
   ([§8](#8-paridade-entre-runtimes)) antes da primeira tela.
4. **Medir no aparelho de referência**, com um banco de dez anos de dados: tempo de
   abertura até a tela de lançamento e p95 das chamadas interativas
   ([§4.3](#43-o-custo-é-a-thread-javascript)). Estourar o orçamento aciona a rota de
   escape; o resultado fica registrado aqui.
5. **Validar a biblioteca de mDNS** nas duas plataformas, com a Nova Arquitetura, e
   decidir entre ela e o módulo próprio ([§5.2](#52-os-adaptadores-do-mobile)).
6. **Medir a vazão da cifra no Hermes** com um snapshot e anexos reais
   ([§5.1](#51-protocolo-e-criptografia-ficam-no-núcleo)).
7. **Contar as linhas** de núcleo e de adaptadores quando o monorepo existir, para
   que a [§3.2](#32-o-inventário-do-que-é-compartilhado) se apoie em número.
