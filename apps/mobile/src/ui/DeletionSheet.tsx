import { describeError, type CoreCallError, type DeletionWarning } from '@finance/client';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText.tsx';
import { Button } from './Button.tsx';
import { Sheet } from './Sheet.tsx';
import { TextField } from './TextField.tsx';
import { QueryView } from './states.tsx';

/*
 * Alerta da exclusão em cadeia, o mesmo do desktop (desktop-mvp-plan §5.1). Regra de negócio
 * (Contas e Cartões): a ação padrão é desativar; excluir é a ação explícita, e antes dela o app
 * mostra tudo o que será apagado junto — contado, e com as outras contas cujo saldo muda — e só
 * exclui depois de uma confirmação forte. As contagens vêm do `deletionImpact`, que usa o mesmo
 * escopo que a exclusão apaga.
 */

/** Substantivo do cadastro, com o artigo e a concordância das frases do alerta. */
export type DeletionNoun = 'conta' | 'cartão';

/**
 * O que some junto e as contas cujo saldo muda. Sem nada na cadeia, diz isso com todas as
 * letras: um alerta vazio pareceria que as contagens não carregaram.
 *
 * @param props.warning Frases montadas a partir das contagens.
 * @param props.noun Substantivo do cadastro, para a frase do cadastro sem cadeia.
 * @return A lista do que será apagado e o aviso das outras contas.
 */
function WarningDetails({ warning, noun }: { readonly warning: DeletionWarning; readonly noun: DeletionNoun }): ReactNode {
    return (
        <View className="gap-3">
            {warning.items.length === 0 ? (
                <AppText>{noun === 'conta' ? 'Só o cadastro da conta será apagado: não há nada ligado a ela.' : 'Só o cadastro do cartão será apagado: não há nada ligado a ele.'}</AppText>
            ) : (
                <View accessibilityLabel="Também serão apagados" className="gap-1">
                    <AppText className="font-medium">Também serão apagados:</AppText>
                    {warning.items.map((item) => (
                        <AppText key={item} className="text-ink2">
                            • {item}
                        </AppText>
                    ))}
                </View>
            )}
            {warning.affectedAccounts.length > 0 && (
                <AppText className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                    O saldo {warning.affectedAccounts.length === 1 ? 'desta outra conta vai mudar' : 'destas outras contas vai mudar'}: {warning.affectedAccounts.join(', ')}.
                </AppText>
            )}
        </View>
    );
}

/**
 * Folha de exclusão em cadeia, igual para conta e cartão. A confirmação forte é digitar o nome,
 * como no desktop: excluir apaga a cadeia inteira e muda o saldo de outras contas, e um toque só
 * — numa folha aberta por engano — não basta. O botão só se habilita com o nome exato e com as
 * contagens carregadas, para que ninguém confirme sem ter visto o que vai sumir. Ao confirmar,
 * guarda as contagens exibidas: quem chama para a consulta durante a exclusão (refeita, ela
 * acusaria "não encontrado"), e a folha continua mostrando o que está sendo apagado.
 *
 * @param props.noun Substantivo do cadastro.
 * @param props.name Nome do cadastro, que o usuário digita para confirmar.
 * @param props.warning Consulta do `deletionImpact`; sem dados enquanto a exclusão anda.
 * @param props.describe Monta as frases do alerta a partir das contagens.
 * @param props.pending Se a exclusão está em andamento.
 * @param props.error Recusa do núcleo à exclusão, quando houver.
 * @param props.onConfirm Exclui.
 * @param props.onClose Fecha sem excluir.
 * @param props.onDisableInstead Desativa em vez de excluir; omitido quando já está desativado.
 * @return A folha.
 */
export function DeletionSheet<T>(props: {
    readonly noun: DeletionNoun;
    readonly name: string;
    readonly warning: { readonly data: T | undefined; readonly error: CoreCallError | null; readonly refetch: () => unknown };
    readonly describe: (impact: T) => DeletionWarning;
    readonly pending: boolean;
    readonly error: CoreCallError | null;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const { noun, name, warning, describe, pending, error, onConfirm, onClose, onDisableInstead } = props;
    const [typed, setTyped] = useState('');
    const [confirmedImpact, setConfirmedImpact] = useState<{ readonly impact: T } | null>(null);
    const article = noun === 'conta' ? 'a' : 'o';
    const disabledWord = noun === 'conta' ? 'desativada' : 'desativado';
    const loaded = warning.data !== undefined;
    return (
        <Sheet open title={`Excluir ${article} ${noun} ${name}?`} onClose={onClose}>
            <AppText className="text-ink2">
                A exclusão não pode ser desfeita. Se você só quer parar de usar {article} {noun}, desative: {article} {noun} {disabledWord} sai dos lançamentos novos e o histórico continua.
            </AppText>
            {warning.data === undefined && confirmedImpact !== null ? (
                <WarningDetails warning={describe(confirmedImpact.impact)} noun={noun} />
            ) : (
                <QueryView query={warning} loadingLabel="Contando o que será apagado…">
                    {(impact) => <WarningDetails warning={describe(impact)} noun={noun} />}
                </QueryView>
            )}
            <TextField label={`Digite ${name} para confirmar`} autoCapitalize="none" autoCorrect={false} value={typed} onChangeText={setTyped} />
            {error !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {describeError(error.error).message}
                </AppText>
            )}
            <Button
                label={pending ? 'Excluindo…' : `Excluir ${noun}`}
                variant="danger"
                busy={pending}
                disabled={typed.trim() !== name || !loaded}
                onPress={() => {
                    if (warning.data !== undefined) {
                        setConfirmedImpact({ impact: warning.data });
                    }
                    onConfirm();
                }}
            />
            {onDisableInstead !== undefined && (
                <Button
                    label="Desativar em vez disso"
                    variant="secondary"
                    onPress={() => {
                        onDisableInstead();
                        onClose();
                    }}
                />
            )}
            <Button label="Cancelar" variant="ghost" onPress={onClose} />
        </Sheet>
    );
}
