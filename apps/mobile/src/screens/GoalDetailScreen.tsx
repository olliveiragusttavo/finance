import {
    describeError,
    describeGoalDeletion,
    describeGoalFunding,
    describeGoalListItem,
    formatMoney,
    goalFigures,
    goalPendingNote,
    goalProjectionNote,
    movementsFromGoalContributions,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useGoalContributions,
    useGoals,
    useRecurrences,
    type MovementRow,
} from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { GoalFormSheet } from '../goals/GoalFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { accountRoute, moreTransactionRoute, ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, LoadingState, QueryView } from '../ui/states.tsx';

/** Folha aberta no detalhe: as ações, o formulário ou a confirmação de exclusão. */
type GoalSheet = 'actions' | 'edit' | 'delete';

/** Cor do valor da vinculada: o que guarda entra, a retirada sai; o sinal vem no texto. */
const TONE: Readonly<Record<MovementRow['tone'], string>> = { in: 'text-in', out: 'text-out', neutral: 'text-ink' };

/**
 * Etiqueta pequena ao lado do nome (Atingida, Arquivada, retirada).
 *
 * @param props.text Texto da etiqueta.
 * @param props.warn Usa a cor de aviso (arquivada), e não a neutra.
 * @return A etiqueta.
 */
function Tag({ text, warn = false }: { readonly text: string; readonly warn?: boolean }): ReactNode {
    return (
        <View className={`rounded-full px-2 py-0.5 ${warn ? 'bg-warn-bg' : 'bg-soft'}`}>
            <AppText className={`text-12 ${warn ? 'text-warn-ink' : 'text-soft-ink'}`}>{text}</AppText>
        </View>
    );
}

/**
 * Transações vinculadas, com o total, que é o próprio progresso. Tocar abre o detalhe do
 * lançamento, onde se edita ou desvincula — é aqui que se nota a vinculada errada (desktop-mvp-plan
 * Fase 13.3). Contas, cartões e categorias só dão nome às linhas.
 *
 * @param props.goal Meta aberta, por lançamentos.
 * @return A seção.
 */
function Contributions({ goal }: { readonly goal: GoalProgressResponse }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const contributions = useGoalContributions({ id: goal.id });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const recurrences = useRecurrences({ profileId: profile.id });
    const pending = goalPendingNote(goal);
    if (contributions.data === undefined || accounts.data === undefined || creditCards.data === undefined || categories.data === undefined) {
        return <LoadingState label="Abrindo as transações vinculadas…" />;
    }
    const rows = movementsFromGoalContributions({
        contributions: contributions.data,
        accounts: accounts.data.accounts,
        creditCards: creditCards.data.creditCards,
        categories: categories.data,
        recurrences: recurrences.data ?? [],
        profileId: profile.id,
    });
    return (
        <View className="gap-1.5">
            <FormSection>Transações vinculadas</FormSection>
            {rows.length === 0 ? (
                <EmptyState title="Nenhuma transação paga vinculada ainda" body="Vincule receitas ou transferências pelo campo “Meta” do lançamento." />
            ) : (
                <FormGroup>
                    {rows.map((row, index) => {
                        const sub = [row.date, row.category, row.container].filter((part) => part !== '').join(' · ');
                        return (
                            <Pressable
                                key={row.id}
                                accessibilityRole="button"
                                accessibilityLabel={[row.name, ...row.badges, sub, row.amountText].join(', ')}
                                onPress={() => {
                                    router.push(moreTransactionRoute(row.id));
                                }}
                                className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                            >
                                <View className="min-w-0 flex-1">
                                    <View className="flex-row items-center gap-1.5">
                                        <AppText className="shrink" numberOfLines={1}>{row.name}</AppText>
                                        {row.badges.map((badge) => (
                                            <Tag key={badge} text={badge} />
                                        ))}
                                    </View>
                                    <AppText className="text-12 text-muted" numberOfLines={1}>{sub}</AppText>
                                </View>
                                <AppText className={`font-semibold ${TONE[row.tone]}`}>{row.amountText}</AppText>
                            </Pressable>
                        );
                    })}
                    <View className="min-h-12.5 flex-row items-center justify-between border-t border-line px-3.5">
                        <AppText className="text-muted">Total</AppText>
                        <AppText className="font-semibold">{formatMoney(goal.saved)}</AppText>
                    </View>
                </FormGroup>
            )}
            {pending !== null && <AppText className="text-12 text-muted">{pending}</AppText>}
        </View>
    );
}

/**
 * Ações da meta em folha: editar, arquivar ou reativar e excluir — as do detalhe no desktop.
 * Arquivar não pede confirmação, como desativar uma conta: as duas ações se desfazem uma com a
 * outra e não mexem nos vínculos nem no progresso, e a frase diz isso.
 *
 * @param props.goal Meta aberta.
 * @param props.pending Se o arquivamento está em andamento.
 * @param props.onEdit Abre o formulário.
 * @param props.onToggleArchive Arquiva ou reativa.
 * @param props.onDelete Abre a confirmação de exclusão.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function GoalActionsSheet(props: {
    readonly goal: GoalProgressResponse;
    readonly pending: boolean;
    readonly onEdit: () => void;
    readonly onToggleArchive: () => void;
    readonly onDelete: () => void;
    readonly onClose: () => void;
}): ReactNode {
    const { goal, pending, onEdit, onToggleArchive, onDelete, onClose } = props;
    return (
        <Sheet open title={goal.name} onClose={onClose}>
            <Button label="Editar meta" variant="secondary" onPress={onEdit} />
            <Button label={goal.archived ? 'Reativar meta' : 'Arquivar meta'} variant="secondary" busy={pending} onPress={onToggleArchive} />
            {!goal.archived && <AppText className="text-12 text-muted">Arquivada, a meta sai da lista das ativas; os lançamentos continuam vinculados a ela.</AppText>}
            <Button label="Excluir meta…" variant="danger" onPress={onDelete} />
        </Sheet>
    );
}

/**
 * Detalhe da meta (mobile-mvp-plan, Fase 14, tela aprovada pelo usuário; o mockup `MobileMetas`
 * só desenha a lista): o progresso, os três números do desktop (falta, data-alvo, ritmo
 * necessário), a projeção e as transações vinculadas — ou, na meta vinculada a conta, o link para
 * o extrato da conta, de onde vem o saldo (desktop-mvp-plan Fase 13.3). As ações ficam no "⋯".
 * A meta vem da mesma consulta da lista, já em cache.
 *
 * @return A tela.
 */
export function GoalDetailScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const goals = useGoals({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const archive = useCoreMutation('goals.archive');
    const unarchive = useCoreMutation('goals.unarchive');
    const remove = useCoreMutation('goals.delete');
    const [sheet, setSheet] = useState<GoalSheet | null>(null);
    const goal = goals.data?.find((candidate) => candidate.id === id);

    if (goal === undefined) {
        return (
            <Screen header={<ScreenHeader title="Meta" back />} withMonth>
                <QueryView query={goals} loadingLabel="Abrindo a meta…">
                    {() => <EmptyState title="Esta meta não existe mais" body="Ela pode ter sido excluída." />}
                </QueryView>
            </Screen>
        );
    }

    const funding = describeGoalFunding(goal, accounts.data?.accounts ?? []);
    const item = describeGoalListItem(goal);
    const projection = goalProjectionNote(goal);
    const toggle = goal.archived ? unarchive : archive;
    /** Fecha a folha aberta. */
    const close = (): void => {
        setSheet(null);
    };

    const header = (
        <ScreenHeader
            back
            left={
                <View className="min-w-0 flex-1">
                    <AppText accessibilityRole="header" className="text-17 font-semibold" numberOfLines={1}>{goal.name}</AppText>
                    <AppText className="text-12 text-muted" numberOfLines={1}>Meta de economia · {funding}</AppText>
                </View>
            }
            actions={
                <IconButton
                    icon="more"
                    label="Ações da meta"
                    onPress={() => {
                        setSheet('actions');
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header} withMonth>
            {toggle.error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(toggle.error.error).message}
                </AppText>
            )}
            <View accessibilityLabel="Progresso" className="gap-2.5 rounded-12 border border-line bg-surface p-3.5">
                {(goal.reached || goal.archived) && (
                    <View className="flex-row gap-1.5">
                        {goal.reached && <Tag text="Atingida" />}
                        {goal.archived && <Tag text="Arquivada" warn />}
                    </View>
                )}
                <View className="flex-row items-end justify-between gap-3">
                    <View className="min-w-0 flex-1">
                        <AppText className="text-24 font-semibold">{formatMoney(goal.saved)}</AppText>
                        <AppText className="text-13 text-muted">de {formatMoney(goal.value)}</AppText>
                    </View>
                    <AppText className="text-20 font-semibold">{item.percentText}</AppText>
                </View>
                <ProgressBar ratio={item.barRatio} thick />
            </View>
            <FormGroup>
                {goalFigures(goal).map((figure, index) => (
                    <View key={figure.label} className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 py-2.5 ${index === 0 ? '' : 'border-t border-line2'}`}>
                        <AppText className="text-muted">{figure.label}</AppText>
                        <View className="min-w-0 flex-1 items-end">
                            <AppText className="font-semibold">{figure.value}</AppText>
                            <AppText className="text-right text-12 text-muted">{figure.note}</AppText>
                        </View>
                    </View>
                ))}
            </FormGroup>
            {projection !== null && <AppText className="rounded-10 bg-soft px-3 py-2.5 text-13 text-soft-ink">{projection}</AppText>}
            {goal.funding.kind === 'account' ? (
                <View className="gap-1 rounded-12 border border-line bg-surface px-3.5 py-3">
                    <AppText className="text-13 text-ink2">{funding}: o progresso é o saldo consolidado de hoje da conta, com tudo o que entrou e saiu dela.</AppText>
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => {
                            if (goal.funding.kind === 'account') {
                                router.push(accountRoute(goal.funding.accountId));
                            }
                        }}
                        className="min-h-11 justify-center self-start"
                    >
                        <AppText className="text-13 text-accent">Ver extrato da conta ›</AppText>
                    </Pressable>
                </View>
            ) : (
                <Contributions goal={goal} />
            )}
            {sheet === 'actions' && (
                <GoalActionsSheet
                    goal={goal}
                    pending={toggle.isPending}
                    onEdit={() => {
                        setSheet('edit');
                    }}
                    onToggleArchive={() => {
                        toggle.mutate({ id: goal.id }, { onSuccess: close });
                    }}
                    onDelete={() => {
                        setSheet('delete');
                    }}
                    onClose={close}
                />
            )}
            {sheet === 'edit' && <GoalFormSheet goal={goal} onClose={close} />}
            {sheet === 'delete' && (
                <Sheet open title={`Excluir a meta ${goal.name}?`} onClose={close}>
                    <AppText className="text-ink2">{describeGoalDeletion(goal)}</AppText>
                    {remove.error !== null && (
                        <AppText accessibilityRole="alert" className="text-13 text-danger">
                            {describeError(remove.error.error).message}
                        </AppText>
                    )}
                    <Button
                        label="Excluir meta"
                        variant="danger"
                        busy={remove.isPending}
                        onPress={() => {
                            // `mutateAsync` pelo mesmo motivo das exclusões de conta e cartão: a meta
                            // sai da lista, a folha desmonta e o retorno do `mutate` não viria.
                            remove.mutateAsync({ id: goal.id }).then(() => {
                                close();
                                if (router.canGoBack()) {
                                    router.back();
                                } else {
                                    router.replace(ROUTES.goals);
                                }
                            }, () => undefined);
                        }}
                    />
                    <Button label="Cancelar" variant="secondary" onPress={close} />
                </Sheet>
            )}
        </Screen>
    );
}
