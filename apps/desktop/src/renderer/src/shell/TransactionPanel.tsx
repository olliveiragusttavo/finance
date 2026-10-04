import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/states';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** Abre e fecha o painel de transação de qualquer ponto do app. */
interface TransactionPanelValue {
    readonly isOpen: boolean;
    /** Abre o painel para um lançamento novo: "+ Lançamento" e atalho `N`. */
    readonly openNew: () => void;
    /**
     * @param open Novo estado; o painel fecha por `Esc`, pelo véu ou pelo `×`.
     */
    readonly setOpen: (open: boolean) => void;
}

const TransactionPanelContext = createContext<TransactionPanelValue | null>(null);

/**
 * Dono do painel de transação global (desktop-mvp-plan Fase 4). Fica no shell, e não na tela
 * de Transações, porque "+ Lançamento" e o atalho `N` valem em toda tela: lançar não pode
 * exigir navegar antes. O formulário em si chega com a tela de Transações (Fase 9).
 *
 * @param props.children O shell, que abre o painel pela barra superior e pelos atalhos.
 * @return O provedor e o painel.
 */
export function TransactionPanelProvider({ children }: { readonly children: ReactNode }): ReactNode {
    const [isOpen, setOpen] = useState(false);
    const value = useMemo(() => ({ isOpen, setOpen, openNew: () => { setOpen(true); } }), [isOpen]);
    return (
        <TransactionPanelContext value={value}>
            {children}
            <Sheet open={isOpen} onOpenChange={setOpen}>
                <SheetContent className="w-85 p-5 sm:max-w-none">
                    <SheetHeader className="p-0">
                        <SheetTitle>Novo lançamento</SheetTitle>
                        <SheetDescription>Despesa, receita, transferência ou investimento.</SheetDescription>
                    </SheetHeader>
                    <EmptyState title="Formulário em construção" description="O formulário de lançamento chega junto com a tela de Transações." />
                </SheetContent>
            </Sheet>
        </TransactionPanelContext>
    );
}

/**
 * @return O estado do painel de transação e as ações de abri-lo.
 * @throws {Error} Fora do `TransactionPanelProvider`, um erro de montagem do app.
 */
export function useTransactionPanel(): TransactionPanelValue {
    const value = useContext(TransactionPanelContext);
    if (value === null) {
        throw new Error('useTransactionPanel precisa de um TransactionPanelProvider acima na árvore');
    }
    return value;
}
