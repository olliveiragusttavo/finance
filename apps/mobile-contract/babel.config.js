// @ts-check

/**
 * Babel do app de contrato: só o preset do Expo. Sem NativeWind, porque a única tela é um
 * relatório e o que se testa aqui é o núcleo, não o estilo.
 *
 * @param {{ cache: (forever: boolean) => void }} api API do Babel; o cache é permanente porque a
 * configuração não depende de variável de ambiente.
 * @returns {{ presets: string[] }} A configuração.
 */
module.exports = function babelConfig(api) {
    api.cache(true);
    return { presets: ['babel-preset-expo'] };
};
