#!/usr/bin/env bash
# Medição da Fase 5 do mobile-mvp-plan no aparelho conectado ao adb (o S23 FE, ou o emulador
# para ensaio): leva o banco de dez anos ao app e mede, no APK de release, o tempo da abertura
# até a primeira tela interativa e o p95 das chamadas interativas.
#
# O banco entra por uma ação só de build de desenvolvimento, como o plano pede: o development
# build é depurável e aceita o `run-as`, que copia o arquivo para dentro do diretório do app; o
# APK de release, que não aceita, é instalado por cima com `install -r`. Os dois são assinados
# com a mesma chave de depuração do `expo prebuild`, então o Android mantém os dados.
#
# Uso: pnpm bench:android <banco.sqlite> [--replace]
#   banco.sqlite: gerado com `pnpm db:history <arquivo>`
#   --replace: apaga o app já instalado e os dados dele (sem a opção, o script recusa)
# Antes: `pnpm --filter @finance/mobile build:benchmark`, que gera os dois APKs num build só —
# o `expo prebuild` apaga as saídas do Gradle, então dois comandos separados deixariam só o último.
set -euo pipefail

package="br.com.finance.app"
activity="$package/.MainActivity"
android_dir="$(cd "$(dirname "$0")/../apps/mobile/android" 2>/dev/null && pwd || true)"
debug_apk="$android_dir/app/build/outputs/apk/debug/app-debug.apk"
release_apk="$android_dir/app/build/outputs/apk/release/app-release.apk"
# Aberturas medidas: a primeira, depois de instalar, paga a compilação inicial do ART e não é
# típica; a mediana das seguintes é o número que vai para o design.
launches=6

database="${1:-}"
replace="${2:-}"
if [[ -z "$database" || ! -f "$database" ]]; then
    echo "uso: pnpm bench:android <banco.sqlite> [--replace]  (gere o banco com pnpm db:history)" >&2
    exit 2
fi
for apk in "$debug_apk" "$release_apk"; do
    if [[ ! -f "$apk" ]]; then
        echo "falta $apk; gere os dois com pnpm --filter @finance/mobile build:benchmark" >&2
        exit 2
    fi
done

# O banco real do usuário nunca é apagado por engano: com o app instalado, só com --replace.
if adb shell pm list packages | grep -qx "package:$package"; then
    if [[ "$replace" != "--replace" ]]; then
        echo "$package já está instalado; --replace apaga o app e os dados dele antes de medir." >&2
        exit 1
    fi
    adb uninstall "$package" >/dev/null
fi

echo "== aparelho"
echo "modelo: $(adb shell getprop ro.product.model) | Android $(adb shell getprop ro.build.version.release) | One UI $(adb shell getprop ro.build.version.oneui) | build $(adb shell getprop ro.build.display.id)"

echo "== banco de dez anos pelo development build"
adb install "$debug_apk" >/dev/null
adb push "$database" /data/local/tmp/finance-history.sqlite >/dev/null 2>&1
adb shell run-as "$package" sh -c "'mkdir -p files/SQLite && rm -f files/SQLite/finance.sqlite-wal files/SQLite/finance.sqlite-shm && cat /data/local/tmp/finance-history.sqlite > files/SQLite/finance.sqlite'"
adb shell rm /data/local/tmp/finance-history.sqlite

echo "== APK de medição (release) por cima, com os dados"
adb install -r "$release_apk" >/dev/null

# Espera uma linha do app no logcat.
#   $1 trecho procurado; $2 limite em segundos.
wait_for_log() {
    local deadline=$((SECONDS + $2))
    while ((SECONDS < deadline)); do
        if adb logcat -d -s ReactNativeJS:V | grep -q "$1"; then
            return 0
        fi
        sleep 0.5
    done
    echo "o app não registrou \"$1\" em $2 s; veja adb logcat -s ReactNativeJS:V" >&2
    return 1
}

echo "== abertura até a primeira tela interativa"
for ((i = 1; i <= launches; i++)); do
    adb shell am force-stop "$package"
    adb logcat -c
    started=$(adb shell 'date +%s%3N' | tr -d '\r')
    adb shell am start -n "$activity" >/dev/null
    wait_for_log '\[abertura\]' 120
    line=$(adb logcat -d -s ReactNativeJS:V | grep -o '\[abertura\].*' | head -1)
    shown=$(sed -E 's/.*epoch=([0-9]+).*/\1/' <<<"$line")
    echo "abertura $i: $((shown - started)) ms (${line#*epoch=$shown })"
done

echo "== chamadas interativas (40 rodadas cada, no app já aberto)"
wait_for_log '\[medição\] fim' 600
adb logcat -d -s ReactNativeJS:V | grep -o '\[medição\].*' | grep -v '\[medição\] fim'
