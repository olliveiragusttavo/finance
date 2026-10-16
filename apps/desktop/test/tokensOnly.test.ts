import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(import.meta.dirname, '../src/renderer');

/**
 * Padrões de estilo que não podem aparecer no renderer. O CSS gerado dos tokens já zera as
 * escalas padrão do Tailwind, então uma classe fora dos tokens simplesmente não teria
 * estilo — este teste transforma o "sem estilo, sem aviso" num erro com o arquivo e a linha.
 */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
    { pattern: /#[0-9a-fA-F]{3,8}\b/, why: 'cor literal; use um token de packages/tokens' },
    { pattern: /\b(?:rgba?|hsla?|oklch|oklab)\(/, why: 'cor literal; use um token de packages/tokens' },
    { pattern: /\b(?:bg|text|border|ring|fill|stroke|outline|decoration|caret|accent|from|via|to)-\[(?:#|rgb|hsl|oklch|color)/, why: 'cor arbitrária; use um token' },
    {
        pattern: /\b(?:bg|text|border|ring|fill|stroke|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\b/,
        why: 'paleta padrão do Tailwind; use um token',
    },
    { pattern: /\b(?:text|rounded(?:-[trbl]{1,2})?)-(?:xs|sm|base|md|lg|xl|[2-9]xl)\b/, why: 'escala padrão do Tailwind; os tokens nomeiam tamanho e raio pelo px do mockup (text-13, rounded-8)' },
];

/**
 * @param folder Pasta a percorrer.
 * @return Os arquivos de código e estilo do renderer, recursivamente.
 */
function sourceFiles(folder: string): readonly string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(path);
        }
        return /\.(?:tsx?|css|html)$/.test(entry.name) ? [path] : [];
    });
}

describe('estilo só a partir dos tokens (desktop-mvp-plan §7, CLAUDE.md "Telas")', () => {
    it('o renderer não tem cor literal nem classe fora da escala dos tokens', () => {
        const violations = sourceFiles(RENDERER).flatMap((file) =>
            readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
                FORBIDDEN.filter(({ pattern }) => pattern.test(line)).map(({ why }) => `${relative(RENDERER, file)}:${String(index + 1)} — ${why}: ${line.trim()}`),
            ),
        );
        expect(violations).toEqual([]);
    });

    it('o padrão pega o que deve pegar', () => {
        const caught = (line: string): boolean => FORBIDDEN.some(({ pattern }) => pattern.test(line));
        expect(caught('className="bg-[#fff]"')).toBe(true);
        expect(caught("style={{ color: '#1B1F1D' }}")).toBe(true);
        expect(caught('className="text-sm bg-red-500"')).toBe(true);
        expect(caught('className="rounded-md"')).toBe(true);
        expect(caught('className="text-13 bg-surface rounded-8 ring-[3px] text-muted"')).toBe(false);
    });
});
