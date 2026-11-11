import { describe, expect, it } from 'vitest';
import { exportFailureMessage, formatExportInstant, formatSchemaVersion, importResultMessage, lastExportText } from '../src/viewModels/settingsView.ts';

describe('textos de Ajustes', () => {
    it('mostra a última cópia na hora local, e "nenhuma" sem cópia ou com data ilegível', () => {
        const instant = new Date(2026, 9, 14, 15, 7).toISOString();
        expect(formatExportInstant(instant)).toBe('14/10/2026 às 15:07');
        expect(lastExportText(instant)).toBe('Não há backup em nuvem. Última cópia: 14/10/2026 às 15:07.');
        expect(lastExportText(null)).toBe('Não há backup em nuvem. Nenhuma cópia exportada ainda.');
        expect(lastExportText('ontem')).toBe('Não há backup em nuvem. Nenhuma cópia exportada ainda.');
    });

    it('cancelar o diálogo não avisa nada; cada falha diz o que fazer', () => {
        expect(exportFailureMessage('canceled')).toBeNull();
        expect(exportFailureMessage('same-as-database')).toContain('Escolha outro arquivo');
        expect(exportFailureMessage('write-failed')).toContain('espaço no disco');
        expect(exportFailureMessage('unavailable')).toContain('Feche e abra o app');
    });

    it('importação: o sucesso diz onde ficou o banco anterior; cancelar não avisa; cada falha diz se algo mudou', () => {
        expect(importResultMessage({ ok: true, file: '/home/u/financas.sqlite', previousCopy: '/dados/backups/antes-da-importacao-20261017-120000.sqlite' }))
            .toBe('Cópia /home/u/financas.sqlite importada. O banco anterior foi guardado em /dados/backups/antes-da-importacao-20261017-120000.sqlite.');
        expect(importResultMessage({ ok: false, reason: 'canceled' })).toBeNull();
        for (const reason of ['unreadable', 'not-app-database', 'newer-than-app', 'write-failed', 'core-busy'] as const) {
            expect(importResultMessage({ ok: false, reason })).toContain('Nada foi alterado');
        }
        expect(importResultMessage({ ok: false, reason: 'io-error' })).toContain('os dados continuam os de antes');
        expect(importResultMessage({ ok: false, reason: 'database-moved', failedCopy: '/dados/backups/x.sqlite' })).toContain('/dados/backups/x.sqlite');
    });

    it('versão do banco', () => {
        expect(formatSchemaVersion(4)).toBe('v4');
        expect(formatSchemaVersion(null)).toBe('—');
    });
});
