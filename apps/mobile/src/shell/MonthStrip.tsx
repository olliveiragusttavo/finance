import { formatMonthLong } from '@finance/client';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from '../ui/AppText.tsx';
import { useReferenceMonth } from './useReferenceMonth.ts';

/**
 * Faixa do mês de referência, abaixo do cabeçalho (decisão de interface 2 dos mockups), nas telas
 * que dependem de período; nunca no lançamento nem nos fluxos de configuração. O centro mostra o
 * mês; fora do mês corrente, o rótulo de cima vira "Voltar ao mês atual" e o toque no centro
 * volta a ele — o mockup deixa o centro como botão sem dizer o que faz, e o celular não tem
 * espaço para um terceiro botão ao lado das setas.
 *
 * @return A faixa.
 */
export function MonthStrip(): ReactNode {
    const month = useReferenceMonth();
    const label = formatMonthLong(month.period);
    return (
        <View className="flex-row items-center justify-between border-b border-line bg-surface px-1.5 py-0.5">
            <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior" onPress={month.previous} className="h-11 w-12 items-center justify-center rounded-10 active:bg-line2">
                <AppText className="text-20">‹</AppText>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={month.isCurrent ? `Mês de referência: ${label}` : `Mês de referência: ${label}. Voltar ao mês atual`}
                disabled={month.isCurrent}
                onPress={month.goToCurrent}
                className="min-h-11 items-center justify-center rounded-10 px-3 py-1 active:bg-line2"
            >
                <AppText className={`text-11 ${month.isCurrent ? 'text-muted' : 'font-medium text-accent'}`}>{month.isCurrent ? 'Mês de referência' : 'Voltar ao mês atual'}</AppText>
                <AppText className="font-semibold">{label}</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Próximo mês" onPress={month.next} className="h-11 w-12 items-center justify-center rounded-10 active:bg-line2">
                <AppText className="text-20">›</AppText>
            </Pressable>
        </View>
    );
}
