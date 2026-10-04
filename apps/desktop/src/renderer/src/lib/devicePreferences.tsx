import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { DevicePreferences } from '../../../shared/bridge.ts';
import { bridge } from './bridge.ts';

/** Preferências do aparelho e o jeito de mudá-las. */
interface DevicePreferencesValue {
    readonly preferences: DevicePreferences;
    /**
     * Aplica a mudança na tela na hora e grava em seguida.
     *
     * @param patch Campos a mudar.
     */
    readonly update: (patch: Partial<DevicePreferences>) => void;
}

const DevicePreferencesContext = createContext<DevicePreferencesValue | null>(null);

/**
 * Mantém as preferências do aparelho (tema, último perfil, último mês) num estado do React,
 * semeado pelo que a abertura leu. A tela muda antes de a gravação terminar — trocar o tema
 * esperando o disco pareceria travado —, e uma falha ao gravar só avisa: perder a preferência
 * não põe dado nenhum em risco, então não justifica a tela de erro fatal.
 *
 * @param props.initial Preferências lidas na abertura.
 * @param props.children Árvore que lê e muda as preferências.
 * @return O provedor do contexto.
 */
export function DevicePreferencesProvider({ initial, children }: { readonly initial: DevicePreferences; readonly children: ReactNode }): ReactNode {
    const [preferences, setPreferences] = useState(initial);
    const update = useCallback((patch: Partial<DevicePreferences>): void => {
        setPreferences((current) => ({ ...current, ...patch }));
        bridge.preferences.update(patch).catch(() => {
            toast.error('Não foi possível salvar a preferência neste aparelho. Ela vale até fechar o app.');
        });
    }, []);
    const value = useMemo(() => ({ preferences, update }), [preferences, update]);
    return <DevicePreferencesContext value={value}>{children}</DevicePreferencesContext>;
}

/**
 * @return As preferências do aparelho e a função que as muda.
 * @throws {Error} Fora do `DevicePreferencesProvider`, um erro de montagem do app.
 */
export function useDevicePreferences(): DevicePreferencesValue {
    const value = useContext(DevicePreferencesContext);
    if (value === null) {
        throw new Error('useDevicePreferences precisa de um DevicePreferencesProvider acima na árvore');
    }
    return value;
}
