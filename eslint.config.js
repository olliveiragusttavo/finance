import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Regras de fronteira do núcleo (backend-design §3.1 e §3.4): o `core` roda igual no
 * Electron, no Hermes do React Native e num servidor, então não pode importar nada do
 * Node nem de uma plataforma, nem ler relógio ou aleatoriedade fora das portas. A regra
 * é verificada por lint, e não por disciplina, porque a quebra só apareceria no celular.
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
 * Os tokens são dados sem dependências, lidos pelo desktop, pelo mobile e pelo gerador
 * (desktop-shell-design §4.5); só o script de geração toca o disco.
 */
const tokensBoundaryRules = {
    'no-restricted-imports': ['error', {
        patterns: [{ regex: '^(?!\\./)', message: 'packages/tokens/src não tem dependências (desktop-shell-design §4.5).' }],
    }],
};

export default tseslint.config(
    { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/test-results/**', '**/playwright-report/**', '**/*.generated.ts'] },
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
        // Scripts de build em JavaScript puro: sem anotação de tipo possível, o tipo de
        // retorno fica no JSDoc.
        files: ['**/*.js', '**/*.mjs'],
        ...tseslint.configs.disableTypeChecked,
        rules: {
            ...tseslint.configs.disableTypeChecked.rules,
            '@typescript-eslint/explicit-function-return-type': 'off',
        },
    },
);
