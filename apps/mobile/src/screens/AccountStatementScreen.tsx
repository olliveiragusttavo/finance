import {
    buildStatementTable,
    describeError,
    formatAccountHeading,
    formatMoney,
    formatMonthLong,
    useAccounts,
    useCategoryTree,
    useCoreMutation,
    useCreditCards,
    useStatement,
    useTransferTargets,
    type StatementRow,
} from '@finance/client';
import type { AccountInPeriodResponse, AccountListResponse, BalancePairResponse, StatementResponse } from '@finance/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AccountDeletionSheet } from '../accounts/AccountDeletionSheet.tsx';
import { AccountFormSheet } from '../accounts/AccountFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { accountTransactionRoute, ROUTES } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { EmptyState, LoadingState, QueryView } from '../ui/states.tsx';

/** Cor do valor pelo sentido; o sinal e o ⇄ vêm no texto (decisão de interface 7). */
const AMOUNT_TONE: Readonly<Record<StatementRow['direction'], string>> = { in: 'text-in', out: 'text-out', transfer: 'text-ink2' };

/** Folha aberta no extrato: as ações, o formulário de edição ou a exclusão. */
type StatementSheet = 'actions' | 'edit' | 'delete';

/**
 * Um saldo do resumo: o consolidado em destaque e o previsto abaixo, com peso menor (decisão de
 * interface 6).
 *
 * @param props.label Rótulo.
 * @param props.pair Consolidado e previsto.
 * @param props.end Alinha à direita (a coluna da direita do mockup).
 * @return O número.
 */
function Balance({ label, pair, end = false }: { readonly label: string; readonly pair: BalancePairResponse; readonly end?: boolean }): ReactNode {
    return (
        <View className={`flex-1 ${end ? 'items-end' : ''}`}>
            <AppText className="text-12 text-muted">{label}</AppText>
            <AppText className="text-17 font-semibold">{formatMoney(pair.consolidated, 'negative')}</AppText>
            <AppText className="text-12 text-muted">previsto {formatMoney(pair.projected, 'negative')}</AppText>
        </View>
    );
}

/**
 * Entradas ou saídas do resumo, com a seta que diz o sentido sem depender da cor (decisão de
 * interface 7). Mostra o consolidado, como o mockup; o previsto vem abaixo, como no desktop,
 * para que inicial + entradas − saídas = final se confira nas duas colunas.
 *
 * @param props.label Rótulo com a seta.
 * @param props.pair Consolidado e previsto.
 * @param props.tone Cor de entrada ou saída.
 * @param props.end Alinha à direita.
 * @return O número.
 */
function Flow({ label, pair, tone, end = false }: { readonly label: string; readonly pair: BalancePairResponse; readonly tone: 'in' | 'out'; readonly end?: boolean }): ReactNode {
    return (
        <View className={`flex-1 ${end ? 'items-end' : ''}`}>
            <AppText className="text-12 text-muted">{label}</AppText>
            <AppText className={`font-semibold ${tone === 'in' ? 'text-in' : 'text-out'}`}>{formatMoney(pair.consolidated, 'always')}</AppText>
            <AppText className="text-12 text-muted">previsto {formatMoney(pair.projected, 'always')}</AppText>
        </View>
    );
}

/**
 * Resumo do extrato (mockup `MobileExtrato`): saldos inicial e final em cima, entradas e saídas
 * embaixo.
 * Regra de negócio (Extrato): entradas e saídas somam os mesmos movimentos da lista, pagos no
 * consolidado e todos no previsto, então inicial + entradas − saídas = final vale nos dois.
 *
 * @param props.statement Extrato do mês.
 * @return O cartão do resumo.
 */
function StatementSummary({ statement }: { readonly statement: StatementResponse }): ReactNode {
    return (
        <View accessibilityLabel="Resumo do extrato" className="gap-2.5 rounded-12 border border-line bg-surface p-3.5">
            <View className="flex-row gap-3">
                <Balance label="Saldo inicial" pair={statement.opening} />
                <Balance label="Saldo final" pair={statement.closing} end />
            </View>
            <View className="flex-row gap-3 border-t border-line2 pt-2.5">
                <Flow label="↑ Entradas" pair={statement.inflows} tone="in" />
                <Flow label="↓ Saídas" pair={statement.outflows} tone="out" end />
            </View>
        </View>
    );
}

/**
 * Um movimento do extrato (`.it` do mockup): nome, data e complemento à esquerda; valor e
 * situação à direita. A fatura em aberto diz que pesa só no previsto e leva à fatura; o
 * lançamento abre o detalhe.
 *
 * @param props.row Linha montada pelo `buildStatementTable` do `client`, o mesmo do desktop.
 * @param props.first Se é a primeira do grupo.
 * @param props.onPress Abre a fatura ou o lançamento.
 * @return A linha.
 */
function MovementItem({ row, first, onPress }: { readonly row: StatementRow; readonly first: boolean; readonly onPress: () => void }): ReactNode {
    const openInvoice = row.situation === 'invoiceOpen';
    const detail = openInvoice ? 'em aberto · só no previsto' : (row.detail ?? row.category);
    const situation = openInvoice ? 'ver fatura ›' : row.situationText.toLowerCase();
    const warn = openInvoice || row.situation === 'pending';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[row.name, row.refund ? 'estorno' : null, row.date, detail, row.amountText, openInvoice ? 'em aberto, ver fatura' : situation].filter((part) => part !== null).join(', ')}
            onPress={onPress}
            className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-line2 ${first ? '' : 'border-t border-line2'}`}
        >
            <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                    <AppText className="shrink" numberOfLines={1}>{row.name}</AppText>
                    {row.refund && (
                        <View className="rounded-full bg-soft px-2 py-0.5">
                            <AppText className="text-12 text-soft-ink">estorno</AppText>
                        </View>
                    )}
                </View>
                <AppText className="text-12 text-muted" numberOfLines={1}>
                    {row.date} · {detail}
                </AppText>
            </View>
            <View className="items-end">
                <AppText className={`font-semibold ${AMOUNT_TONE[row.direction]}`}>{row.amountText}</AppText>
                <AppText className={`text-12 ${warn ? 'text-warn-ink' : 'text-muted'}`}>{situation}</AppText>
            </View>
        </Pressable>
    );
}

/**
 * Movimentos do mês, na ordem da data de caixa (`buildStatementTable`). Os cartões e as
 * categorias só dão nome às linhas; enquanto carregam, o resumo já aparece.
 *
 * @param props.statement Extrato do mês.
 * @param props.accounts Todas as contas do perfil, desativadas incluídas: nomeiam o outro lado
 * das transferências.
 * @return A seção dos movimentos.
 */
function StatementMovements({ statement, accounts }: { readonly statement: StatementResponse; readonly accounts: AccountListResponse['accounts'] }): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    // Só nomeiam o outro lado das transferências entre perfis; sem elas o extrato ainda se monta.
    const otherProfileAccounts = useTransferTargets({ profileId: profile.id });
    if (creditCards.data === undefined || categories.data === undefined) {
        return <LoadingState label="Abrindo os movimentos…" />;
    }
    const table = buildStatementTable({ statement, accounts, creditCards: creditCards.data.creditCards, categories: categories.data, otherProfileAccounts: otherProfileAccounts.data ?? [] });
    return (
        <View className="gap-1.5">
            <FormSection>Movimentos</FormSection>
            {table.rows.length === 0 ? (
                <EmptyState title={`Nenhum movimento em ${formatMonthLong(statement.period).toLowerCase()}`} body="O saldo final é o mesmo do inicial." />
            ) : (
                <FormGroup>
                    {table.rows.map((row, index) => (
                        <MovementItem
                            key={row.key}
                            row={row}
                            first={index === 0}
                            onPress={() => {
                                // A fatura abre em Cartões; o detalhe da fatura (`MobileFatura`) chega na Fase 13.
                                if (row.transactionId === null) {
                                    router.push(ROUTES.cards);
                                } else {
                                    router.push(accountTransactionRoute(row.transactionId));
                                }
                            }}
                        />
                    ))}
                </FormGroup>
            )}
            {table.hasOpenInvoices && <AppText className="text-12 text-muted">Fatura em aberto conta só no saldo previsto, no mês do vencimento.</AppText>}
        </View>
    );
}

/**
 * Ações da conta em folha: editar, usar como padrão, desativar ou reativar e excluir — as do "⋯"
 * do extrato no desktop. O `MobileExtrato` não desenha as ações; elas ficam atrás de um botão no
 * cabeçalho para não disputar espaço com o resumo (mobile-mvp-plan, Fase 12).
 * Regra de negócio (Contas, database-design §4.1): a conta desativada não aceita lançamentos
 * novos, então não pode ser a padrão — a ação some enquanto ela estiver desativada.
 *
 * @param props.account Conta aberta.
 * @param props.isDefault Se é a conta padrão do perfil.
 * @param props.pending Se uma alternância está em andamento.
 * @param props.onEdit Abre o formulário.
 * @param props.onToggleDefault Torna padrão, ou deixa de ser.
 * @param props.onToggle Desativa ou reativa.
 * @param props.onDelete Abre a exclusão.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
function AccountActionsSheet(props: {
    readonly account: AccountInPeriodResponse;
    readonly isDefault: boolean;
    readonly pending: boolean;
    readonly onEdit: () => void;
    readonly onToggleDefault: () => void;
    readonly onToggle: () => void;
    readonly onDelete: () => void;
    readonly onClose: () => void;
}): ReactNode {
    const { account, isDefault, pending, onEdit, onToggleDefault, onToggle, onDelete, onClose } = props;
    return (
        <Sheet open title={account.name} onClose={onClose}>
            <Button label="Editar conta" variant="secondary" onPress={onEdit} />
            {!account.disabled && <Button label={isDefault ? 'Deixar de ser a conta padrão' : 'Usar como conta padrão (débito)'} variant="secondary" busy={pending} onPress={onToggleDefault} />}
            <Button label={account.disabled ? 'Reativar conta' : 'Desativar conta'} variant="secondary" busy={pending} onPress={onToggle} />
            {!account.disabled && <AppText className="text-12 text-muted">Desativada, a conta sai dos lançamentos novos e continua nos extratos e relatórios.</AppText>}
            <Button label="Excluir conta…" variant="danger" onPress={onDelete} />
        </Sheet>
    );
}

/**
 * Extrato da conta no mês (mockup `MobileExtrato`; mobile-mvp-plan, Fase 12): o resumo de
 * `statements.get` e os movimentos, com as ações da conta no "⋯". A conta vem da mesma consulta
 * da lista de Contas, já em cache, e não de uma rota própria: o cabeçalho e a lista nunca
 * divergem. Alternar padrão e situação não pede confirmação, como no desktop — as duas se
 * desfazem e não mudam saldo nenhum.
 *
 * @return A tela.
 */
export function AccountStatementScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const accounts = useAccounts({ profileId: profile.id, period });
    const statement = useStatement({ accountId: id, period });
    const disable = useCoreMutation('accounts.disable');
    const enable = useCoreMutation('accounts.enable');
    const setDefault = useCoreMutation('profiles.setDefaultAccount');
    const [sheet, setSheet] = useState<StatementSheet | null>(null);
    const account = accounts.data?.accounts.find((candidate) => candidate.id === id);

    if (account === undefined) {
        return (
            <Screen header={<ScreenHeader title="Extrato" back />} withMonth>
                <QueryView query={accounts} loadingLabel="Abrindo a conta…">
                    {() => <EmptyState title="Esta conta não existe mais" body="Ela pode ter sido excluída." />}
                </QueryView>
            </Screen>
        );
    }

    const isDefault = profile.defaultAccountId === account.id;
    const toggle = account.disabled ? enable : disable;
    const failure = toggle.error ?? setDefault.error;
    /** Fecha a folha aberta. */
    const close = (): void => {
        setSheet(null);
    };
    /** Desativa ou reativa a conta, conforme a situação atual. */
    const toggleAccount = (): void => {
        toggle.mutate({ id: account.id }, { onSuccess: close });
    };

    const header = (
        <ScreenHeader
            back
            left={
                <View className="min-w-0 flex-1">
                    <AppText accessibilityRole="header" className="text-17 font-semibold" numberOfLines={1}>{account.name}</AppText>
                    <AppText className="text-12 text-muted" numberOfLines={1}>{formatAccountHeading(account)}</AppText>
                </View>
            }
            actions={
                <IconButton
                    icon="more"
                    label="Ações da conta"
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
            <QueryView query={statement} loadingLabel="Abrindo o extrato…">
                {(data) => (
                    <>
                        <StatementSummary statement={data} />
                        <StatementMovements statement={data} accounts={accounts.data?.accounts ?? []} />
                    </>
                )}
            </QueryView>
            {sheet === 'actions' && (
                <AccountActionsSheet
                    account={account}
                    isDefault={isDefault}
                    pending={toggle.isPending || setDefault.isPending}
                    onEdit={() => {
                        setSheet('edit');
                    }}
                    onToggleDefault={() => {
                        setDefault.mutate({ profileId: profile.id, accountId: isDefault ? null : account.id }, { onSuccess: close });
                    }}
                    onToggle={toggleAccount}
                    onDelete={() => {
                        setSheet('delete');
                    }}
                    onClose={close}
                />
            )}
            {sheet === 'edit' && <AccountFormSheet account={account} onClose={close} />}
            {sheet === 'delete' && (
                <AccountDeletionSheet
                    account={account}
                    onClose={close}
                    onDeleted={() => {
                        close();
                        if (router.canGoBack()) {
                            router.back();
                        } else {
                            router.replace(ROUTES.accounts);
                        }
                    }}
                    onDisableInstead={account.disabled ? undefined : toggleAccount}
                />
            )}
        </Screen>
    );
}
