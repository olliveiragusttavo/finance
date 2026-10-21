import {
    describeAccountDeletion,
    describeCreditCardDeletion,
    describeError,
    useAccountDeletionImpact,
    useCoreMutation,
    useCreditCardDeletionImpact,
    type CoreCallError,
    type DeletionWarning,
} from '@finance/client';
import type { AccountResponse, CreditCardResponse } from '@finance/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/form';
import { QueryState, Skeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/*
 * Alerta da exclusão em cadeia (desktop-mvp-plan §5.1). Regra de negócio (Contas e Cartões):
 * a ação padrão é desativar; excluir é a ação explícita, e antes dela o app mostra tudo o que
 * será apagado junto — contado, e com as outras contas cujo saldo muda — e só exclui depois de
 * uma confirmação forte. As contagens vêm do `deletionImpact`, que usa o mesmo escopo que a
 * exclusão apaga, então o alerta nunca mostra outra coisa que não o que vai sumir.
 */

/**
 * Alerta de exclusão de conta. A consulta do impacto para assim que a exclusão começa: a
 * invalidação que segue a exclusão a refaria para uma conta que já não existe, e o alerta
 * trocaria a lista do que será apagado por um "não encontrado" até fechar.
 *
 * @param props.account Conta a excluir.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @param props.onDisableInstead Desativa a conta em vez de excluí-la; omitido quando ela já
 * está desativada.
 * @return O alerta.
 */
export function AccountDeletionDialog({
    account,
    onClose,
    onDisableInstead,
}: {
    readonly account: AccountResponse;
    readonly onClose: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const [deleting, setDeleting] = useState(false);
    const impact = useAccountDeletionImpact(deleting ? null : { id: account.id });
    const remove = useCoreMutation('accounts.delete');
    return (
        <DeletionAlert
            noun="conta"
            name={account.name}
            warning={impact}
            describe={describeAccountDeletion}
            pending={remove.isPending}
            error={remove.error}
            onConfirm={() => {
                setDeleting(true);
                remove.mutate(
                    { id: account.id },
                    {
                        onError: () => {
                            setDeleting(false);
                        },
                        onSuccess: () => {
                            toast.success(`Conta ${account.name} excluída.`);
                            onClose();
                        },
                    },
                );
            }}
            onClose={onClose}
            onDisableInstead={onDisableInstead}
        />
    );
}

/**
 * Alerta de exclusão de cartão. A consulta do impacto para assim que a exclusão começa, pelo
 * mesmo motivo do alerta de conta: refeita depois da exclusão, ela acusaria "não encontrado".
 *
 * @param props.creditCard Cartão a excluir.
 * @param props.onClose Fecha o alerta, depois de excluir ou ao desistir.
 * @param props.onDisableInstead Desativa o cartão em vez de excluí-lo; omitido quando ele já
 * está desativado.
 * @return O alerta.
 */
export function CreditCardDeletionDialog({
    creditCard,
    onClose,
    onDisableInstead,
}: {
    readonly creditCard: CreditCardResponse;
    readonly onClose: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const [deleting, setDeleting] = useState(false);
    const impact = useCreditCardDeletionImpact(deleting ? null : { id: creditCard.id });
    const remove = useCoreMutation('creditCards.delete');
    return (
        <DeletionAlert
            noun="cartão"
            name={creditCard.name}
            warning={impact}
            describe={describeCreditCardDeletion}
            pending={remove.isPending}
            error={remove.error}
            onConfirm={() => {
                setDeleting(true);
                remove.mutate(
                    { id: creditCard.id },
                    {
                        onError: () => {
                            setDeleting(false);
                        },
                        onSuccess: () => {
                            toast.success(`Cartão ${creditCard.name} excluído.`);
                            onClose();
                        },
                    },
                );
            }}
            onClose={onClose}
            onDisableInstead={onDisableInstead}
        />
    );
}

/**
 * O alerta em si, igual para conta e cartão. A confirmação forte é digitar o nome: excluir
 * apaga a cadeia inteira e muda o saldo de outras contas, e um clique só — num diálogo que se
 * abre por engano — não basta para isso. O botão de excluir só se habilita com o nome exato e
 * com as contagens carregadas, para que ninguém confirme sem ter visto o que vai sumir.
 * Ao confirmar, guarda as contagens exibidas: quem chama para a consulta durante a exclusão, e
 * o alerta continua mostrando o que está sendo apagado em vez de voltar ao carregamento.
 *
 * @param props.noun Substantivo do cadastro ("conta", "cartão"), para compor as frases.
 * @param props.name Nome do cadastro, que o usuário digita para confirmar.
 * @param props.warning Consulta do `deletionImpact`; parada (sem dados) enquanto a exclusão
 * está em andamento.
 * @param props.describe Monta as frases do alerta a partir das contagens.
 * @param props.pending Se a exclusão está em andamento.
 * @param props.error Recusa do núcleo à exclusão, quando houver.
 * @param props.onConfirm Exclui.
 * @param props.onClose Fecha sem excluir.
 * @param props.onDisableInstead Desativa em vez de excluir; omitido quando já está desativado.
 * @return O diálogo de alerta.
 */
function DeletionAlert<T>({
    noun,
    name,
    warning,
    describe,
    pending,
    error,
    onConfirm,
    onClose,
    onDisableInstead,
}: {
    readonly noun: 'conta' | 'cartão';
    readonly name: string;
    readonly warning: UseQueryResult<T, CoreCallError>;
    readonly describe: (impact: T) => DeletionWarning;
    readonly pending: boolean;
    readonly error: CoreCallError | null;
    readonly onConfirm: () => void;
    readonly onClose: () => void;
    readonly onDisableInstead: (() => void) | undefined;
}): ReactNode {
    const [typed, setTyped] = useState('');
    const [confirmedImpact, setConfirmedImpact] = useState<{ readonly impact: T } | null>(null);
    const confirmed = typed.trim() === name;
    const article = noun === 'conta' ? 'a' : 'o';
    const disabledWord = noun === 'conta' ? 'desativada' : 'desativado';
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent showCloseButton={false} role="alertdialog">
                <DialogHeader>
                    <DialogTitle>
                        Excluir {article} {noun} {name}?
                    </DialogTitle>
                    <DialogDescription>
                        A exclusão não pode ser desfeita. Se você só quer parar de usar {article} {noun}, desative: {article} {noun} {disabledWord} sai dos lançamentos novos e o histórico continua.
                    </DialogDescription>
                </DialogHeader>
                {warning.data === undefined && confirmedImpact !== null ? (
                    <WarningDetails warning={describe(confirmedImpact.impact)} noun={noun} />
                ) : (
                    <QueryState query={warning} loading={<Skeleton className="h-20" />}>
                        {(impact) => <WarningDetails warning={describe(impact)} noun={noun} />}
                    </QueryState>
                )}
                <Field id="deletion-confirm" label={`Digite ${name} para confirmar`} error={undefined}>
                    <Input
                        id="deletion-confirm"
                        autoComplete="off"
                        value={typed}
                        onChange={(event) => {
                            setTyped(event.target.value);
                        }}
                    />
                </Field>
                {error !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {describeError(error.error).message}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    {onDisableInstead !== undefined && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onDisableInstead();
                                onClose();
                            }}
                        >
                            Desativar em vez disso
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={!confirmed || !warning.isSuccess || pending}
                        onClick={() => {
                            if (warning.isSuccess) {
                                setConfirmedImpact({ impact: warning.data });
                            }
                            onConfirm();
                        }}
                    >
                        {pending ? 'Excluindo…' : `Excluir ${noun}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * O que some junto e as contas cujo saldo muda. Sem nada na cadeia, diz isso com todas as
 * letras: um alerta vazio pareceria que as contagens não carregaram.
 *
 * @param props.warning Frases montadas a partir das contagens.
 * @param props.noun Substantivo do cadastro, para a frase do cadastro sem cadeia.
 * @return A lista do que será apagado e o aviso das outras contas.
 */
function WarningDetails({ warning, noun }: { readonly warning: DeletionWarning; readonly noun: 'conta' | 'cartão' }): ReactNode {
    return (
        <div className="flex flex-col gap-3 text-14">
            {warning.items.length === 0 ? (
                <p>{noun === 'conta' ? 'Só o cadastro da conta será apagado: não há nada ligado a ela.' : 'Só o cadastro do cartão será apagado: não há nada ligado a ele.'}</p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    <p className="font-medium">Também serão apagados:</p>
                    <ul aria-label="Também serão apagados" className="list-disc pl-5 text-ink2">
                        {warning.items.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            )}
            {warning.affectedAccounts.length > 0 && (
                <p className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                    O saldo {warning.affectedAccounts.length === 1 ? 'desta outra conta vai mudar' : 'destas outras contas vai mudar'}: {warning.affectedAccounts.join(', ')}.
                </p>
            )}
        </div>
    );
}
