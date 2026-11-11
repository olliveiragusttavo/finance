import { describeGoalFunding, describeGoalListItem, formatGoalListView, formatMoney, GOAL_LIST_VIEWS, goalInView, useAccounts, useGoals, type GoalListView } from '@finance/client';
import type { GoalProgressResponse } from '@finance/core';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { GoalFormSheet } from '../goals/GoalFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { goalRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Segmented } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/** As visualizações da lista no controle segmentado, com os rótulos do desktop. */
const VIEW_OPTIONS = GOAL_LIST_VIEWS.map((view) => ({ value: view, label: formatGoalListView(view) }));

/** Frase da visualização sem meta. */
const EMPTY_VIEW: Readonly<Record<GoalListView, string>> = { active: 'Nenhuma meta ativa', reached: 'Nenhuma meta atingida', archived: 'Nenhuma meta arquivada' };

/**
 * Cartão da meta (mockup `MobileMetas`): nome e percentual, a barra, "quanto de quanto · prazo" e,
 * enquanto falta, o ritmo para chegar lá. A meta vinculada a conta diz de qual conta vem o saldo,
 * porque o progresso dela não soma lançamentos; a arquivada leva a etiqueta, já que a atingida e
 * arquivada aparece também em "Atingidas".
 *
 * @param props.goal Meta com o progresso.
 * @param props.funding "saldo de Tesouro" ou "por lançamentos", do `describeGoalFunding`.
 * @param props.onPress Abre o detalhe.
 * @return O cartão.
 */
function GoalCard({ goal, funding, onPress }: { readonly goal: GoalProgressResponse; readonly funding: string; readonly onPress: () => void }): ReactNode {
    const item = describeGoalListItem(goal);
    const pace = !goal.reached && goal.requiredPerMonth !== null ? `Para chegar lá: ≈ ${formatMoney(goal.requiredPerMonth)} por mês` : null;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[goal.name, goal.archived ? 'arquivada' : null, item.percentText, item.summary, pace].filter((part) => part !== null).join(', ')}
            onPress={onPress}
            className="gap-2 rounded-12 border border-line bg-surface p-3.5 active:bg-line2"
        >
            <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    <AppText className="shrink" numberOfLines={1}>{goal.name}</AppText>
                    {goal.archived && (
                        <View className="rounded-full bg-warn-bg px-2 py-0.5">
                            <AppText className="text-12 text-warn-ink">Arquivada</AppText>
                        </View>
                    )}
                </View>
                <AppText className="font-semibold">{item.percentText}</AppText>
            </View>
            <ProgressBar ratio={item.barRatio} />
            <AppText className="text-12 text-muted">{item.summary}</AppText>
            {goal.funding.kind === 'account' && <AppText className="text-12 text-muted">{funding}</AppText>}
            {pace !== null && <AppText className="text-12 text-ink2">{pace}</AppText>}
        </Pressable>
    );
}

/**
 * Metas (mockup `MobileMetas`; mobile-mvp-plan, Fase 14, tela aprovada pelo usuário): os cartões
 * das metas com a escolha entre ativas, atingidas e arquivadas — as visualizações do desktop
 * (Fase 13.4), que o mockup não desenha —, e o "+" de nova meta. Tocar abre o detalhe.
 * Regra de negócio (Metas): a meta atingida e arquivada aparece nas duas visualizações
 * (`goalInView`); o mês de referência só move o ritmo, porque o progresso é o que já foi pago até
 * hoje.
 *
 * @return A tela.
 */
export function GoalsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const goals = useGoals({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const [view, setView] = useState<GoalListView>('active');
    const [creating, setCreating] = useState(false);

    const header = (
        <ScreenHeader
            title="Metas"
            back
            actions={
                <IconButton
                    icon="plus"
                    label="Nova meta"
                    onPress={() => {
                        setCreating(true);
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header} withMonth>
            <Segmented label="Visualização das metas" options={VIEW_OPTIONS} value={view} onChange={setView} />
            <QueryView query={goals} loadingLabel="Abrindo as metas…">
                {(list) => {
                    if (list.length === 0) {
                        return <EmptyState title="Nenhuma meta" body="Toque em + para criar uma meta e vincule a ela as receitas e transferências que guardam dinheiro para o objetivo." />;
                    }
                    const visible = list.filter((goal) => goalInView(goal, view));
                    if (visible.length === 0) {
                        return <EmptyState title={EMPTY_VIEW[view]} />;
                    }
                    return (
                        <>
                            {visible.map((goal) => (
                                <GoalCard
                                    key={goal.id}
                                    goal={goal}
                                    funding={describeGoalFunding(goal, accounts.data?.accounts ?? [])}
                                    onPress={() => {
                                        router.push(goalRoute(goal.id));
                                    }}
                                />
                            ))}
                            <AppText className="text-12 text-muted">O progresso soma as transações vinculadas a cada meta, ou acompanha o saldo da conta vinculada.</AppText>
                        </>
                    );
                }}
            </QueryView>
            {creating && (
                <GoalFormSheet
                    goal={null}
                    onClose={() => {
                        setCreating(false);
                    }}
                    onCreated={(created) => {
                        router.push(goalRoute(created.id));
                    }}
                />
            )}
        </Screen>
    );
}
