# Plano do MVP Mobile — o desktop no bolso, no Android

**Status:** Em andamento — Fase 0. Primeira entrega do app mobile: o
[design do shell mobile](mobile-shell-design.md) posto em código, no Android, com as
mesmas funcionalidades do desktop — menos relatórios, calendário e Extrato — sobre o banco
do próprio celular. A sincronização fica para um plano próprio, logo depois deste.
**Relacionado:** [mobile-shell-design.md](mobile-shell-design.md) — a arquitetura que este
plano implementa (Expo, núcleo no Hermes, `expo-sqlite` síncrono, NativeWind);
[desktop-mvp-plan.md](desktop-mvp-plan.md) — as funcionalidades e regras de produto que o
celular reproduz, fase a fase; [sync-design.md](sync-design.md) — o que fica de fora e a
regra de ids que já vale agora ([§10](sync-design.md#10-até-a-sincronização-ser-entregue));
[backend-design.md](backend-design.md) — o núcleo e o contrato dos adaptadores;
[mockups](../design/mockups/README.md) — as telas do celular.

A [§2](#2-decisões-em-resumo) é o resumo; a [§6](#6-lista-de-tarefas) é a lista de
tarefas, em ordem de execução.

---

## 1. Objetivo e escopo

**Pergunta que o MVP responde:** o mesmo núcleo do desktop roda no celular, dentro do
orçamento de tempo da [mobile-shell-design §4.3](mobile-shell-design.md#43-o-custo-é-a-thread-javascript),
e permite fazer pelo celular tudo o que o desktop faz no dia a dia, com **os mesmos
números, centavo a centavo**?

A paridade é conferida com uma ponte provisória: a cópia do banco exportada pelo desktop
(Fase 13.9 do desktop) é importada no celular, e as duas telas precisam mostrar os mesmos
saldos, faturas e metas ([§7](#7-critério-de-pronto-do-mvp)).

### Dentro do escopo

| Área | Telas (mockup) | O que entra | Regras vêm de (desktop) |
|---|---|---|---|
| Primeiro uso | `MobilePrimeiroUso` | Criar perfil e primeira conta. "Entrar num grupo" aparece desabilitado | Fase 5 |
| Shell | todas | Barra inferior Início · Transações · Contas · Cartões · Mais; faixa do mês de referência; seletor de perfil; tema claro/escuro/sistema; botão "+" de lançamento | Fase 4 |
| Início | `MobileInicio` | Seção de atrasados no topo ([§5.1](#51-decididas)), saldo consolidado e previsto, contas, faturas do mês | Fases 10 e 15.1 |
| Transações | `MobileTransacoes`, `MobileTransacaoDetalhe` | Lista do mês com as compras do cartão agrupadas na linha da fatura ([§5.1](#51-decididas)), filtros em folha inferior, busca, marcar pago, excluir | Fases 9 e 11.1 |
| Lançamento | `MobileLancamento` | Despesa, receita e transferência; fatura sugerida; débito/crédito com conta e cartão padrão; nome sugerido; tags, meta e sócio | Fases 9, 9.3 e 15.2 |
| Recorrências | `MobileParcelar`, `MobileEscopo` | Parcelado e fixo; escopos "somente esta", "esta e as futuras" e "todas" | Fases 9.1 e 9.2 |
| Contas | `MobileContas`, `MobileExtrato` | Lista com consolidado e previsto → extrato da conta no mês; criar, editar, desativar e excluir em cadeia; conta padrão | Fases 6, 7 e 15.2 |
| Cartões | `MobileCartoes`, `MobileFatura`, `MobilePagarFatura` | Fatura do mês, pagar, pagamento parcial, reabrir, próximas faturas, limite usado; cartão padrão | Fases 8, 13.5 e 15.2 |
| Metas | `MobileMetas` | Lista com progresso → detalhe; tipos de meta, retirada, arquivadas ([pendência 1](#52-decisões-pendentes)) | Fases 9.3, 13.3 e 13.4 |
| Cadastros | `MobileCadastros` | Perfis (moeda só sem lançamentos, mover de perfil), categorias e subcategorias, entrada para Tags, Anotações e Sócios ([§5.1](#51-decididas)) | Fases 6, 13.11 e 13.12 |
| Tags | `MobileTags` | Lista + folha de edição | Fase 6 |
| Anotações | `MobileAnotacoes`, `MobileAnotacaoEditar` | Lista (primeira linha como título) + editor | Fase 6 |
| Sócios | `MobileSocios` | Só no perfil empresarial: participação somando 100%, atribuir sócio no lançamento | Fases 13.7 e 13.8 |
| Ajustes | `MobileAjustes` | Tema, exportar a cópia do banco pela folha de compartilhamento, importar a cópia, versões, relatar problema | Fases 13 e 13.9 |
| Mais | `MobileMais` | Menu com Metas, Cadastros, Anotações, Dispositivos e Ajustes | — |

`MobileExtrato` é o **extrato da conta** (M8), parte de Contas, e entra. O que fica fora é
o Extrato do desktop: o resultado de cada dia numa tabela dia × mês.

### Fora do escopo (próximas entregas)

- **Relatórios** (personalizados, por sócio, projeção de saldo), **Calendário** e o
  **Extrato dia × mês** do desktop — decisão do usuário para este MVP.
- **Sincronização** — Dispositivos, Parear e Recebendo (`MobileDispositivos`,
  `MobileParear`, `MobileRecebendo`), as portas `Transport`, `Discovery`, `KeyStore` e
  `RandomSource`, Noise e CPace. Ganham um plano próprio, logo depois deste
  ([§3](#3-relação-com-a-sincronização)). O modo remoto
  ([sync-design §7.7](sync-design.md#77-modo-remoto-o-celular-usa-o-banco-do-desktop))
  vem depois da sincronização.
- **iOS** — fica para uma fase futura, e a escolha da distribuição continua pendente
  ([mobile-shell-design §7](mobile-shell-design.md#7-distribuição-sem-custo-recorrente)).
  Nada neste plano depende dela: as escolhas abaixo valem também para o iOS.
- **Importação de CSV** — só no desktop (decisão 11 do README dos mockups).
- **Bloqueio por biometria** ([mobile-shell-design §6.3](mobile-shell-design.md#63-criptografia-em-repouso)),
  widgets e extensões ([§4.5](mobile-shell-design.md#45-quando-uma-api-local-passaria-a-valer)).

---

## 2. Decisões em resumo

| Pergunta | Decisão | Por quê |
|---|---|---|
| Mobile ou sincronização primeiro? | **Mobile primeiro**, sobre o banco do próprio celular; sincronização num plano próprio logo depois | Valida a stack inteira — Hermes, `expo-sqlite` síncrono, NativeWind, orçamento de 50 ms — antes do investimento no sync. Nenhuma tela depende dele. O uso real diário só começa com a sincronização ([§3](#3-relação-com-a-sincronização)) |
| Plataforma | **Só Android** | O design já punha o Android primeiro; o iOS depende de uma decisão de custo ainda aberta |
| Onde compila | **No devcontainer**: JDK, SDK e NDK de linha de comando numa camada do `Dockerfile`, cache do Gradle num volume; `expo prebuild` + Gradle geram o APK | Mantém a regra do container ("nada de compiladores no host"). Disco e memória sobram (428 GB livres, 30 GB de RAM) |
| Onde roda | **Emulador no devcontainer** no desenvolvimento (`/dev/kvm` repassado pelo compose, janela no desktop pelo mesmo Wayland/X11 do Electron); **aparelho físico** na medição (Fase 5) e na validação final (Fase 19); **emulador no CI** | Testar não depende do celular por perto, e build, `adb`, Metro e emulador ficam no mesmo lugar, sem toolchain no host. O desempenho de um emulador x86 num PC não diz nada do aparelho, por isso os números saem do celular; os runners Linux do GitHub Actions têm KVM |
| Ciclo de desenvolvimento | Development build instalado no emulador (`pnpm emulator:android`), Metro no container; no celular, quando preciso, o aparelho alcança o Metro por `adb` sem fio (`adb pair`/`connect` + `adb reverse`) ou pelo IP do host, já que o container usa a rede do host | O túnel do Expo passa o bundle por um terceiro; fica só como último recurso (código, nunca dados) |
| Framework | **Expo**, SDK estável mais recente no início da Fase 4, Nova Arquitetura, Hermes, development build, `android/` gerado e não commitado | [mobile-shell-design §3.5](mobile-shell-design.md#35-expo-com-build-de-desenvolvimento) |
| Navegação | **Expo Router**: abas da barra inferior, uma pilha por aba, rotas tipadas | É o roteador do Expo, com rotas tipadas como o TanStack Router do desktop, e trata o "voltar" do Android |
| Mês de referência | Estado do shell, salvo nas preferências do aparelho (`lastPeriod`), e não parâmetro de rota | No desktop, ele é *search param* para sobreviver à URL; no celular não há URL para preservar, e as pilhas por aba perderiam o parâmetro ao trocar de aba |
| Estilo | **NativeWind** sobre `packages/tokens`: a v5 lê o mesmo `theme.generated.css`; se ela não estiver estável no SDK escolhido, a v4 com uma saída em JS do mesmo gerador | [mobile-shell-design §9](mobile-shell-design.md#9-telas-e-estilo); validado no esqueleto, antes da primeira tela |
| Folhas inferiores | Componente `Sheet` próprio sobre o `Modal` do React Native (revisto na Fase 6: o `@gorhom/bottom-sheet` não abria no aparelho) | Decisão 12 do README dos mockups ("escolhas em folhas inferiores"), com o mesmo comportamento no Android e, depois, no iOS |
| Listas longas | `@shopify/flash-list` em Transações e no extrato da conta; `FlatList` no resto | Um mês tem centenas de linhas; a reciclagem de células mantém a rolagem fluida enquanto a thread JavaScript trabalha |
| Dados na UI | **TanStack Query** e os hooks do `client`, os mesmos do desktop | [desktop-shell §4.2](desktop-shell-design.md#42-o-que-é-compartilhado-é-a-camada-headless) |
| Cliente do núcleo | `DirectCoreClient` do `client`, com a execução agendada para depois do frame corrente | [mobile-shell-design §4.3](mobile-shell-design.md#43-o-custo-é-a-thread-javascript): o retorno visual do toque é desenhado antes de a thread bloquear |
| Formulários | **react-hook-form** + os schemas Zod da camada Request | Igual ao desktop: validação de conforto com a mesma regra do núcleo |
| Preferências do aparelho | Arquivo JSON no diretório do app (tema, último perfil, último mês, data da última cópia exportada) | São do aparelho, não do perfil: no banco, seriam replicadas pela sincronização (mesma decisão do desktop) |
| Testes de tela | **jest-expo + React Native Testing Library** em `apps/mobile`, com o núcleo real sobre `better-sqlite3` em memória atrás do `DirectCoreClient` | A tela é testada no Node, sem aparelho, contra as regras de verdade. A lógica continua nos view-models do `client`, testados no Vitest |
| Ponta a ponta | **Maestro** no emulador do CI | Fluxos declarativos em YAML, gratuitos, sem código de teste dentro do app |
| Paridade de runtime | `apps/mobile-contract` no emulador do CI: contrato do adaptador, vetores de ouro, ordenação | [mobile-shell-design §8](mobile-shell-design.md#8-paridade-entre-runtimes) |

---

## 3. Relação com a sincronização

Este MVP entrega um celular com banco próprio. Até a sincronização existir:

- **O celular não é para uso real em paralelo com o desktop.** Uma despesa lançada no
  celular não chega ao desktop, e o contrário também vale. O uso diário começa no plano de
  sincronização.
- **A importação da cópia do banco é uma ponte de teste, não sincronização.** Ela
  substitui o banco do celular inteiro pelo do desktop, com backup antes, como na Fase 13.9
  do desktop. Depois dela, os dois bancos divergem a cada escrita. A tela de Ajustes diz isso
  com todas as letras.
- **Quando a sincronização chegar**, vale a [sync-design §10](sync-design.md#10-até-a-sincronização-ser-entregue):
  um dos dispositivos entra vazio no grupo e recebe o snapshot. O banco de teste do
  celular é descartado nessa hora.
- **A regra de ids determinísticos já vale** — o celular usa as mesmas rotas e os mesmos
  Services, então não há caminho novo de criação de linha. Ainda assim, nenhuma tarefa
  deste plano pode gerar id fora do `IdGenerator` e do `DeterministicIds`.

O que este plano já deixa pronto para o sync: o ciclo de vida do app num ponto só da raiz
de composição ([§6, Fase 4](#fase-4--esqueleto-do-appsmobile)), o `Dispositivos` com rota
no menu Mais e o "Entrar num grupo" no primeiro uso, desabilitados.

---

## 4. Arquitetura da entrega

```
packages/core            ajustes de paridade no Hermes (ordenação sem localeCompare); nenhuma regra nova
packages/client          DirectCoreClient com agendamento pós-frame; estado da abertura compartilhado
packages/tokens          saída em JS para o NativeWind 4, se for a versão adotada
packages/sqlite-expo     NOVO — adaptadores Database e BackupDirectory sobre expo-sqlite e expo-file-system
apps/mobile              NOVO — Expo: raiz de composição, navegação, telas
apps/mobile-contract     NOVO — app de teste no emulador do CI: contrato do adaptador e vetores de ouro
```

Fluxo de uma chamada: componente → hook do `client` → `CoreClient.call` →
`DirectCoreClient` (agendado após o frame) → `core.dispatch` → Controller → Service →
Repository → `expo-sqlite` pela JSI, síncrono. Não existe processo nem ponte entre a tela e
o banco ([mobile-shell-design §4.2](mobile-shell-design.md#42-decisão-o-mesmo-mecanismo-embarcado)).

Como as telas só conhecem `CoreClient`, a rota de escape — um `WorkerCoreClient` num
runtime secundário, se a medição estourar o orçamento — troca só a raiz do app.

---

## 5. Decisões de produto

### 5.1 Decididas

| Decisão | Regra |
|---|---|
| Regras de negócio | **Nenhuma regra nova no mobile.** Toda funcionalidade usa rotas que o desktop já usa; se uma tela precisar de dado que nenhuma rota dá, a rota nasce no `core` e serve aos dois |
| Funcionalidades do desktop sem mockup no celular | Seguem a regra do desktop e o padrão visual dos mockups mobile (lista → folha ou tela de detalhe); a divergência do mockup é apresentada antes do código e registrada na fase |
| Dispositivos no menu Mais | Rota com uma tela que explica "Dados só neste aparelho", como o rodapé do desktop antes do sync |
| "Entrar num grupo" no primeiro uso | Visível e desabilitado, como no desktop |
| Mês de referência | Na faixa abaixo do cabeçalho em toda tela que depende de período; fora do lançamento e dos fluxos de configuração (decisão 2 do README dos mockups) |
| Importar a cópia do banco | Ponte de teste ([§3](#3-relação-com-a-sincronização)): substitui o banco inteiro, com backup antes e aviso explícito de que os bancos passam a divergir |
| Atrasados no Início | O Início ganha, **numa seção no topo**, o que o selo de atrasados da Visão geral do desktop mostra (Fase 15.1): lançamentos vencidos e não pagos, com "Marcar como pago/recebido" e "Desfazer", e o que ainda vence até o fim do mês. É uma seção, e não um selo com popover, porque o celular não tem espaço ao lado do título nem *hover*. Diverge do `MobileInicio`, que não a desenha |
| Compras do cartão em Transações | Agrupadas na linha da fatura, **como no desktop** (Fase 11.1); tocar na linha abre a fatura (`MobileFatura`). A regra do desktop sobre a data dos lançamentos de conta vale igual |
| Telas sem mockup no celular (Perfis, detalhe de Categorias) | Seguem o modelo das demais telas mobile (lista → tela de detalhe, edição em folha inferior) e mostram as mesmas informações das telas do desktop (Fases 13.11 e 13.12) |
| Lembrete de exportar a cópia | **Não existe.** A recuperação de um celular que é o único dispositivo vai ser tratada por outra funcionalidade, mais tarde; a [mobile-shell-design §6.1](mobile-shell-design.md#61-fora-do-backup-em-nuvem) foi atualizada |
| Aparelho de referência | **Samsung Galaxy S23 FE**, que mede o orçamento de p95 ≤ 50 ms (Fase 5) |

### 5.2 Decisões pendentes

Perguntada no início da fase em que aparece, antes do código. O mockup é proposta, não
regra.

1. **Metas (Fase 14):** tipos de meta, retirada e arquivadas (Fases 13.3 e 13.4 do
   desktop) não estão no `MobileMetas`. O usuário analisa a tela quando a fase chegar.

---

## 6. Lista de tarefas

Ordem pensada para que o risco técnico caia antes da primeira tela: ambiente → paridade
do núcleo → adaptador → app de contrato → esqueleto → **medição** → telas. As Fases 1 e 2
podem andar em paralelo com a 0. Todo item segue o padrão do `CLAUDE.md`: contratos
explícitos, docblock com motivação e testes no mesmo commit.

### Fase 0 — Ambiente Android no devcontainer

- [x] Camada no `.devcontainer/Dockerfile`: JDK na versão que o Gradle do SDK do Expo pede, Android `cmdline-tools`, `platform-tools` (`adb`), `platforms`/`build-tools` do `targetSdk` e o NDK que o SDK do Expo fixa; licenças aceitas na construção da imagem; comentário com o motivo de cada pacote, como as camadas existentes
- [x] Volume no `compose.yaml` para `~/.gradle` (e o cache do Android SDK, se ficar fora da imagem), para que o primeiro build lento não se repita a cada container
- [x] Emulador no devcontainer: `/dev/kvm` e o grupo dono repassados pelo compose (GID gravado pelo `initializeCommand`), pacote `emulator` e imagem `android-36/google_apis/x86_64` numa camada própria, `pnpm emulator:android` criando o AVD no volume do `~/.android`
- [x] Validar o ciclo de desenvolvimento com um app Expo descartável: development build instalado no emulador, Metro no container, *fast refresh* funcionando. Registrar o caminho no README do app (Fase 4). Validado com o Expo SDK 58: `adb reverse tcp:8081 tcp:8081`, `expo start --dev-client` e o app aberto pelo link `exp+<slug>://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`. O Metro não pode subir com `CI=1`, que desliga o *watch mode* e, com ele, o *fast refresh*
- [x] Instalar no emulador, por `adb install`, um APK gerado no container (debug, x86_64, ~6 min no primeiro build)
- [ ] Celular, só quando chegar a Fase 5: ligar o aparelho ao Metro por `adb` sem fio (`adb pair` + `adb connect` + `adb reverse tcp:8081`) ou pelo IP do host

### Fase 1 — Paridade do núcleo no Hermes

Antes de qualquer app: o que a [mobile-shell-design §8](mobile-shell-design.md#8-paridade-entre-runtimes)
manda e o código ainda não cumpre.

- [x] Trocar os `localeCompare` do núcleo por um comparador explícito no domínio: `GoalProgress`, `SpendingSummary`, `PendingItems` (dois) e `CascadeDeletionService`. Os que hoje usam `'pt-BR'` ordenam ignorando acento e maiúscula; o comparador novo dobra acento e caixa por tabela própria, sem ICU, para que "Água" continue antes de "Bebida" no desktop
- [x] Regra de lint no `core`: proibir `localeCompare`, `Intl` e `toLocale*` (o `client` já tem a dele)
- [x] Vetores de ouro gerados no Node e versionados em JSON: arredondamento de `Money`, divisão de parcelas, UUID v5, ordenação do comparador, saídas dos formatadores do `client` e do parser de valor digitado. Script `pnpm golden:generate`; um teste no Vitest confere que o JSON está em dia com o código
- [x] Gerador determinístico de um banco de **dez anos** (perfis, contas, cartões, faturas, parcelados, fixos, metas) pelas rotas do núcleo, para a medição da Fase 5 — o mesmo arquivo serve ao desktop. `pnpm db:history <arquivo.sqlite>`: dois perfis, ~11 mil lançamentos, gerado em ~10 s
- [x] Testes: comparador (acentos, caixa, empate pelo id), vetores, gerador (o banco gerado passa em `integrity.verifyBalances`)

### Fase 2 — `packages/sqlite-expo`

- [x] Pacote novo em `1.0.0`, com `expo-sqlite` como dependência par; lint de fronteira (só importa a porta do `core`)
- [x] `ExpoSqliteDatabase` sobre a API síncrona (`openDatabaseSync`, `runSync`, `getFirstSync`, `getAllSync`, `execSync`, `withTransactionSync`). O SQL do núcleo usa `:nome`, e o `expo-sqlite` espera o prefixo na chave do objeto: o adaptador traduz `{ nome }` em `{ ':nome' }`, com cache por instrução preparada, como o `BetterSqliteDatabase`
- [x] `ExpoBackupDirectory` sobre o `expo-file-system`, com a pasta `backups/` ao lado do banco
- [x] Conferência na abertura: versão mínima do SQLite e suporte a `STRICT`, com erro explícito
- [x] Extrair a suíte de contrato da porta `Database` de `packages/core/test/infrastructure/database.test.ts` para uma função que recebe a fábrica do banco e um `expect` mínimo, sem depender do Vitest — roda no Vitest contra o `better-sqlite3` e, na Fase 3, no Hermes contra o `expo-sqlite`

Como ficou: o adaptador usa `prepareSync` + `executeSync`, com `resetSync` depois de cada
leitura, e não o `runSync`/`getFirstSync` da conexão, que preparam e finalizam a instrução a
cada chamada e anulariam o cache. Ele recebe a conexão já aberta por interfaces próprias
(`ExpoConnection`, `ExpoBackupFolder`), conferidas na compilação contra os tipos reais do SDK
58, e só `@finance/sqlite-expo/open` carrega código nativo; assim o Vitest roda o adaptador
inteiro sobre um dublê fiel ao `expo-sqlite` (chave sem `:` ignorada em silêncio, cursor
aberto até o `resetSync`). A suíte de contrato (`@finance/core/contract`) traz as próprias
asserções em vez de receber um `expect`, e `runDatabaseContract` devolve a lista de casos que
falharam, que é o que o app de contrato mostra. Versão mínima do SQLite: 3.38.0 (`STRICT` e
`json_valid`); o `expo-sqlite` 58 embarca o 3.53.3.

### Fase 3 — `apps/mobile-contract` no CI

- [x] App Expo mínimo (`1.0.0`) que, ao abrir, roda a suíte de contrato contra o `ExpoSqliteDatabase`, recalcula os vetores de ouro no Hermes e mostra e registra no log um resultado único (passou / lista de divergências)
- [ ] Workflow `mobile.yml` no GitHub Actions: build do APK de contrato, emulador com KVM (`reactivecircus/android-emulator-runner`), fluxo Maestro que espera o resultado e falha o job em qualquer divergência. Roda só quando mudam `packages/core`, `packages/client`, `packages/sqlite-expo`, `apps/mobile*` ou `db/migrations`. O job e o fluxo (`apps/mobile-contract/.maestro/contract.yaml`) estão escritos e o app foi validado no emulador do devcontainer por `adb`; falta a primeira execução no CI, que depende de um push
- [x] Handshake Noise e CPace contra vetores do Node ([mobile-shell-design §8](mobile-shell-design.md#8-paridade-entre-runtimes), item 3) **não entram aqui**: vão para o plano de sincronização, junto com a criptografia

Como ficou:

- **Resultado no emulador** (APK de release, Hermes, `expo-sqlite` 58): SQLite 3.53.3, 14 casos
  do contrato do banco e 842 vetores de ouro (núcleo e `client`), sem divergência. A ordenação
  de nomes, o arredondamento e os formatadores saem iguais aos do Node.
- **Dois achados, corrigidos antes do resultado verde:**
  - `openDatabaseSync(':memory:')` aberto de novo devolveu o mesmo banco, e os casos herdaram as
    tabelas uns dos outros. O app usa um arquivo por caso numa pasta do cache, apagada antes e
    depois — o que também roda os casos em WAL, como o app.
  - **Defeito do adaptador:** o `finalizeSync` do `expo-sqlite` lança de novo o erro da última
    execução da instrução. Com a instrução que violou uma restrição ainda no cache, o `close`
    do banco lançava, e o app fechava com exceção fatal. O `ExpoSqliteDatabase` agora tira do
    cache e finaliza na hora a instrução que falhou, e o dublê `FakeExpoConnection` reproduz o
    comportamento do driver, com teste.
- **Os vetores entram pelo bundle** (o Metro embute o `vectors.json` como objeto);
  `readGoldenVectors` do núcleo confere a forma do valor, como o `parseGoldenVectors` faz com
  o texto.
- **Um job só no CI** para o contrato e o teste de fumaça, no mesmo emulador: o contrato roda
  antes, e na falha o log `[contrato]` vai para a saída do job.
- Um erro ao fechar um banco também vira falha da lista, e não exceção, para o app mostrar a
  causa em vez de fechar.

### Fase 4 — Esqueleto do `apps/mobile`

- [x] App Expo (`1.0.0`, `com.finance.app` ou o identificador que o usuário escolher), `app.config.ts`, Nova Arquitetura, Hermes; `android/` no `.gitignore`
- [x] Metro no monorepo pnpm: `watchFolders` na raiz, resolução dos pacotes `workspace:*` por symlink, imports com extensão `.ts` do núcleo, **uma só cópia de React** (o `client` tem React como dependência par). Se o modo isolado do pnpm não funcionar com o Metro, avaliar `node-linker=hoisted` antes de seguir — a mudança afeta o workspace inteiro e precisa ser perguntada
- [x] *Config plugin*: `allowBackup` desligado e exclusão do backup automático ([mobile-shell-design §6.1](mobile-shell-design.md#61-fora-do-backup-em-nuvem)); nenhuma permissão além das que o Expo exige
- [x] Raiz de composição: abre `finance.sqlite` com o `ExpoSqliteDatabase`, roda `openDatabase` com o `ExpoBackupDirectory`, monta `createCore` com `Clock` do sistema e `IdGenerator` sobre `expo-crypto`, roda `integrity.verifyBalances` e grava desvios e erros inesperados num log no diretório do app
- [x] Estado da abertura: extrair do desktop (`utility/openCore.ts` e o processo principal) a parte que é regra — banco mais novo que o app, falha de migration, falha do backup, arquivo que não abre — para o `client`, e usar nos dois shells. Telas de bloqueio do mobile com "restaurar backup"
- [x] `DirectCoreClient` com agendamento pós-frame (opção no `client`, testada no Vitest com um agendador falso)
- [x] Ciclo de vida (`AppState`) num ponto só da raiz, ainda sem uso: é onde o sync liga e desliga o listener ([mobile-shell-design §5.3](mobile-shell-design.md#53-ciclo-de-vida-do-app))
- [x] NativeWind lendo `packages/tokens` (v5 ou v4, [§2](#2-decisões-em-resumo)); IBM Plex Sans pelo `expo-font`; tema claro/escuro/sistema pelas mesmas variáveis; teste de que nenhuma cor literal aparece em `apps/mobile` (regra de lint, como no desktop)
- [x] Lint de fronteira em `apps/mobile`: telas só falam com o `client`; o `core` só entra na raiz de composição
- [x] jest-expo + React Native Testing Library configurados, com um `renderWithCore` de teste sobre `better-sqlite3` em memória
- [x] Scripts na raiz: `pnpm dev:mobile`, `pnpm build:mobile` (APK de debug) e `pnpm check` cobrindo lint, tipos e testes do app
- [x] `CLAUDE.md`: linhas `apps/mobile/**`, `apps/mobile-contract/**` e `packages/sqlite-expo/**` na tabela de versionamento
- [ ] Teste de fumaça Maestro no CI: abre o app num banco vazio e chega ao primeiro uso. O fluxo (`apps/mobile/.maestro/smoke.yaml`) e o workflow `mobile.yml` estão escritos, e o mesmo caminho foi validado no emulador do devcontainer por `adb` (o Maestro não está na imagem); falta a primeira execução no CI, que depende de um push

Como ficou:

- **Identificador:** `br.com.finance.app`, escolhido pelo usuário.
- **Metro no modo isolado do pnpm**, sem `node-linker=hoisted`: o `metro.config.js` resolve
  todo pacote que o app declara (mais `react-native` e `expo-modules-core`) a partir do
  próprio app. Sem isso, o `client` e o `sqlite-expo` levavam ao bundle outra variante de
  `react-native`, do `expo-modules-core` e do `expo-sqlite` (mesma versão, contexto de
  dependência par diferente no store). O source map do bundle confere que nenhum pacote
  entra duas vezes. Pelo mesmo motivo, o app declara o que as configurações dele carregam
  pelo nome e que no modo isolado não estaria ao alcance: o `react-native-css-interop` (o
  Babel do NativeWind injeta o import dele em cada arquivo), o `babel-preset-expo` e o
  `@babel/plugin-transform-react-jsx` (o preset do NativeWind o pede sem declarar). Os dois
  últimos só faltavam no bundle de release do Gradle (`export:embed`), não no Metro de
  desenvolvimento.
- **NativeWind 4.2.7**, porque a v5 ainda está em RC. O `packages/tokens` gera
  `nativewind-preset.generated.cjs` a partir dos mesmos dados do CSS do desktop. O preset do
  NativeWind declara `fontFamily.sans` em `theme.extend`, que vence o `theme` de qualquer
  preset, e o app saía na Roboto: o preset dos tokens repete a família em `extend`, e um teste
  do app resolve o tema completo para pegar a colisão.
- **Fonte:** IBM Plex Sans embutida pelo plugin do `expo-font`, como uma família com os pesos
  400, 500 e 600, para `font-medium` e `font-semibold` funcionarem como no desktop. A escala
  de tamanhos ganhou o 26, do título do `MobilePrimeiroUso`.
- **Abertura compartilhada:** `openCoreSequence`, `StartupStatus`, os textos das telas de
  bloqueio e o `SystemClock` saíram do desktop para o `client` (`@finance/client/startup`,
  sem React). O desktop passou a usá-los sem mudar comportamento, e os testes da abertura do
  desktop passam sem alteração. A restauração do backup no celular segue os passos do
  `replaceDatabase` do desktop, sobre o `expo-file-system`.
- **Validado no emulador** (development build com Metro e *fast refresh*, temas claro e
  escuro): o log do aparelho registra SQLite 3.53.3, as 8 migrations aplicadas, integridade
  sem desvio e o complemento das recorrências.

### Fase 5 — Medição (portão antes das telas)

- [ ] Aparelho de referência: **Samsung Galaxy S23 FE** ([§5.1](#51-decididas)); registrar a versão do Android e da One UI junto com os números
- [x] Banco de dez anos da Fase 1 levado ao aparelho por uma ação só de build de desenvolvimento (a importação de Ajustes ainda não existe)
- [ ] Medir no build de **release**: tempo da abertura até a primeira tela interativa e p95 de lançar, editar uma transação antiga (o pior caso, que recalcula a cadeia da conta), consultar um mês e abrir uma fatura
- [ ] Registrar os números na [mobile-shell-design §4.3 e §11](mobile-shell-design.md#11-próximos-passos). **Estourou o orçamento de p95 ≤ 50 ms:** parar e decidir com o usuário entre otimizar a rota culpada e o `WorkerCoreClient` antes de qualquer tela

Como ficou a preparação (a medição no S23 FE ainda falta):

- **Roteiro único** em `@finance/core/benchmark` (`runInteractiveBenchmark`): 40 rodadas de
  lançar, editar uma despesa avulsa de 2016-11 (o recálculo da cadeia inteira da conta),
  listar as transações do mês e abrir uma fatura, chamando o núcleo como as telas chamam.
  Roda no Node (`pnpm bench:core <banco>`, linha de base do desktop) e no Hermes, com o mesmo
  banco e o mesmo código. Deixa as transações vivas como encontrou; cada rodada deixa só a
  lápide do lançamento excluído.
- **No aparelho**, `pnpm bench:android <banco> [--replace]`: instala o development build,
  copia o banco pelo `run-as` (a ação só de desenvolvimento), instala por cima o APK de
  release gerado com `EXPO_PUBLIC_BENCHMARK=1` (`build:benchmark`; a mesma chave de depuração
  mantém os dados), mede seis aberturas e espera a medição das chamadas no logcat. Sem
  `--replace`, recusa rodar com o app já instalado, para não apagar dado real.
- **Abertura até a primeira tela interativa:** o app registra em toda abertura
  `[abertura] primeira-tela epoch=…` quando a primeira consulta da tela inicial responde; o
  script subtrai o instante do `am start`, os dois pelo relógio do aparelho. A primeira
  abertura depois de instalar paga a compilação inicial do ART e fica de fora da mediana.
- **Ensaio** com o banco de dez anos (120 meses, 2 perfis, 9.827 lançamentos):

  | Onde | Abertura | Lançar p95 | Editar antiga p95 | Consultar mês p95 | Abrir fatura p95 |
  |------|----------|------------|-------------------|-------------------|------------------|
  | Node 24 (container) | — | 2,1 ms | 5,9 ms | 0,4 ms | 0,2 ms |
  | Emulador x86_64 (KVM), Android 16 | ~510 ms, ~255 ms dela no núcleo | 4,2 ms | 12,4 ms | 1,8 ms | 0,6 ms |

  O emulador roda em x86_64 sobre a CPU do computador e não vale como referência; serve para
  mostrar que o roteiro e o script funcionam de ponta a ponta.

### Fase 6 — Shell e navegação

- [x] Abas Início · Transações · Contas · Cartões · Mais, com uma pilha por aba; "voltar" do Android coerente com a pilha
- [x] Faixa do mês de referência (‹ mês ›, "Voltar ao mês atual") nas telas com período; `lastPeriod` nas preferências
- [x] Seletor de perfil no cabeçalho, em folha inferior; troca grava `lastProfileId` e invalida todas as queries
- [x] Botão "+" de lançamento nas telas do mockup
- [x] Menu Mais completo; rotas das telas ainda não feitas levando a uma tela em branco, substituída na fase de cada uma
- [x] Componentes base: `Sheet`, botão, campo, seleção em folha, estados (carregando, erro com "Tentar de novo" pelo `describeError`, vazio), alvos de toque ≥ 44 px, movimento reduzido respeitado
- [x] Preferências do aparelho num arquivo JSON, com leitura tolerante (arquivo corrompido volta aos padrões)
- [x] Testes: componentes base, mês de referência, troca de perfil

Como ficou:

- **Rotas** em `app/(tabs)/{home,transactions,accounts,cards,more}`, cada pasta com a própria
  pilha (`TabStack`), e o lançamento em `app/new-transaction.tsx`, por cima das abas, na pilha
  raiz (`AppNavigation`). Os caminhos ficam em `src/shell/routes.ts`: as rotas tipadas do Expo
  Router dependem dos tipos que o servidor de desenvolvimento gera, e o `pnpm check` roda sem
  ele. Na raiz de uma aba, o "voltar" leva ao Início (`backBehavior: firstRoute`); tocar na
  aba aberta volta ao topo da pilha dela.
- **Barra inferior própria** (`BottomBar`), com o desenho do mockup, que emite o `tabPress`
  como a padrão. Ícones dos mockups pelo `react-native-svg`, com a cor do token pela
  propriedade (`useThemeColor`), sem cor literal.
- **Regras de shell no `client`:** `currentPeriod`, `currentDate`, `shiftPeriod`,
  `isValidPeriod` e `pickActiveProfile` saíram do desktop para o `client`, e os dois apps usam
  as mesmas. O celular não tem a guarda de alteração não salva da troca de perfil: o seletor
  só existe no Início e no Mais, que não têm formulário.
- **Faixa do mês:** fora do mês corrente, o rótulo "Mês de referência" vira "Voltar ao mês
  atual", e o toque no centro volta a ele — o mockup deixa o centro como botão sem dizer o que
  faz, e não há espaço para um terceiro botão.
- **Tema:** o botão do cabeçalho abre uma folha com "Seguir o sistema", "Tema claro" e "Tema
  escuro", como o menu do desktop, e não alterna claro/escuro como o mockup.
- **Folhas sobre o `Modal` do React Native**, e não sobre o `@gorhom/bottom-sheet` da §2: no
  emulador, o `present()` da biblioteca registrava o portal, mas nenhuma view da folha chegava
  à árvore nativa, sem erro (com Reanimated 4.7.1 e gesture-handler 3.3.0, que rodavam
  normalmente). O `Sheet` próprio abre numa janela por cima de tudo, fecha no véu, no "Fechar"
  e no "voltar" do Android (`onRequestClose`), sobe pela `Animated` no driver nativo e aparece
  sem animação com "remover animações" ligado. Como é renderizado no lugar, e não num portal,
  enxerga os contextos de quem o abriu. Perde só o arrastar para fechar.
- **LogBox:** o aviso de `ImageBackground` obsoleto, disparado pelo NativeWind ao carregar, é
  ignorado na raiz; a faixa dele cobria a barra inferior e engolia os toques no desenvolvimento.
- **Preferências** em `preferences.json`, no diretório de documentos (fora da pasta do banco,
  para restaurar o banco não levar o tema junto), com escrita por arquivo temporário.
- **Mais** diverge do mockup no rodapé e em Dispositivos, que dizem "Dados só neste aparelho"
  enquanto não há sincronização; Dispositivos é uma tela que explica isso.
- **Testes:** o `renderApp` monta as rotas de verdade de `app/` pelo `renderRouter` do Expo
  Router, só com a raiz trocada pelo núcleo em memória. A lint do app passou a aceitar `import type` do núcleo (os DTOs
  das respostas), nunca código.

### Fase 7 — Primeiro uso

- [x] `MobilePrimeiroUso`: perfil e primeira conta por `onboarding.start`; "Entrar num grupo" desabilitado
- [x] Sem perfil no banco, o shell não abre
- [x] Testes: tela (RNTL) e fluxo Maestro do banco vazio até o Início

Como ficou:

- **Validação compartilhada:** o `readOnboardingForm`, o `formIssues` e as moedas saíram do
  desktop para o `client`; os dois apps mostram a mesma frase para o mesmo erro.
- **Formulário no padrão do mockup:** grupos com linhas "rótulo à esquerda, valor à direita"
  (`FormGroup`, `FormRow`, `RowInput`, `Segmented`, `RowSelect` em `src/ui/form.tsx`), com
  react-hook-form como no desktop.
- **Sem tipo de conta:** como o mockup, a primeira conta nasce corrente; investimento se
  escolhe depois, em Contas. O desktop pergunta o tipo.
- **Ao criar:** o perfil criado vira o aberto e o mês volta ao corrente, como no desktop.
- **Maestro:** `.maestro/first-use.yaml`; o workflow passou a rodar todos os fluxos da pasta.

### Fase 8 — Início

- [x] Seção de atrasados no topo ([§5.1](#51-decididas)), sobre a rota `overview.pending` e o view-model do desktop: itens vencidos e não pagos (nome, data, "há N dias", conta, valor), totais a pagar e a receber, "Marcar como pago/recebido" com "Desfazer", e o que ainda vence até o fim do mês. Sem atrasos, a seção mostra "Nada atrasado"
- [x] Saldo consolidado com o previsto, contas compactas (investimentos fora do total), faturas do mês, com os view-models do desktop (`overviewView`)
- [ ] Testes de tela e fluxo Maestro: marcar um atrasado como pago e desfazer — os testes de tela estão feitos; o fluxo Maestro depende de criar um lançamento vencido pela tela e entra com a Fase 10

Como ficou:

- **Atrasados:** o selo do desktop vira o topo da seção (mesmo texto, `pendingBadge`), seguido
  das linhas do `pendingPanel`, cada uma com a ação embaixo. A linha de fatura leva à aba
  Cartões; a fatura certa passa a abrir quando a Fase 13 fizer a tela dela.
- **Contas:** as fora do total ficam num grupo "Fora do saldo total", como no desktop; tocar
  numa conta leva à aba Contas (o extrato da conta é da Fase 12).
- **Cenário de teste** (`test/support/scenario.ts`), o mesmo do `ClientWorld` do `client`,
  para as telas dos dois apps serem testadas sobre os mesmos números.

### Fase 9 — Transações

- [x] `MobileTransacoes`: lista do mês em `FlashList`, agrupada por dia, entrada/saída sem depender da cor (sinal, ⇄, rótulo); filtros em folha inferior e busca, pelos view-models do `client` (`transactionTable`, `movementList`)
- [x] Compras do cartão agrupadas na linha da fatura, como no desktop (Fase 11.1); tocar na linha abre `MobileFatura` ([§5.1](#51-decididas)) — por enquanto leva à aba Cartões; a fatura certa abre com a Fase 13
- [x] `MobileTransacaoDetalhe`: dados do lançamento, marcar pago/recebido, editar, excluir (com o escopo da Fase 11 quando for recorrente)
- [x] Testes de tela e fluxo Maestro: filtrar, marcar pago, excluir — os de tela; o fluxo Maestro entra junto com o do lançamento (Fase 10), que cria os dados pela tela

Como ficou:

- **Mesma tabela do desktop:** o hook `useTransactionTable` faz as mesmas consultas e chama o
  `buildTransactionTable`; o `useMonthInvoices` saiu do desktop para o `client`.
- **Novo no `client`:** `groupTransactionsByDay` e `formatWeekdayDayMonth` ("Seg, 12/10") e
  `transactionTotals`, que soma entradas e saídas com a mesma regra do resultado (sem as
  transferências dentro do perfil), para os três números do topo sempre fecharem.
- **Detalhe:** monta a linha pelo mesmo `buildTransactionTable` (sem as faturas do mês, para a
  compra no cartão aparecer ela mesma); "Marcar como pago" segue o `movementPermissions` do
  desktop, e a exclusão usa o texto do `describeTransactionDeletion`. Anexos (no mockup) não
  existem no núcleo e ficaram de fora.
- **Filtros:** cada escolha abre uma folha por cima da de filtros e muda a lista na hora.

### Fase 10 — Lançamento

- [x] `MobileLancamento` sobre os mesmos schemas Zod e o mesmo editor do desktop (`transactionEditor`): despesa, receita, transferência; valor pelo `parseMoneyInput`; teclado numérico
- [x] Fatura sugerida (`invoices.suggest`) para compra no cartão
- [x] Atalho débito/crédito com conta e cartão padrão; nome sugerido (`transactions.nameSuggestions`) só no lançamento novo (regras da Fase 15.2 do desktop)
- [x] Tags, meta (`goals.options`) e, no perfil empresarial, sócio
- [ ] Testes de tela e fluxo Maestro: do "+" ao lançamento no extrato da conta — os de tela estão feitos; os fluxos Maestro das Fases 8 a 10 ficam para quando o Maestro puder rodar fora do CI (não está na imagem do devcontainer), para não entrarem no CI sem validação

Como ficou:

- **Leitura do formulário no `client`:** `transactionForm` e `invoiceForms` saíram do desktop,
  com o `coreErrorField` (erro do núcleo → campo), o mapa `TRANSACTION_FIELD_BY_CORE_FIELD`, o
  `useInvoiceChoice` (fatura sugerida, escolhas e aviso de reabertura) e o
  `suggestedSourceOption`. O `client` reexporta `feedsGoal`, `movesToDestination` e
  `withdrawsFromGoal` do núcleo, para as telas do celular não importarem o núcleo.
- **Uma rota para criar e editar:** `/new-transaction`, e `?id=` abre a edição pelo detalhe. O
  tipo não muda na edição, como no desktop.
- **Valor:** campo com o teclado decimal do sistema, e não o teclado próprio do mockup; o valor
  com o sinal e a etiqueta "estorno" aparecem embaixo (`previewTransactionValue`), e o "±"
  inverte o sinal.
- **Data:** sem módulo nativo de data, uma folha com o calendário do mês (`monthGrid`) e o
  rótulo "Hoje, 06/10" (`formatDateChoice`), os dois no `client`.
- **Escolhas longas** (contas, categorias) em folha com busca (`matchesAllTerms`), tags em folha
  de múltipla escolha; perfil, encargos, meta, sócio e descrição em "Mais detalhes".
- **Repetir e editar ocorrência de série** entraram na Fase 11.

### Fase 11 — Recorrências

- [x] `MobileParcelar`: parcelado e fixo, com a prévia (`recurrences.preview`)
- [x] `MobileEscopo`: "somente esta", "esta e as futuras", "todas" na edição e na exclusão (`recurrences.planUpdate`, `recurrences.planDelete`)
- [x] Testes: os casos de mesa da Fase 9.2 do desktop pela tela — parcelar em 3x com revisão, editar só esta ocorrência e excluir esta e as futuras com revisão

Como ficou:

- **Mesmo fluxo do desktop:** criar uma série passa pela revisão (`recurrences.planCreate`);
  editar uma ocorrência pergunta o escopo, e fora "somente esta" revisa o que muda; mudar a
  repetição vai direto à revisão de "esta e as futuras", e mudar o perfil, à de "todas". Os
  textos vêm do `client` (`scopeChoices`, `describeSeriesPlan`, `describeRepeatPreview`); o
  `repeatPreviewInput` saiu do desktop para o `client`.
- **Repetir** é uma linha do formulário ("Parcelado · 12x mensal") que abre uma folha com o
  tipo, a frequência, as parcelas ou o fim e a prévia.
- **Testes:** o preset do jest-expo usa temporizadores falsos, e um `waitFor` com função
  assíncrona deixava o teste seguinte sem montar o app; os testes esperam o estado da tela e
  consultam o núcleo depois. O "hoje" das telas é fixado por um `Date` próprio (`fixToday`).

### Fase 12 — Contas e extrato da conta

- [x] `MobileContas`: lista com consolidado e previsto do mês, saldo zero esmaecido, desativadas à parte, selo "Padrão"
- [x] `MobileExtrato`: extrato da conta no mês (`statements.get`), toque na fatura leva a `MobileFatura`
- [x] Criar, editar, desativar, reativar, usar como padrão e excluir em cadeia, com o impacto (`accounts.deletionImpact`) antes de confirmar
- [x] Testes de tela

Como ficou:

- **Lista:** as ativas com o saldo do fim do mês e, numa seção "Desativadas", as
  desativadas. A conta fora do total e a conta zerada (consolidado e previsto) ficam
  esmaecidas. O total mostra também o previsto (decisão de interface 6); o mockup mostra só
  o consolidado.
- **Extrato:** o resumo em 2×2 do mockup, com o previsto também em entradas e saídas, como
  no desktop, e os movimentos pelo `buildStatementTable` do `client`. O lançamento abre o
  detalhe **na pilha da aba Contas** (`/accounts/transaction/[id]`), para o "voltar" devolver
  ao extrato. A fatura leva à aba Cartões até a Fase 13 criar o `MobileFatura`. Sem o link
  "Ver todos os movimentos" do mockup: o extrato já lista todos.
- **Ações:** o mockup não desenha as ações da conta; ficam num "⋯" no cabeçalho do extrato,
  numa folha (editar, padrão, desativar/reativar, excluir), com o "+" da lista para criar.
  O formulário de conta (`accountForm`, `ACCOUNT_FIELD_BY_CORE_FIELD`) saiu do desktop para o
  `client`. A exclusão repete o alerta do desktop numa folha (`DeletionSheet`, que a Fase 13
  reaproveita no cartão): o impacto contado, as contas afetadas, digitar o nome e
  "Desativar em vez disso".

### Fase 13 — Cartões, fatura e pagamento

- [ ] `MobileCartoes`: fatura do mês, situação, limite usado, selo "Padrão"
- [ ] `MobileFatura`: lançamentos, próximas faturas, reabrir
- [ ] `MobilePagarFatura`: pagamento total e parcial
- [ ] Criar, editar, desativar, reativar, usar como padrão e excluir em cadeia
- [ ] Testes de tela e fluxo Maestro: pagar a fatura e ver o saldo da conta pagadora

### Fase 14 — Metas

- [ ] Apresentar a tela ao usuário, que a analisa antes do código ([pendência 1](#52-decisões-pendentes))
- [ ] `MobileMetas`: lista com progresso → detalhe com quanto falta, data-alvo, ritmo necessário e contribuições; tipos, retirada, arquivar e desarquivar
- [ ] Testes de tela

### Fase 15 — Cadastros: perfis e categorias

- [ ] `MobileCadastros` como índice; perfis (criar, renomear, moeda só sem lançamentos); categorias → detalhe com subcategorias, mover e excluir — no modelo das demais telas mobile, com as informações das telas do desktop ([§5.1](#51-decididas))
- [ ] Testes de tela

### Fase 16 — Tags e Anotações

- [ ] `MobileTags`: lista + folha de edição
- [ ] `MobileAnotacoes` e `MobileAnotacaoEditar`: primeira linha como título, editor de texto livre
- [ ] Testes de tela

### Fase 17 — Sócios

- [ ] `MobileSocios`, só no perfil empresarial: nome até 100 caracteres, participação com soma ao vivo e barra de divisão, salvar só com 100%
- [ ] Testes de tela

### Fase 18 — Ajustes

- [ ] Tema; versões do app, do núcleo e do schema
- [ ] Exportar a cópia (`VACUUM INTO` num arquivo temporário → folha de compartilhamento do sistema → arquivo removido); data da última cópia nas preferências. Sem lembrete periódico ([§5.1](#51-decididas))
- [ ] Importar a cópia (seletor de documentos → validação do arquivo, schema não mais novo que o app → backup → substituição → reabertura do núcleo), com o aviso da [§3](#3-relação-com-a-sincronização)
- [ ] Relatar problema: o log do app pela folha de compartilhamento
- [ ] Testes de tela e fluxo Maestro da exportação

### Fase 19 — Empacotamento e validação

- [ ] APK de release assinado com uma chave local fora do repositório (caminho e senha por variável de ambiente), `pnpm dist:mobile`
- [ ] Teste do APK de release no emulador do CI (Maestro: primeiro uso → lançamento → fatura paga)
- [ ] **Teste de paridade:** importar no celular a cópia do banco real do desktop e conferir, tela a tela, saldos de contas, faturas e metas de três meses — centavo a centavo
- [ ] Repetir a medição da Fase 5 com o app completo e atualizar o registro
- [ ] Contar as linhas de núcleo e de adaptadores e registrar na [mobile-shell-design §3.2](mobile-shell-design.md#32-o-inventário-do-que-é-compartilhado)

---

## 7. Critério de pronto do MVP

- Do primeiro uso ao lançamento, à fatura paga e à meta, tudo pelo celular, sem tocar no banco à mão.
- A cópia do banco do desktop, importada no celular, mostra os mesmos números (Fase 19).
- p95 das chamadas interativas ≤ 50 ms no aparelho de referência, medido e registrado.
- Contrato do adaptador e vetores de ouro verdes no emulador do CI.
- Tema claro e escuro em todas as telas; nenhuma cor literal fora de `packages/tokens`.
- `pnpm check` verde, com os testes de tela e os fluxos Maestro.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Metro e o pnpm isolado não se entenderem (symlinks, duas cópias de React, imports `.ts`) | Primeira tarefa da Fase 4, antes de qualquer tela; `node-linker=hoisted` como alternativa, perguntada antes por afetar o workspace inteiro |
| NativeWind 5 ainda imaturo no SDK escolhido | NativeWind 4 com saída em JS do gerador de tokens; `StyleSheet` gerado dos tokens como última rota ([mobile-shell-design §9](mobile-shell-design.md#9-telas-e-estilo)) |
| Hermes estourar o orçamento | Fase 5 é portão: as telas só começam com o número em mãos; `WorkerCoreClient` como rota de escape, trocado só na raiz |
| Emulador no container não abrir janela ou ficar lento (GPU, KVM) | Validado na Fase 0; `-gpu swiftshader_indirect` como alternativa sem GPU; a lógica e as telas testadas no Node (Vitest e jest-expo) cobrem a maior parte das mudanças sem aparelho |
| Toolchain Android pesada no container | Camada própria no `Dockerfile` e volume para o cache do Gradle; espaço em disco sobra |
| Trocar `localeCompare` mudar a ordem de listas no desktop | Comparador com dobra de acento e caixa, com testes que fixam a ordem atual |
| Banco do celular divergir do desktop depois de importar a cópia | É esperado até o sync; aviso na tela e [§3](#3-relação-com-a-sincronização). O banco de teste é descartado ao entrar no grupo |
| React do SDK do Expo diferente do React do desktop | O `client` aceita `^19.2` como dependência par; conferir na Fase 4 e, se o SDK exigir outra versão maior, decidir antes de seguir |
