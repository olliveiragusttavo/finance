import { colorTokens, fontFamilies, fontSizesPx, fontWeights, radiiPx, rootFontSizePx, spacingUnitPx, type ColorTokenName, type ThemeName } from './tokens.ts';

/** Classe na raiz do documento que liga o tema escuro; o claro é o padrão de `:root`. */
export const DARK_THEME_CLASS = 'dark';

/** Cabeçalho do arquivo gerado; o teste de sincronia confere que o arquivo vem do gerador. */
const HEADER = '/* Gerado a partir de packages/tokens/src/tokens.ts por `pnpm tokens:css` — não edite à mão. */';

/**
 * Gera o CSS de tema do Tailwind v4: as variáveis de cada tema (`:root` e `.dark`) e o
 * bloco `@theme` que transforma cada token em classe. É o "preset" do Tailwind no formato
 * CSS da v4 — o mesmo arquivo que o NativeWind 5 lê no mobile.
 *
 * O tema troca por variável CSS (desktop-shell-design §4.5): as classes apontam para
 * `var(--token)` e trocar de tema é trocar a classe da raiz, sem re-renderizar a árvore. As
 * escalas padrão do Tailwind (cores, tamanhos de fonte, raios) são zeradas antes, para que
 * uma classe fora dos tokens (`bg-red-500`, `text-sm`) não gere CSS e o valor literal não
 * entre nas telas por descuido (desktop-mvp-plan §7).
 *
 * @return O conteúdo do `theme.generated.css`, determinístico para o mesmo conjunto de tokens.
 */
export function renderThemeCss(): string {
    const names = colorTokenNames();
    return [
        HEADER,
        '',
        `@custom-variant dark (&:where(.${DARK_THEME_CLASS}, .${DARK_THEME_CLASS} *));`,
        '',
        themeBlock(':root', 'light', names),
        '',
        themeBlock(`.${DARK_THEME_CLASS}`, 'dark', names),
        '',
        '@theme inline {',
        '    --color-*: initial;',
        ...names.map((name) => `    --color-${name}: var(--${name});`),
        '',
        `    --font-sans: ${fontStack(fontFamilies.sans)};`,
        `    --font-mono: ${fontStack(fontFamilies.mono)};`,
        ...Object.entries(fontWeights).map(([name, weight]) => `    --font-weight-${name}: ${String(weight)};`),
        '',
        '    --text-*: initial;',
        ...fontSizesPx.map((size) => `    --text-${String(size)}: ${rem(size)};`),
        '',
        '    --radius-*: initial;',
        ...radiiPx.map((radius) => `    --radius-${String(radius)}: ${String(radius)}px;`),
        '',
        `    --spacing: ${rem(spacingUnitPx)};`,
        '}',
        '',
    ].join('\n');
}

/**
 * @return Os nomes dos tokens de cor na ordem da declaração. Existe porque `Object.keys`
 * devolve `string[]`, e o nome tipado é o que garante que o valor lido existe nos dois temas.
 */
export function colorTokenNames(): readonly ColorTokenName[] {
    return Object.keys(colorTokens).filter((name): name is ColorTokenName => Object.hasOwn(colorTokens, name));
}

/**
 * @param selector Seletor que recebe as variáveis (`:root` para o claro, `.dark` para o escuro).
 * @param theme Tema cujos valores entram no bloco.
 * @param names Tokens a declarar.
 * @return O bloco com `color-scheme`, para que barras de rolagem e controles nativos do
 * Chromium acompanhem o tema.
 */
function themeBlock(selector: string, theme: ThemeName, names: readonly ColorTokenName[]): string {
    return [
        `${selector} {`,
        `    color-scheme: ${theme};`,
        ...names.map((name) => `    --${name}: ${colorTokens[name][theme]};`),
        '}',
    ].join('\n');
}

/**
 * @param families Pilha de fontes, da preferida ao fallback genérico.
 * @return A pilha em sintaxe CSS, com aspas só nos nomes que têm espaço — palavras-chave
 * genéricas (`sans-serif`) entre aspas deixariam de ser genéricas.
 */
function fontStack(families: readonly string[]): string {
    return families.map((family) => (family.includes(' ') ? `'${family}'` : family)).join(', ');
}

/**
 * Tamanhos e espaçamentos em rem acompanham o zoom de fonte do sistema; os mockups estão em
 * px sobre uma raiz de 16px.
 *
 * @param px Valor do mockup em pixels.
 * @return O valor em rem.
 */
function rem(px: number): string {
    return `${String(px / rootFontSizePx)}rem`;
}
