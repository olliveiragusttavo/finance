import type { CategoryBranchResponse } from '@finance/core';
import { z } from 'zod';

/*
 * Tipos de cadastro da tela Cadastros (mockup `DesktopCadastros`; desktop-mvp-plan Fase 6). A
 * lista lateral escolhe o tipo, e não abas no topo (decisão de interface 4 dos mockups).
 */

/** Tipo de cadastro, o *search param* `kind` da rota `/registry`. */
export type RegistryKind = 'accounts' | 'cards' | 'categories' | 'tags' | 'partners' | 'profiles' | 'notes';

/** Item da lista lateral. */
export interface RegistryKindItem {
    readonly kind: RegistryKind;
    readonly label: string;
    /** Só aparece em perfil empresarial (Sócios). */
    readonly businessOnly: boolean;
}

/** Tipos na ordem do mockup (`DesktopSocios` mostra a lista completa). */
export const REGISTRY_KINDS: readonly RegistryKindItem[] = [
    { kind: 'accounts', label: 'Contas', businessOnly: false },
    { kind: 'cards', label: 'Cartões', businessOnly: false },
    { kind: 'categories', label: 'Categorias', businessOnly: false },
    { kind: 'tags', label: 'Tags', businessOnly: false },
    { kind: 'partners', label: 'Sócios', businessOnly: true },
    { kind: 'profiles', label: 'Perfis', businessOnly: false },
    { kind: 'notes', label: 'Anotações', businessOnly: false },
];

/**
 * Regra de negócio (Perfis): sócio só existe em perfil empresarial (database-design §4.2), então
 * o tipo Sócios some da lista no perfil pessoal, como "Por sócio" some do menu de Relatórios.
 *
 * @param type Tipo do perfil ativo.
 * @return Os tipos que a lista lateral mostra para o perfil, na ordem do mockup.
 */
export function registryKindsFor(type: 'personal' | 'business'): readonly RegistryKindItem[] {
    return REGISTRY_KINDS.filter((item) => !item.businessOnly || type === 'business');
}

/** Parâmetros de busca próprios da tela de Cadastros. */
export interface RegistrySearch {
    /** Tipo aberto; ausente abre o primeiro, Contas. */
    readonly kind?: RegistryKind;
    /**
     * Anotação a abrir no editor, para outras telas levarem a ela (a lista de anotações da Visão
     * geral, desktop-mvp-plan Fase 13.2); só vale com `kind` = `notes`.
     */
    readonly note?: string;
}

/** Os mesmos tipos da união, para validar a URL; o `satisfies` recusa nome fora dela. */
const kindSchema = z.enum(['accounts', 'cards', 'categories', 'tags', 'partners', 'profiles', 'notes'] as const satisfies readonly RegistryKind[]);

/** Id da anotação pedida: qualquer texto não vazio; a que não existe mais só não abre. */
const noteSchema = z.string().min(1);

/**
 * Valida a busca da URL. Tipo desconhecido (URL editada, histórico antigo) é descartado em vez
 * de derrubar a rota: a tela abre no tipo padrão. A anotação só vai junto com o tipo Anotações.
 *
 * @param search Busca crua, como o roteador a leu.
 * @return O tipo, quando ele é válido, e a anotação pedida, quando o tipo é Anotações.
 */
export function parseRegistrySearch(search: Readonly<Record<string, unknown>>): RegistrySearch {
    const kind = kindSchema.safeParse(search['kind']);
    if (!kind.success) {
        return {};
    }
    const note = noteSchema.safeParse(search['note']);
    return kind.data === 'notes' && note.success ? { kind: kind.data, note: note.data } : { kind: kind.data };
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
