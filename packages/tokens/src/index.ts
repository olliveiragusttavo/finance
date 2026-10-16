// API pública dos tokens: os dados e o gerador do CSS de tema. Sem dependências, porque é
// consumido pelo desktop, pelo mobile e pelo gerador (desktop-shell-design §4.5).
export * from './tokens.ts';
export { colorTokenNames, DARK_THEME_CLASS, renderThemeCss } from './themeCss.ts';
