import { formatAccountType, formatMoney, useAccounts } from '@finance/client';
import type { AccountInPeriodResponse } from '@finance/core';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AccountFormSheet } from '../accounts/AccountFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { accountRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/**
 * Se a linha da conta aparece esmaecida.
 * Regra de negócio (Contas): a conta fora do total aparece apagada e só com o consolidado, como no
 * mockup e no desktop, porque não soma no total (database-design §4.4); a conta sem saldo no mês
 * — consolidado e previsto zerados — também, para que as contas com dinheiro se destaquem
 * (mobile-mvp-plan, Fase 12).
 *
 * @param account Conta com os saldos do mês.
 * @return `true` quando a linha fica com a cor `muted`.
 */
function isDimmed(account: AccountInPeriodResponse): boolean {
    return !account.considerBalance || (account.balances.consolidated.amount === 0 && account.balances.projected.amount === 0);
}

/**
 * Linha da conta (mockup `MobileContas`): nome, tipo e o selo "Padrão" à esquerda; consolidado e
 * previsto do fim do mês à direita, e o "›" que abre o extrato. O selo diz qual conta o atalho
 * "Débito" do lançamento escolhe (database-design §4.1). O nome acessível junta tudo, porque o
 * leitor de tela lê a linha como um botão só.
 *
 * @param props.account Conta com os saldos do mês.
 * @param props.isDefault Se é a conta padrão do perfil.
 * @param props.first Se é a primeira do grupo.
 * @param props.onPress Abre o extrato.
 * @return A linha.
 */
function AccountItem(props: { readonly account: AccountInPeriodResponse; readonly isDefault: boolean; readonly first: boolean; readonly onPress: () => void }): ReactNode {
    const { account, isDefault, first, onPress } = props;
    const outside = !account.considerBalance;
    const dimmed = isDimmed(account);
    const kind = `${formatAccountType(account.type)}${outside ? ' · fora do total' : ''}`;
    const consolidated = formatMoney(account.balances.consolidated);
    const projected = formatMoney(account.balances.projected);
    const label = [account.name, isDefault ? 'padrão' : null, kind, consolidated, outside ? null : `previsto ${projected}`].filter((part) => part !== null).join(', ');
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-3 active:bg-line2 ${first ? '' : 'border-t border-line2'}`}
        >
            <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                    <AppText className={`shrink ${dimmed ? 'text-muted' : ''}`} numberOfLines={1}>{account.name}</AppText>
                    {isDefault && (
                        <View className="rounded-full bg-line2 px-2 py-0.5">
                            <AppText className="text-12 text-ink2">Padrão</AppText>
                        </View>
                    )}
                </View>
                <AppText className="text-12 text-muted">{kind}</AppText>
            </View>
            <View className="flex-row items-center gap-2.5">
                {outside ? (
                    <AppText className="text-muted">{consolidated}</AppText>
                ) : (
                    <View className="items-end">
                        <AppText className={`font-semibold ${dimmed ? 'text-muted' : ''}`}>{consolidated}</AppText>
                        <AppText className="text-12 text-muted">previsto {projected}</AppText>
                    </View>
                )}
                <AppText className="text-muted">›</AppText>
            </View>
        </Pressable>
    );
}

/**
 * Contas (mockup `MobileContas`; mobile-mvp-plan, Fase 12): as contas ativas com o saldo do fim
 * do mês, o total do perfil e, à parte, as desativadas. Tocar numa conta abre o extrato dela; o
 * "+" cria uma conta e abre o extrato da nova, como o desktop.
 *
 * Regra de negócio (Contas): o total vem do núcleo, que já soma só as contas que entram no total
 * — a tela não refaz a soma (database-design §4.4) —, e é do perfil: a conta desativada continua
 * no saldo (desktop-mvp-plan §5.1), por isso mostrá-la à parte não muda o total. Consolidado e
 * previsto sempre juntos (decisão de interface 6), também no total, que o mockup mostra só com o
 * consolidado.
 *
 * @return A tela.
 */
export function AccountsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const accounts = useAccounts({ profileId: profile.id, period });
    const [creating, setCreating] = useState(false);

    const header = (
        <ScreenHeader
            title="Contas"
            actions={
                <IconButton
                    icon="plus"
                    label="Adicionar conta"
                    onPress={() => {
                        setCreating(true);
                    }}
                />
            }
        />
    );

    /**
     * @param list Contas de uma das seções.
     * @return O grupo com as linhas.
     */
    const renderGroup = (list: readonly AccountInPeriodResponse[]): ReactNode => (
        <FormGroup>
            {list.map((account, index) => (
                <AccountItem
                    key={account.id}
                    account={account}
                    isDefault={profile.defaultAccountId === account.id}
                    first={index === 0}
                    onPress={() => {
                        router.push(accountRoute(account.id));
                    }}
                />
            ))}
        </FormGroup>
    );

    return (
        <Screen header={header} withMonth>
            <QueryView query={accounts} loadingLabel="Abrindo as contas…">
                {(data) => {
                    const active = data.accounts.filter((account) => !account.disabled);
                    const disabled = data.accounts.filter((account) => account.disabled);
                    if (data.accounts.length === 0) {
                        return <EmptyState title="Nenhuma conta" body="Toque em + para criar a primeira conta do perfil." />;
                    }
                    return (
                        <>
                            <View className="gap-1.5">
                                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-row justify-between">
                                    <AppText className="text-13 text-muted">Conta</AppText>
                                    <AppText className="text-13 text-muted">saldo no fim do mês</AppText>
                                </View>
                                {active.length === 0 ? <EmptyState title="Nenhuma conta ativa" body="As contas desativadas estão abaixo." /> : renderGroup(active)}
                                <View accessibilityLabel="Totais do perfil" className="gap-0.5 px-1">
                                    <View className="flex-row justify-between">
                                        <AppText className="text-13 text-muted">Total consolidado</AppText>
                                        <AppText className="text-13 font-semibold">{formatMoney(data.total.consolidated)}</AppText>
                                    </View>
                                    <View className="flex-row justify-between">
                                        <AppText className="text-13 text-muted">Total previsto</AppText>
                                        <AppText className="text-13">{formatMoney(data.total.projected)}</AppText>
                                    </View>
                                </View>
                            </View>
                            {disabled.length > 0 && (
                                <View className="gap-1.5">
                                    <FormSection>Desativadas</FormSection>
                                    {renderGroup(disabled)}
                                </View>
                            )}
                        </>
                    );
                }}
            </QueryView>
            {creating && (
                <AccountFormSheet
                    account={null}
                    onClose={() => {
                        setCreating(false);
                    }}
                    onCreated={(created) => {
                        router.push(accountRoute(created.id));
                    }}
                />
            )}
        </Screen>
    );
}
