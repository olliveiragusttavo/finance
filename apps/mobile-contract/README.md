# App de contrato (Android)

Prova no Hermes, com o `expo-sqlite` real, o que o Vitest só prova no Node
([mobile-shell-design §8](../../docs/plans/mobile-shell-design.md#8-paridade-entre-runtimes);
[mobile-mvp-plan, Fase 3](../../docs/plans/mobile-mvp-plan.md)):

1. a suíte de contrato da porta `Database` (`@finance/core/contract`) contra o
   `ExpoSqliteDatabase`, com a versão mínima do SQLite e o `STRICT`;
2. os vetores de ouro do núcleo e do `client` (arredondamento do `Money`, parcelas, UUID v5,
   ordenação de nomes, formatadores), gerados no Node e recalculados no aparelho.

Ao abrir, mostra **Contrato: passou** ou **Contrato: falhou** com a lista do que divergiu, e
grava o mesmo resultado no log (`adb logcat -s ReactNativeJS:V | grep contrato`). Não tem
router nem NativeWind: cada dependência a menos é uma causa a menos de falha que não seja do
núcleo ou do banco.

## Rodar no emulador

```sh
pnpm build:mobile-contract
adb install -r apps/mobile-contract/android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n br.com.finance.contract/.MainActivity
```

É APK de release, com o bundle dentro: o contrato precisa rodar o bytecode do Hermes, como o
app instalado, sem o Metro. No CI, o workflow `mobile` roda o fluxo `.maestro/contract.yaml`.

## Quando falha

- **Vetor de ouro:** a linha diz o grupo, a entrada e os dois valores (`Node ..., aqui ...`).
  Reproduza o caso no Vitest e corrija o código para não depender do runtime; nunca
  regenere o arquivo para aceitar a saída do Hermes.
- **Banco:** a linha diz o caso do contrato e a mensagem do driver. A correção é no
  adaptador (`packages/sqlite-expo`), com um teste no dublê `FakeExpoConnection` que
  reproduza o comportamento do driver.
- `pnpm --filter @finance/mobile-contract test` roda o mesmo contrato no Node, sobre o
  `better-sqlite3`: se passa lá e falha aqui, a causa é do Hermes ou do `expo-sqlite`.
