import type { AccountResponse, CategoryBranchResponse, CoreInput, CreditCardResponse, ImportAnalysis, ImportOptions, PlannedRow, ProfileResponse } from '@finance/core';
import type { ImportRowInput } from './interpretRows.ts';

/*
 * View-model da etapa Revisar (mockup `DesktopImportRevisar`; import-design §5). Guarda as
 * decisões do usuário e monta, a partir delas e da análise do núcleo, o que a tela mostra e a
 * entrada da rota `imports.run`.
 */

/** Decisão sobre uma conta do arquivo. */
export interface ReviewAccount {
    readonly name: string;
    readonly rows: number;
    readonly profileId: string;
    /** Conta existente ligada; `null` cria uma nova. */
    readonly linkTo: string | null;
    readonly type: AccountResponse['type'];
    readonly considerBalance: boolean;
}

/** Decisão sobre um cartão do arquivo. */
export interface ReviewCard {
    readonly name: string;
    readonly rows: number;
    /** Conta do arquivo que paga a fatura (só no cartão novo). */
    readonly payingAccount: string;
    /** Cartão existente ligado; `null` cria um novo. */
    readonly linkTo: string | null;
    readonly dueDay: number;
    /** Obrigatório no cartão novo; `null` enquanto o usuário não informou. */
    readonly closingDay: number | null;
    /** Sugestão do núcleo pelas datas de compra. */
    readonly closingSuggestion: number | null;
    readonly limit: number;
}

/** Todas as decisões da revisão. */
export interface ReviewState {
    readonly accounts: readonly ReviewAccount[];
    readonly cards: readonly ReviewCard[];
    readonly options: ImportOptions;
    readonly transferCategory: { readonly category: string; readonly subCategory: string };
    readonly exportCopy: boolean;
}

/** Contas e cartões ativos que a revisão pode ligar, de todos os perfis. */
export interface ExistingRegistries {
    readonly accounts: readonly AccountResponse[];
    readonly creditCards: readonly CreditCardResponse[];
}

/** Opções padrão da revisão, as marcadas no mockup. */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { groupSeries: true, keepFutureOccurrences: true, hashtagsAsTags: true, pastDueAsPaid: false };

/** Categoria das transferências sugerida (import-design §5.2). */
export const DEFAULT_TRANSFER_CATEGORY = { category: 'Transferências', subCategory: 'Entre contas' } as const;

/**
 * Mesma comparação de nomes do núcleo (`sameName`: sem diferença de caixa, acento composto igual).
 * Não usa a busca, que ignora acentos: "Saude" e "Saúde" são categorias diferentes no núcleo, e a
 * prévia diria "já existe" para uma categoria que a importação cria.
 *
 * @param a Primeiro nome.
 * @param b Segundo nome.
 * @return `true` quando são o mesmo nome para o usuário.
 */
function sameName(a: string, b: string): boolean {
    return foldName(a) === foldName(b);
}

/**
 * @param name Nome.
 * @return A forma comparável do nome, a mesma do núcleo.
 */
function foldName(name: string): string {
    return name.trim().normalize('NFC').toLowerCase();
}

/**
 * Decisões iniciais: toda conta vai para o perfil padrão e liga à conta ativa de mesmo nome que já
 * existir lá; senão é criada como corrente, no saldo total. O cartão liga ao de mesmo nome no
 * perfil da pagadora; senão é criado, com o fechamento em branco — o arquivo não o traz, e o
 * usuário precisa confirmá-lo (import-design §5.1).
 *
 * @param analysis Análise do núcleo.
 * @param defaultProfileId Perfil padrão (o ativo).
 * @param existing Contas e cartões ativos.
 * @param options Opções escolhidas até aqui.
 * @return O estado inicial da revisão.
 */
export function initialReview(analysis: ImportAnalysis, defaultProfileId: string, existing: ExistingRegistries, options: ImportOptions = DEFAULT_IMPORT_OPTIONS): ReviewState {
    const accounts = analysis.accounts.map((use): ReviewAccount => ({
        name: use.name,
        rows: use.rows,
        profileId: defaultProfileId,
        linkTo: existing.accounts.find((account) => account.profileId === defaultProfileId && sameName(account.name, use.name))?.id ?? null,
        type: 'checking',
        considerBalance: true,
    }));
    const cards = analysis.creditCards.map((use): ReviewCard => ({
        name: use.name,
        rows: use.rows,
        payingAccount: use.payingAccount,
        linkTo: existing.creditCards.find((card) => card.profileId === defaultProfileId && sameName(card.name, use.name))?.id ?? null,
        dueDay: use.dueDay,
        closingDay: null,
        closingSuggestion: use.closingDay,
        limit: 0,
    }));
    return { accounts, cards, options, transferCategory: DEFAULT_TRANSFER_CATEGORY, exportCopy: true };
}

/**
 * Mantém as decisões já tomadas quando a revisão é refeita — o usuário voltou às colunas e avançou
 * de novo. As contas e os cartões que continuam no arquivo guardam o que o usuário escolheu; os
 * novos entram com a decisão inicial, e os que saíram do arquivo somem.
 *
 * @param previous Revisão anterior.
 * @param fresh Revisão inicial da análise nova (`initialReview`).
 * @return A revisão nova com as decisões anteriores.
 */
export function carryOverReview(previous: ReviewState, fresh: ReviewState): ReviewState {
    return {
        ...previous,
        accounts: fresh.accounts.map((account) => {
            const kept = previous.accounts.find((item) => sameName(item.name, account.name));
            return kept === undefined ? account : { ...kept, rows: account.rows };
        }),
        cards: fresh.cards.map((card) => {
            const kept = previous.cards.find((item) => sameName(item.name, card.name));
            return kept === undefined ? card : { ...kept, rows: card.rows, dueDay: card.dueDay, closingSuggestion: card.closingSuggestion };
        }),
    };
}

/**
 * Troca o perfil de uma conta. A ligação a uma conta do perfil antigo cai, porque "Ligar a" lista
 * só as contas do perfil escolhido; a de mesmo nome no perfil novo é ligada sozinha. O cartão novo
 * acompanha a pagadora (`cardProfileId`); o ligado continua no perfil dele.
 *
 * @param state Estado atual.
 * @param name Conta do arquivo; `null` aplica a todas ("Aplicar a todas as contas").
 * @param profileId Perfil escolhido.
 * @param existing Contas e cartões ativos.
 * @return O novo estado.
 */
export function withAccountProfile(state: ReviewState, name: string | null, profileId: string, existing: ExistingRegistries): ReviewState {
    const accounts = state.accounts.map((account) => (name !== null && account.name !== name ? account : {
        ...account,
        profileId,
        linkTo: existing.accounts.find((item) => item.profileId === profileId && sameName(item.name, account.name))?.id ?? null,
    }));
    return { ...state, accounts };
}

/**
 * Regra de negócio (Importação, import-design §5.1): o cartão fica no perfil da conta que paga a
 * fatura; o cartão ligado, no perfil dele.
 *
 * @param state Estado atual.
 * @param card Cartão do arquivo.
 * @param existing Contas e cartões ativos.
 * @return O perfil do cartão; `null` quando a pagadora não é uma conta do arquivo.
 */
export function cardProfileId(state: ReviewState, card: ReviewCard, existing: ExistingRegistries): string | null {
    if (card.linkTo !== null) {
        return existing.creditCards.find((item) => item.id === card.linkTo)?.profileId ?? null;
    }
    return state.accounts.find((account) => sameName(account.name, card.payingAccount))?.profileId ?? null;
}

/**
 * O que ainda impede a importação — o "Falta:" ao lado do botão, que fica desabilitado enquanto a
 * lista não estiver vazia (mockup `DesktopImportRevisar`).
 *
 * @param state Estado atual.
 * @return As pendências, prontas para a frase; vazia quando dá para importar.
 */
export function reviewPending(state: ReviewState): readonly string[] {
    const pending: string[] = [];
    const missingClosing = state.cards.filter((card) => card.linkTo === null && card.closingDay === null).length;
    if (missingClosing > 0) {
        pending.push(missingClosing === 1 ? 'fechamento de 1 cartão' : `fechamento de ${String(missingClosing)} cartões`);
    }
    if (state.transferCategory.category.trim() === '' || state.transferCategory.subCategory.trim() === '') {
        pending.push('categoria das transferências');
    }
    return pending;
}

/** Linhas e contas de um perfil, para a barra "Divisão das linhas". */
export interface ProfileShare {
    readonly profile: ProfileResponse;
    readonly rows: number;
    readonly accounts: readonly string[];
}

/**
 * @param analysis Análise do núcleo.
 * @param state Estado atual.
 * @param profiles Perfis existentes.
 * @param existing Contas e cartões ativos.
 * @return Quantas linhas vão para cada perfil, e por quais contas — na ordem dos perfis.
 */
export function profileShares(analysis: ImportAnalysis, state: ReviewState, profiles: readonly ProfileResponse[], existing: ExistingRegistries): readonly ProfileShare[] {
    const rows = new Map<string, number>();
    for (const item of plannedRows(analysis)) {
        const profileId = rowProfileId(item, state, existing);
        if (profileId !== null) {
            rows.set(profileId, (rows.get(profileId) ?? 0) + 1);
        }
    }
    return profiles.map((profile) => ({
        profile,
        rows: rows.get(profile.id) ?? 0,
        accounts: state.accounts.filter((account) => account.profileId === profile.id).map((account) => account.name),
    }));
}

/** Categorias de um perfil: as que já existem e as que serão criadas. */
export interface ProfileCategories {
    readonly profile: ProfileResponse;
    /** "Categoria › Subcategoria" já existentes no perfil. */
    readonly existing: readonly string[];
    /** "Categoria › Subcategoria" que a importação cria no perfil. */
    readonly created: readonly string[];
}

/**
 * Regra de negócio (Importação, import-design §5.2): a categoria é procurada pelo nome no perfil da
 * linha e criada quando falta; a mesma categoria em perfis diferentes é criada em cada um.
 *
 * @param analysis Análise do núcleo.
 * @param state Estado atual.
 * @param profiles Perfis existentes.
 * @param existing Contas e cartões ativos.
 * @param trees Árvore de categorias de cada perfil.
 * @return Para cada perfil que recebe linhas, os pares existentes e os que serão criados.
 */
export function profileCategories(
    analysis: ImportAnalysis,
    state: ReviewState,
    profiles: readonly ProfileResponse[],
    existing: ExistingRegistries,
    trees: ReadonlyMap<string, readonly CategoryBranchResponse[]>,
): readonly ProfileCategories[] {
    const pairs = new Map<string, Map<string, { readonly category: string; readonly subCategory: string }>>();
    /**
     * @param profileId Perfil que recebe o par.
     * @param category Categoria.
     * @param subCategory Subcategoria.
     */
    const add = (profileId: string, category: string, subCategory: string): void => {
        const byProfile = pairs.get(profileId) ?? new Map<string, { readonly category: string; readonly subCategory: string }>();
        byProfile.set(`${foldName(category)}\u0000${foldName(subCategory)}`, { category, subCategory });
        pairs.set(profileId, byProfile);
    };
    for (const use of analysis.categories) {
        const profileId = use.source.kind === 'account'
            ? state.accounts.find((account) => sameName(account.name, use.source.name))?.profileId ?? null
            : cardFor(state, use.source.name, existing);
        if (profileId !== null) {
            add(profileId, use.category, use.subCategory);
        }
    }
    for (const item of plannedRows(analysis)) {
        const profileId = item.row.type === 'transference' ? rowProfileId(item, state, existing) : null;
        if (profileId !== null) {
            add(profileId, state.transferCategory.category, state.transferCategory.subCategory);
        }
    }
    return profiles.flatMap((profile) => {
        const used = pairs.get(profile.id);
        if (used === undefined) {
            return [];
        }
        const tree = trees.get(profile.id) ?? [];
        const existingPairs: string[] = [];
        const created: string[] = [];
        for (const { category, subCategory } of used.values()) {
            const branch = tree.find((item) => sameName(item.name, category));
            const label = `${category} › ${subCategory}`;
            if (branch?.subCategories.some((sub) => sameName(sub.name, subCategory)) === true) {
                existingPairs.push(label);
            } else {
                created.push(label);
            }
        }
        return [{ profile, existing: existingPairs, created }];
    });
}

/**
 * @param state Estado atual.
 * @param name Cartão do arquivo.
 * @param existing Contas e cartões ativos.
 * @return O perfil do cartão, ou `null` sem pagadora resolvida.
 */
function cardFor(state: ReviewState, name: string, existing: ExistingRegistries): string | null {
    const card = state.cards.find((item) => sameName(item.name, name));
    return card === undefined ? null : cardProfileId(state, card, existing);
}

/**
 * @param analysis Análise do núcleo.
 * @return Todas as linhas aceitas, avulsas e de séries.
 */
function plannedRows(analysis: ImportAnalysis): readonly PlannedRow[] {
    return [...analysis.standalone, ...analysis.series.flatMap((series) => series.occurrences)];
}

/**
 * Regra de negócio (Importação, import-design §5.1): o lançamento vai para o perfil da conta de
 * origem; a compra no cartão, para o perfil do cartão.
 *
 * @param item Linha aceita.
 * @param state Estado atual.
 * @param existing Contas e cartões ativos.
 * @return O perfil da linha, ou `null` sem decisão.
 */
function rowProfileId(item: PlannedRow, state: ReviewState, existing: ExistingRegistries): string | null {
    if (item.creditCard !== null) {
        return cardFor(state, item.creditCard, existing);
    }
    return state.accounts.find((account) => sameName(account.name, item.row.account))?.profileId ?? null;
}

/**
 * Monta a entrada da rota `imports.run` com as decisões da revisão.
 *
 * @param rows Linhas lidas pelo client — as mesmas que a análise recebeu.
 * @param state Decisões da revisão; o fechamento do cartão novo já precisa estar preenchido
 * (`reviewPending` vazio).
 * @return A entrada da rota.
 */
export function importRunInput(rows: readonly ImportRowInput[], state: ReviewState): CoreInput<'imports.run'> {
    return {
        rows: [...rows],
        options: state.options,
        accounts: state.accounts.map((account) => ({
            name: account.name,
            profileId: account.profileId,
            target: account.linkTo === null
                ? { kind: 'create', type: account.type, considerBalance: account.considerBalance }
                : { kind: 'link', accountId: account.linkTo },
        })),
        creditCards: state.cards.map((card) => ({
            name: card.name,
            target: card.linkTo === null
                ? { kind: 'create', payingAccount: card.payingAccount, closingDay: card.closingDay ?? card.closingSuggestion ?? 1, dueDay: card.dueDay, limit: card.limit }
                : { kind: 'link', creditCardId: card.linkTo },
        })),
        transferCategory: state.transferCategory,
    };
}
