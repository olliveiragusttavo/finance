import { DEFAULT_PREFERENCES, DevicePreferencesStore } from '../src/preferences/devicePreferences.tsx';
import { MemoryFileSystem } from './support/MemoryFileSystem.ts';

const URI = 'file:///docs/preferences.json';

describe('preferências do aparelho (mobile-mvp-plan §2)', () => {
    it('sem arquivo, volta aos padrões', () => {
        expect(new DevicePreferencesStore(new MemoryFileSystem(), URI).read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('grava e lê de volta', () => {
        const files = new MemoryFileSystem();
        const store = new DevicePreferencesStore(files, URI);
        const saved = { theme: 'dark', lastProfileId: 'perfil-1', lastPeriod: '2026-10', lastExportAt: '2026-10-07T12:00:00.000Z' } as const;

        store.write(saved);

        expect(store.read()).toEqual(saved);
        expect(files.exists(`${URI}.tmp`)).toBe(false);
    });

    it('arquivo corrompido volta aos padrões sem lançar', () => {
        const files = new MemoryFileSystem();
        files.writeText(URI, '{"theme": "dark", "lastPer');

        expect(new DevicePreferencesStore(files, URI).read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('um campo inválido volta ao padrão sem derrubar os outros, e campo desconhecido some', () => {
        const files = new MemoryFileSystem();
        files.writeText(URI, JSON.stringify({ theme: 'sépia', lastProfileId: 'perfil-1', lastPeriod: '2026-13', lastExportAt: 'ontem', extra: true }));

        expect(new DevicePreferencesStore(files, URI).read()).toEqual({ ...DEFAULT_PREFERENCES, lastProfileId: 'perfil-1' });
    });

    it('o app fechado entre apagar o arquivo e pôr o novo no lugar não perde a escolha', () => {
        const files = new MemoryFileSystem();
        const store = new DevicePreferencesStore(files, URI);
        store.write({ ...DEFAULT_PREFERENCES, theme: 'light' });
        files.failOn('move');

        expect(() => {
            store.write({ ...DEFAULT_PREFERENCES, theme: 'dark' });
        }).toThrow();

        expect(files.exists(URI)).toBe(false);
        expect(store.read().theme).toBe('dark');
    });
});
