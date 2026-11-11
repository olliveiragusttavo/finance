import { formatInvoiceAmount, formatInvoiceSituation, formatMoney, useAccounts, useCreditCards } from '@finance/client';
import type { CreditCardInPeriodResponse } from '@finance/core';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { CreditCardFormSheet } from '../cards/CreditCardFormSheet.tsx';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { invoiceRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { FormGroup, FormSection } from '../ui/form.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import { EmptyState, QueryView } from '../ui/states.tsx';

/**
 * Linha do cartão (mockup `MobileCartoes`): nome, selo "Padrão" e a situação da fatura do mês à
 * esquerda; o valor a pagar à direita. A fatura em aberto leva a situação na cor de aviso, com o
 * texto — a cor sozinha não diz nada (decisão de interface 7). O selo diz qual cartão o atalho
 * "Crédito" do lançamento escolhe (database-design §4.1).
 *
 * @param props.creditCard Cartão com a fatura do mês.
 * @param props.isDefault Se é o cartão padrão do perfil.
 * @param props.first Se é o primeiro do grupo.
 * @param props.onPress Abre a fatura do mês.
 * @return A linha.
 */
function CardItem(props: { readonly creditCard: CreditCardInPeriodResponse; readonly isDefault: boolean; readonly first: boolean; readonly onPress: () => void }): ReactNode {
    const { creditCard, isDefault, first, onPress } = props;
    const cycle = creditCard.invoiceOfMonth;
    const situation = formatInvoiceSituation(cycle);
    const amount = formatInvoiceAmount(cycle);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[creditCard.name, isDefault ? 'padrão' : null, situation, amount].filter((part) => part !== null).join(', ')}
            onPress={onPress}
            className={`min-h-15 flex-row items-center justify-between gap-3 px-3.5 py-3 active:bg-line2 ${first ? '' : 'border-t border-line2'}`}
        >
            <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                    <AppText className="shrink" numberOfLines={1}>{creditCard.name}</AppText>
                    {isDefault && (
                        <View className="rounded-full bg-line2 px-2 py-0.5">
                            <AppText className="text-12 text-ink2">Padrão</AppText>
                        </View>
                    )}
                </View>
                <AppText className={`text-12 ${cycle.invoice?.status === 'open' ? 'text-warn-ink' : 'text-muted'}`}>{situation}</AppText>
            </View>
            <View className="flex-row items-center gap-2.5">
                <AppText className="font-semibold">{amount}</AppText>
                <AppText className="text-muted">›</AppText>
            </View>
        </Pressable>
    );
}

/**
 * Cartões (mockup `MobileCartoes`; mobile-mvp-plan, Fase 13): os totais do mês, os cartões ativos
 * com a fatura do mês e, à parte, os desativados. Tocar num cartão abre a fatura do mês; o "+"
 * cria um cartão e abre a fatura do novo.
 * Regra de negócio (Cartões): os totais vêm prontos do núcleo, em módulo — "Em aberto no mês"
 * soma só as faturas do mês ainda não pagas, "Total das faturas" soma todas — e são do perfil: a
 * fatura do cartão desativado continua a pagar. Sem conta ativa, não há quem pague um cartão
 * novo, e o "+" explica isso em vez de abrir um formulário sem saída.
 *
 * @return A tela.
 */
export function CardsScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const accounts = useAccounts({ profileId: profile.id, period });
    const [creating, setCreating] = useState(false);
    const [noAccount, setNoAccount] = useState(false);
    const accountList = accounts.data?.accounts ?? [];

    const header = (
        <ScreenHeader
            title="Cartões"
            actions={
                <IconButton
                    icon="plus"
                    label="Adicionar cartão"
                    onPress={() => {
                        // Antes de as contas chegarem não se sabe se há quem pague: o toque não
                        // abre nada, em vez de acusar "sem conta" por engano.
                        if (accounts.data === undefined) {
                            return;
                        }
                        const canCreate = accountList.some((account) => !account.disabled);
                        setNoAccount(!canCreate);
                        setCreating(canCreate);
                    }}
                />
            }
        />
    );

    /**
     * @param list Cartões de uma das seções.
     * @return O grupo com as linhas.
     */
    const renderGroup = (list: readonly CreditCardInPeriodResponse[]): ReactNode => (
        <FormGroup>
            {list.map((creditCard, index) => (
                <CardItem
                    key={creditCard.id}
                    creditCard={creditCard}
                    isDefault={profile.defaultCreditCardId === creditCard.id}
                    first={index === 0}
                    onPress={() => {
                        router.push(invoiceRoute(creditCard.id, null));
                    }}
                />
            ))}
        </FormGroup>
    );

    return (
        <Screen header={header} withMonth>
            {noAccount && (
                <AppText accessibilityRole="alert" className="text-13 text-warn-ink">
                    Reative ou crie uma conta para pagar o cartão.
                </AppText>
            )}
            <QueryView query={creditCards} loadingLabel="Abrindo os cartões…">
                {(data) => {
                    if (data.creditCards.length === 0) {
                        return <EmptyState title="Nenhum cartão" body="Toque em + para cadastrar um cartão e ver a fatura do mês." />;
                    }
                    const active = data.creditCards.filter((creditCard) => !creditCard.disabled);
                    const disabled = data.creditCards.filter((creditCard) => creditCard.disabled);
                    return (
                        <>
                            <View accessibilityLabel="Totais das faturas" className="flex-row gap-3 rounded-12 border border-line bg-surface p-3.5">
                                <View className="flex-1">
                                    <AppText className="text-12 text-muted">Em aberto no mês</AppText>
                                    <AppText className="text-17 font-semibold">{formatMoney(data.openTotal, 'absolute')}</AppText>
                                </View>
                                <View className="flex-1 items-end">
                                    <AppText className="text-12 text-muted">Total das faturas</AppText>
                                    <AppText className="text-17">{formatMoney(data.total, 'absolute')}</AppText>
                                </View>
                            </View>
                            <View className="gap-1.5">
                                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-row justify-between">
                                    <AppText className="text-13 text-muted">Cartão</AppText>
                                    <AppText className="text-13 text-muted">fatura do mês</AppText>
                                </View>
                                {active.length === 0 ? <EmptyState title="Nenhum cartão ativo" body="Os cartões desativados estão abaixo." /> : renderGroup(active)}
                            </View>
                            {disabled.length > 0 && (
                                <View className="gap-1.5">
                                    <FormSection>Desativados</FormSection>
                                    {renderGroup(disabled)}
                                </View>
                            )}
                        </>
                    );
                }}
            </QueryView>
            {creating && (
                <CreditCardFormSheet
                    creditCard={null}
                    accounts={accountList}
                    onClose={() => {
                        setCreating(false);
                    }}
                    onCreated={(created) => {
                        router.push(invoiceRoute(created.id, null));
                    }}
                />
            )}
        </Screen>
    );
}
