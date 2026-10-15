import type { AccountType } from '../../domain/account/Account.ts';
import type { ImportOptions, ImportRow } from '../../domain/import/ImportRow.ts';
import type { AccountId, CreditCardId, ProfileId } from '../../domain/shared/ids.ts';

/**
 * O que fazer com uma conta do arquivo (import-design §5.1): criar no perfil escolhido ou ligar a
 * uma conta existente desse perfil.
 */
export type ImportAccountTarget =
    | { readonly kind: 'create'; readonly type: AccountType; readonly considerBalance: boolean }
    | { readonly kind: 'link'; readonly accountId: AccountId };

/** Decisão da revisão sobre uma conta do arquivo, pelo nome como o arquivo a escreve. */
export interface ImportAccountDecision {
    readonly name: string;
    /** Perfil de destino dos lançamentos que saem da conta. */
    readonly profileId: ProfileId;
    readonly target: ImportAccountTarget;
}

/**
 * O que fazer com um cartão do arquivo: criar — com a conta pagadora (nome do arquivo), o ciclo e
 * o limite — ou ligar a um cartão existente. O perfil é sempre o da conta pagadora.
 */
export type ImportCreditCardTarget =
    | { readonly kind: 'create'; readonly payingAccount: string; readonly closingDay: number; readonly dueDay: number; readonly limit: number }
    | { readonly kind: 'link'; readonly creditCardId: CreditCardId };

/** Decisão da revisão sobre um cartão do arquivo. */
export interface ImportCreditCardDecision {
    readonly name: string;
    readonly target: ImportCreditCardTarget;
}

/** A importação de um arquivo, como a revisão a aprovou. */
export interface ImportCommand {
    readonly rows: readonly ImportRow[];
    readonly options: ImportOptions;
    readonly accounts: readonly ImportAccountDecision[];
    readonly creditCards: readonly ImportCreditCardDecision[];
    /** Categoria e subcategoria das transferências, criadas no perfil de origem quando faltam. */
    readonly transferCategory: { readonly category: string; readonly subCategory: string };
}

/** O que a importação gravou, para a tela confirmar. */
export interface ImportOutcome {
    readonly transactions: number;
    readonly fixedSeries: number;
    readonly installmentSeries: number;
    readonly invoicesPaid: number;
    readonly accountsCreated: number;
    readonly creditCardsCreated: number;
    readonly categoriesCreated: number;
    readonly subCategoriesCreated: number;
    readonly tagsCreated: number;
    /** Linhas recusadas pela análise, que ficaram de fora. */
    readonly skipped: number;
}
