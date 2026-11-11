// @ts-check

/**
 * Babel do app: o preset do Expo com o JSX do NativeWind, para que `className` vire estilo do
 * React Native (mobile-mvp-plan §2, "Estilo"). O preset do Expo já inclui o plugin do
 * Reanimated/Worklets, de que o NativeWind 4 depende para as transições.
 *
 * @param {{ cache: (forever: boolean) => void }} api API do Babel; o cache é permanente porque a
 * configuração não depende de variável de ambiente.
 * @returns {{ presets: unknown[] }} A configuração.
 */
module.exports = function babelConfig(api) {
    api.cache(true);
    return {
        presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    };
};
