/*
 * Schemas da camada Request, exportados pelo subcaminho `@finance/core/requests` para os
 * formulários da UI (desktop-mvp-plan §2, Formulários). O formulário valida com o mesmo
 * schema que o núcleo aplica na fronteira, para que a mensagem de conforto e a recusa do
 * núcleo nunca discordem (desktop-shell-design §5.4). São só schemas e o domínio puro que
 * eles usam: nada de Repository, Service ou plataforma entra por aqui.
 */
export * from './fields.ts';
export * from './profileRequests.ts';
export * from './onboardingRequests.ts';
export * from './accountRequests.ts';
export * from './creditCardRequests.ts';
export * from './categoryRequests.ts';
export * from './transactionRequests.ts';
export * from './invoiceRequests.ts';
export * from './statementRequests.ts';
export * from './balanceRequests.ts';
export * from './integrityRequests.ts';
export * from './reportRequests.ts';
export * from './tagRequests.ts';
export * from './noteRequests.ts';
export * from './recurrenceRequests.ts';
