import {
    formatTransactionSituation,
    NO_TRANSACTION_FILTERS,
    TRANSACTION_SITUATIONS,
    useAccounts,
    useCategoryTree,
    useCreditCards,
    useTags,
    type TransactionFilters,
    type TransactionSituation,
} from '@finance/client';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button.tsx';
import { SelectField, type SelectOption } from '../ui/Select.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/** Valor que representa "Todos" nas escolhas; nenhum id do núcleo tem esse formato. */
const ALL = 'all';

/**
 * @param filters Filtros da tela.
 * @return Quantos filtros estão escolhidos (a busca fica de fora: tem campo próprio).
 */
export function countActiveFilters(filters: TransactionFilters): number {
    return [filters.container, filters.category, filters.tagId, filters.situation].filter((value) => value !== null).length;
}

/**
 * @param container Conta ou cartão escolhido.
 * @return O valor da escolha na lista (`account:<id>`, `card:<id>`), ou "Todos".
 */
function containerValue(container: TransactionFilters['container']): string {
    if (container === null) {
        return ALL;
    }
    return container.kind === 'account' ? `account:${container.accountId}` : `card:${container.creditCardId}`;
}

/**
 * @param value Valor escolhido na lista.
 * @return O filtro de conta ou cartão correspondente.
 */
function parseContainer(value: string): TransactionFilters['container'] {
    if (value.startsWith('account:')) {
        return { kind: 'account', accountId: value.slice('account:'.length) };
    }
    if (value.startsWith('card:')) {
        return { kind: 'creditCard', creditCardId: value.slice('card:'.length) };
    }
    return null;
}

/**
 * @param category Categoria ou subcategoria escolhida.
 * @return O valor da escolha na lista (`category:<id>`, `sub:<id>`), ou "Todas".
 */
function categoryValue(category: TransactionFilters['category']): string {
    if (category === null) {
        return ALL;
    }
    return category.kind === 'category' ? `category:${category.categoryId}` : `sub:${category.subCategoryId}`;
}

/**
 * @param value Valor escolhido na lista.
 * @return O filtro de categoria correspondente.
 */
function parseCategory(value: string): TransactionFilters['category'] {
    if (value.startsWith('category:')) {
        return { kind: 'category', categoryId: value.slice('category:'.length) };
    }
    if (value.startsWith('sub:')) {
        return { kind: 'subCategory', subCategoryId: value.slice('sub:'.length) };
    }
    return null;
}

/**
 * @param value Valor escolhido na lista.
 * @return A situação escolhida, ou `null` para "Todas".
 */
function parseSituation(value: string): TransactionSituation | null {
    return TRANSACTION_SITUATIONS.find((situation) => situation === value) ?? null;
}

/**
 * Filtros de Transações numa folha inferior (mobile-mvp-plan, Fase 9): conta ou cartão,
 * categoria ou subcategoria, tag e situação — os mesmos do desktop, aplicados pelo mesmo
 * `buildTransactionTable`. Cada escolha muda a lista na hora; "Limpar filtros" volta a tudo, e a
 * busca, que tem campo próprio na tela, fica como está.
 *
 * @param props.open Se a folha está aberta.
 * @param props.onClose Fecha a folha.
 * @param props.profileId Perfil ativo, para as opções.
 * @param props.period Mês de referência, a chave das consultas de contas e cartões já em cache.
 * @param props.filters Filtros atuais.
 * @param props.onChange Novos filtros.
 * @return A folha.
 */
export function TransactionFiltersSheet(props: {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly profileId: string;
    readonly period: string;
    readonly filters: TransactionFilters;
    readonly onChange: (filters: TransactionFilters) => void;
}): ReactNode {
    const { open, onClose, profileId, period, filters, onChange } = props;
    const accounts = useAccounts({ profileId, period });
    const creditCards = useCreditCards({ profileId, period });
    const categories = useCategoryTree({ profileId });
    const tags = useTags({ profileId });

    const containers: SelectOption<string>[] = [
        { value: ALL, label: 'Todas as contas e cartões' },
        ...(accounts.data?.accounts ?? []).map((account) => ({ value: `account:${account.id}`, label: account.name, description: 'Conta' })),
        ...(creditCards.data?.creditCards ?? []).map((card) => ({ value: `card:${card.id}`, label: card.name, description: 'Cartão' })),
    ];
    const categoryOptions: SelectOption<string>[] = [
        { value: ALL, label: 'Todas as categorias' },
        ...(categories.data ?? []).flatMap((category) => [
            { value: `category:${category.id}`, label: category.name, description: 'Categoria inteira' },
            ...category.subCategories.map((sub) => ({ value: `sub:${sub.id}`, label: `${category.name} › ${sub.name}` })),
        ]),
    ];
    const tagOptions: SelectOption<string>[] = [{ value: ALL, label: 'Todas as tags' }, ...(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))];
    const situations: SelectOption<string>[] = [{ value: ALL, label: 'Todas as situações' }, ...TRANSACTION_SITUATIONS.map((situation) => ({ value: situation, label: formatTransactionSituation(situation) }))];

    return (
        <Sheet open={open} onClose={onClose} title="Filtros">
            <SelectField
                label="Conta ou cartão"
                options={containers}
                value={containerValue(filters.container)}
                onChange={(value) => {
                    onChange({ ...filters, container: parseContainer(value) });
                }}
            />
            <SelectField
                label="Categoria"
                options={categoryOptions}
                value={categoryValue(filters.category)}
                onChange={(value) => {
                    onChange({ ...filters, category: parseCategory(value) });
                }}
            />
            <SelectField
                label="Tag"
                options={tagOptions}
                value={filters.tagId ?? ALL}
                onChange={(value) => {
                    onChange({ ...filters, tagId: value === ALL ? null : value });
                }}
            />
            <SelectField
                label="Situação"
                options={situations}
                value={filters.situation ?? ALL}
                onChange={(value) => {
                    onChange({ ...filters, situation: parseSituation(value) });
                }}
            />
            <Button
                label="Limpar filtros"
                variant="secondary"
                disabled={countActiveFilters(filters) === 0}
                onPress={() => {
                    onChange({ ...NO_TRANSACTION_FILTERS, search: filters.search });
                }}
            />
        </Sheet>
    );
}
