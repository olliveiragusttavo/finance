import { BRIDGE_KEY, type FinanceBridge } from '../../../shared/bridge.ts';

declare global {
    /** A ponte publicada pelo preload; é tudo o que o renderer enxerga fora dele. */
    interface Window {
        readonly [BRIDGE_KEY]: FinanceBridge;
    }
}

/**
 * A ponte do preload, num lugar só. As telas importam daqui em vez de ler `window` direto,
 * para que um teste do renderer possa trocar a ponte e para que o nome da propriedade não se
 * espalhe pelo código.
 */
export const bridge: FinanceBridge = window[BRIDGE_KEY];
