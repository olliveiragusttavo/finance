import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Boot } from './App.tsx';
import { FailureGate } from './components/FailureGate.tsx';
import { bridge } from './lib/bridge.ts';
import { failures, installFailureHandlers } from './lib/failures.ts';
import './styles.css';

/*
 * Entrada do renderer. O estado da abertura e as preferências são pedidos uma vez, antes do
 * primeiro render, e o `Suspense` segura a tela até os dois chegarem. Os avisos de falha são
 * ligados antes de tudo, para que um erro já na abertura também chegue à tela de erro.
 */

installFailureHandlers(failures, bridge);

const boot: Promise<Boot> = Promise.all([bridge.startup.status(), bridge.preferences.get()])
    .then(([status, preferences]) => ({ status, preferences }));

const container = document.getElementById('root');
if (container === null) {
    throw new Error('index.html sem o elemento #root');
}

createRoot(container).render(
    <StrictMode>
        <FailureGate store={failures}>
            <Suspense>
                <App boot={boot} />
            </Suspense>
        </FailureGate>
    </StrictMode>,
);
