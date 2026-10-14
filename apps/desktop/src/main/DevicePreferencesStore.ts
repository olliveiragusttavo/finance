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

/**
 * O arquivo inteiro; campo inválido ou ausente cai no padrão, campo desconhecido é descartado.
 * Além das preferências, guarda o instante da última cópia exportada (desktop-mvp-plan Fase 13),
 * que é do aparelho pelo mesmo motivo: a cópia é do arquivo deste aparelho.
 */
const fileSchema = z.object({
    theme: fields.theme.catch(DEFAULT_PREFERENCES.theme),
    lastProfileId: fields.lastProfileId.catch(DEFAULT_PREFERENCES.lastProfileId),
    lastPeriod: fields.lastPeriod.catch(DEFAULT_PREFERENCES.lastPeriod),
    lastExportAt: z.iso.datetime().nullable().catch(null),
});

/** O que fica gravado no arquivo. */
type StoredFile = z.output<typeof fileSchema>;

/** O arquivo de um aparelho que acabou de instalar o app. */
const DEFAULT_FILE: StoredFile = { ...DEFAULT_PREFERENCES, lastExportAt: null };

/**
 * O que o renderer pode pedir para mudar: entrada não confiável, recusada se inválida. A data
 * da última cópia fica de fora — só o processo principal a grava, depois de a cópia existir —,
 * para que o renderer não possa dizer que há uma cópia que não há.
 */
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
        const { theme, lastProfileId, lastPeriod } = this.readFile();
        return { theme, lastProfileId, lastPeriod };
    }

    /**
     * @return Instante (ISO 8601) da última cópia exportada; `null` antes da primeira ou quando
     * o valor gravado não é um instante.
     */
    public lastExportAt(): string | null {
        return this.readFile().lastExportAt;
    }

    /**
     * Registra a cópia que acabou de ser gravada, para Ajustes mostrar há quanto tempo o
     * usuário não exporta — sem backup em nuvem, é a única cópia fora deste aparelho.
     *
     * @param at Instante da cópia, ISO 8601.
     */
    public recordExport(at: string): void {
        this.write({ ...this.readFile(), lastExportAt: z.iso.datetime().parse(at) });
    }

    /**
     * @param patch Campos a mudar, como vieram do renderer.
     * @return As preferências como ficaram gravadas.
     * @throws {z.ZodError} Quando o pedido tem campo desconhecido ou valor inválido.
     */
    public update(patch: unknown): DevicePreferences {
        const changes = patchSchema.parse(patch);
        this.write({ ...this.readFile(), ...stripUndefined(changes) });
        return this.read();
    }

    /**
     * @return O arquivo inteiro; o padrão quando ele falta ou não é JSON.
     */
    private readFile(): StoredFile {
        let raw: unknown;
        try {
            raw = JSON.parse(readFileSync(this.path, 'utf8'));
        } catch {
            return DEFAULT_FILE;
        }
        const parsed = fileSchema.safeParse(raw);
        return parsed.success ? parsed.data : DEFAULT_FILE;
    }

    /**
     * Grava num arquivo temporário e renomeia, para que uma queda no meio da escrita não deixe
     * um JSON truncado no lugar das preferências.
     *
     * @param file O arquivo inteiro, já validado.
     */
    private write(file: StoredFile): void {
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(file, null, 4)}\n`);
        renameSync(temporary, this.path);
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
