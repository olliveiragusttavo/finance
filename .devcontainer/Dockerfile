# Ambiente de desenvolvimento do monorepo: nada de Node, pnpm ou compiladores no host.
#
# Imagem Debian (glibc) completa em vez da -slim ou Alpine porque o better-sqlite3 é
# módulo nativo: o binário pré-compilado só existe para glibc, e quando não houver um
# para a versão do Node (ou do Electron) ele compila do fonte com python3, make e g++,
# que já vêm na imagem completa.
FROM node:24-bookworm

# Bibliotecas que o Chromium do Electron carrega ao abrir a janela. Instaladas desde já
# para que o apps/desktop rode no container sem reconstruir a imagem quando entrar.
# libsecret-1-0 é exigida pelo safeStorage (chaveiro do sistema), usado no pareamento
# do sync; mesa/EGL permitem a aceleração pela GPU repassada em /dev/dri.
RUN apt-get update \
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
    && rm -rf /var/lib/apt/lists/*

# O pnpm vem pelo corepack, que lê a versão exata do campo packageManager do
# package.json — assim a versão fica num lugar só e não diverge da usada fora do container.
RUN corepack enable pnpm

# O usuário node da imagem já tem UID 1000, igual ao do host: os arquivos criados pelo
# container no repositório montado ficam com o dono certo, sem precisar de chown.
#
# Os diretórios abaixo são criados aqui, com dono node, porque o Docker copia o dono do
# ponto de montagem da imagem para o volume nomeado na primeira vez — sem isso o volume
# nasce como root e o pnpm não consegue escrever no store. O XDG_RUNTIME_DIR precisa ser
# 0700 e do próprio usuário, senão o Chromium recusa o socket do Wayland.
RUN mkdir -p /home/node/.pnpm-store /home/node/.cache/node/corepack /tmp/runtime-node \
    && chown -R node:node /home/node/.pnpm-store /home/node/.cache /tmp/runtime-node \
    && chmod 0700 /tmp/runtime-node

USER node
