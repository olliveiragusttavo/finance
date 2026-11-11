// @ts-check
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

/**
 * Pacotes que precisam existir uma vez só no bundle — o mesmo problema e a mesma solução do
 * `apps/mobile/metro.config.js`: no modo isolado do pnpm, o `sqlite-expo` e o `client` levariam
 * outra variante de `react-native`, do `expo-modules-core` e do `expo-sqlite`, e os módulos
 * nativos seriam registrados duas vezes. Fica copiado, e não importado do app, porque um app
 * não depende do outro e um pacote só para 30 linhas de configuração não se paga.
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

// Resolve todo import de um pacote da lista como se viesse do próprio app.
config.resolver.resolveRequest = (context, moduleName, platform) => {
    const name = packageNameOf(moduleName);
    const fromApp = name !== null && SINGLETONS.has(name) ? { ...context, originModulePath: path.join(projectRoot, 'package.json') } : context;
    return defaultResolve ? defaultResolve(fromApp, moduleName, platform) : fromApp.resolveRequest(fromApp, moduleName, platform);
};

// Os pacotes do workspace importam com extensão `.ts` (`./Money.ts`).
config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, 'ts', 'tsx'])];

module.exports = config;
