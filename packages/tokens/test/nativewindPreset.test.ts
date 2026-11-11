import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorTokenNames, colorTokens, nativewindTheme, renderNativewindPreset, themeVariables } from '../src/index.ts';

describe('preset do NativeWind 4 (mobile-mvp-plan §2, "Estilo")', () => {
    it('o arquivo versionado está em dia com os tokens (rode `pnpm tokens:css`)', () => {
        const committed = readFileSync(new URL('../src/nativewind-preset.generated.cjs', import.meta.url), 'utf8');
        expect(committed).toBe(renderNativewindPreset());
    });

    it('aponta cada cor para a variável do tema, como o @theme do desktop', () => {
        const theme = nativewindTheme();
        expect(Object.keys(theme.colors)).toEqual([...colorTokenNames()]);
        expect(theme.colors['surface']).toBe('var(--surface)');
    });

    it('mantém as classes do desktop com o mesmo valor em px', () => {
        const theme = nativewindTheme();
        expect(theme.fontSize['13']).toBe('13px');
        expect(theme.borderRadius['8']).toBe('8px');
        // Unidade de 4px: p-3 é 12px e py-2.25 é 9px, como no Tailwind 4 do desktop.
        expect(theme.spacing['3']).toBe('12px');
        expect(theme.spacing['2.25']).toBe('9px');
        expect(theme.spacing['96']).toBe('384px');
        expect(theme.fontWeight['semibold']).toBe('600');
        // Com aspas, para o NativeWind não ler só "IBM" e cair na fonte do sistema.
        expect(theme.fontFamily['sans']).toEqual(['"IBM Plex Sans"']);
    });

    it('não traz escala fora dos tokens, para que text-sm ou rounded-md não tenham estilo', () => {
        const theme = nativewindTheme();
        expect(theme.fontSize['sm']).toBeUndefined();
        expect(theme.borderRadius['md']).toBeUndefined();
        expect(theme.colors['red']).toBeUndefined();
    });

    it('dá a cada tema o valor de cada token, no formato do vars()', () => {
        for (const theme of ['light', 'dark'] as const) {
            const variables = themeVariables(theme);
            expect(Object.keys(variables)).toHaveLength(colorTokenNames().length);
            expect(variables['--bg']).toBe(colorTokens.bg[theme]);
        }
    });
});
