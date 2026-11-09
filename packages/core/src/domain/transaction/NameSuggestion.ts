import type { AccountId, CreditCardId, SubCategoryId } from '../shared/ids.ts';
import type { TransactionType } from './TransactionType.ts';

/** Conta ou cartão de um lançamento, sem a fatura: a sugestão só repete a origem. */
export type SuggestedSource = { readonly kind: 'account'; readonly accountId: AccountId } | { readonly kind: 'creditCard'; readonly creditCardId: CreditCardId };

/**
 * Um nome já lançado no perfil, com a categoria e a origem do lançamento mais recente que o
 * usou — o que o autocomplete do campo "Nome" copia ao escolher a sugestão. É um modelo de
 * leitura no domínio, como os da Visão geral, porque o Repository o monta direto do SQL.
 */
export interface TransactionNameSuggestion {
    /** Nome como foi digitado no lançamento mais recente. */
    readonly name: string;
    /** O mesmo nome em tipos diferentes ("Pix" despesa e receita) são sugestões diferentes. */
    readonly type: TransactionType;
    readonly subCategoryId: SubCategoryId;
    readonly source: SuggestedSource;
    /** Quantos lançamentos vivos usam o nome nesse tipo; desempata a ordem das sugestões. */
    readonly uses: number;
}

/**
 * Chave que junta as grafias de um mesmo nome nas sugestões. Fica em TypeScript porque o
 * `lower()` do SQLite só trata ASCII: "PÃO DE AÇÚCAR" e "Pão de Açúcar" virariam duas sugestões,
 * cada uma com parte dos usos e a mais antiga com categoria e origem desatualizadas.
 * Regra de negócio (Lançamentos, desktop-mvp-plan Fase 15.2): o nome sugerido não diferencia
 * acento e maiúscula.
 *
 * @param name Nome como foi gravado no lançamento.
 * @return O nome sem espaços nas pontas, minúsculo e sem diacríticos.
 */
export function nameSuggestionKey(name: string): string {
    return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
