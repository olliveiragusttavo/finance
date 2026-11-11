import { isValidPeriod } from '@finance/client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import type { AppFileSystem } from '../platform/AppFileSystem.ts';
import type { ThemePreference } from '../theme/ThemeRoot.tsx';

/**
 * Preferências do aparelho (mobile-mvp-plan §2): ficam num JSON no diretório do app, e não no
 * banco, porque são do aparelho e não do perfil — no banco, seriam replicadas pela sincronização
 * e o celular abriria no perfil e no mês que o desktop deixou.
 */
export interface DevicePreferences {
    readonly theme: ThemePreference;
    /** Último perfil aberto; o shell reabre nele (`pickActiveProfile`). */
    readonly lastProfileId: string | null;
    /** Último mês de referência aberto, `YYYY-MM`; o app reabre onde o usuário parou. */
    readonly lastPeriod: string | null;
    /** Instante (ISO 8601) da última cópia do banco exportada em Ajustes. */
    readonly lastExportAt: string | null;
}

/** Preferências de um aparelho que acabou de instalar o app. */
export const DEFAULT_PREFERENCES: DevicePreferences = { theme: 'system', lastProfileId: null, lastPeriod: null, lastExportAt: null };

/**
 * O arquivo, lido com tolerância: cada campo inválido volta ao padrão sem derrubar os outros, e
 * campo desconhecido é descartado. O arquivo pode vir de outra versão do app ou de uma escrita
 * interrompida, e uma preferência ruim nunca pode impedir o app de abrir.
 */
const fileSchema = z.object({
    theme: z.enum(['system', 'light', 'dark']).catch(DEFAULT_PREFERENCES.theme),
    lastProfileId: z.string().min(1).nullable().catch(DEFAULT_PREFERENCES.lastProfileId),
    lastPeriod: z.string().refine(isValidPeriod).nullable().catch(DEFAULT_PREFERENCES.lastPeriod),
    lastExportAt: z.iso.datetime().nullable().catch(DEFAULT_PREFERENCES.lastExportAt),
});

/**
 * Lê e grava as preferências num arquivo JSON. A escrita vai para um arquivo temporário que
 * depois toma o lugar do definitivo, para que o app fechado no meio da escrita não deixe um JSON
 * truncado; a leitura aceita o temporário quando o definitivo sumiu nessa troca.
 */
export class DevicePreferencesStore {
    /**
     * @param files Disco do aparelho; um em memória nos testes.
     * @param uri Arquivo das preferências.
     */
    public constructor(
        private readonly files: AppFileSystem,
        private readonly uri: string,
    ) {}

    /**
     * @return As preferências gravadas; as padrão quando o arquivo falta, não é JSON ou não
     * pode ser lido.
     */
    public read(): DevicePreferences {
        const source = this.files.exists(this.uri) ? this.uri : this.temporaryUri();
        let raw: unknown;
        try {
            raw = JSON.parse(this.files.readText(source));
        } catch {
            return DEFAULT_PREFERENCES;
        }
        const parsed = fileSchema.safeParse(raw);
        return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
    }

    /**
     * @param preferences As preferências inteiras, já validadas pelo tipo.
     * @throws {Error} Quando o disco recusa a escrita; quem chama decide se a falha importa.
     */
    public write(preferences: DevicePreferences): void {
        const temporary = this.temporaryUri();
        this.files.remove(temporary);
        this.files.writeText(temporary, `${JSON.stringify(preferences, null, 4)}\n`);
        this.files.remove(this.uri);
        this.files.move(temporary, this.uri);
    }

    /** @return O arquivo temporário da escrita, ao lado do definitivo. */
    private temporaryUri(): string {
        return `${this.uri}.tmp`;
    }
}

/** As preferências e a forma de mudá-las. */
interface DevicePreferencesValue {
    readonly preferences: DevicePreferences;
    /**
     * @param patch Campos a mudar; os demais ficam como estão.
     */
    readonly update: (patch: Partial<DevicePreferences>) => void;
}

const DevicePreferencesContext = createContext<DevicePreferencesValue | null>(null);

/**
 * Lê as preferências uma vez, na abertura, e grava a cada mudança. A tela muda na hora, pelo
 * estado; uma escrita que falha não desfaz a escolha — só não sobrevive ao app fechar —, porque
 * travar o tema ou o mês por causa do disco seria pior do que esquecê-los.
 *
 * @param props.store Onde as preferências moram.
 * @param props.children O app.
 * @return A árvore com as preferências disponíveis.
 */
export function DevicePreferencesProvider({ store, children }: { readonly store: DevicePreferencesStore; readonly children: ReactNode }): ReactNode {
    const [preferences, setPreferences] = useState(() => store.read());
    // O valor mais novo fora do ciclo de render: duas mudanças no mesmo toque (perfil e mês)
    // precisam somar, e a escrita no disco não pode ficar dentro do atualizador do estado, que
    // o React pode chamar duas vezes.
    const latest = useRef(preferences);

    const update = useCallback((patch: Partial<DevicePreferences>): void => {
        const next = { ...latest.current, ...patch };
        latest.current = next;
        try {
            store.write(next);
        } catch (error: unknown) {
            console.warn('não foi possível gravar as preferências', error);
        }
        setPreferences(next);
    }, [store]);

    const value = useMemo(() => ({ preferences, update }), [preferences, update]);
    return <DevicePreferencesContext value={value}>{children}</DevicePreferencesContext>;
}

/**
 * @return As preferências do aparelho e a forma de mudá-las.
 * @throws {Error} Fora do `DevicePreferencesProvider`, um erro de montagem do app.
 */
export function useDevicePreferences(): DevicePreferencesValue {
    const value = useContext(DevicePreferencesContext);
    if (value === null) {
        throw new Error('useDevicePreferences precisa do DevicePreferencesProvider acima na árvore');
    }
    return value;
}
