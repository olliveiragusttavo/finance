import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { DevicePreferences } from '../shared/bridge.ts';

/** Preferências de um aparelho que acabou de instalar o app. */
export const DEFAULT_PREFERENCES: DevicePreferences = { theme: 'system', lastProfileId: null, lastPeriod: null };

const fields = {
    theme: z.enum(['system', 'light', 'dark']),
    lastProfileId: z.uuid().nullable(),
    lastPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
};

/** O arquivo inteiro; campo inválido ou ausente cai no padrão, campo desconhecido é descartado. */
const fileSchema = z.object({
    theme: fields.theme.catch(DEFAULT_PREFERENCES.theme),
    lastProfileId: fields.lastProfileId.catch(DEFAULT_PREFERENCES.lastProfileId),
    lastPeriod: fields.lastPeriod.catch(DEFAULT_PREFERENCES.lastPeriod),
});

/** O que o renderer pode pedir para mudar: entrada não confiável, recusada se inválida. */
const patchSchema = z.strictObject(fields).partial();

/**
 * Preferências do aparelho num JSON em `userData` (desktop-mvp-plan §2). Ficam fora do banco
 * porque são do aparelho e não do perfil: no banco seriam replicadas pela sincronização.
 *
 * O arquivo é tolerante na leitura — editado à mão ou de uma versão antiga, um campo ruim
 * volta ao padrão sem derrubar a abertura — e estrito na escrita, porque o pedido vem do
 * renderer.
 */
export class DevicePreferencesStore {
    /**
     * @param path `userData/preferences.json`.
     */
    public constructor(private readonly path: string) {}

    /**
     * @return As preferências gravadas; as padrão quando o arquivo falta ou não é JSON.
     */
    public read(): DevicePreferences {
        let raw: unknown;
        try {
            raw = JSON.parse(readFileSync(this.path, 'utf8'));
        } catch {
            return DEFAULT_PREFERENCES;
        }
        const parsed = fileSchema.safeParse(raw);
        return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
    }

    /**
     * Grava num arquivo temporário e renomeia, para que uma queda no meio da escrita não
     * deixe um JSON truncado no lugar das preferências.
     *
     * @param patch Campos a mudar, como vieram do renderer.
     * @return As preferências como ficaram gravadas.
     * @throws {z.ZodError} Quando o pedido tem campo desconhecido ou valor inválido.
     */
    public update(patch: unknown): DevicePreferences {
        const changes = patchSchema.parse(patch);
        const next: DevicePreferences = { ...this.read(), ...stripUndefined(changes) };
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(next, null, 4)}\n`);
        renameSync(temporary, this.path);
        return next;
    }
}

/**
 * @param changes Campos validados do pedido.
 * @return Só os campos presentes; sob `exactOptionalPropertyTypes`, um `undefined` explícito
 * apagaria o valor gravado ao espalhar o objeto.
 */
function stripUndefined(changes: z.output<typeof patchSchema>): Partial<DevicePreferences> {
    return {
        ...(changes.theme === undefined ? {} : { theme: changes.theme }),
        ...(changes.lastProfileId === undefined ? {} : { lastProfileId: changes.lastProfileId }),
        ...(changes.lastPeriod === undefined ? {} : { lastPeriod: changes.lastPeriod }),
    };
}
