// @ts-check
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;

/**
 * Pacotes que precisam existir uma vez só no bundle: os que o app declara (React, Expo, os
 * módulos nativos, o TanStack Query) e os dois que todo módulo nativo importa por baixo.
 * No modo isolado do pnpm, `packages/sqlite-expo` e `packages/client` têm as próprias
 * dependências, e o mesmo `react-native` chega por duas variantes do store quando os
 * contextos de dependência par diferem; duas cópias registrariam os módulos nativos duas
 * vezes e quebrariam o contexto do React (mobile-mvp-plan, Fase 4).
 *
 * @type {ReadonlySet<string>}
 */
const SINGLETONS = new Set([
    ...Object.keys(JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).dependencies),
    'react-native',
    'expo-modules-core',
]);

/**
 * @param {string} moduleName Import como escrito no código (`react-native/Libraries/...`).
 * @returns {string | null} O nome do pacote, ou `null` para import relativo ou absoluto.
 */
function packageNameOf(moduleName) {
    if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
        return null;
    }
    const parts = moduleName.split('/');
    return moduleName.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
}

const config = getDefaultConfig(projectRoot);
const defaultResolve = config.resolver.resolveRequest;

/*
 * Resolve todo import de um pacote da lista como se viesse do próprio app, de onde quer que
 * venha (do `client`, do `sqlite-expo`, de outro pacote do store). É a alternativa ao
 * `node-linker=hoisted`, que mudaria a instalação do monorepo inteiro: aqui só o bundle do
 * celular é afetado.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
    const name = packageNameOf(moduleName);
    const fromApp = name !== null && SINGLETONS.has(name) ? { ...context, originModulePath: path.join(projectRoot, 'package.json') } : context;
    return defaultResolve ? defaultResolve(fromApp, moduleName, platform) : fromApp.resolveRequest(fromApp, moduleName, platform);
};

// Os pacotes do workspace importam com extensão `.ts` (`./Money.ts`), como o Node e o Vite
// do desktop; o Metro precisa saber que a extensão faz parte do nome.
config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, 'ts', 'tsx', 'cjs'])];

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
