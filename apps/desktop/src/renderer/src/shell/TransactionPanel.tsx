import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TransactionForm } from '@/transactions/TransactionForm';

/** Abre e fecha o painel de transação de qualquer ponto do app. */
interface TransactionPanelValue {
    readonly isOpen: boolean;
    /** Abre o painel para um lançamento novo: "+ Lançamento" e atalho `N`. */
    readonly openNew: () => void;
    /**
     * @param open Novo estado; o painel fecha por `Esc`, pelo véu ou pelo `×`.
     */
    readonly setOpen: (open: boolean) => void;
    /**
     * Registra a tela que abre o lançamento novo no próprio layout, no lugar do painel.
     *
     * @param host Abre o formulário na tela; `null` devolve o "+ Lançamento" ao painel.
     */
    readonly setHost: (host: (() => void) | null) => void;
}

const TransactionPanelContext = createContext<TransactionPanelValue | null>(null);

/**
 * Dono do painel de transação global (desktop-mvp-plan Fase 4). Fica no shell, e não na tela
 * de Transações, porque "+ Lançamento" e o atalho `N` valem em toda tela: lançar não pode
 * exigir navegar antes. Na tela de Transações o formulário abre na coluna ao lado da tabela,
 * como no mockup (decisão da Fase 9); a tela se registra como *host* e o painel não abre lá.
 *
 * @param props.children O shell, que abre o painel pela barra superior e pelos atalhos.
 * @return O provedor e o painel.
 */
export function TransactionPanelProvider({ children }: { readonly children: ReactNode }): ReactNode {
    const [isOpen, setOpen] = useState(false);
    const host = useRef<(() => void) | null>(null);
    const value = useMemo(
        () => ({
            isOpen,
            setOpen,
            openNew: () => {
                if (host.current === null) {
                    setOpen(true);
                } else {
                    host.current();
                }
            },
            setHost: (next: (() => void) | null) => {
                host.current = next;
            },
        }),
        [isOpen],
    );
    return (
        <TransactionPanelContext value={value}>
            {children}
            <Sheet open={isOpen} onOpenChange={setOpen}>
                <SheetContent className="w-95 gap-3 overflow-y-auto p-5 sm:max-w-none">
                    <SheetHeader className="p-0">
                        <SheetTitle>Novo lançamento</SheetTitle>
                        <SheetDescription>Despesa, receita, transferência ou investimento.</SheetDescription>
                    </SheetHeader>
                    {isOpen && (
                        <TransactionForm
                            transaction={null}
                            onClose={() => {
                                setOpen(false);
                            }}
                        />
                    )}
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

/**
 * Faz a tela atual abrir o lançamento novo no próprio layout enquanto estiver montada — a tela de
 * Transações, onde o formulário é a coluna ao lado da tabela e um painel por cima a cobriria.
 *
 * @param openNew Abre o formulário de lançamento novo na tela; precisa ser estável entre renders
 * (`useCallback`), senão o registro se refaz a cada render.
 */
export function useTransactionPanelHost(openNew: () => void): void {
    const { setHost } = useTransactionPanel();
    useEffect(() => {
        setHost(openNew);
        return () => {
            setHost(null);
        };
    }, [openNew, setHost]);
}
