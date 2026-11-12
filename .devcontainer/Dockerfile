# Ambiente de desenvolvimento do monorepo: nada de Node, pnpm ou compiladores no host.
#
# Por que multi-stage e imagens base fixadas por digest: a imagem final passa de 16 GB, e
# a tag `node:24-bookworm` muda de digest várias vezes por semana. Com a tag solta, cada
# mudança invalidava todas as camadas e o rebuild baixava tudo de novo (11–13 min). Agora:
# - as bases têm digest fixo e só mudam quando alguém atualiza a linha do FROM;
# - o toolchain Android (o grosso do tamanho) é montado em stages próprios sobre o Debian
#   e entra com `COPY --link`, que não depende das camadas anteriores: trocar a base do
#   Node reaproveita o SDK, o NDK e o emulador já construídos;
# - o apt usa cache do BuildKit, então uma camada invalidada reinstala os pacotes sem
#   baixá-los de novo.
#
# Para atualizar uma base: `docker buildx imagetools inspect node:24-bookworm` (ou
# debian:bookworm), copiar o Digest para o FROM e reconstruir.

# ---------------------------------------------------------------------------------------
# Toolchain Android para gerar o APK do apps/mobile aqui dentro (`expo prebuild` + Gradle),
# mantendo a regra de nada de compiladores no host (docs/plans/mobile-mvp-plan.md, Fase 0).
# As versões seguem o Expo SDK 58 (React Native 0.88); ao trocar de SDK, confira o
# gradle/libs.versions.toml do react-native e ajuste os pacotes abaixo.
#
# Stage base dos dois stages Android: só o necessário para rodar o CLI `android`, que
# instala o resto. Debian puro, e não a imagem do Node, para o SDK não ser reconstruído
# quando a base do Node mudar.
# - JDK 17: o CLI `android` roda na JVM (e é o mesmo JDK que a imagem final usa no Gradle).
# - cmdline-tools: versão fixa e conferida pelo SHA-1 publicado pelo Google, para a imagem
#   não mudar sozinha entre rebuilds.
# ---------------------------------------------------------------------------------------
FROM debian:bookworm@sha256:268fb24c39bca92d326dd83ea3abebe4a3f7751c804ffef23bb6d857dd343ff8 AS android-tools

# A imagem Debian apaga os .deb depois de cada install (docker-clean); sem tirar isso, o
# cache do apt montado pelo BuildKit ficaria sempre vazio.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip openjdk-17-jdk-headless

ENV ANDROID_HOME=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin
ARG ANDROID_CMDLINE_TOOLS_BUILD=16111833
ARG ANDROID_CMDLINE_TOOLS_SHA1=e025545c62a8e64c7559119566a569fb1dec5f60
RUN curl -fsSL -o /tmp/cmdline-tools.zip \
        "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_BUILD}_latest.zip" \
    && echo "${ANDROID_CMDLINE_TOOLS_SHA1}  /tmp/cmdline-tools.zip" | sha1sum -c - \
    && mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools \
    && mv /tmp/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
    && rm -rf /tmp/cmdline-tools /tmp/cmdline-tools.zip

# Pacotes de build pelo CLI `android sdk`, que substituiu o sdkmanager (hoje obsoleto) e não
# pergunta nada: aceita as licenças e grava licenses/ no SDK, que o Gradle exige para usar
# os pacotes — sem isso o build pararia esperando um terminal que não existe.
# --no-metrics desliga a coleta de uso que o CLI faz por padrão.
# - platform-tools: o adb, para instalar o APK e ligar o aparelho ao Metro.
# - platforms/android-37.0: o compileSdk 37 do SDK; o targetSdk 36 não pede plataforma própria.
# - build-tools/37.0.0: aapt2, zipalign e apksigner na versão que o Expo fixa.
# - ndk/27.1.12297006: o NDK que o Expo impõe a todos os módulos nativos (Hermes, expo-sqlite).
# - cmake/3.22.1: o CMake padrão do AGP, usado pelos módulos com código C++.
FROM android-tools AS android-build
RUN android --no-metrics --sdk=${ANDROID_HOME} sdk install \
        platform-tools \
        platforms/android-37.0 \
        build-tools/37.0.0 \
        ndk/27.1.12297006 \
        cmake/3.22.1

# Emulador para testar o app sem o celular, acelerado pelo /dev/kvm repassado no compose
# (o aparelho físico fica para a medição e a validação final — mobile-mvp-plan §2).
# Stage separado porque a imagem de sistema tem ~4 GB descompactada: mudar os pacotes de
# build acima não obriga a baixá-la de novo. A imagem segue o targetSdk 36, a versão em que
# o app declara se comportar; google_apis em vez da AOSP pura porque traz o WebView e os
# serviços do Google que um aparelho real tem. O AVD em si é criado pelo
# scripts/android-emulator.sh, no volume do ~/.android, e não aqui.
FROM android-tools AS android-emulator
RUN android --no-metrics --sdk=${ANDROID_HOME} sdk install \
        emulator \
        system-images/android-36/google_apis/x86_64

# ---------------------------------------------------------------------------------------
# Imagem final.
#
# Imagem Debian (glibc) completa em vez da -slim ou Alpine porque o better-sqlite3 é
# módulo nativo: o binário pré-compilado só existe para glibc, e quando não houver um
# para a versão do Node (ou do Electron) ele compila do fonte com python3, make e g++,
# que já vêm na imagem completa.
# ---------------------------------------------------------------------------------------
FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496

# SDK Android dos stages acima. `--link` torna essas camadas independentes da base: trocar
# o digest do Node não as invalida. O dono é o usuário node (UID/GID 1000, numérico porque
# `--link` não consulta o /etc/passwd da imagem) para o AGP baixar sozinho um pacote que uma
# versão nova do SDK venha a pedir; o que ele baixar some no rebuild, sinal para atualizar
# a lista do stage android-build. Pastas copiadas uma a uma do stage do emulador porque o
# restante dele (cmdline-tools, licenças) é igual ao do stage de build.
ENV ANDROID_HOME=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator
COPY --link --chown=1000:1000 --from=android-emulator ${ANDROID_HOME}/system-images ${ANDROID_HOME}/system-images
COPY --link --chown=1000:1000 --from=android-emulator ${ANDROID_HOME}/emulator ${ANDROID_HOME}/emulator
COPY --link --chown=1000:1000 --from=android-build ${ANDROID_HOME} ${ANDROID_HOME}

# Mesmo ajuste do stage android-tools: mantém os .deb no cache do BuildKit entre builds.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

# Wine para gerar o instalador do Windows (`pnpm dist:win`): o electron-builder monta o
# desinstalador do NSIS executando o próprio instalador. O stub do NSIS é 32-bit, por isso
# entra também o wine32 (arquitetura i386); só com o wine64 a execução falha.
# Primeira camada da imagem final por ser a maior (~1,5 GB) e a que menos muda.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends wine wine32 wine64

# Bibliotecas do sistema, numa camada só: com o cache do apt, mudar a lista custa só a
# instalação, sem novo download.
# - Electron: bibliotecas que o Chromium carrega ao abrir a janela. libsecret-1-0 é exigida
#   pelo safeStorage (chaveiro do sistema), usado no pareamento do sync; mesa/EGL permitem a
#   aceleração pela GPU repassada em /dev/dri.
# - JDK 17: é o jvmToolchain do React Native e o mínimo do Gradle 9 e do AGP 9. Headless
#   porque nada aqui abre janela Java.
# - libxkbfile1, libxcb-cursor0 e libpulse0: o emulador as carrega ao abrir (teclado e
#   plugin xcb do Qt 6.5+, áudio); o resto do que ele usa já vem com as do Electron. A
#   libxcb-cursor0 é carregada só em tempo de execução, por isso não aparece no ldd: sem
#   ela, o Qt não abre a janela e o emulador aborta.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        libasound2 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libegl1 \
        libgbm1 \
        libgl1-mesa-dri \
        libgtk-3-0 \
        libnss3 \
        libsecret-1-0 \
        libx11-xcb1 \
        libxkbcommon0 \
        libxshmfence1 \
        libxss1 \
        fonts-liberation \
        openjdk-17-jdk-headless \
        libxkbfile1 \
        libxcb-cursor0 \
        libpulse0

# Prefixo do Wine no home do container, fora do repositório; ele é criado no primeiro
# `dist:win`. WINEDEBUG=-all tira os avisos do Wine, que soterram a saída do electron-builder.
# LANG=C.UTF-8 porque a imagem vem sem locale (POSIX) e o makensis aborta com "main argv
# conversion failed" ao receber argumento não ASCII, como o productName "Finanças".
ENV WINEPREFIX=/home/node/.wine \
    WINEDEBUG=-all \
    LANG=C.UTF-8

# O pnpm vem pelo corepack, que lê a versão exata do campo packageManager do
# package.json — assim a versão fica num lugar só e não diverge da usada fora do container.
RUN corepack enable pnpm

# graphify: mapa de relacionamentos do código para análise de impacto em refatorações,
# acionado só pelo comando /impacto (.claude/commands/impacto.md). Instalado com o uv
# sobre o Python 3.11 da imagem, ambos com versão fixa, como o pnpm. Fica no fim da imagem
# porque é a ferramenta que mais troca de versão: atualizá-la não refaz as camadas pesadas.
#
# A saída fica no home do container, fora do repositório e fora dos volumes: o grafo
# (vários MB de JSON e HTML) não pode cair em buscas do Claude no projeto, e deve morrer
# junto com o container em vez de ficar gravado no host. Sem saída é só regerar.
# NO_AUTO_REFRESH impede o graphify de regravar skills nas pastas de configuração que
# detectar, porque o ~/.claude é montado do host; NO_TIPS tira dicas da saída do CLI,
# que o Claude leria como tokens inúteis.
COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /usr/local/bin/uv
RUN UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_DOWNLOADS=never \
    uv tool install --no-cache graphifyy==0.9.82
ENV GRAPHIFY_OUT=/home/node/.cache/graphify \
    GRAPHIFY_NO_AUTO_REFRESH=1 \
    GRAPHIFY_NO_TIPS=1

# O usuário node da imagem já tem UID 1000, igual ao do host: os arquivos criados pelo
# container no repositório montado ficam com o dono certo, sem precisar de chown.
#
# Os diretórios abaixo são criados aqui, com dono node, porque o Docker copia o dono do
# ponto de montagem da imagem para o volume nomeado na primeira vez — sem isso o volume
# nasce como root e o pnpm não consegue escrever no store. O XDG_RUNTIME_DIR precisa ser
# 0700 e do próprio usuário, senão o Chromium recusa o socket do Wayland.
RUN mkdir -p /home/node/.pnpm-store /home/node/.cache/node/corepack /home/node/.gradle \
        /home/node/.android /tmp/runtime-node \
    && chown -R node:node /home/node/.pnpm-store /home/node/.cache /home/node/.gradle \
        /home/node/.android /tmp/runtime-node \
    && chmod 0700 /tmp/runtime-node

USER node
