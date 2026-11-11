// @ts-check

/**
 * Pacotes publicados sem compilar para CommonJS, que o Jest precisa passar pelo Babel. No modo
 * isolado do pnpm o caminho real é `node_modules/.pnpm/<pacote>@<versão>/node_modules/<pacote>`,
 * e o escopo vira `@escopo+nome` no primeiro segmento, por isso os dois formatos.
 */
const TRANSFORMED = [
    'react-native',
    '@react-native',
    '@react-native\\+',
    'expo',
    '@expo',
    '@expo\\+',
    // Dependência do núcleo (SHA-1 do UUID v5), publicada só como ESM.
    '@noble',
    '@noble\\+',
];

/**
 * Jest do app de contrato: confere no Node que o relatório e a tela funcionam sobre o
 * `better-sqlite3`, para que uma falha no emulador seja do Hermes ou do `expo-sqlite`, e não
 * do próprio app de contrato.
 *
 * @type {import('jest').Config}
 */
module.exports = {
    preset: 'jest-expo',
    testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
    transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/)?(?:${TRANSFORMED.join('|')}))`],
};
