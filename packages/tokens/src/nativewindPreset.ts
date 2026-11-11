import { colorTokens, fontFamilies, fontSizesPx, fontWeights, radiiPx, spacingUnitPx, type ThemeName } from './tokens.ts';
import { colorTokenNames } from './themeCss.ts';

/** Cabeçalho do arquivo gerado; o teste de sincronia confere que o arquivo vem do gerador. */
const HEADER = '// Gerado a partir de packages/tokens/src/tokens.ts por `pnpm tokens:css` — não edite à mão.';

/**
 * O pedaço do `theme` do Tailwind 3 que o NativeWind 4 lê. Só os campos que os tokens
 * definem; o resto da escala padrão fica de fora pelo mesmo motivo do CSS do desktop.
 */
export interface NativewindTheme {
    readonly colors: Readonly<Record<string, string>>;
    readonly fontFamily: Readonly<Record<string, readonly string[]>>;
    readonly fontSize: Readonly<Record<string, string>>;
    readonly fontWeight: Readonly<Record<string, string>>;
    readonly borderRadius: Readonly<Record<string, string>>;
    readonly spacing: Readonly<Record<string, string>>;
}

/**
 * Passos da escala de espaçamento, no vocabulário do Tailwind (`p-3`, `py-2.25`): de quarto
 * em quarto até 24 — onde estão os espaçamentos dos mockups, inclusive os ímpares em px
 * (`py-2.25` é 9px) — e inteiros até 96. O Tailwind 4 do desktop aceita qualquer múltiplo;
 * o 3, do NativeWind 4, só os passos declarados, então a lista precisa cobrir o que o desktop
 * usa para a mesma classe valer nos dois.
 */
function spacingSteps(): readonly number[] {
    const quarters = Array.from({ length: 24 * 4 + 1 }, (_, index) => index / 4);
    const integers = Array.from({ length: 96 - 24 }, (_, index) => 25 + index);
    return [...quarters, ...integers];
}

/**
 * O tema do Tailwind 3 para o NativeWind 4 do celular, a partir dos mesmos tokens do CSS do
 * desktop: a v5 do NativeWind, que leria o `theme.generated.css`, ainda não é estável no
 * Expo SDK 58 (mobile-mvp-plan §2, "Estilo"). As cores apontam para variáveis (`var(--bg)`),
 * que a raiz do app troca por tema com `vars()`, como a classe `.dark` faz no desktop.
 *
 * Tamanhos em px, e não em rem: no React Native o rem do NativeWind vale 14 por padrão, e o
 * px dos mockups é o que a tela precisa mostrar. O aumento de fonte do sistema continua
 * valendo, porque o `Text` do React Native escala sozinho.
 *
 * @return O tema, com as mesmas classes do desktop (`bg-surface`, `text-13`, `rounded-8`, `p-3`).
 */
export function nativewindTheme(): NativewindTheme {
    return {
        colors: Object.fromEntries(colorTokenNames().map((name) => [name, `var(--${name})`])),
        // Entre aspas: sem elas o CSS sai `font-family: IBM Plex Sans`, o NativeWind lê só a
        // primeira palavra e o Android cai na fonte do sistema. Só a primeira da pilha, porque no
        // React Native não há fallback por lista: a fonte vem embutida no app.
        fontFamily: { sans: [`"${fontFamilies.sans[0]}"`], mono: [`"${fontFamilies.mono[0]}"`] },
        fontSize: Object.fromEntries(fontSizesPx.map((size) => [String(size), `${String(size)}px`])),
        fontWeight: Object.fromEntries(Object.entries(fontWeights).map(([name, weight]) => [name, String(weight)])),
        borderRadius: { ...Object.fromEntries(radiiPx.map((radius) => [String(radius), `${String(radius)}px`])), full: '9999px' },
        spacing: Object.fromEntries(spacingSteps().map((step) => [String(step), `${String(step * spacingUnitPx)}px`])),
    };
}

/**
 * As variáveis de cor de um tema, no formato do `vars()` do NativeWind (`{ '--bg': '#F4F5F2' }`).
 * A raiz do app aplica o mapa do tema escolhido; trocar de tema é trocar o mapa, sem
 * re-renderizar cada componente com outra classe.
 *
 * @param theme Tema cujos valores entram no mapa.
 * @return O valor de cada token naquele tema.
 */
export function themeVariables(theme: ThemeName): Readonly<Record<string, string>> {
    return Object.fromEntries(colorTokenNames().map((name) => [`--${name}`, colorTokens[name][theme]]));
}

/**
 * O tema do preset, com a família de fonte repetida em `extend`. O preset do próprio NativeWind
 * declara `fontFamily.sans` em `theme.extend` (a fonte do sistema de cada plataforma), e no
 * Tailwind o `extend` é aplicado por cima do `theme` de qualquer preset: sem a repetição,
 * `font-sans` viraria `san-serif` e o app sairia na Roboto. Os outros campos do `extend` dele
 * (sombras, translações) não colidem com os tokens.
 *
 * @return O tema que vai para o arquivo gerado.
 */
function presetTheme(): NativewindTheme & { readonly extend: Pick<NativewindTheme, 'fontFamily'> } {
    const theme = nativewindTheme();
    return { ...theme, extend: { fontFamily: theme.fontFamily } };
}

/**
 * Gera o preset em CommonJS que o `tailwind.config.js` do app carrega. É gerado e versionado,
 * como o CSS do desktop, e não importado do TypeScript, porque a configuração do Tailwind roda
 * no transformador do Metro, em Node puro, sem entender `.ts`.
 *
 * @return O conteúdo do `nativewind-preset.generated.cjs`, determinístico para os mesmos tokens.
 */
export function renderNativewindPreset(): string {
    return [
        HEADER,
        '// Preset do Tailwind 3 para o NativeWind 4 do apps/mobile (mobile-mvp-plan §2, "Estilo").',
        `module.exports = { theme: ${JSON.stringify(presetTheme(), null, 4)} };`,
        '',
    ].join('\n');
}
