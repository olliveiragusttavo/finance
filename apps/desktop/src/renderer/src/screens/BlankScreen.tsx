import type { ReactNode } from 'react';
import { EmptyState } from '@/components/states';

/**
 * Tela em branco dentro do shell, com título, para os itens do menu sem tela no MVP
 * (Dispositivos — desktop-mvp-plan §5), que existem para que a navegação já esteja
 * pronta quando as telas chegarem. As telas do MVP também começaram assim, cada uma substituída
 * na sua fase; Ajustes foi a última do MVP (Fase 13), e Por sócio veio depois (Fase 13.6).
 *
 * @param props.title Título da tela, o mesmo do item do menu.
 * @param props.description Por que a tela está vazia.
 * @return O título e o aviso de tela vazia.
 */
export function BlankScreen({ title, description }: { readonly title: string; readonly description: string }): ReactNode {
    return (
        <>
            <h1 className="text-24 font-semibold">{title}</h1>
            <EmptyState title="Nada por aqui ainda" description={description} />
        </>
    );
}

/** Explicação das telas que ficam fora do MVP. */
const OUTSIDE_MVP = 'Esta tela chega numa próxima versão do app.';

/**
 * Cria a tela em branco de uma rota, no formato que o roteador pede (componente sem props).
 *
 * @param title Título da tela.
 * @return O componente da rota, que explica que a tela chega numa próxima versão.
 */
export function blankScreen(title: string): () => ReactNode {
    return function RouteBlankScreen(): ReactNode {
        return <BlankScreen title={title} description={OUTSIDE_MVP} />;
    };
}
