import { useTransaction } from '@finance/client';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ModalHeader } from '../shell/Screen.tsx';
import { TransactionFormScreen } from '../transactions/TransactionFormScreen.tsx';
import { ErrorState, LoadingState } from '../ui/states.tsx';

/**
 * Rota do lançamento (mobile-mvp-plan, Fase 10): sem `id`, um lançamento novo; com `id`, a edição
 * dele, aberta pelo detalhe. Uma rota só para os dois, por cima das abas, como o diálogo único do
 * desktop.
 *
 * @return O formulário, ou o estado de carregamento do lançamento editado.
 */
export function NewTransactionScreen(): ReactNode {
    const { id } = useLocalSearchParams<{ id?: string }>();
    const query = useTransaction(id === undefined ? null : { id });
    if (id === undefined) {
        return <TransactionFormScreen transaction={null} />;
    }
    if (query.data !== undefined) {
        return <TransactionFormScreen transaction={query.data} />;
    }
    return (
        <View className="flex-1 bg-bg">
            <ModalHeader title="Editar lançamento" />
            <View className="p-4">
                {query.error === null ? (
                    <LoadingState label="Abrindo o lançamento…" />
                ) : (
                    <ErrorState
                        error={query.error}
                        onRetry={() => {
                            void query.refetch();
                        }}
                    />
                )}
            </View>
        </View>
    );
}
