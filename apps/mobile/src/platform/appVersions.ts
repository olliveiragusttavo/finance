import Constants from 'expo-constants';
import { z } from 'zod';

/** As versões que Ajustes mostra: a do app instalado e a do núcleo embarcado nele. */
export interface AppVersions {
    readonly app: string;
    readonly core: string;
}

/** O `extra` do `app.config.ts`, lido sem confiar no formato: um build antigo pode não ter o campo. */
const extraSchema = z.object({ coreVersion: z.string() });

/**
 * @return As versões do app e do núcleo, do `app.config.ts` embarcado no build; "—" quando o
 * build não as tem, em vez de derrubar a tela de Ajustes.
 */
export function appVersions(): AppVersions {
    const config = Constants.expoConfig;
    const extra = extraSchema.safeParse(config?.extra);
    return { app: config?.version ?? '—', core: extra.success ? extra.data.coreVersion : '—' };
}
