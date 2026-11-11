import { describeError, type CoreCallError } from '@finance/client';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText.tsx';
import { Button } from './Button.tsx';

/**
 * Carregando. Quase nunca aparece — o núcleo responde em milissegundos —, mas a primeira
 * consulta de uma tela num banco grande pode passar de um frame, e uma tela vazia nesse
 * intervalo pareceria "sem dados".
 *
 * @param props.label O que está sendo aberto, para o leitor de tela.
 * @return O indicador.
 */
export function LoadingState({ label = 'Carregando…' }: { readonly label?: string }): ReactNode {
    return (
        <View accessibilityRole="progressbar" accessibilityLabel={label} className="items-center justify-center p-6">
            <ActivityIndicator className="text-muted" />
        </View>
    );
}

/**
 * Erro de uma consulta, com a frase do `describeError` e o código — os mesmos do desktop — e
 * "Tentar de novo". O erro do núcleo é determinístico, mas o usuário pode ter corrigido a causa
 * em outra tela (reativado a conta), e sem o botão a única saída seria fechar o app.
 *
 * @param props.error Falha da consulta.
 * @param props.onRetry Refaz a consulta.
 * @return O aviso, anunciado ao leitor de tela.
 */
export function ErrorState({ error, onRetry }: { readonly error: CoreCallError; readonly onRetry: () => void }): ReactNode {
    return (
        <View accessibilityRole="alert" className="gap-3 rounded-12 border border-line bg-surface p-4">
            <AppText className="font-medium text-danger">Não foi possível carregar.</AppText>
            <AppText className="text-ink2">{describeError(error.error).message}</AppText>
            <AppText className="text-12 text-muted">Código: {error.code}</AppText>
            <Button label="Tentar de novo" variant="secondary" onPress={onRetry} />
        </View>
    );
}

/**
 * Lista sem itens, com o que fazer a seguir — uma lista vazia sem texto parece erro.
 *
 * @param props.title O que não há.
 * @param props.body Como criar o primeiro, quando a tela tem como.
 * @return O aviso.
 */
export function EmptyState({ title, body }: { readonly title: string; readonly body?: string }): ReactNode {
    return (
        <View className="items-center gap-1 rounded-12 border border-line bg-surface px-4 py-6">
            <AppText className="font-medium">{title}</AppText>
            {body !== undefined && <AppText className="text-center text-13 text-muted">{body}</AppText>}
        </View>
    );
}
