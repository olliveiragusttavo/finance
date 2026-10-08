import { TRANSACTION_SITUATIONS, type TransactionFilters, type TransactionSituation } from '@finance/client';
import { z } from 'zod';

/*
 * Filtros da tela de Transações na URL (mockup `DesktopTransacoes`; desktop-mvp-plan Fase 9).
 * Ficam na URL, e não num estado do React, pelo mesmo motivo do mês de referência: voltar no
 * histórico devolve a tabela filtrada, e outra tela pode abrir Transações já filtrada — o painel
 * de Tags hoje e o relatório por categoria na Fase 11 ("Abrir em Transações" levando os filtros).
 */

/** Parâmetros de busca próprios da tela de Transações. */
export interface TransactionsSearch {
    /** Texto da busca (nome e descrição). */
    readonly q?: string;
    readonly account?: string;
    readonly card?: string;
    readonly category?: string;
    readonly subCategory?: string;
    readonly tag?: string;
    readonly situation?: TransactionSituation;
}

/** Os parâmetros que a tela escreve; a troca dos filtros substitui todos de uma vez. */
const FILTER_KEYS = ['q', 'account', 'card', 'category', 'subCategory', 'tag', 'situation'] as const satisfies readonly (keyof TransactionsSearch)[];

const idSchema = z.uuid();
const situationSchema = z.enum(TRANSACTION_SITUATIONS);

/**
 * Valida a busca da URL. Cada parâmetro inválido é descartado sozinho, como em Cartões: um link
 * antigo com uma conta excluída ainda abre a tela com os outros filtros.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só os parâmetros com formato válido.
 */
export function parseTransactionsSearch(search: Readonly<Record<string, unknown>>): TransactionsSearch {
    const q = typeof search['q'] === 'string' && search['q'].trim() !== '' ? search['q'] : undefined;
    const situation = situationSchema.safeParse(search['situation']);
    return withoutEmpty({
        q,
        account: validId(search['account']),
        card: validId(search['card']),
        category: validId(search['category']),
        subCategory: validId(search['subCategory']),
        tag: validId(search['tag']),
        situation: situation.success ? situation.data : undefined,
    });
}

/**
 * @param raw Valor cru de um parâmetro de id.
 * @return O id, quando é um UUID; senão `undefined`, e o filtro some.
 */
function validId(raw: unknown): string | undefined {
    const parsed = idSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
}

/**
 * @param search Busca já validada.
 * @return Os filtros do view-model. Conta e cartão, ou categoria e subcategoria, são uma escolha
 * só na tela; se um link trouxer os dois, vale o mais específico (a conta, a subcategoria).
 */
export function filtersFromSearch(search: TransactionsSearch): TransactionFilters {
    return {
        container:
            search.account !== undefined
                ? { kind: 'account', accountId: search.account }
                : search.card !== undefined
                  ? { kind: 'creditCard', creditCardId: search.card }
                  : null,
        category:
            search.subCategory !== undefined
                ? { kind: 'subCategory', subCategoryId: search.subCategory }
                : search.category !== undefined
                  ? { kind: 'category', categoryId: search.category }
                  : null,
        tagId: search.tag ?? null,
        situation: search.situation ?? null,
        search: search.q ?? '',
    };
}

/**
 * @param filters Filtros escolhidos na tela.
 * @return Os parâmetros da URL; os filtros vazios ficam de fora, para a URL sem filtro ser limpa.
 */
export function searchFromFilters(filters: TransactionFilters): TransactionsSearch {
    const { container, category } = filters;
    return withoutEmpty({
        q: filters.search.trim() === '' ? undefined : filters.search,
        account: container?.kind === 'account' ? container.accountId : undefined,
        card: container?.kind === 'creditCard' ? container.creditCardId : undefined,
        category: category?.kind === 'category' ? category.categoryId : undefined,
        subCategory: category?.kind === 'subCategory' ? category.subCategoryId : undefined,
        tag: filters.tagId ?? undefined,
        situation: filters.situation ?? undefined,
    });
}

/**
 * Troca os filtros na busca atual sem tocar no resto (o mês de referência).
 *
 * @param current Busca atual inteira.
 * @param filters Novos filtros.
 * @return A busca com os filtros substituídos; os que ficaram vazios saem da URL.
 */
export function withFilters(current: Readonly<Record<string, unknown>>, filters: TransactionFilters): Record<string, unknown> {
    const next: Record<string, unknown> = { ...current };
    for (const key of FILTER_KEYS) {
        next[key] = undefined;
    }
    return { ...next, ...searchFromFilters(filters) };
}

/**
 * Valor do campo "Conta ou cartão": um `Select` só, com as contas e os cartões juntos, como no
 * mockup.
 *
 * @param filter Filtro de conta ou cartão.
 * @return `account:<id>`, `creditCard:<id>` ou vazio para "Todos".
 */
export function containerFilterValue(filter: TransactionFilters['container']): string {
    if (filter === null) {
        return '';
    }
    return filter.kind === 'account' ? `account:${filter.accountId}` : `creditCard:${filter.creditCardId}`;
}

/**
 * @param value Valor escolhido no campo "Conta ou cartão".
 * @return O filtro; `null` para "Todos" ou um valor que a tela não produz.
 */
export function parseContainerFilterValue(value: string): TransactionFilters['container'] {
    const [kind, id] = splitChoice(value);
    if (id === null) {
        return null;
    }
    return kind === 'account' ? { kind: 'account', accountId: id } : kind === 'creditCard' ? { kind: 'creditCard', creditCardId: id } : null;
}

/**
 * Valor do campo "Categoria": a categoria inteira ou uma subcategoria.
 *
 * @param filter Filtro de categoria.
 * @return `category:<id>`, `subCategory:<id>` ou vazio para "Todas".
 */
export function categoryFilterValue(filter: TransactionFilters['category']): string {
    if (filter === null) {
        return '';
    }
    return filter.kind === 'category' ? `category:${filter.categoryId}` : `subCategory:${filter.subCategoryId}`;
}

/**
 * @param value Valor escolhido no campo "Categoria".
 * @return O filtro; `null` para "Todas" ou um valor que a tela não produz.
 */
export function parseCategoryFilterValue(value: string): TransactionFilters['category'] {
    const [kind, id] = splitChoice(value);
    if (id === null) {
        return null;
    }
    return kind === 'category' ? { kind: 'category', categoryId: id } : kind === 'subCategory' ? { kind: 'subCategory', subCategoryId: id } : null;
}

/**
 * @param value `tipo:id` de um campo de escolha.
 * @return O tipo e o id; o id é `null` quando o valor não tem os dois.
 */
function splitChoice(value: string): readonly [string, string | null] {
    const separator = value.indexOf(':');
    return separator <= 0 || separator === value.length - 1 ? [value, null] : [value.slice(0, separator), value.slice(separator + 1)];
}

/** Todos os parâmetros, com `undefined` explícito nos vazios. */
type SearchDraft = { readonly [K in keyof TransactionsSearch]-?: TransactionsSearch[K] | undefined };

/**
 * @param draft Parâmetros com possíveis `undefined`.
 * @return Os mesmos parâmetros sem as chaves vazias, que sob `exactOptionalPropertyTypes` não
 * podem ficar presentes com `undefined` — e que deixariam `?q=` sobrando na URL.
 */
function withoutEmpty(draft: SearchDraft): TransactionsSearch {
    return {
        ...(draft.q === undefined ? {} : { q: draft.q }),
        ...(draft.account === undefined ? {} : { account: draft.account }),
        ...(draft.card === undefined ? {} : { card: draft.card }),
        ...(draft.category === undefined ? {} : { category: draft.category }),
        ...(draft.subCategory === undefined ? {} : { subCategory: draft.subCategory }),
        ...(draft.tag === undefined ? {} : { tag: draft.tag }),
        ...(draft.situation === undefined ? {} : { situation: draft.situation }),
    };
}
