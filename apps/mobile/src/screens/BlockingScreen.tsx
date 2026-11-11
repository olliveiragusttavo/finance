import { blockingCopy, canTryRestore, restoreMessage, type BlockedStatus, type RestoreState } from '@finance/client';
import type { RestoreResult } from '@finance/client/startup';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AppText } from '../ui/AppText.tsx';

/**
 * Tela de bloqueio da abertura (backend-design §4.5 e §4.8), com os mesmos textos e as mesmas
 * decisões do desktop, vindos do `client`: o banco não foi aberto e o app não segue, porque
 * abrir mesmo assim mostraria número errado ou gravaria num banco pela metade. Sem barra
 * inferior nem mês de referência, já que nada do banco pode ser lido.
 *
 * @param props.status O bloqueio a explicar.
 * @param props.restore Restaura o backup oferecido; só é chamado quando a tela oferece.
 * @return A tela.
 */
export function BlockingScreen({ status, restore }: { readonly status: BlockedStatus; readonly restore: () => RestoreResult }): ReactNode {
    const [state, setState] = useState<RestoreState>(null);
    const copy = blockingCopy(status);
    const offersRestore = status.kind === 'migrationFailed' && status.backupFile !== null && canTryRestore(state);

    /** Restaura e guarda o resultado; uma exceção vira `io-error`, para a tela nunca ficar parada. */
    const runRestore = (): void => {
        setState('running');
        // Um frame para o "Restaurando…" aparecer antes de a thread parar na cópia do arquivo.
        requestAnimationFrame(() => {
            try {
                setState(restore());
            } catch {
                setState({ ok: false, reason: 'io-error' });
            }
        });
    };

    return (
        <ScrollView className="flex-1 bg-bg" contentContainerClassName="flex-grow justify-center px-5 py-14">
            <View accessibilityRole="alert" className="gap-4 rounded-12 border border-line bg-surface p-5">
                <AppText className="text-22 font-semibold" accessibilityRole="header">{copy.title}</AppText>
                <AppText className="text-ink2">{copy.body}</AppText>
                {state === 'running' && <AppText className="text-ink2">Restaurando a cópia…</AppText>}
                {state !== null && state !== 'running' && <AppText className="text-ink2">{restoreMessage(state)}</AppText>}
                {offersRestore && (
                    <Pressable accessibilityRole="button" onPress={runRestore} className="min-h-11 items-center justify-center rounded-10 bg-accent px-4">
                        <AppText className="font-semibold text-on-accent">{state === null ? 'Restaurar a cópia anterior' : 'Tentar restaurar de novo'}</AppText>
                    </Pressable>
                )}
            </View>
        </ScrollView>
    );
}
