import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorTokenNames, colorTokens, fontSizesPx, radiiPx, renderThemeCss } from '../src/index.ts';

const HEX = /^#[0-9A-F]{6}$/;

/**
 * Extrai o corpo de um bloco de regras do CSS gerado.
 *
 * @param css CSS completo.
 * @param selector Seletor exato do bloco (`:root`, `.dark`).
 * @return As declarações do bloco; vazio quando o bloco não existe, para o teste acusar a falta.
 */
function blockOf(css: string, selector: string): string {
    const start = css.indexOf(`\n${selector} {\n`);
    return start === -1 ? '' : css.slice(start, css.indexOf('\n}', start));
}

describe('tokens de cor (desktop-mvp-plan Fase 3.1)', () => {
    it('todo token tem valor hexadecimal nos dois temas', () => {
        for (const name of colorTokenNames()) {
            expect(colorTokens[name].light, `${name} claro`).toMatch(HEX);
            expect(colorTokens[name].dark, `${name} escuro`).toMatch(HEX);
        }
    });

    it('cobre a paleta do README dos mockups, mais o indicador de sincronização e o véu dos diálogos', () => {
        expect(colorTokenNames()).toEqual([
            'bg', 'surface', 'surface2', 'line', 'line2', 'ink', 'ink2', 'muted', 'accent', 'on-accent', 'soft', 'soft-ink',
            'in', 'out', 'warn-bg', 'warn-ink', 'ok-bg', 'ok-ink', 'track', 'danger', 'dot', 'scrim',
        ]);
    });

    it('declara cada token no :root e no .dark do CSS gerado, com o valor do tema', () => {
        const css = renderThemeCss();
        const light = blockOf(css, ':root');
        const dark = blockOf(css, '.dark');
        for (const name of colorTokenNames()) {
            expect(light).toContain(`--${name}: ${colorTokens[name].light};`);
            expect(dark).toContain(`--${name}: ${colorTokens[name].dark};`);
            expect(css).toContain(`--color-${name}: var(--${name});`);
        }
    });
});

describe('CSS de tema', () => {
    it('zera as escalas padrão do Tailwind para que só existam as classes dos tokens', () => {
        const css = renderThemeCss();
        expect(css).toContain('--color-*: initial;');
        expect(css).toContain('--text-*: initial;');
        expect(css).toContain('--radius-*: initial;');
        expect(css).toContain('--text-13: 0.8125rem;');
        expect(css).toContain('--radius-8: 8px;');
        expect(css).toContain("--font-sans: 'IBM Plex Sans', system-ui, sans-serif;");
    });

    it('mantém as escalas em ordem crescente e sem repetição, para que a escolha do mockup seja inequívoca', () => {
        for (const scale of [fontSizesPx, radiiPx]) {
            expect([...scale].sort((a, b) => a - b)).toEqual([...new Set(scale)]);
        }
    });

    it('o theme.generated.css versionado está em dia com os tokens (rode `pnpm tokens:css`)', () => {
        const committed = readFileSync(new URL('../src/theme.generated.css', import.meta.url), 'utf8');
        expect(committed).toBe(renderThemeCss());
    });
});
