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
    '@expo-google-fonts',
    'nativewind',
    'react-native-css-interop',
    'react-native-reanimated',
    'react-native-worklets',
    'react-native-safe-area-context',
    'react-native-screens',
    'react-native-svg',
    '@shopify',
    '@shopify\\+',
    // Dependência da navegação por abas do Expo Router, publicada só como ESM.
    'standard-navigation',
    'react-native-gesture-handler',
    // Dependência do núcleo (SHA-1 do UUID v5), publicada só como ESM.
    '@noble',
    '@noble\\+',
];

/**
 * Jest do app (mobile-mvp-plan §2, "Testes de tela"): jest-expo com React Native Testing
 * Library, e o núcleo real sobre `better-sqlite3` em memória atrás do `DirectCoreClient`, para
 * que a tela seja testada no Node contra as regras de verdade.
 *
 * @type {import('jest').Config}
 */
module.exports = {
    preset: 'jest-expo',
    testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
    setupFiles: ['<rootDir>/test/support/jestSetup.ts'],
    setupFilesAfterEnv: ['<rootDir>/test/support/jestAfterEnv.ts'],
    // Cada teste de tela monta o app inteiro; o padrão de 5 s não deixa folga para a espera das consultas.
    testTimeout: 20000,
    transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/)?(?:${TRANSFORMED.join('|')}))`],
};
