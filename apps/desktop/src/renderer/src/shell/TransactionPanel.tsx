import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TransactionDialog } from '@/transactions/TransactionDialog';

/** Abre e fecha o diálogo de lançamento de qualquer ponto do app. */
interface TransactionPanelValue {
    readonly isOpen: boolean;
    /** Abre o diálogo de lançamento novo: "+ Lançamento" e atalho `N`. */
    readonly openNew: () => void;
    /**
     * @param open Novo estado; o diálogo fecha por `Esc`, pelo véu ou pelo "Cancelar".
     */
    readonly setOpen: (open: boolean) => void;
    /**
     * Registra a tela que abre o lançamento novo por conta própria, no lugar do diálogo do shell.
     *
     * @param host Abre o diálogo da tela; `null` devolve o "+ Lançamento" ao shell.
     */
    readonly setHost: (host: (() => void) | null) => void;
}

const TransactionPanelContext = createContext<TransactionPanelValue | null>(null);

/**
 * Dono do lançamento global (desktop-mvp-plan Fase 4). Fica no shell, e não na tela de
 * Transações, porque "+ Lançamento" e o atalho `N` valem em toda tela: lançar não pode exigir
 * navegar antes. Abre o mesmo diálogo de lançamento da tela de Transações; lá a tela se registra
 * como *host* e abre o dela, que sugere a origem do filtro e seleciona o gravado na tabela.
 *
 * @param props.children O shell, que abre o lançamento pela barra superior e pelos atalhos.
 * @return O provedor e o diálogo.
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
            {isOpen && (
                <TransactionDialog
                    transaction={null}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
            )}
        </TransactionPanelContext>
    );
}

/**
 * @return O estado do diálogo de lançamento e as ações de abri-lo.
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
 * Faz a tela atual abrir o lançamento novo por conta própria enquanto estiver montada — a tela de
 * Transações, cujo diálogo sugere a origem filtrada e seleciona na tabela o lançamento gravado.
 *
 * @param openNew Abre o diálogo de lançamento novo da tela; precisa ser estável entre renders
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
