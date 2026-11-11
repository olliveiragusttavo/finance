/// <reference types="nativewind/types" />

// O `global.css` com as diretivas do Tailwind é importado pela raiz só pelo efeito: o
// transformador do NativeWind no Metro o converte em estilos.
declare module '*.css';
