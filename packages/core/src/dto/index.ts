/*
 * DTOs de resposta: o contrato de saída que o pacote `client` consome nas duas plataformas
 * (desktop-shell-design §5.1). São dados serializáveis por tipo — objetos simples, strings,
 * números, booleanos e `null`; nada de classe, `Date` ou `Map` (mobile-shell-design §4.4).
 * Um DTO que carregasse um `Money` funcionaria no celular, onde nada é serializado, e
 * chegaria ao renderer do desktop sem os métodos.
 *
 * Ficam fora de `controllers/` porque o contrato muda por motivos diferentes da orquestração
 * das rotas, e agrupados por objeto para que cada um cresça sem inchar os demais. Este barrel
 * existe só para a API pública do pacote — o código interno importa do arquivo específico,
 * deixando explícito de qual contrato depende.
 */
export * from './shared/MoneyResponse.ts';
export * from './shared/BalancePairResponse.ts';
export * from './transactions/TransactionResponse.ts';
export * from './invoices/InvoiceResponse.ts';
export * from './invoices/InvoiceDetailResponse.ts';
export * from './invoices/InvoiceSuggestionResponse.ts';
export * from './statements/StatementResponse.ts';
export * from './accounts/AccountBalanceResponse.ts';
export * from './profiles/ProfileBalancesResponse.ts';
