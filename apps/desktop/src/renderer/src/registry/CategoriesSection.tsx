import { useCoreMutation, type CoreCallError } from '@finance/client';
import type { CategoryBranchResponse, SubCategoryUsageResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Field, fieldAria } from '@/components/form';
import { EmptyState, QueryState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveProfile } from '@/shell/activeProfile';
import { moveTargets, transactionsToMove, type CategoryDeletionTarget } from './categoryMoves.ts';
import { reportRejection } from './coreErrorField.ts';
import { readNameForm } from './nameForm.ts';
import { FormDialog, RowAction, SectionHeader } from './registryUi.tsx';

/** Diálogo aberto na seção. */
type CategoryDialogState =
    | { readonly mode: 'createCategory' }
    | { readonly mode: 'editCategory'; readonly category: CategoryBranchResponse }
    | { readonly mode: 'createSubCategory'; readonly category: CategoryBranchResponse }
    | { readonly mode: 'renameSubCategory'; readonly subCategory: SubCategoryUsageResponse }
    | { readonly mode: 'delete'; readonly target: CategoryDeletionTarget };

/**
 * Categorias em Cadastros (mockup `DesktopCadastros`; desktop-mvp-plan Fase 6): um cartão por
 * categoria com as subcategorias e a contagem de lançamentos, criar, renomear e excluir. A
 * ordem é a do núcleo; o "Reordenar" do mockup ficou fora do MVP, porque o núcleo não guarda
 * ordem de categorias.
 *
 * @param props.query Árvore de categorias do perfil.
 * @return A seção de categorias.
 */
export function CategoriesSection({ query }: { readonly query: UseQueryResult<readonly CategoryBranchResponse[], CoreCallError> }): ReactNode {
    const [dialog, setDialog] = useState<CategoryDialogState | null>(null);
    const close = (): void => {
        setDialog(null);
    };
    const tree = query.data ?? [];

    return (
        <>
            <SectionHeader
                title="Categorias"
                description="Toda transação aponta para uma subcategoria"
                actions={
                    <Button
                        onClick={() => {
                            setDialog({ mode: 'createCategory' });
                        }}
                    >
                        + Nova categoria
                    </Button>
                }
            />
            <QueryState query={query}>
                {(branches) =>
                    branches.length === 0 ? (
                        <EmptyState title="Nenhuma categoria" description="Crie uma categoria e as subcategorias que classificam os lançamentos." />
                    ) : (
                        <div className="grid grid-cols-3 items-start gap-4">
                            {branches.map((category) => (
                                <CategoryCard key={category.id} category={category} onOpen={setDialog} />
                            ))}
                        </div>
                    )
                }
            </QueryState>
            <p className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                Nomes são únicos no perfil, sem diferenciar maiúsculas. Excluir uma subcategoria em uso pede para mover os lançamentos antes.
            </p>
            {dialog?.mode === 'createCategory' && <CategoryNameDialog category={null} onClose={close} onDelete={undefined} />}
            {dialog?.mode === 'editCategory' && (
                <CategoryNameDialog
                    category={dialog.category}
                    onClose={close}
                    onDelete={() => {
                        setDialog({ mode: 'delete', target: { kind: 'category', category: dialog.category } });
                    }}
                />
            )}
            {dialog?.mode === 'createSubCategory' && <SubCategoryNameDialog parent={dialog.category} subCategory={null} onClose={close} />}
            {dialog?.mode === 'renameSubCategory' && <SubCategoryNameDialog parent={null} subCategory={dialog.subCategory} onClose={close} />}
            {dialog?.mode === 'delete' && <CategoryDeletionDialog tree={tree} target={dialog.target} onClose={close} />}
        </>
    );
}

/**
 * Cartão de uma categoria, como no mockup: nome com "Editar", subcategorias com a contagem e
 * "+ Subcategoria". Renomear e excluir a subcategoria ficam na própria linha, visíveis ao
 * passar o mouse ou ao chegar pelo teclado, para não poluir a grade.
 *
 * @param props.category Categoria com as subcategorias.
 * @param props.onOpen Abre um diálogo da seção.
 * @return O cartão.
 */
function CategoryCard({ category, onOpen }: { readonly category: CategoryBranchResponse; readonly onOpen: (dialog: CategoryDialogState) => void }): ReactNode {
    return (
        <section aria-label={category.name} className="flex flex-col rounded-10 border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line2 px-4 py-3">
                <h3 className="font-semibold">{category.name}</h3>
                <RowAction
                    label="Editar"
                    accessibleName={`Editar ${category.name}`}
                    onClick={() => {
                        onOpen({ mode: 'editCategory', category });
                    }}
                />
            </div>
            <ul aria-label={`Subcategorias de ${category.name}`}>
                {category.subCategories.map((subCategory) => (
                    <li key={subCategory.id} className="group flex items-center justify-between gap-2 border-b border-line2 py-2 pr-4 pl-7 text-13">
                        <span className="min-w-0 truncate">{subCategory.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                            <span className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                                <RowAction
                                    label="Renomear"
                                    accessibleName={`Renomear ${subCategory.name}`}
                                    onClick={() => {
                                        onOpen({ mode: 'renameSubCategory', subCategory });
                                    }}
                                />
                                <RowAction
                                    label="Excluir"
                                    accessibleName={`Excluir ${subCategory.name}`}
                                    danger
                                    onClick={() => {
                                        onOpen({ mode: 'delete', target: { kind: 'subCategory', category, subCategory } });
                                    }}
                                />
                            </span>
                            <span className="text-12 text-muted tabular-nums">{subCategory.transactionCount} lanç.</span>
                        </span>
                    </li>
                ))}
                <li className="px-7 py-2">
                    <Button
                        type="button"
                        variant="link"
                        size="xs"
                        aria-label={`Nova subcategoria em ${category.name}`}
                        className="px-0 text-13 font-normal"
                        onClick={() => {
                            onOpen({ mode: 'createSubCategory', category });
                        }}
                    >
                        + Subcategoria
                    </Button>
                </li>
            </ul>
        </section>
    );
}

/**
 * Diálogo que só pede um nome, base de categoria e subcategoria. O conflito de nome volta do
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
 * @param props.secondaryAction Ação à esquerda do rodapé.
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
    secondaryAction,
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
    readonly secondaryAction?: ReactNode;
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
            secondaryAction={secondaryAction}
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <Field id="registry-name" label={label} error={error}>
                <Input
                    id="registry-name"
                    autoFocus
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    {...fieldAria('registry-name', error)}
                />
            </Field>
        </FormDialog>
    );
}

/**
 * Criar ou renomear categoria. Na edição, o rodapé traz "Excluir categoria": no mockup, o
 * cartão da categoria só tem "Editar", e é por ele que se chega à exclusão.
 *
 * @param props.category Categoria a renomear, ou `null` para criar uma.
 * @param props.onClose Fecha o diálogo.
 * @param props.onDelete Abre a exclusão da categoria; só na edição.
 * @return O diálogo.
 */
function CategoryNameDialog({
    category,
    onClose,
    onDelete,
}: {
    readonly category: CategoryBranchResponse | null;
    readonly onClose: () => void;
    readonly onDelete: (() => void) | undefined;
}): ReactNode {
    const { profile } = useActiveProfile();
    const create = useCoreMutation('categories.create');
    const rename = useCoreMutation('categories.update');
    return (
        <NameDialog
            title={category === null ? 'Nova categoria' : `Editar ${category.name}`}
            description="A categoria agrupa subcategorias nos relatórios; os lançamentos apontam para a subcategoria."
            label="Nome da categoria"
            fieldLabel="o nome da categoria"
            initial={category?.name ?? ''}
            submitLabel={category === null ? 'Criar categoria' : 'Salvar'}
            pending={create.isPending || rename.isPending}
            onSave={async (name) => {
                if (category === null) {
                    await create.mutateAsync({ profileId: profile.id, name });
                    toast.success(`Categoria ${name} criada.`);
                } else {
                    await rename.mutateAsync({ id: category.id, name });
                    toast.success(`Categoria renomeada para ${name}.`);
                }
            }}
            onClose={onClose}
            secondaryAction={
                onDelete === undefined ? undefined : (
                    <Button type="button" variant="ghost" className="text-danger" onClick={onDelete}>
                        Excluir categoria
                    </Button>
                )
            }
        />
    );
}

/**
 * Criar ou renomear subcategoria.
 *
 * @param props.parent Categoria da subcategoria nova; `null` ao renomear.
 * @param props.subCategory Subcategoria a renomear; `null` ao criar.
 * @param props.onClose Fecha o diálogo.
 * @return O diálogo.
 */
function SubCategoryNameDialog({
    parent,
    subCategory,
    onClose,
}: {
    readonly parent: CategoryBranchResponse | null;
    readonly subCategory: SubCategoryUsageResponse | null;
    readonly onClose: () => void;
}): ReactNode {
    const create = useCoreMutation('subCategories.create');
    const rename = useCoreMutation('subCategories.update');
    return (
        <NameDialog
            title={subCategory === null ? `Nova subcategoria em ${parent?.name ?? ''}` : `Renomear ${subCategory.name}`}
            description="Renomear não muda os lançamentos: eles continuam na mesma subcategoria."
            label="Nome da subcategoria"
            fieldLabel="o nome da subcategoria"
            initial={subCategory?.name ?? ''}
            submitLabel={subCategory === null ? 'Criar subcategoria' : 'Salvar'}
            pending={create.isPending || rename.isPending}
            onSave={async (name) => {
                if (subCategory !== null) {
                    await rename.mutateAsync({ id: subCategory.id, name });
                    toast.success(`Subcategoria renomeada para ${name}.`);
                } else if (parent !== null) {
                    await create.mutateAsync({ categoryId: parent.id, name });
                    toast.success(`Subcategoria ${name} criada.`);
                }
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
 * @return O diálogo.
 */
function CategoryDeletionDialog({ tree, target, onClose }: { readonly tree: readonly CategoryBranchResponse[]; readonly target: CategoryDeletionTarget; readonly onClose: () => void }): ReactNode {
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
                        <Select value={moveTo} onValueChange={setMoveTo}>
                            <SelectTrigger id="move-to" className="w-full" {...fieldAria('move-to', error)}>
                                <SelectValue placeholder="Escolha a subcategoria" />
                            </SelectTrigger>
                            <SelectContent>
                                {groups.map((group) => (
                                    <SelectGroup key={group.categoryId}>
                                        <SelectLabel>{group.categoryName}</SelectLabel>
                                        {group.subCategories.map((subCategory) => (
                                            <SelectItem key={subCategory.id} value={subCategory.id}>
                                                {subCategory.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                            </SelectContent>
                        </Select>
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
