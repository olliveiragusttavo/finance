import { describeCategoryDeletion, moveTargets, reportRejection, transactionsToMove, useCoreMutation, type CategoryDeletionTarget } from '@finance/client';
import type { CategoryBranchResponse } from '@finance/core';
import { useState, type ReactNode } from 'react';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormRow } from '../ui/form.tsx';
import { RowSearchSelect } from '../ui/pickers.tsx';
import { Sheet } from '../ui/Sheet.tsx';

/**
 * Excluir categoria ou subcategoria, como o diálogo do desktop. Regra de negócio (Categorias,
 * desktop-mvp-plan Fase 1.4): com lançamentos, a exclusão pede para onde movê-los — toda
 * transação aponta para uma subcategoria, e apagar a classificação não pode apagar o lançamento;
 * os destinos já saem sem as subcategorias que somem junto (`moveTargets`). Sem lançamentos, é só
 * a confirmação. Mover não muda saldo nenhum.
 *
 * @param props.tree Árvore de categorias, de onde saem os destinos.
 * @param props.target O que será excluído.
 * @param props.onClose Fecha a folha ao desistir.
 * @param props.onDeleted Depois da exclusão; a tela da categoria excluída sai da pilha.
 * @return A folha.
 */
export function CategoryDeletionSheet(props: {
    readonly tree: readonly CategoryBranchResponse[];
    readonly target: CategoryDeletionTarget;
    readonly onClose: () => void;
    readonly onDeleted: () => void;
}): ReactNode {
    const { tree, target, onClose, onDeleted } = props;
    const removeCategory = useCoreMutation('categories.delete');
    const removeSubCategory = useCoreMutation('subCategories.delete');
    const [moveTo, setMoveTo] = useState<string | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);
    const toMove = transactionsToMove(target);
    const options = moveTargets(tree, target).flatMap((group) => group.subCategories.map((sub) => ({ value: sub.id, label: `${group.categoryName} › ${sub.name}` })));
    const name = target.kind === 'category' ? target.category.name : target.subCategory.name;

    /** Confere o destino, quando ele é exigido, e exclui. */
    const submit = (): void => {
        if (toMove > 0 && moveTo === null) {
            setMoveError('Escolha para onde mover os lançamentos.');
            return;
        }
        setMoveError(null);
        setGeneralError(null);
        const destination = toMove > 0 ? moveTo : null;
        // `mutateAsync`: a exclusão tira a categoria da árvore, a tela deixa de montar esta folha,
        // e os retornos do `mutate` de quem desmontou não seriam chamados.
        const removal = target.kind === 'category' ? removeCategory.mutateAsync({ id: target.category.id, moveTo: destination }) : removeSubCategory.mutateAsync({ id: target.subCategory.id, moveTo: destination });
        removal.then(onDeleted, (rejection: unknown) => {
            reportRejection(
                rejection,
                { moveTo: 'moveTo' },
                (_field, message) => {
                    setMoveError(message);
                },
                setGeneralError,
            );
        });
    };

    return (
        <Sheet open title={target.kind === 'category' ? `Excluir a categoria ${name}?` : `Excluir a subcategoria ${name}?`} onClose={onClose}>
            <AppText className="text-ink2">{describeCategoryDeletion(target, toMove)}</AppText>
            {toMove > 0 &&
                (options.length === 0 ? (
                    <AppText accessibilityRole="alert" className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                        Não há outra subcategoria para receber os lançamentos. Crie uma antes de excluir.
                    </AppText>
                ) : (
                    <FormGroup>
                        <FormRow first label={`Mover ${String(toMove)} ${toMove === 1 ? 'lançamento' : 'lançamentos'} para`} error={moveError ?? undefined}>
                            <RowSearchSelect label="Mover para" options={options} value={moveTo} onChange={setMoveTo} placeholder="Escolher" emptyText="Nenhuma subcategoria encontrada." />
                        </FormRow>
                    </FormGroup>
                ))}
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={toMove > 0 ? 'Mover e excluir' : 'Excluir'} variant="danger" disabled={toMove > 0 && options.length === 0} busy={removeCategory.isPending || removeSubCategory.isPending} onPress={submit} />
            <Button label="Cancelar" variant="secondary" onPress={onClose} />
        </Sheet>
    );
}
