import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/states';
import { useActiveProfile } from '@/shell/activeProfile';

/**
 * Tela em branco dentro do shell, com título. Serve a dois casos: os itens do menu sem tela no
 * MVP (Dispositivos, Fluxo por conta, Por sócio, Por tag — desktop-mvp-plan §5), que
 * existem para que a navegação já esteja pronta, e as telas do MVP que ainda não chegaram,
 * cada uma substituída na sua fase.
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

/** Explicação das telas do MVP que ainda estão em construção. */
const UNDER_CONSTRUCTION = 'Esta tela está em construção.';

/**
 * Cria a tela em branco de uma rota, no formato que o roteador pede (componente sem props).
 *
 * @param title Título da tela.
 * @param outsideMvp Se a tela fica fora do MVP, e não só ainda não feita; muda a explicação.
 * @return O componente da rota.
 */
export function blankScreen(title: string, outsideMvp: boolean): () => ReactNode {
    const description = outsideMvp ? OUTSIDE_MVP : UNDER_CONSTRUCTION;
    return function RouteBlankScreen(): ReactNode {
        return <BlankScreen title={title} description={description} />;
    };
}

/**
 * Relatório por sócio. Regra de negócio (Perfis): sócio só existe em perfil empresarial
 * (brief §12). O menu já esconde o item no perfil pessoal, mas a rota continua alcançável —
 * pelo histórico, ou trocando o perfil com o relatório aberto —, e então a tela explica em
 * vez de mostrar um relatório que não se aplica.
 *
 * @return A tela em branco no perfil empresarial; o aviso no perfil pessoal.
 */
export function PartnerReportScreen(): ReactNode {
    const { profile } = useActiveProfile();
    if (profile.type === 'business') {
        return <BlankScreen title="Relatório por sócio" description={OUTSIDE_MVP} />;
    }
    return (
        <>
            <h1 className="text-24 font-semibold">Relatório por sócio</h1>
            <EmptyState
                title="Só em perfil empresarial"
                description={`O perfil ${profile.name} é pessoal e não tem sócios.`}
                action={<Link to="/reports/category">Ver o relatório por categoria</Link>}
            />
        </>
    );
}
