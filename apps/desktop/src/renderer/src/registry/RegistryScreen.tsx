import { useAccounts, useCategoryTree, useCreditCards, useNotes, useTags } from '@finance/client';
import { Link, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';
import { AccountsSection } from './AccountsSection.tsx';
import { CategoriesSection } from './CategoriesSection.tsx';
import { CreditCardsSection } from './CreditCardsSection.tsx';
import { NotesSection } from './NotesSection.tsx';
import { ProfilesSection } from './ProfilesSection.tsx';
import { categoryCounter, openKind, parseRegistrySearch, REGISTRY_KINDS, type RegistryKind, type RegistryKindItem } from './registryKinds.ts';
import { TagsSection } from './TagsSection.tsx';

/**
 * Cadastros (mockup `DesktopCadastros`; desktop-mvp-plan Fase 6): à esquerda a lista de tipos
 * com os contadores, à direita o cadastro aberto. O tipo aberto fica na URL (`kind`), para que
 * voltar no histórico devolva o mesmo cadastro.
 *
 * As listas de contas e cartões pedem um mês porque as rotas também servem às telas Contas e
 * Cartões; aqui só o cadastro importa, e o mês de referência, escondido nesta tela, serve de
 * entrada — o mesmo cache que aquelas telas já usam.
 *
 * @return A tela de Cadastros.
 */
export function RegistryScreen(): ReactNode {
    const { profile, profiles } = useActiveProfile();
    const { period } = useReferenceMonth();
    // Lida pelo `parseRegistrySearch`, e não pelo tipo da rota, pelo mesmo motivo do
    // `useReferenceMonth`: a tela é importada pelo próprio roteador.
    const kind = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => openKind(parseRegistrySearch(raw)) });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const notes = useNotes({ profileId: profile.id });

    const counters: Readonly<Partial<Record<RegistryKind, string | undefined>>> = {
        accounts: accounts.data === undefined ? undefined : String(accounts.data.accounts.length),
        cards: creditCards.data === undefined ? undefined : String(creditCards.data.creditCards.length),
        categories: categories.data === undefined ? undefined : categoryCounter(categories.data),
        tags: tags.data === undefined ? undefined : String(tags.data.length),
        profiles: String(profiles.length),
        notes: notes.data === undefined ? undefined : String(notes.data.length),
    };

    return (
        <div className="-mx-8 -my-6 flex flex-1">
            <section aria-label="Tipos de cadastro" className="flex w-75 shrink-0 flex-col border-r border-line bg-surface">
                <div className="px-5 pt-5 pb-3">
                    <h1 className="text-20 font-semibold">Cadastros</h1>
                </div>
                <ul>
                    {REGISTRY_KINDS.map((item) => (
                        <KindLink key={item.kind} item={item} current={item.kind === kind} counter={counters[item.kind]} />
                    ))}
                </ul>
                <p className="border-t border-line2 px-5 py-3.5 text-12 text-muted">
                    {profile.type === 'business' ? 'Sócios do perfil empresarial chegam numa próxima versão do app.' : 'Sócios aparecem aqui só em perfil empresarial.'}
                </p>
            </section>
            <div className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-6">
                <OpenSection kind={kind} accounts={accounts} creditCards={creditCards} categories={categories} tags={tags} notes={notes} />
            </div>
        </div>
    );
}

/**
 * Item da lista lateral: o nome e o contador, marcado quando é o tipo aberto.
 *
 * @param props.item Tipo de cadastro.
 * @param props.current Se é o tipo aberto.
 * @param props.counter Contador; ausente enquanto carrega e nos tipos fora do MVP.
 * @return O link do tipo.
 */
function KindLink({ item, current, counter }: { readonly item: RegistryKindItem; readonly current: boolean; readonly counter: string | undefined }): ReactNode {
    return (
        <li>
            <Link
                to="/registry"
                search={{ kind: item.kind }}
                aria-current={current ? 'page' : undefined}
                className={cn(
                    'flex items-center justify-between gap-3 border-t border-line2 px-5 py-3 text-14 text-ink hover:bg-surface2',
                    current && 'bg-soft font-semibold shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
                )}
            >
                <span>{item.label}</span>
                {counter !== undefined && <span className="text-12 font-normal text-muted tabular-nums">{counter}</span>}
            </Link>
        </li>
    );
}

/**
 * A seção do tipo aberto. As consultas vêm de cima porque são as mesmas que alimentam os
 * contadores; buscar de novo em cada seção duplicaria o estado de carregamento.
 *
 * @param props.kind Tipo aberto.
 * @param props.accounts Lista de contas do perfil.
 * @param props.creditCards Lista de cartões do perfil.
 * @param props.categories Árvore de categorias do perfil.
 * @param props.tags Tags do perfil, com o uso.
 * @param props.notes Anotações do perfil.
 * @return A seção.
 */
function OpenSection({
    kind,
    accounts,
    creditCards,
    categories,
    tags,
    notes,
}: {
    readonly kind: RegistryKind;
    readonly accounts: ReturnType<typeof useAccounts>;
    readonly creditCards: ReturnType<typeof useCreditCards>;
    readonly categories: ReturnType<typeof useCategoryTree>;
    readonly tags: ReturnType<typeof useTags>;
    readonly notes: ReturnType<typeof useNotes>;
}): ReactNode {
    switch (kind) {
        case 'accounts':
            return <AccountsSection query={accounts} />;
        case 'cards':
            return <CreditCardsSection query={creditCards} accounts={accounts} />;
        case 'categories':
            return <CategoriesSection query={categories} />;
        case 'profiles':
            return <ProfilesSection />;
        case 'tags':
            return <TagsSection query={tags} />;
        case 'notes':
            return <NotesSection query={notes} />;
    }
}
