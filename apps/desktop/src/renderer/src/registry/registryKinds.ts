import type { CategoryBranchResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Tipos de cadastro da tela Cadastros (mockup `DesktopCadastros`; desktop-mvp-plan Fase 6). A
 * lista lateral escolhe o tipo, e não abas no topo (decisão de interface 4 dos mockups).
 */

/** Tipo de cadastro, o *search param* `kind` da rota `/registry`. */
export type RegistryKind = 'accounts' | 'cards' | 'categories' | 'tags' | 'profiles' | 'notes';

/** Item da lista lateral. */
export interface RegistryKindItem {
    readonly kind: RegistryKind;
    readonly label: string;
}

/** Tipos na ordem do mockup. */
export const REGISTRY_KINDS: readonly RegistryKindItem[] = [
    { kind: 'accounts', label: 'Contas' },
    { kind: 'cards', label: 'Cartões' },
    { kind: 'categories', label: 'Categorias' },
    { kind: 'tags', label: 'Tags' },
    { kind: 'profiles', label: 'Perfis' },
    { kind: 'notes', label: 'Anotações' },
];

/** Parâmetros de busca próprios da tela de Cadastros. */
export interface RegistrySearch {
    /** Tipo aberto; ausente abre o primeiro, Contas. */
    readonly kind?: RegistryKind;
}

/** Os mesmos tipos da união, para validar a URL; o `satisfies` recusa nome fora dela. */
const kindSchema = z.enum(['accounts', 'cards', 'categories', 'tags', 'profiles', 'notes'] as const satisfies readonly RegistryKind[]);

/**
 * Valida a busca da URL. Tipo desconhecido (URL editada, histórico antigo) é descartado em vez
 * de derrubar a rota: a tela abre no tipo padrão.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return Só o tipo, quando ele é válido.
 */
export function parseRegistrySearch(search: Readonly<Record<string, unknown>>): RegistrySearch {
    const parsed = kindSchema.safeParse(search['kind']);
    return parsed.success ? { kind: parsed.data } : {};
}

/**
 * @param search Busca já validada.
 * @return O tipo aberto; Contas quando a URL não diz, o primeiro da lista.
 */
export function openKind(search: RegistrySearch): RegistryKind {
    return search.kind ?? 'accounts';
}

/**
 * Contador das categorias na lista lateral, no formato do mockup (`8 · 17 sub`): as duas
 * contagens juntas porque toda transação aponta para uma subcategoria, e uma categoria sem
 * subcategoria não serve para lançar.
 *
 * @param tree Árvore de categorias do perfil.
 * @return O contador.
 */
export function categoryCounter(tree: readonly CategoryBranchResponse[]): string {
    const subCategories = tree.reduce((total, branch) => total + branch.subCategories.length, 0);
    return `${String(tree.length)} · ${String(subCategories)} sub`;
}
