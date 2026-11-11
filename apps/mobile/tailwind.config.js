// @ts-check

/**
 * Tailwind 3 do NativeWind 4. O tema vem inteiro do preset gerado em `packages/tokens`, as
 * mesmas classes do desktop (`bg-surface`, `text-13`, `rounded-8`, `p-3`); o tema padrão do
 * Tailwind é substituído, e não estendido, para que uma classe fora dos tokens não tenha
 * estilo (desktop-mvp-plan §7, mobile-mvp-plan §2 "Estilo").
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
    content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
    darkMode: 'class',
    presets: [require('nativewind/preset'), require('@finance/tokens/nativewind-preset')],
};
