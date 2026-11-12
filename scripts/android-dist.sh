#!/usr/bin/env bash
# APK de release distribuído do app do celular (mobile-mvp-plan, Fase 19): assinado com a chave
# do usuário, que fica fora do repositório, com o caminho e as senhas em variáveis de ambiente.
# É o APK que vai para o aparelho por instalação direta (mobile-shell-design §7).
#
# Uso: pnpm dist:mobile
#   FINANCE_ANDROID_KEYSTORE           caminho do keystore, fora do repositório
#   FINANCE_ANDROID_KEYSTORE_PASSWORD  senha do keystore
#   FINANCE_ANDROID_KEY_ALIAS          alias da chave
#   FINANCE_ANDROID_KEY_PASSWORD       senha da chave
# Saída: apps/mobile/dist/finance-<versão>.apk (arm64-v8a, do aparelho, e x86_64, do emulador).
#
# O Gradle lê as mesmas variáveis pelo plugin `withReleaseSigning` do app.config.ts. Sem elas o
# release sai com a chave de depuração, que serve ao CI e à medição, mas nunca à distribuição:
# por isso o script confere tudo antes do build e, depois, o certificado do APK gerado.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo/apps/mobile"

for name in FINANCE_ANDROID_KEYSTORE FINANCE_ANDROID_KEYSTORE_PASSWORD FINANCE_ANDROID_KEY_ALIAS FINANCE_ANDROID_KEY_PASSWORD; do
    if [[ -z "${!name:-}" ]]; then
        echo "falta a variável $name; veja \"APK de release\" em apps/mobile/README.md" >&2
        exit 2
    fi
done

keystore="$(realpath -e "$FINANCE_ANDROID_KEYSTORE" 2>/dev/null || true)"
if [[ -z "$keystore" ]]; then
    echo "keystore não encontrado: $FINANCE_ANDROID_KEYSTORE" >&2
    exit 2
fi
# A chave dentro do repositório acabaria num commit por um `git add .` distraído.
if [[ "$keystore" == "$repo"/* ]]; then
    echo "o keystore está dentro do repositório ($keystore); guarde-o fora dele" >&2
    exit 2
fi
# Senha ou alias errados falham aqui, em um segundo, e não no fim de um build de minutos.
if ! keytool -list -keystore "$keystore" -storepass:env FINANCE_ANDROID_KEYSTORE_PASSWORD -alias "$FINANCE_ANDROID_KEY_ALIAS" >/dev/null 2>&1; then
    echo "o keystore não abre com a senha informada ou não tem o alias $FINANCE_ANDROID_KEY_ALIAS" >&2
    exit 2
fi
export FINANCE_ANDROID_KEYSTORE="$keystore"

version="$(node -p "require('$app/package.json').version")"
echo "== APK de release $version"
cd "$app"
npx expo prebuild --platform android --no-install
# Sem a medição da Fase 5, mesmo que a variável tenha ficado no terminal do build:benchmark.
(cd android && env -u EXPO_PUBLIC_BENCHMARK ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64)

apk="$app/android/app/build/outputs/apk/release/app-release.apk"
apksigner="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
certificate="$("$apksigner" verify --print-certs "$apk")"
if grep -q "CN=Android Debug" <<<"$certificate"; then
    echo "o APK saiu assinado com a chave de depuração; confira o withReleaseSigning do app.config.ts" >&2
    exit 1
fi

mkdir -p "$app/dist"
output="$app/dist/finance-$version.apk"
cp "$apk" "$output"
echo "== pronto: $output"
grep -E "certificate (DN|SHA-256 digest)" <<<"$certificate"
sha256sum "$output"
