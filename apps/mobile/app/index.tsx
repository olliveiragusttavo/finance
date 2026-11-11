import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ROUTES } from '../src/shell/routes.ts';

/**
 * Rota `/`: o app abre no Início. O primeiro uso não passa por aqui — sem perfil, o shell nem
 * monta a navegação (`AppShell`).
 *
 * @return O redirecionamento.
 */
export default function Index(): ReactNode {
    return <Redirect href={ROUTES.home} />;
}
