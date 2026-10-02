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

export default tseslint.config(
    { ignores: ['**/node_modules/**', '**/dist/**', '**/*.generated.ts'] },
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
