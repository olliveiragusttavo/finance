import type { Config } from 'tailwindcss';

// Tipo do `tailwind.config.js`, que fica em CommonJS porque o NativeWind o carrega no Metro.
// Declarado à parte para o teste do tema importar a configuração real sem `allowJs`.
declare const config: Config;
export default config;
