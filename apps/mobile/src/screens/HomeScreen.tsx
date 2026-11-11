import {
    formatMoney,
    markedPaidMessage,
    overviewAccounts,
    overviewCardRows,
    pendingBadge,
    pendingPanel,
    useAccounts,
    useCoreMutation,
    useCreditCards,
    useNextInvoices,
    useOverviewPending,
    type OverviewAccountRow,
    type OverviewCardRow,
    type PendingRow,
} from '@finance/client';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ProfileButton } from '../shell/ProfileSheet.tsx';
import { ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/** Cor do valor pelo sentido do dinheiro; o sinal e o ⇄ já vêm no texto (decisão de interface 7). */
const VALUE_TONE: Readonly<Record<PendingRow['tone'], string>> = { in: 'text-in', out: 'text-out', transfer: 'text-ink' };

/**
 * Título de bloco do Início, com o link "Ver todas" do mockup.
 *
 * @param props.title Título do bloco.
 * @param props.link Rótulo do link à direita.
 * @param props.onLink Ação do link.
 * @return A linha do título.
 */
function BlockTitle({ title, link, onLink }: { readonly title: string; readonly link?: string; readonly onLink?: () => void }): ReactNode {
    return (
        <View className="flex-row items-center justify-between">
            <AppText accessibilityRole="header" className="text-13 font-semibold text-muted">{title}</AppText>
            {link !== undefined && onLink !== undefined && (
                <Pressable accessibilityRole="link" onPress={onLink} className="min-h-11 justify-center px-1">
                    <AppText className="text-13 text-accent">{link}</AppText>
                </Pressable>
            )}
        </View>
    );
}

/**
 * Uma linha de atrasado ou em aberto: nome, data e distância, onde, valor e a ação.
 *
 * @param props.row Linha já formatada pelo `pendingPanel` do `client`.
 * @param props.first Se é a primeira do grupo.
 * @param props.busy Se uma marcação está em andamento.
 * @param props.onMarkPaid Marca o lançamento como pago ou recebido.
 * @param props.onOpenInvoice Abre a fatura (a linha de fatura não se paga daqui).
 * @return A linha.
 */
function PendingItem(props: { readonly row: PendingRow; readonly first: boolean; readonly busy: boolean; readonly onMarkPaid: (row: PendingRow, transactionId: string) => void; readonly onOpenInvoice: () => void }): ReactNode {
    const { row, first, busy, onMarkPaid, onOpenInvoice } = props;
    const action = row.action;
    return (
        <View className={`gap-1.5 px-3.5 py-2.5 ${first ? '' : 'border-t border-line2'}`}>
            <View className="flex-row items-start justify-between gap-2.5">
                <View className="min-w-0 flex-1">
                    <AppText numberOfLines={1}>{row.name}</AppText>
                    <AppText className={`text-12 ${row.overdue ? 'text-warn-ink' : 'text-muted'}`}>
                        {row.date} · {row.when}
                    </AppText>
                    <AppText className="text-12 text-muted" numberOfLines={1}>{row.where}</AppText>
                </View>
                <AppText className={`font-semibold ${VALUE_TONE[row.tone]}`}>{row.value}</AppText>
            </View>
            {action !== null && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${action.label}: ${row.name}`}
                    disabled={busy}
                    onPress={() => {
                        if (action.kind === 'markPaid') {
                            onMarkPaid(row, action.transactionId);
                        } else {
                            onOpenInvoice();
                        }
                    }}
                    className="min-h-11 items-center justify-center self-start rounded-10 border border-line px-3 active:bg-line2"
                >
                    <AppText className="text-13 text-accent">{action.label}</AppText>
                </Pressable>
            )}
        </View>
    );
}

/**
 * Atrasados no topo do Início (mobile-mvp-plan §5.1): o que o selo da Visão geral do desktop
 * mostra, numa seção — o celular não tem espaço ao lado do título nem *hover* para um popover.
 * O conteúdo e os textos vêm do `client` (`pendingBadge`, `pendingPanel`), os mesmos do desktop.
 * Regra de negócio (Visão geral): marcar daqui grava o pagamento com a data de hoje
 * (`transactions.setPaid`); o "Desfazer" volta o lançamento a pendente.
 *
 * @param props.profileId Perfil ativo.
 * @return A seção.
 */
function PendingSection({ profileId }: { readonly profileId: string }): ReactNode {
    const pending = useOverviewPending({ profileId });
    const setPaid = useCoreMutation('transactions.setPaid');
    const router = useRouter();
    const [marked, setMarked] = useState<{ readonly transactionId: string; readonly message: string } | null>(null);

    /**
     * @param row Linha marcada.
     * @param transactionId Lançamento a marcar.
     */
    const markPaid = (row: PendingRow, transactionId: string): void => {
        const today = pending.data?.today;
        setPaid.mutate({ id: transactionId, paid: true }, {
            onSuccess: () => {
                setMarked({ transactionId, message: today === undefined ? '' : markedPaidMessage(row, today) });
            },
        });
    };

    /** Volta o último lançamento marcado a pendente. */
    const undo = (): void => {
        if (marked !== null) {
            setPaid.mutate({ id: marked.transactionId, paid: false }, {
                onSuccess: () => {
                    setMarked(null);
                },
            });
        }
    };

    return (
        <QueryView query={pending} loadingLabel="Abrindo os atrasados…">
            {(data) => {
                const badge = pendingBadge(data);
                const panel = pendingPanel(data);
                /** @return Leva à aba Cartões, onde a fatura se paga. */
                const openInvoice = (): void => {
                    router.push(ROUTES.cards);
                };
                return (
                    <View className="gap-1.5">
                        <View accessibilityRole="summary" className={`flex-row flex-wrap items-center gap-1.5 self-start rounded-full border px-3 py-1.5 ${badge.tone === 'warn' ? 'border-warn-ink bg-warn-bg' : 'border-ok-ink bg-ok-bg'}`}>
                            <AppText className={`text-13 font-medium ${badge.tone === 'warn' ? 'text-warn-ink' : 'text-ok-ink'}`}>
                                {badge.tone === 'warn' ? '⚠' : '✓'} {badge.title}
                                {badge.detail === null ? '' : ` · ${badge.detail}`}
                            </AppText>
                        </View>
                        {marked !== null && (
                            <View accessibilityRole="alert" className="flex-row items-center justify-between gap-2 rounded-10 bg-surface2 px-3">
                                <AppText className="flex-1 text-12 text-muted">{marked.message}</AppText>
                                <Pressable accessibilityRole="button" disabled={setPaid.isPending} onPress={undo} className="min-h-11 justify-center px-2">
                                    <AppText className="text-13 text-accent">Desfazer</AppText>
                                </Pressable>
                            </View>
                        )}
                        {setPaid.isError && <AppText accessibilityRole="alert" className="text-12 text-danger">{setPaid.error.message}</AppText>}
                        {panel.overdue.length > 0 && (
                            <View className="overflow-hidden rounded-12 border border-line bg-surface">
                                {panel.overdue.map((row, index) => (
                                    <PendingItem key={row.key} row={row} first={index === 0} busy={setPaid.isPending} onMarkPaid={markPaid} onOpenInvoice={openInvoice} />
                                ))}
                            </View>
                        )}
                        {panel.upcoming.length > 0 && (
                            <>
                                <AppText className="mt-1.5 text-12 font-semibold text-muted">Em aberto até o fim do mês</AppText>
                                <View className="overflow-hidden rounded-12 border border-line bg-surface">
                                    {panel.upcoming.map((row, index) => (
                                        <PendingItem key={row.key} row={row} first={index === 0} busy={setPaid.isPending} onMarkPaid={markPaid} onOpenInvoice={openInvoice} />
                                    ))}
                                </View>
                            </>
                        )}
                        <AppText className="text-12 text-muted">{panel.footer}</AppText>
                    </View>
                );
            }}
        </QueryView>
    );
}

/**
 * Uma conta no Início: nome, consolidado e, embaixo, o previsto com peso menor (decisão de
 * interface 6). A conta zerada aparece esmaecida.
 *
 * @param props.row Conta já formatada pelo `overviewAccounts`.
 * @param props.first Se é a primeira do grupo.
 * @param props.onPress Abre a conta.
 * @return A linha.
 */
function AccountItem({ row, first, onPress }: { readonly row: OverviewAccountRow; readonly first: boolean; readonly onPress: () => void }): ReactNode {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.name}, ${row.consolidated}${row.projected === null ? '' : `, previsto ${row.projected}`}`}
            onPress={onPress}
            className={`min-h-13 flex-row items-center justify-between gap-2.5 px-3.5 py-2.75 active:bg-line2 ${first ? '' : 'border-t border-line2'} ${row.empty ? 'opacity-50' : ''}`}
        >
            <AppText className="min-w-0 flex-1" numberOfLines={1}>{row.name}</AppText>
            <View className="items-end">
                <AppText className="font-semibold">{row.consolidated}</AppText>
                {row.projected !== null && <AppText className="text-12 text-muted">previsto {row.projected}</AppText>}
            </View>
        </Pressable>
    );
}

/**
 * Um cartão no Início: nome, a situação da fatura do mês (em aberto, paga) e o valor.
 *
 * @param props.row Cartão já formatado pelo `overviewCardRows`.
 * @param props.first Se é o primeiro do grupo.
 * @param props.onPress Abre o cartão.
 * @return A linha.
 */
function CardItem({ row, first, onPress }: { readonly row: OverviewCardRow; readonly first: boolean; readonly onPress: () => void }): ReactNode {
    const month = row.invoices[0];
    const status = month?.status ?? null;
    const statusText = month === undefined ? '' : status === null ? month.label : `${status.text} · ${month.label}`;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.name}, ${statusText}, ${month?.amount ?? ''}`}
            onPress={onPress}
            className={`min-h-13 flex-row items-center justify-between gap-2.5 px-3.5 py-2.75 active:bg-line2 ${first ? '' : 'border-t border-line2'}`}
        >
            <View className="min-w-0 flex-1">
                <AppText numberOfLines={1}>{row.name}</AppText>
                <AppText className={`text-12 ${status === null ? 'text-muted' : status.tone === 'warn' ? 'text-warn-ink' : 'text-ok-ink'}`}>{statusText}</AppText>
            </View>
            <AppText className="font-semibold">{month?.amount ?? ''}</AppText>
        </Pressable>
    );
}

/**
 * Início (mockup `MobileInicio`; mobile-mvp-plan, Fase 8): os atrasados no topo, o saldo
 * consolidado com o previsto do fim do mês, as contas — as de fora do total à parte — e a fatura
 * do mês de cada cartão. Todos os números vêm dos view-models do desktop (`overviewAccounts`,
 * `overviewCardRows`) e do mesmo total da tela Contas, para os apps nunca discordarem.
 *
 * @return A tela.
 */
export function HomeScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const next = useNextInvoices({ profileId: profile.id });

    return (
        <Screen header={<ScreenHeader left={<ProfileButton />} />} withMonth withNewTransaction>
            <PendingSection profileId={profile.id} />
            <QueryView query={accounts} loadingLabel="Abrindo as contas…">
                {(list) => {
                    const summary = overviewAccounts(list);
                    /** @return Leva à aba Contas. */
                    const openAccounts = (): void => {
                        router.push(ROUTES.accounts);
                    };
                    return (
                        <>
                            <View className="gap-2.5 rounded-14 border border-line bg-surface p-4">
                                <View className="gap-0.5">
                                    <AppText className="text-13 text-muted">Saldo consolidado</AppText>
                                    <AppText className="text-28 font-semibold">{formatMoney(list.total.consolidated)}</AppText>
                                </View>
                                <View className="flex-row items-baseline justify-between border-t border-line2 pt-2.5">
                                    <AppText className="text-13 text-muted">Previsto fim do mês</AppText>
                                    <AppText className="text-16 text-ink2">{formatMoney(list.total.projected)}</AppText>
                                </View>
                            </View>
                            <View className="gap-1.5">
                                <BlockTitle title="Contas" link="Ver todas" onLink={openAccounts} />
                                {summary.inTotal.length === 0 ? (
                                    <EmptyState title="Nenhuma conta no saldo" />
                                ) : (
                                    <View className="overflow-hidden rounded-12 border border-line bg-surface">
                                        {summary.inTotal.map((row, index) => <AccountItem key={row.accountId} row={row} first={index === 0} onPress={openAccounts} />)}
                                    </View>
                                )}
                            </View>
                            {summary.outsideTotal.length > 0 && (
                                <View className="gap-1.5">
                                    <BlockTitle title="Fora do saldo total" />
                                    <View className="overflow-hidden rounded-12 border border-line bg-surface">
                                        {summary.outsideTotal.map((row, index) => <AccountItem key={row.accountId} row={row} first={index === 0} onPress={openAccounts} />)}
                                    </View>
                                </View>
                            )}
                        </>
                    );
                }}
            </QueryView>
            <QueryView query={creditCards} loadingLabel="Abrindo os cartões…">
                {(list) => {
                    if (list.creditCards.length === 0) {
                        return null;
                    }
                    const rows = overviewCardRows(list, accounts.data?.accounts ?? [], next.data ?? null);
                    /** @return Leva à aba Cartões. */
                    const openCards = (): void => {
                        router.push(ROUTES.cards);
                    };
                    return (
                        <View className="gap-1.5">
                            <BlockTitle title="Cartões · fatura do mês" link="Ver todos" onLink={openCards} />
                            <View className="overflow-hidden rounded-12 border border-line bg-surface">
                                {rows.map((row, index) => <CardItem key={row.creditCardId} row={row} first={index === 0} onPress={openCards} />)}
                            </View>
                        </View>
                    );
                }}
            </QueryView>
        </Screen>
    );
}
