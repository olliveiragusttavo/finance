import {
    buildInvoiceTable,
    buildUpcomingInvoices,
    currentDate,
    describeError,
    describeLimitUsage,
    formatDayMonth,
    formatInvoiceSituation,
    formatMoney,
    formatMonthShort,
    isValidPeriod,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useInvoice,
    useInvoicesByCard,
    type InvoiceLine,
} from '@finance/client';
import type { AccountInPeriodResponse, CreditCardInPeriodResponse, InvoiceCycleResponse } from '@finance/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { CreditCardDeletionSheet } from '../cards/CreditCardDeletionSheet.tsx';
import { CreditCardFormSheet } from '../cards/CreditCardFormSheet.tsx';
import { PartialPaymentSheet, PayInvoiceSheet, ReopenInvoiceSheet, type InvoiceActionTarget } from '../cards/invoiceSheets.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { cardTransactionRoute, invoiceRoute, ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, LoadingState, QueryView } from '../ui/states.tsx';

/** Folha aberta na fatura: ações do cartão, cadastro, exclusão ou ação sobre a fatura. */
type InvoiceSheet = 'actions' | 'edit' | 'delete' | 'pay' | 'partial' | 'reopen';

/** Cor do valor de cada tipo de linha; o sinal e o ⇄ vêm no texto. */
const LINE_TONE: Readonly<Record<InvoiceLine['kind'], string>> = { purchase: 'text-ink', refund: 'text-in', payment: 'text-ink2' };

/**
 * Competência mostrada. A pedida na rota (a "ver fatura" de um extrato, uma próxima fatura) vale
 * até o usuário trocar o mês na faixa, como o desktop faz ao tirar a fatura da URL: depois disso,
 * a tela acompanha o mês de referência, para a faixa nunca mostrar um mês e a fatura ser de outro.
 *
 * @param requested Competência da rota, se houver.
 * @param period Mês de referência.
 * @return A competência a mostrar e a ação de voltar à do mês de referência.
 */
function useInvoicePeriod(requested: string | undefined, period: string): { readonly invoicePeriod: string; readonly followMonth: () => void } {
    const [openedAt] = useState(period);
    const [following, setFollowing] = useState(requested === undefined || !isValidPeriod(requested));
    if (!following && period !== openedAt) {
        // Estado derivado no render: o React refaz o render na hora, sem um quadro com a fatura velha.
        setFollowing(true);
    }
    return {
        invoicePeriod: following || requested === undefined ? period : requested,
        followMonth: () => {
            setFollowing(true);
        },
    };
}

/**
 * Resumo da fatura (mockup `MobileFatura`): a situação, o valor a pagar, o fechamento e o
 * vencimento, o limite usado com a barra e as ações da fatura.
 * Regra de negócio (Fatura, database-design §4.7): em aberto, paga-se inteira ou em parte; paga,
 * só se reabre. Sem fatura no mês (nada caiu nela) não há o que pagar, e o parcial precisa de
 * valor a pagar — numa fatura zerada ou credora ele só criaria crédito. A nota do vencimento diz
 * onde a fatura pesa: em aberto, no previsto da conta pagadora; paga, no extrato do pagamento.
 *
 * @param props.creditCard Cartão, com o limite usado.
 * @param props.cycle Competência mostrada.
 * @param props.payingAccountName Conta pagadora.
 * @param props.onAction Abre pagar, pagamento parcial ou reabrir.
 * @return O cartão do resumo.
 */
function InvoiceSummary(props: {
    readonly creditCard: CreditCardInPeriodResponse;
    readonly cycle: InvoiceCycleResponse;
    readonly payingAccountName: string;
    readonly onAction: (action: 'pay' | 'partial' | 'reopen') => void;
}): ReactNode {
    const { creditCard, cycle, payingAccountName, onAction } = props;
    const { invoice } = cycle;
    const today = currentDate(new Date());
    const usage = describeLimitUsage(creditCard);
    const paid = invoice?.status === 'paid';
    const closed = cycle.closingDate <= today;
    const dueNote = invoice !== null && invoice.paidInPeriod !== null ? `Saiu do extrato de ${formatMonthShort(invoice.paidInPeriod)} de ${payingAccountName}` : `Entra no previsto de ${payingAccountName}`;
    return (
        <View accessibilityLabel="Resumo da fatura" className="gap-3 rounded-12 border border-line bg-surface p-3.5">
            <View className="gap-1">
                <View className={`self-start rounded-full px-2 py-0.5 ${invoice === null ? 'bg-line2' : paid ? 'bg-ok-bg' : 'bg-warn-bg'}`}>
                    <AppText className={`text-12 font-medium ${invoice === null ? 'text-muted' : paid ? 'text-ok-ink' : 'text-warn-ink'}`}>
                        {invoice === null ? 'Sem lançamentos' : paid ? formatInvoiceSituation(cycle) : 'Em aberto'}
                    </AppText>
                </View>
                <AppText className="text-28 font-semibold">{invoice === null ? '—' : formatMoney(invoice.amountDue, 'absolute')}</AppText>
                <AppText className="text-12 text-muted">
                    {closed ? 'Fechou' : 'Fecha'} {formatDayMonth(cycle.closingDate)} · vence {formatDayMonth(cycle.dueDate)}
                </AppText>
                <AppText className="text-12 text-muted">{dueNote}</AppText>
            </View>
            <View className="gap-1.5">
                {usage.share !== null && (
                    <View className="h-1.5 overflow-hidden rounded-full bg-track">
                        <View style={{ width: `${String(usage.share * 100)}%` }} className={`h-full ${usage.exceeded ? 'bg-out' : 'bg-accent'}`} />
                    </View>
                )}
                <View className="flex-row justify-between">
                    <AppText className={`text-12 ${usage.exceeded ? 'text-out' : 'text-muted'}`}>
                        Limite usado {usage.percentText}
                        {usage.exceeded ? ' · acima do limite' : ''}
                    </AppText>
                    <AppText className="text-12 text-muted">
                        {usage.usedText} {usage.limitText}
                    </AppText>
                </View>
            </View>
            {paid ? (
                <Button
                    label="Reabrir fatura"
                    variant="secondary"
                    onPress={() => {
                        onAction('reopen');
                    }}
                />
            ) : (
                <View className="flex-row gap-2.5">
                    <View className="flex-1">
                        <Button
                            label="Pagar fatura"
                            disabled={invoice === null}
                            {...(invoice === null ? { accessibilityHint: 'Nenhum lançamento nesta fatura.' } : {})}
                            onPress={() => {
                                onAction('pay');
                            }}
                        />
                    </View>
                    <View className="flex-1">
                        <Button
                            label="Parcial"
                            variant="secondary"
                            disabled={invoice === null || invoice.amountDue.amount <= 0}
                            accessibilityHint="Pagamento parcial da fatura"
                            onPress={() => {
                                onAction('partial');
                            }}
                        />
                    </View>
                </View>
            )}
        </View>
    );
}

/**
 * Lançamentos da fatura (mockup), com o total. É aqui que se abrem as compras do cartão para
 * editar ou excluir: em Transações elas ficam agrupadas na linha da fatura.
 *
 * @param props.cycle Competência mostrada.
 * @param props.accounts Contas do perfil, para a origem dos pagamentos parciais.
 * @return A seção dos lançamentos.
 */
function InvoiceLines({ cycle, accounts }: { readonly cycle: InvoiceCycleResponse; readonly accounts: readonly AccountInPeriodResponse[] }): ReactNode {
    const { profile } = useActiveProfile();
    const router = useRouter();
    const detail = useInvoice(cycle.invoice === null ? null : { invoiceId: cycle.invoice.id });
    const categories = useCategoryTree({ profileId: profile.id });
    if (cycle.invoice === null) {
        return <EmptyState title={`Nenhum lançamento na fatura de ${formatMonthShort(cycle.period)}`} />;
    }
    if (detail.data === undefined || categories.data === undefined) {
        return <LoadingState label="Abrindo os lançamentos…" />;
    }
    const table = buildInvoiceTable({ invoice: detail.data, accounts, categories: categories.data });
    return (
        <View className="gap-1.5">
            <FormSection>Lançamentos desta fatura</FormSection>
            <FormGroup>
                {table.lines.map((line, index) => {
                    const sub = `${line.date} · ${line.detail ?? line.category}`;
                    return (
                        <Pressable
                            key={line.key}
                            accessibilityRole="button"
                            accessibilityLabel={[line.name, line.kind === 'refund' ? 'estorno' : null, sub, line.amountText].filter((part) => part !== null).join(', ')}
                            onPress={() => {
                                router.push(cardTransactionRoute(line.transactionId));
                            }}
                            className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                        >
                            <View className="min-w-0 flex-1">
                                <AppText numberOfLines={1}>{line.name}</AppText>
                                <AppText className="text-12 text-muted" numberOfLines={1}>{sub}</AppText>
                            </View>
                            <AppText className={`font-semibold ${LINE_TONE[line.kind]}`}>{line.amountText}</AppText>
                        </Pressable>
                    );
                })}
                <View className="min-h-12.5 flex-row items-center justify-between border-t border-line px-3.5">
                    <AppText className="text-muted">Total</AppText>
                    <AppText className="font-semibold">{table.totalText}</AppText>
                </View>
            </FormGroup>
        </View>
    );
}

/**
 * Próximas faturas do cartão (mockup), cada uma levando à sua fatura.
 *
 * @param props.creditCard Cartão, pelo dia de fechamento que decide a fase de cada fatura.
 * @param props.cycles Saída de `invoices.listByCard` a partir da fatura mostrada.
 * @return A seção.
 */
function UpcomingInvoices({ creditCard, cycles }: { readonly creditCard: CreditCardInPeriodResponse; readonly cycles: readonly InvoiceCycleResponse[] }): ReactNode {
    const router = useRouter();
    const rows = buildUpcomingInvoices(cycles, creditCard.closingDay, currentDate(new Date()));
    return (
        <View className="gap-1.5">
            <FormSection>Próximas faturas</FormSection>
            {rows.length === 0 ? (
                <AppText className="text-13 text-muted">Nenhuma fatura com lançamentos depois desta.</AppText>
            ) : (
                <FormGroup>
                    {rows.map((row, index) => (
                        <Pressable
                            key={row.period}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.label}, ${row.amountText}`}
                            onPress={() => {
                                router.push(invoiceRoute(creditCard.id, row.period));
                            }}
                            className={`min-h-12.5 flex-row items-center justify-between gap-3 px-3.5 active:bg-line2 ${index === 0 ? '' : 'border-t border-line2'}`}
                        >
                            <AppText className="text-ink2">{row.label}</AppText>
                            <AppText className="font-semibold">{row.amountText}</AppText>
                        </Pressable>
                    ))}
                </FormGroup>
            )}
        </View>
    );
}

/**
 * Ações do cartão em folha: editar, usar como padrão, desativar ou reativar e excluir — as do
 * "⋯" da fatura no desktop, que o `MobileFatura` não desenha.
 * Regra de negócio (Cartões, database-design §4.1): o cartão desativado não aceita lançamentos
 * novos, então não pode ser o padrão — a ação some enquanto ele estiver desativado.
 *
 * @param props.creditCard Cartão aberto.
 * @param props.isDefault Se é o cartão padrão do perfil.
 * @param props.pending Se uma alternância está em andamento.
 * @param props.onEdit Abre o formulário.
 * @param props.onToggleDefault Torna padrão, ou deixa de ser.
 * @param props.onToggle Desativa ou reativa.
 * @param props.onDelete Abre a exclusão.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function CardActionsSheet(props: {
    readonly creditCard: CreditCardInPeriodResponse;
    readonly isDefault: boolean;
    readonly pending: boolean;
    readonly onEdit: () => void;
    readonly onToggleDefault: () => void;
    readonly onToggle: () => void;
    readonly onDelete: () => void;
    readonly onClose: () => void;
}): ReactNode {
    const { creditCard, isDefault, pending, onEdit, onToggleDefault, onToggle, onDelete, onClose } = props;
    return (
        <Sheet open title={creditCard.name} onClose={onClose}>
            <Button label="Editar cartão" variant="secondary" onPress={onEdit} />
            {!creditCard.disabled && <Button label={isDefault ? 'Deixar de ser o cartão padrão' : 'Usar como cartão padrão (crédito)'} variant="secondary" busy={pending} onPress={onToggleDefault} />}
            <Button label={creditCard.disabled ? 'Reativar cartão' : 'Desativar cartão'} variant="secondary" busy={pending} onPress={onToggle} />
            {!creditCard.disabled && <AppText className="text-12 text-muted">Desativado, o cartão sai dos lançamentos novos; as faturas continuam a pagar.</AppText>}
            <Button label="Excluir cartão…" variant="danger" onPress={onDelete} />
        </Sheet>
    );
}

/**
 * Fatura do cartão (mockup `MobileFatura`; mobile-mvp-plan, Fase 13): o resumo com pagar, parcial
 * e reabrir, os lançamentos e as próximas faturas, com as ações do cartão no "⋯". O cartão vem da
 * mesma consulta da lista de Cartões, já em cache; a fatura, de `invoices.listByCard` a partir da
 * competência mostrada, que traz também as próximas.
 *
 * @return A tela.
 */
export function InvoiceScreen(): ReactNode {
    const params = useLocalSearchParams<{ id: string; invoice?: string }>();
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const { invoicePeriod, followMonth } = useInvoicePeriod(params.invoice, period);
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const cycles = useInvoicesByCard({ creditCardId: params.id, from: invoicePeriod });
    const disable = useCoreMutation('creditCards.disable');
    const enable = useCoreMutation('creditCards.enable');
    const setDefault = useCoreMutation('profiles.setDefaultCreditCard');
    const [sheet, setSheet] = useState<InvoiceSheet | null>(null);
    const creditCard = creditCards.data?.creditCards.find((candidate) => candidate.id === params.id);

    if (creditCard === undefined) {
        return (
            <Screen header={<ScreenHeader title="Fatura" back />} withMonth>
                <QueryView query={creditCards} loadingLabel="Abrindo o cartão…">
                    {() => <EmptyState title="Este cartão não existe mais" body="Ele pode ter sido excluído." />}
                </QueryView>
            </Screen>
        );
    }

    const accountList = accounts.data?.accounts ?? [];
    const payingAccountName = accountList.find((account) => account.id === creditCard.accountId)?.name ?? '—';
    const isDefault = profile.defaultCreditCardId === creditCard.id;
    const toggle = creditCard.disabled ? enable : disable;
    const failure = toggle.error ?? setDefault.error;
    const cycle = cycles.data?.[0];
    const target: InvoiceActionTarget | null =
        cycle?.invoice === undefined || cycle.invoice === null
            ? null
            : { creditCardId: creditCard.id, creditCardName: creditCard.name, payingAccountId: creditCard.accountId, payingAccountName, invoice: cycle.invoice, dueDate: cycle.dueDate };
    /** Fecha a folha aberta. */
    const close = (): void => {
        setSheet(null);
    };
    /** Desativa ou reativa o cartão, conforme a situação atual. */
    const toggleCard = (): void => {
        toggle.mutate({ id: creditCard.id }, { onSuccess: close });
    };

    const header = (
        <ScreenHeader
            back
            left={
                <View className="min-w-0 flex-1">
                    <AppText accessibilityRole="header" className="text-17 font-semibold" numberOfLines={1}>{creditCard.name}</AppText>
                    <AppText className="text-12 text-muted" numberOfLines={1}>
                        Cartão · paga com {payingAccountName}
                        {creditCard.disabled ? ' · desativado' : ''}
                    </AppText>
                </View>
            }
            actions={
                <IconButton
                    icon="more"
                    label="Ações do cartão"
                    onPress={() => {
                        setSheet('actions');
                    }}
                />
            }
        />
    );

    return (
        <Screen header={header} withMonth>
            {failure !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(failure.error).message}
                </AppText>
            )}
            {invoicePeriod !== period && (
                <View accessibilityRole="summary" className="gap-1 rounded-10 border border-line bg-surface2 px-3 py-2.5">
                    <AppText className="text-13 text-ink2">Esta é a fatura de {formatMonthShort(invoicePeriod)}, não a do mês de referência.</AppText>
                    <Pressable accessibilityRole="link" onPress={followMonth} className="min-h-11 justify-center self-start">
                        <AppText className="text-13 text-accent">Ver a fatura de {formatMonthShort(period)}</AppText>
                    </Pressable>
                </View>
            )}
            <QueryView query={cycles} loadingLabel="Abrindo a fatura…">
                {(data) => {
                    const [shown] = data;
                    return shown === undefined ? null : (
                        <>
                            <InvoiceSummary
                                creditCard={creditCard}
                                cycle={shown}
                                payingAccountName={payingAccountName}
                                onAction={(action) => {
                                    setSheet(action);
                                }}
                            />
                            <InvoiceLines cycle={shown} accounts={accountList} />
                            <UpcomingInvoices creditCard={creditCard} cycles={data} />
                        </>
                    );
                }}
            </QueryView>
            {sheet === 'actions' && (
                <CardActionsSheet
                    creditCard={creditCard}
                    isDefault={isDefault}
                    pending={toggle.isPending || setDefault.isPending}
                    onEdit={() => {
                        setSheet('edit');
                    }}
                    onToggleDefault={() => {
                        setDefault.mutate({ profileId: profile.id, creditCardId: isDefault ? null : creditCard.id }, { onSuccess: close });
                    }}
                    onToggle={toggleCard}
                    onDelete={() => {
                        setSheet('delete');
                    }}
                    onClose={close}
                />
            )}
            {sheet === 'edit' && <CreditCardFormSheet creditCard={creditCard} accounts={accountList} onClose={close} />}
            {sheet === 'delete' && (
                <CreditCardDeletionSheet
                    creditCard={creditCard}
                    onClose={close}
                    onDeleted={() => {
                        close();
                        if (router.canGoBack()) {
                            router.back();
                        } else {
                            router.replace(ROUTES.cards);
                        }
                    }}
                    onDisableInstead={creditCard.disabled ? undefined : toggleCard}
                />
            )}
            {sheet === 'pay' && target !== null && (
                <PayInvoiceSheet
                    target={target}
                    onClose={close}
                    onPartial={
                        target.invoice.amountDue.amount > 0
                            ? () => {
                                  setSheet('partial');
                              }
                            : null
                    }
                />
            )}
            {sheet === 'partial' && target !== null && <PartialPaymentSheet target={target} accounts={accountList} onClose={close} />}
            {sheet === 'reopen' && target !== null && <ReopenInvoiceSheet target={target} onClose={close} />}
        </Screen>
    );
}
