# App do celular (Android)

Expo SDK 58 (Nova Arquitetura e Hermes), Expo Router, NativeWind 4 sobre os tokens de
`packages/tokens`, e o núcleo rodando na própria thread JavaScript, sobre o `expo-sqlite`
síncrono (`packages/sqlite-expo`). Plano: [mobile-mvp-plan.md](../../docs/plans/mobile-mvp-plan.md).

## Ciclo de desenvolvimento no devcontainer

Validado na Fase 0 do plano, com o emulador do container:

1. `pnpm emulator:android` num terminal próprio (cria o AVD na primeira vez).
2. `pnpm build:mobile` gera o development build (`android/` vem do `expo prebuild` e não é
   versionado); instale com
   `adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
   O primeiro build leva uns 6 minutos; os seguintes usam o cache do Gradle no volume.
3. `adb reverse tcp:8081 tcp:8081`, para o emulador alcançar o Metro do container.
4. `pnpm dev:mobile` sobe o Metro. **Não** suba com `CI=1`: ele desliga o *watch mode* e,
   com ele, o *fast refresh*.
5. Abra o app pelo link
   `exp+finance://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`
   (`adb shell am start -a android.intent.action.VIEW -d '<link>'`) ou pela lista do próprio
   development build.

No celular (a partir da Fase 5), o mesmo caminho com `adb pair` + `adb connect` sem fio e o
`adb reverse` do passo 3.

## Como o app é montado

- `app/` — rotas do Expo Router; só montam telas de `src/screens`. As abas ficam em
  `app/(tabs)/<aba>/`, cada uma com a própria pilha, e o lançamento em `app/new-transaction.tsx`,
  por cima delas. Os caminhos usados nas telas vêm de `src/shell/routes.ts`.
- `src/shell/` — o que toda tela compartilha: perfil ativo, mês de referência (nas preferências
  do aparelho, `preferences.json`), cabeçalho, faixa do mês, barra inferior e "+".
- `src/ui/` — componentes base (`Sheet`, `Button`, `TextField`, `SelectField`, estados), com
  alvo de toque mínimo de 44 px.
- `src/startup/openMobileCore.ts` — raiz de composição, o único arquivo que conhece o núcleo:
  abre o banco, roda a sequência de abertura do `client` (a mesma do desktop) e entrega às
  telas um `CoreClient` com agendamento pós-frame. O lint recusa `@finance/core` e o banco
  em qualquer outro lugar.
- `metro.config.js` — resolve os pacotes que o app declara (React, Expo, os módulos nativos,
  TanStack Query) sempre a partir do app. Sem isso, o modo isolado do pnpm levaria ao bundle
  duas variantes de `react-native` e do `expo-modules-core`, uma pelo `client` e outra pelo
  `sqlite-expo`. É a alternativa ao `node-linker=hoisted`, que mudaria o monorepo inteiro.
- Dependências que parecem sobrar, mas não sobram: `react-native-css-interop`,
  `babel-preset-expo` e `@babel/plugin-transform-react-jsx` são carregados pelo nome a partir
  do `babel.config.js` (o NativeWind os pede sem declarar). No modo isolado do pnpm, sem elas
  no `package.json` do app, o bundle de release do Gradle falha.
- Cores, tamanhos e raios só pelas classes dos tokens (`bg-surface`, `text-13`,
  `rounded-8`); o teste `tokensOnly` acusa cor literal e classe fora da escala.

## Medição da Fase 5

Com o aparelho no `adb` (o S23 FE por `adb pair` + `adb connect`, ou o emulador para ensaio):

```sh
pnpm db:history /tmp/history.sqlite # banco de dez anos, uma vez
pnpm --filter @finance/mobile build:benchmark # development build + APK de release com a medição
pnpm bench:android /tmp/history.sqlite --replace
```

`--replace` desinstala o app e apaga os dados dele antes de medir; sem a opção, o script
recusa rodar com o app instalado. A linha de base do Node, com o mesmo roteiro, é
`pnpm bench:core /tmp/history.sqlite`. Toda abertura registra no logcat
`[abertura] primeira-tela …`, também fora da medição.

## APK de release

O APK que vai para o celular por instalação direta, assinado com a sua chave:

```sh
# Uma vez: a chave, FORA do repositório (o script recusa um keystore dentro dele)
keytool -genkeypair -v -keystore ~/chaves/finance-release.jks -alias finance \
    -keyalg RSA -keysize 4096 -validity 10000

export FINANCE_ANDROID_KEYSTORE=~/chaves/finance-release.jks
export FINANCE_ANDROID_KEYSTORE_PASSWORD='…'
export FINANCE_ANDROID_KEY_ALIAS=finance
export FINANCE_ANDROID_KEY_PASSWORD='…'
pnpm dist:mobile # apps/mobile/dist/finance-<versão>.apk
```

O script confere as variáveis, abre o keystore antes do build (senha ou alias errados falham
em um segundo), gera o release para `arm64-v8a` (aparelho) e `x86_64` (emulador) e recusa o
APK que tenha saído com a chave de depuração. No fim, mostra o SHA-256 do certificado e do
APK. O `versionCode` vem da versão do `package.json` (`1.15.0` → `1015000`), então o Android
recusa instalar um APK mais antigo por cima.

- **Guarde a chave e as senhas com backup.** O Android só aceita a atualização de um app
  assinado pela mesma chave; sem ela, a única saída é desinstalar — e desinstalar apaga o
  banco do aparelho.
- **O APK distribuído e o development build não convivem.** Os dois usam o pacote
  `br.com.finance.app`, e o development build é assinado pela chave de depuração: instalar um
  por cima do outro falha com `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Trocar exige desinstalar
  e perder os dados; exporte a cópia do banco em Ajustes antes.
- Sem as variáveis, o Gradle continua assinando o release com a chave de depuração: é o que
  o CI e a medição da Fase 5 usam. Só o `pnpm dist:mobile` exige a chave.

## Testes

- `pnpm --filter @finance/mobile test` — Jest com jest-expo e React Native Testing Library,
  sobre o núcleo real em `better-sqlite3` em memória. `test/support/renderApp.tsx` monta o app
  inteiro (as rotas de `app/` pelo `renderRouter`).
- `.maestro/smoke.yaml` — teste de fumaça no emulador, rodado no CI pelo workflow `mobile`
  com o APK de release.
