/*
 * Tokens de design como dados (desktop-shell-design §4.5): a única fonte de cor, tipografia,
 * raio e espaçamento dos dois apps. Os valores vêm dos mockups aprovados
 * (docs/design/mockups/README.md, "Tokens de cor"); nenhuma tela usa valor literal fora
 * daqui. São dados, e não CSS, para que o mesmo conjunto alimente o Tailwind do desktop,
 * o NativeWind do mobile e, se ele falhar, um `StyleSheet` gerado (mobile-shell-design §9).
 */

/** Cor hexadecimal `#RRGGBB`; o tipo impede que um nome de token seja passado no lugar do valor. */
export type HexColor = `#${string}`;

/** Os dois temas que toda tela suporta desde o início (decisão de interface 1 dos mockups). */
export type ThemeName = 'light' | 'dark';

/** Um token de cor: o valor em cada tema e para que ele serve. */
export interface ColorToken {
    readonly light: HexColor;
    readonly dark: HexColor;
    /** Papel do token, para quem escolhe a cor de um componente novo. */
    readonly role: string;
}

/**
 * Paleta dos mockups. Os nomes são os mesmos das variáveis dos mockups (`--bg`, `--ink`…),
 * para que mockup, CSS e classe (`bg-surface text-ink`) falem o mesmo vocabulário.
 * `satisfies` em vez de anotação para que o nome de cada token continue literal no tipo
 * `ColorTokenName` e um token novo exija valor nos dois temas.
 */
export const colorTokens = {
    'bg': { light: '#F4F5F2', dark: '#111413', role: 'Fundo da janela' },
    'surface': { light: '#FFFFFF', dark: '#1A1E1C', role: 'Painéis, barras e cartões' },
    'surface2': { light: '#FAFAF8', dark: '#151917', role: 'Superfície secundária (cabeçalho de tabela, campos)' },
    'line': { light: '#DDE1DC', dark: '#2E3431', role: 'Bordas' },
    'line2': { light: '#EEF0EC', dark: '#242926', role: 'Divisórias internas (linhas de tabela)' },
    'ink': { light: '#1B1F1D', dark: '#E7EAE7', role: 'Texto principal' },
    'ink2': { light: '#3D4541', dark: '#C3C9C5', role: 'Texto secundário (saldo previsto, categoria)' },
    'muted': { light: '#5A625E', dark: '#9AA29E', role: 'Rótulos e textos de apoio' },
    'accent': { light: '#1F5F8B', dark: '#6AAAD8', role: 'Ação principal, links e foco' },
    'on-accent': { light: '#FFFFFF', dark: '#0B1A24', role: 'Texto sobre accent' },
    'soft': { light: '#E6EEF4', dark: '#1D3040', role: 'Fundo de item selecionado' },
    'soft-ink': { light: '#163F5C', dark: '#B5D7F0', role: 'Texto sobre soft' },
    'in': { light: '#1F5F8B', dark: '#7DB8E2', role: 'Entrada de dinheiro (sempre junto do sinal +)' },
    'out': { light: '#A04A12', dark: '#E89A63', role: 'Saída de dinheiro (sempre junto do sinal −)' },
    'warn-bg': { light: '#FFF1D6', dark: '#3A2C10', role: 'Fundo de aviso (fatura em aberto, pendente)' },
    'warn-ink': { light: '#5C3D00', dark: '#F2D38F', role: 'Texto de aviso' },
    'ok-bg': { light: '#E2F1E8', dark: '#16302A', role: 'Fundo de situação concluída (fatura paga)' },
    'ok-ink': { light: '#1E5A3F', dark: '#8FD9B4', role: 'Texto de situação concluída' },
    'track': { light: '#EEF0EC', dark: '#2A302D', role: 'Trilho de barras e etiquetas neutras' },
    'danger': { light: '#9B2C1F', dark: '#F08A7A', role: 'Ação destrutiva e erro' },
    'dot': { light: '#2E7D5B', dark: '#5BC08F', role: 'Indicador de sincronização' },
    // Fora da tabela dos mockups, que não desenham diálogos: o véu atrás de diálogo e painel
    // lateral precisa escurecer nos dois temas, e `ink` clarearia o fundo no escuro.
    'scrim': { light: '#1B1F1D', dark: '#000000', role: 'Véu atrás de diálogos e painéis (sempre com opacidade)' },
} as const satisfies Readonly<Record<string, ColorToken>>;

/**
 * Nome de uma cor da paleta. Derivado das chaves em vez de escrito à mão para que o gerador
 * de CSS e o teste dos dois temas não aceitem uma cor que não exista nos dados.
 */
export type ColorTokenName = keyof typeof colorTokens;

/**
 * Famílias de fonte. IBM Plex Sans é a fonte dos mockups; a Mono aparece só nos códigos de
 * pareamento. A pilha de fallback é a dos mockups, para o primeiro quadro antes da fonte carregar.
 */
export const fontFamilies = {
    sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
    mono: ['IBM Plex Mono', 'monospace'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * Escala fechada de tamanhos de fonte, em px, com o nome igual ao valor (`text-13`). Os
 * mockups especificam tamanhos em px que não cabem nos nomes do Tailwind (13, 17, 22): com
 * o número no nome, quem lê o mockup acha a classe sem tabela de conversão, e um tamanho
 * fora da lista simplesmente não existe como classe.
 */
export const fontSizesPx = [11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 30] as const;

/**
 * Tamanho de fonte permitido. Fecha o tipo na escala para que um tamanho fora dos mockups
 * falhe na compilação, e não só por não gerar classe.
 */
export type FontSizePx = (typeof fontSizesPx)[number];

/** Pesos usados nos mockups: texto, ênfase e títulos/valores. */
export const fontWeights = { normal: 400, medium: 500, semibold: 600 } as const;

/**
 * Escala fechada de raios, em px, com o nome igual ao valor (`rounded-8`), pelo mesmo motivo
 * dos tamanhos de fonte. `full` é o círculo e a pílula (`50%` e `999px` nos mockups).
 */
export const radiiPx = [2, 3, 4, 6, 8, 10, 12, 14, 18] as const;

/**
 * Raio permitido. Fecha o tipo na escala pelo mesmo motivo do `FontSizePx`: um raio fora dos
 * mockups falha na compilação.
 */
export type RadiusPx = (typeof radiiPx)[number];

/**
 * Unidade da escala de espaçamento, em px. Todo espaçamento dos mockups é múltiplo de 1px e
 * quase todo de 2px; com a unidade de 4px do Tailwind, `p-3` é 12px e `py-2.25` é 9px, e o
 * vocabulário continua o mesmo que o shadcn/ui e o NativeWind já usam.
 */
export const spacingUnitPx = 4;

/** Tamanho-base da fonte da raiz, para converter px em rem sem depender do navegador. */
export const rootFontSizePx = 16;
