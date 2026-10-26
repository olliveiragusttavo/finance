import { useCategoryTree, useCoreMutation } from '@finance/client';
import type { CategoryBranchResponse, SubCategoryUsageResponse } from '@finance/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { FormDialog } from '@/components/entityUi';
import { Field, fieldAria } from '@/components/form';
import { DetailPane, ListPane, PaneLayout } from '@/components/PaneLayout';
import { EmptyState, QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { reportRejection } from '@/lib/coreErrorField';
import { readNameForm } from '@/lib/nameForm';
import { useActiveProfile } from '@/shell/activeProfile';
import { categoryTransactionCount, filterCategories, formatCategoryCount, openCategory, parseCategoriesSearch } from './categoriesSearch.ts';
import { moveTargets, transactionsToMove, type CategoryDeletionTarget } from './categoryMoves.ts';

/** Rótulo do campo do nome da subcategoria, com artigo, para a frase do campo vazio. */
const SUB_CATEGORY_NAME_LABEL = 'o nome da subcategoria';

/** Diálogo aberto na tela. */
type CategoryDialogState =
    | { readonly mode: 'createCategory' }
    | { readonly mode: 'renameCategory'; readonly category: CategoryBranchResponse }
    | { readonly mode: 'renameSubCategory'; readonly subCategory: SubCategoryUsageResponse }
    | { readonly mode: 'delete'; readonly target: CategoryDeletionTarget };

/**
 * Categorias, item próprio do menu (desktop-mvp-plan Fases 6, 13.11 e 13.12): à esquerda a lista
 * das categorias com a busca, à direita as subcategorias da categoria aberta, como Contas e
 * Cartões. A categoria aberta fica na URL (`category`); a busca, não, porque é só um atalho
 * para achar a categoria e não deve voltar ao reabrir a tela.
 *
 * Diverge do mockup em três pontos, decididos com o usuário: sem "Mover para" (o núcleo não
 * move subcategoria entre categorias), sem o total do mês (a tela não depende do mês de
 * referência, decisão de interface 2 — os relatórios mostram os valores) e sem
 * reordenar (o núcleo não guarda ordem de categorias).
 *
 * @return A tela de categorias.
 */
export function CategoriesScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const navigate = useNavigate();
    // Lida pelo `parseCategoriesSearch`, e não pelo tipo da rota, pelo mesmo motivo de Contas: a
    // tela é importada pelo próprio roteador.
    const search = useSearch({ strict: false, select: (raw: Readonly<Record<string, unknown>>) => parseCategoriesSearch(raw) });
    const query = useCategoryTree({ profileId: profile.id });
    const [filter, setFilter] = useState('');
    const [dialog, setDialog] = useState<CategoryDialogState | null>(null);
    const close = (): void => {
        setDialog(null);
    };
    const tree = query.data ?? [];

    return (
        <PaneLayout>
            <QueryState query={query} loading={<CategoryListSkeleton />}>
                {(branches) => {
                    const visible = filterCategories(branches, filter);
                    const open = openCategory(branches, visible, search);
                    return (
                        <>
                            <CategoryList
                                categories={visible}
                                empty={branches.length === 0}
                                filter={filter}
                                onFilterChange={setFilter}
                                openId={open?.id ?? null}
                                onCreate={() => {
                                    setDialog({ mode: 'createCategory' });
                                }}
                            />
                            <DetailPane label="Categoria">
                                {open === null ? (
                                    branches.length === 0 ? (
                                        <EmptyState title="Nenhuma categoria" description="Crie uma categoria e as subcategorias que classificam os lançamentos." />
                                    ) : (
                                        <EmptyState title="Nenhuma categoria encontrada" description="Mude o texto da busca para ver as outras categorias." />
                                    )
                                ) : (
                                    <CategoryDetail key={open.id} category={open} onOpen={setDialog} />
                                )}
                            </DetailPane>
                        </>
                    );
                }}
            </QueryState>
            {dialog?.mode === 'createCategory' && (
                <CategoryNameDialog
                    category={null}
                    onClose={close}
                    onCreated={(id) => {
                        // A busca sai para que a categoria nova apareça marcada na lista.
                        setFilter('');
                        void navigate({ to: '/categories', search: { category: id } });
                    }}
                />
            )}
            {dialog?.mode === 'renameCategory' && <CategoryNameDialog category={dialog.category} onClose={close} onCreated={undefined} />}
            {dialog?.mode === 'renameSubCategory' && <SubCategoryRenameDialog subCategory={dialog.subCategory} onClose={close} />}
            {dialog?.mode === 'delete' && (
                <CategoryDeletionDialog
                    tree={tree}
                    target={dialog.target}
                    onClose={close}
                    onDeleted={() => {
                        // A categoria excluída sai da URL; a tela abre a primeira da lista.
                        if (dialog.target.kind === 'category') {
                            void navigate({ to: '/categories', search: {} });
                        }
                    }}
                />
            )}
        </PaneLayout>
    );
}

/**
 * Lista lateral: título com "+ Nova", a busca e o resumo das contagens fixos no topo, e só as
 * categorias rolam (`ListPane`).
 *
 * @param props.categories Categorias que casam com a busca.
 * @param props.empty Se o perfil não tem categoria nenhuma, para não dizer "nenhuma encontrada".
 * @param props.filter Texto da busca.
 * @param props.onFilterChange Troca o texto da busca.
 * @param props.openId Categoria aberta, marcada na lista.
 * @param props.onCreate Abre o diálogo de nova categoria.
 * @return A lista de categorias.
 */
function CategoryList({
    categories,
    empty,
    filter,
    onFilterChange,
    openId,
    onCreate,
}: {
    readonly categories: readonly CategoryBranchResponse[];
    readonly empty: boolean;
    readonly filter: string;
    readonly onFilterChange: (filter: string) => void;
    readonly openId: string | null;
    readonly onCreate: () => void;
}): ReactNode {
    return (
        <ListPane
            label="Lista de categorias"
            width="w-72"
            header={
                <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
                    <div className="flex items-center justify-between">
                        <h1 className="text-20 font-semibold">Categorias</h1>
                        <Button variant="outline" size="sm" className="text-13 font-normal" aria-label="Nova categoria" onClick={onCreate}>
                            + Nova
                        </Button>
                    </div>
                    <div className="relative">
                        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
                        <Input
                            type="search"
                            aria-label="Buscar categoria ou subcategoria"
                            placeholder="Buscar categoria ou subcategoria"
                            value={filter}
                            onChange={(event) => {
                                onFilterChange(event.target.value);
                            }}
                            className="pl-8 text-13"
                        />
                    </div>
                    <span className="text-12 text-muted">{formatCategoryCount(categories)}</span>
                </div>
            }
        >
            {categories.length === 0 && !empty && <p className="px-5 py-3.5 text-13 text-muted">Nenhuma categoria encontrada.</p>}
            <ul aria-label="Categorias">
                {categories.map((category) => (
                    <li key={category.id}>
                        <CategoryLink category={category} current={category.id === openId} />
                    </li>
                ))}
            </ul>
        </ListPane>
    );
}

/**
 * Item da lista: o nome à esquerda; quantas subcategorias e quantos lançamentos à direita, que
 * dizem o peso da categoria sem abri-la.
 *
 * @param props.category Categoria com as subcategorias.
 * @param props.current Se é a categoria aberta.
 * @return O link que abre a categoria.
 */
function CategoryLink({ category, current }: { readonly category: CategoryBranchResponse; readonly current: boolean }): ReactNode {
    return (
        <Link
            to="/categories"
            search={{ category: category.id }}
            aria-current={current ? 'page' : undefined}
            className={cn(
                'flex items-center justify-between gap-3 border-t border-line2 px-5 py-2.5 text-ink hover:bg-surface2',
                current && 'bg-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-soft',
            )}
        >
            <span className={cn('min-w-0 truncate text-14', current && 'font-semibold')}>{category.name}</span>
            <span className="flex shrink-0 flex-col items-end text-12 text-muted tabular-nums">
                <span>{category.subCategories.length} sub</span>
                <span>{categoryTransactionCount(category)} lanç.</span>
            </span>
        </Link>
    );
}

/**
 * Detalhe da categoria aberta: cabeçalho com renomear e excluir, os números de todo o período e a
 * tabela das subcategorias com a criação na última linha.
 *
 * @param props.category Categoria aberta.
 * @param props.onOpen Abre um diálogo da tela.
 * @return O detalhe.
 */
function CategoryDetail({ category, onOpen }: { readonly category: CategoryBranchResponse; readonly onOpen: (dialog: CategoryDialogState) => void }): ReactNode {
    return (
        <>
            <header className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-13 text-muted">Categoria</span>
                    <h2 className="text-22 font-semibold">{category.name}</h2>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        className="font-normal"
                        onClick={() => {
                            onOpen({ mode: 'renameCategory', category });
                        }}
                    >
                        Renomear
                    </Button>
                    <Button
                        variant="outline"
                        className="font-normal text-danger"
                        onClick={() => {
                            onOpen({ mode: 'delete', target: { kind: 'category', category } });
                        }}
                    >
                        Excluir categoria
                    </Button>
                </div>
            </header>
            <div className="flex items-end gap-10">
                <dl className="flex gap-10">
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-12 text-muted">Subcategorias</dt>
                        <dd className="text-20 font-semibold tabular-nums">{category.subCategories.length}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <dt className="text-12 text-muted">Lançamentos (todo o período)</dt>
                        <dd className="text-20 font-semibold tabular-nums">{categoryTransactionCount(category)}</dd>
                    </div>
                </dl>
            </div>
            <SubCategoryTable category={category} onOpen={onOpen} />
            <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                Nomes são únicos no perfil, sem diferenciar maiúsculas. Excluir uma subcategoria com lançamentos pede para escolher outra subcategoria para recebê-los.
            </p>
        </>
    );
}

/**
 * Tabela das subcategorias, com a contagem de lançamentos à direita e tabular (decisão de
 * interface 8). Renomear e excluir ficam em ícones na linha, com o nome no rótulo acessível,
 * porque vários "Excluir" iguais não diriam o que excluem.
 *
 * @param props.category Categoria aberta, com as subcategorias.
 * @param props.onOpen Abre um diálogo da tela.
 * @return A tabela.
 */
function SubCategoryTable({ category, onOpen }: { readonly category: CategoryBranchResponse; readonly onOpen: (dialog: CategoryDialogState) => void }): ReactNode {
    return (
        <section aria-label="Subcategorias" className="overflow-hidden rounded-10 border border-line bg-surface">
            <table aria-label={`Subcategorias de ${category.name}`} className="w-full text-13">
                <thead className="bg-surface2 text-12 text-muted">
                    <tr className="border-b border-line">
                        <th scope="col" className="px-4 py-2.5 text-left font-normal">
                            Subcategoria
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-normal">
                            Lançamentos
                        </th>
                        <th scope="col" className="w-24 px-4 py-2.5">
                            <span className="sr-only">Ações</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {category.subCategories.length === 0 && (
                        <tr className="border-b border-line2">
                            <td colSpan={3} className="px-4 py-3 text-muted">
                                Nenhuma subcategoria. Toda transação aponta para uma subcategoria: crie a primeira abaixo.
                            </td>
                        </tr>
                    )}
                    {category.subCategories.map((subCategory) => (
                        <tr key={subCategory.id} className="border-b border-line2 hover:bg-surface2">
                            <th scope="row" className="px-4 py-2.5 text-left font-normal">
                                {subCategory.name}
                            </th>
                            <td className="px-4 py-2.5 text-right tabular-nums">{subCategory.transactionCount}</td>
                            <td className="px-4 py-1.5">
                                <span className="flex justify-end gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Renomear ${subCategory.name}`}
                                        className="text-muted"
                                        onClick={() => {
                                            onOpen({ mode: 'renameSubCategory', subCategory });
                                        }}
                                    >
                                        <PencilIcon />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Excluir ${subCategory.name}`}
                                        className="text-muted hover:text-danger"
                                        onClick={() => {
                                            onOpen({ mode: 'delete', target: { kind: 'subCategory', category, subCategory } });
                                        }}
                                    >
                                        <Trash2Icon />
                                    </Button>
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <NewSubCategoryForm category={category} />
        </section>
    );
}

/**
 * "Nova subcategoria" na última linha da tabela, como no mockup: a subcategoria é só um nome, e
 * criá-la sem diálogo deixa cadastrar várias seguidas. O nome repetido volta do núcleo como
 * `CONFLICT` e aparece abaixo do campo.
 *
 * @param props.category Categoria que recebe a subcategoria.
 * @return O formulário.
 */
function NewSubCategoryForm({ category }: { readonly category: CategoryBranchResponse }): ReactNode {
    const create = useCoreMutation('subCategories.create');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const fieldError = error === null ? undefined : { type: 'validate', message: error };

    /**
     * Valida o nome com o campo das rotas e cria a subcategoria; o campo se esvazia para a próxima.
     *
     * @return Promessa resolvida quando a subcategoria foi criada ou o erro apareceu.
     */
    const submit = async (): Promise<void> => {
        const read = readNameForm(name, SUB_CATEGORY_NAME_LABEL);
        if (!read.ok) {
            setError(read.error);
            return;
        }
        setError(null);
        try {
            await create.mutateAsync({ categoryId: category.id, name: read.name });
            toast.success(`Subcategoria ${read.name} criada.`);
            setName('');
        } catch (rejection) {
            reportRejection(
                rejection,
                { name: 'name' },
                (_field, message) => {
                    setError(message);
                },
                setError,
            );
        }
    };

    return (
        <form
            noValidate
            className="flex items-start gap-2 bg-surface2 px-4 py-2.5"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div className="flex flex-1 flex-col gap-1">
                <Input
                    aria-label={`Nova subcategoria em ${category.name}`}
                    placeholder={`Nova subcategoria em ${category.name}`}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    className="text-13"
                    {...fieldAria('new-sub-category', fieldError)}
                />
                {error !== null && (
                    <p id="new-sub-category-error" className="text-12 text-danger">
                        {error}
                    </p>
                )}
            </div>
            <Button type="submit" variant="outline" disabled={create.isPending} className="font-normal">
                Adicionar
            </Button>
        </form>
    );
}

/**
 * @return O esqueleto da tela enquanto a árvore carrega, com o mesmo desenho da lista.
 */
function CategoryListSkeleton(): ReactNode {
    return (
        <section aria-label="Lista de categorias" className="flex w-72 shrink-0 flex-col gap-3 border-r border-line bg-surface p-5">
            <h1 className="text-20 font-semibold">Categorias</h1>
            <Skeleton className="h-9" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
        </section>
    );
}

/**
 * Diálogo que só pede um nome, base de criar e renomear categoria e de renomear subcategoria. O conflito de nome volta do
 * núcleo como `CONFLICT` com o campo `name` e aparece abaixo do campo, como erro de validação.
 *
 * @param props.title Título do diálogo.
 * @param props.description Frase sob o título.
 * @param props.label Rótulo do campo.
 * @param props.fieldLabel Nome do campo com artigo, para a frase do campo vazio.
 * @param props.initial Nome atual, na edição; vazio ao criar.
 * @param props.submitLabel Texto do botão de salvar.
 * @param props.pending Se o núcleo ainda está gravando.
 * @param props.onSave Grava o nome; rejeita com a recusa do núcleo.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo.
 */
function NameDialog({
    title,
    description,
    label,
    fieldLabel,
    initial,
    submitLabel,
    pending,
    onSave,
    onClose,
}: {
    readonly title: string;
    readonly description: string;
    readonly label: string;
    readonly fieldLabel: string;
    readonly initial: string;
    readonly submitLabel: string;
    readonly pending: boolean;
    readonly onSave: (name: string) => Promise<unknown>;
    readonly onClose: () => void;
}): ReactNode {
    const [name, setName] = useState(initial);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);
    const error = fieldError === null ? undefined : { type: 'validate', message: fieldError };

    /**
     * Valida o nome com o mesmo campo das rotas e só então chama o núcleo.
     *
     * @return Promessa resolvida quando o diálogo fechou ou mostrou o erro.
     */
    const submit = async (): Promise<void> => {
        const read = readNameForm(name, fieldLabel);
        if (!read.ok) {
            setFieldError(read.error);
            return;
        }
        setFieldError(null);
        setGeneralError(null);
        try {
            await onSave(read.name);
            onClose();
        } catch (rejection) {
            reportRejection(
                rejection,
                { name: 'name' },
                (_field, message) => {
                    setFieldError(message);
                },
                setGeneralError,
            );
        }
    };

    return (
        <FormDialog
            open
            onClose={onClose}
            title={title}
            description={description}
            submitLabel={submitLabel}
            pending={pending}
            error={generalError}
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <Field id="category-name" label={label} error={error}>
                <Input
                    id="category-name"
                    autoFocus
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    {...fieldAria('category-name', error)}
                />
            </Field>
        </FormDialog>
    );
}

/**
 * Criar ou renomear categoria. Excluir não fica aqui: o detalhe da categoria tem o próprio
 * "Excluir categoria", à vista ao lado de "Renomear".
 *
 * @param props.category Categoria a renomear, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @param props.onCreated Abre a categoria criada, para que a próxima ação — criar as
 * subcategorias — já esteja à mão; só na criação.
 * @return O diálogo.
 */
function CategoryNameDialog({
    category,
    onClose,
    onCreated,
}: {
    readonly category: CategoryBranchResponse | null;
    readonly onClose: () => void;
    readonly onCreated: ((id: string) => void) | undefined;
}): ReactNode {
    const { profile } = useActiveProfile();
    const create = useCoreMutation('categories.create');
    const rename = useCoreMutation('categories.update');
    return (
        <NameDialog
            title={category === null ? 'Nova categoria' : `Renomear ${category.name}`}
            description="A categoria agrupa subcategorias nos relatórios; os lançamentos apontam para a subcategoria."
            label="Nome da categoria"
            fieldLabel="o nome da categoria"
            initial={category?.name ?? ''}
            submitLabel={category === null ? 'Criar categoria' : 'Salvar'}
            pending={create.isPending || rename.isPending}
            onSave={async (name) => {
                if (category === null) {
                    const created = await create.mutateAsync({ profileId: profile.id, name });
                    toast.success(`Categoria ${name} criada.`);
                    onCreated?.(created.id);
                } else {
                    await rename.mutateAsync({ id: category.id, name });
                    toast.success(`Categoria renomeada para ${name}.`);
                }
            }}
            onClose={onClose}
        />
    );
}

/**
 * Renomear subcategoria. Criar não passa por diálogo: é a última linha da tabela
 * (`NewSubCategoryForm`).
 *
 * @param props.subCategory Subcategoria a renomear.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo.
 */
function SubCategoryRenameDialog({ subCategory, onClose }: { readonly subCategory: SubCategoryUsageResponse; readonly onClose: () => void }): ReactNode {
    const rename = useCoreMutation('subCategories.update');
    return (
        <NameDialog
            title={`Renomear ${subCategory.name}`}
            description="Renomear não muda os lançamentos: eles continuam na mesma subcategoria."
            label="Nome da subcategoria"
            fieldLabel={SUB_CATEGORY_NAME_LABEL}
            initial={subCategory.name}
            submitLabel="Salvar"
            pending={rename.isPending}
            onSave={async (name) => {
                await rename.mutateAsync({ id: subCategory.id, name });
                toast.success(`Subcategoria renomeada para ${name}.`);
            }}
            onClose={onClose}
        />
    );
}

/**
 * Excluir categoria ou subcategoria. Regra de negócio (Categorias, desktop-mvp-plan Fase 1.4):
 * com lançamentos, a exclusão pede para onde movê-los — toda transação aponta para uma
 * subcategoria, e apagar a classificação não pode apagar o lançamento. Sem lançamentos, é só
 * a confirmação. Mover não muda saldo nenhum, porque a categoria não afeta saldo.
 *
 * @param props.tree Árvore de categorias, de onde saem os destinos.
 * @param props.target O que será excluído.
 * @param props.onClose Fecha o diálogo.
 * @param props.onDeleted Avisa a tela depois da exclusão, para que ela tire da URL a categoria
 * que deixou de existir.
 * @return O diálogo.
 */
function CategoryDeletionDialog({
    tree,
    target,
    onClose,
    onDeleted,
}: {
    readonly tree: readonly CategoryBranchResponse[];
    readonly target: CategoryDeletionTarget;
    readonly onClose: () => void;
    readonly onDeleted: () => void;
}): ReactNode {
    const removeCategory = useCoreMutation('categories.delete');
    const removeSubCategory = useCoreMutation('subCategories.delete');
    const [moveTo, setMoveTo] = useState('');
    const [moveError, setMoveError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);
    const toMove = transactionsToMove(target);
    const groups = moveTargets(tree, target);
    const name = target.kind === 'category' ? target.category.name : target.subCategory.name;
    const error = moveError === null ? undefined : { type: 'validate', message: moveError };

    /**
     * Confere o destino, quando ele é exigido, e exclui.
     *
     * @return Promessa resolvida quando o diálogo fechou ou mostrou o erro.
     */
    const submit = async (): Promise<void> => {
        if (toMove > 0 && moveTo === '') {
            setMoveError('Escolha para onde mover os lançamentos.');
            return;
        }
        setMoveError(null);
        setGeneralError(null);
        const destination = toMove > 0 ? moveTo : null;
        try {
            if (target.kind === 'category') {
                await removeCategory.mutateAsync({ id: target.category.id, moveTo: destination });
            } else {
                await removeSubCategory.mutateAsync({ id: target.subCategory.id, moveTo: destination });
            }
            toast.success(target.kind === 'category' ? `Categoria ${name} excluída.` : `Subcategoria ${name} excluída.`);
            onClose();
            onDeleted();
        } catch (rejection) {
            reportRejection(
                rejection,
                { moveTo: 'moveTo' },
                (_field, message) => {
                    setMoveError(message);
                },
                setGeneralError,
            );
        }
    };

    return (
        <FormDialog
            open
            onClose={onClose}
            title={target.kind === 'category' ? `Excluir a categoria ${name}?` : `Excluir a subcategoria ${name}?`}
            description={deletionDescription(target, toMove)}
            submitLabel={toMove > 0 ? 'Mover e excluir' : 'Excluir'}
            pending={removeCategory.isPending || removeSubCategory.isPending}
            error={generalError}
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            {toMove > 0 &&
                (groups.length === 0 ? (
                    <p role="alert" className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                        Não há outra subcategoria para receber os lançamentos. Crie uma antes de excluir.
                    </p>
                ) : (
                    <Field id="move-to" label={`Mover ${String(toMove)} ${toMove === 1 ? 'lançamento' : 'lançamentos'} para`} error={error}>
                        <Combobox
                            id="move-to"
                            options={groups.flatMap((group) => group.subCategories.map((subCategory) => ({ value: subCategory.id, label: subCategory.name, group: group.categoryName })))}
                            value={moveTo}
                            onChange={setMoveTo}
                            placeholder="Escolha a subcategoria"
                            searchLabel="Buscar subcategoria"
                            emptyText="Nenhuma subcategoria encontrada."
                            aria={fieldAria('move-to', error)}
                        />
                    </Field>
                ))}
        </FormDialog>
    );
}

/**
 * @param target O que será excluído.
 * @param toMove Quantos lançamentos precisam ser movidos.
 * @return A frase sob o título: o que some junto e, havendo lançamentos, que eles serão
 * movidos em vez de apagados.
 */
function deletionDescription(target: CategoryDeletionTarget, toMove: number): string {
    const subCategories = target.kind === 'category' ? target.category.subCategories.length : 0;
    const together =
        subCategories === 0 ? '' : subCategories === 1 ? 'A subcategoria dela também será excluída. ' : `As ${String(subCategories)} subcategorias dela também serão excluídas. `;
    if (toMove === 0) {
        return `${together}Não há lançamentos nesta ${target.kind === 'category' ? 'categoria' : 'subcategoria'}.`;
    }
    return `${together}Os lançamentos não são apagados: eles passam para a subcategoria escolhida.`;
}
