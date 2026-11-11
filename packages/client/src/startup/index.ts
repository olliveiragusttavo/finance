// Abertura do banco compartilhada pelos dois shells, sem React: o processo do núcleo do
// desktop importa este subcaminho sem carregar hooks nem telas.
export * from './blockingCopy.ts';
export * from './openCoreSequence.ts';
export { SystemClock } from './SystemClock.ts';
