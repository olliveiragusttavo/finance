#!/usr/bin/env bash
# Abre o emulador Android do desenvolvimento, criando o AVD na primeira vez.
#
# Existe para testar o app mobile sem o celular (mobile-mvp-plan §2, "Onde roda"): o SDK,
# o emulador e a imagem de sistema vêm na imagem do devcontainer, mas o AVD guarda o
# estado do aparelho virtual (apps instalados, dados, snapshot de boot rápido) e por isso
# mora no volume do ~/.android, que sobrevive ao rebuild. Criá-lo aqui, sob demanda, evita
# um AVD dentro da imagem que voltaria ao zero a cada rebuild.
#
# Uso: pnpm emulator:android [opções extras do emulador, ex.: -wipe-data]
# Roda em primeiro plano; deixe num terminal próprio. O adb já enxerga o emulador sozinho.
set -euo pipefail

# Nome fixo para o AVD ser reaproveitado entre execuções e rebuilds.
avd_name="finance"
# A mesma imagem instalada no Dockerfile; trocar uma exige trocar a outra.
system_image="system-images;android-36;google_apis;x86_64"
# Pixel 7: tela de 1080 x 2400 em 6,3", a mais próxima do Galaxy S23 FE (aparelho de
# referência, mobile-mvp-plan §5.1) entre os perfis que o avdmanager conhece.
device_profile="pixel_7"

if [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
    echo "Sem acesso a /dev/kvm: reconstrua o devcontainer (o compose repassa o dispositivo e o grupo)." >&2
    exit 1
fi

if ! avdmanager list avd -c | grep -qx "$avd_name"; then
    # "no" recusa o perfil de hardware personalizado que o avdmanager oferece criar.
    echo no | avdmanager create avd --name "$avd_name" --package "$system_image" --device "$device_profile"
fi

# -no-audio: o container não tem o socket do PulseAudio do host, e o app não usa som;
# sem a opção, o emulador enche o log de erros de áudio.
exec emulator -avd "$avd_name" -no-audio "$@"
