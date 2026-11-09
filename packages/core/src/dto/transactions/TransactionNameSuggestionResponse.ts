import type { TransactionNameSuggestion } from '../../domain/transaction/NameSuggestion.ts';
import type { TransactionType } from '../../domain/transaction/TransactionType.ts';

/** Sugestão do autocomplete do campo "Nome": o nome e o que escolhê-lo copia para o formulário. */
export interface TransactionNameSuggestionResponse {
    readonly name: string;
    readonly type: TransactionType;
    readonly subCategoryId: string;
    readonly source: { readonly kind: 'account'; readonly accountId: string } | { readonly kind: 'creditCard'; readonly creditCardId: string };
    readonly uses: number;
}

/**
 * @param suggestion Sugestão montada pelo Repository.
 * @return A sugestão serializável.
 */
export function toTransactionNameSuggestionResponse(suggestion: TransactionNameSuggestion): TransactionNameSuggestionResponse {
    return {
        name: suggestion.name,
        type: suggestion.type,
        subCategoryId: suggestion.subCategoryId,
        source: suggestion.source.kind === 'account' ? { kind: 'account', accountId: suggestion.source.accountId } : { kind: 'creditCard', creditCardId: suggestion.source.creditCardId },
        uses: suggestion.uses,
    };
}
