import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Regras de fronteira do núcleo (backend-design §3.1 e §3.4): o `core` roda igual no
 * Electron, no Hermes do React Native e num servidor, então não pode importar nada do
 * Node nem de uma plataforma, nem ler relógio ou aleatoriedade fora das portas. A regra
 * é verificada por lint, e não por disciplina, porque a quebra só apareceria no celular.
 * `localeCompare`, `Intl` e `toLocale*` ficam de fora pelo mesmo motivo: dependem do ICU
 * de cada runtime, e o Chromium e o Hermes ordenam e formatam diferente
 * (mobile-shell-design §8).
 */
const coreBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [
            { group: ['node:*'], message: 'O core não pode depender do Node (backend-design §3.1).' },
            { group: ['fs', 'path', 'crypto', 'os', 'electron', 'react-native', 'expo-*', 'better-sqlite3'], message: 'Plataforma entra no core só por portas (backend-design §3.4).' },
        ],
    }],
    'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date']", message: 'Use a porta Clock: datas são a maior fonte de bug em finanças (backend-design §3.4).' },
        { selector: "MemberExpression[object.name='Date'][property.name='now']", message: 'Use a porta Clock (backend-design §3.4).' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Use a porta IdGenerator (backend-design §3.4).' },
        { selector: "MemberExpression[object.name='crypto']", message: 'Use a porta IdGenerator: o React Native não tem crypto (backend-design §3.4).' },
        { selector: "MemberExpression[property.name='localeCompare']", message: 'Use compareNames ou compareCodeUnits de domain/shared/textOrder.ts: localeCompare muda com o ICU do runtime (mobile-shell-design §8).' },
        { selector: 'MemberExpression[property.name=/^toLocale/]', message: 'toLocale* formata pelo ICU do runtime e diverge entre Chromium e Hermes (mobile-shell-design §8).' },
    ],
    'no-restricted-globals': ['error',
        { name: 'Intl', message: 'Intl difere entre Chromium e Hermes (mobile-shell-design §8); formate no client e ordene com domain/shared/textOrder.ts.' },
    ],
};

/**
 * Fronteira do `client` (desktop-shell-design §4.2): a camada headless é compartilhada com o
 * React Native, então não pode depender do React DOM, do React Native, do Electron nem do
 * Node. `Intl` também fica de fora porque formata diferente no Chromium e no Hermes
 * (mobile-shell-design §8): o mesmo saldo apareceria de dois jeitos.
 */
const clientBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [
            { group: ['react-dom', 'react-dom/*', 'react-native', 'react-native/*', 'electron', 'electron/*'], message: 'O client é compartilhado entre desktop e mobile (desktop-shell-design §4.2).' },
            { group: ['node:*', 'fs', 'path', 'crypto', 'os'], message: 'O client roda também no Hermes do mobile, sem Node.' },
        ],
    }],
    'no-restricted-globals': ['error',
        { name: 'Intl', message: 'Formate com os formatadores do client: Intl difere entre Chromium e Hermes (desktop-shell-design §4.2).' },
    ],
};

/**
 * Fronteira do adaptador do mobile (mobile-mvp-plan, Fase 2): fino e sem regra, como o do
 * desktop, ele só conhece as portas do núcleo e a suíte de contrato que as verifica. Importar
 * Service, Repository ou o `client` levaria regra para dentro do driver; e o Node não existe
 * no Hermes, onde o pacote roda.
 */
const sqliteExpoBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [
            { group: ['node:*', 'fs', 'path', 'crypto', 'os', 'better-sqlite3'], message: 'O sqlite-expo roda no Hermes, sem Node.' },
            { group: ['@finance/*', '@finance/core/*', '!@finance/core', '!@finance/core/contract'], message: 'O adaptador só conhece as portas do núcleo (@finance/core) e a suíte de contrato.' },
            { group: ['react-native', 'react-native/*', 'react'], message: 'O adaptador não tem tela: só expo-sqlite e expo-file-system.' },
        ],
    }],
};

/**
 * Fronteira do app do celular (mobile-mvp-plan, Fase 4), a mesma do desktop: as telas só
 * falam com o `client`; o núcleo, o adaptador do banco e o driver entram só pela raiz de
 * composição. Uma tela que chamasse o núcleo direto pularia o agendamento pós-frame e o cache
 * de consultas. `Intl` fica de fora pelo motivo do `client`: formata diferente no Hermes.
 */
const mobileBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [
            { group: ['@finance/core', '@finance/core/*', '@finance/sqlite-expo', '@finance/sqlite-expo/*', 'expo-sqlite'], message: 'Telas falam só com o client; o núcleo e o banco entram pela raiz de composição (src/startup/openMobileCore.ts).' },
            { group: ['node:*', 'fs', 'path', 'crypto', 'os', 'better-sqlite3', '@finance/sqlite-better'], message: 'O app roda no Hermes, sem Node.' },
        ],
    }],
    'no-restricted-globals': ['error',
        { name: 'Intl', message: 'Formate com os formatadores do client: Intl difere entre Chromium e Hermes (mobile-shell-design §8).' },
    ],
};

/**
 * A raiz de composição e os adaptadores das portas do núcleo: os únicos arquivos do app que
 * conhecem o núcleo e o banco. Continuam sem Node.
 */
const mobileCompositionRules = {
    'no-restricted-imports': ['error', {
        patterns: [{ group: ['node:*', 'fs', 'path', 'crypto', 'os', 'better-sqlite3', '@finance/sqlite-better'], message: 'O app roda no Hermes, sem Node.' }],
    }],
};

/**
 * Os tokens são dados sem dependências, lidos pelo desktop, pelo mobile e pelo gerador
 * (desktop-shell-design §4.5); só o script de geração toca o disco.
 */
const tokensBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [{ regex: '^(?!\\./)', message: 'packages/tokens/src não tem dependências (desktop-shell-design §4.5).' }],
    }],
};

export default tseslint.config(
    { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/test-results/**', '**/playwright-report/**', '**/release/**', '**/*.generated.ts', '**/*.generated.cjs'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
            '@typescript-eslint/explicit-member-accessibility': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
        },
    },
    {
        files: ['packages/core/src/**/*.ts'],
        rules: coreBoundaryRules,
    },
    {
        files: ['packages/client/src/**/*.{ts,tsx}'],
        rules: clientBoundaryRules,
    },
    {
        files: ['packages/tokens/src/**/*.ts'],
        rules: tokensBoundaryRules,
    },
    {
        files: ['packages/sqlite-expo/src/**/*.ts'],
        rules: sqliteExpoBoundaryRules,
    },
    {
        files: ['apps/mobile/app/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}'],
        rules: mobileBoundaryRules,
    },
    {
        files: ['apps/mobile/src/startup/openMobileCore.ts', 'apps/mobile/src/platform/systemAdapters.ts'],
        rules: mobileCompositionRules,
    },
    {
        // Scripts de build em JavaScript puro: sem anotação de tipo possível, o tipo de
        // retorno fica no JSDoc.
        files: ['**/*.js', '**/*.mjs'],
        ...tseslint.configs.disableTypeChecked,
        rules: {
            ...tseslint.configs.disableTypeChecked.rules,
            '@typescript-eslint/explicit-function-return-type': 'off',
        },
    },
    {
        // Configurações do app do celular que o Metro, o Babel, o Jest e o Tailwind carregam
        // em CommonJS, sem opção de ESM no pacote do app (que não é `type: module`, porque o
        // Expo Router resolve a entrada pelo `main`).
        files: ['apps/mobile/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
);
