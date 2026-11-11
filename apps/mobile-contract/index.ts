import { registerRootComponent } from 'expo';
import { createElement, type ReactNode } from 'react';
import { ContractScreen } from './src/ContractScreen.tsx';
import { runDeviceContract } from './src/deviceContract.ts';

/**
 * Raiz do app de contrato. Sem Expo Router: é uma tela só, e cada dependência a menos é uma
 * fonte a menos de falha que não seja do núcleo ou do `expo-sqlite`.
 *
 * @return A tela do contrato rodando no aparelho.
 */
function ContractApp(): ReactNode {
    return createElement(ContractScreen, { run: runDeviceContract });
}

registerRootComponent(ContractApp);
