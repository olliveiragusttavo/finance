import type { ReactNode } from 'react';
import { StartScreen } from '../src/screens/StartScreen.tsx';

/**
 * Rota `/`: a tela inicial. As rotas só montam telas de `src/screens`, para que a tela seja
 * testada sem o roteador.
 *
 * @return A tela inicial.
 */
export default function Index(): ReactNode {
    return <StartScreen />;
}
