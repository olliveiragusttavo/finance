import { describe, expect, it } from 'vitest';
import { TestWorld } from '../support/TestWorld.ts';

describe('anotações do perfil (mockup DesktopAnotacoes; database-design §4.3)', () => {
    it('cria, lista da editada mais recentemente para a mais antiga e reescreve', async () => {
        const world = new TestWorld('2026-03-15');
        const profileId = world.profile();
        const tax = await world.ok('notes.create', { profileId, text: 'IPTU 2027\nCota única vence em fevereiro.' });
        world.clock.set('2026-03-16');
        const refunds = await world.ok('notes.create', { profileId, text: 'Reembolsos pendentes' });
        expect((await world.ok('notes.list', { profileId })).map((note) => note.id)).toEqual([refunds.id, tax.id]);

        world.clock.set('2026-03-17');
        const rewritten = await world.ok('notes.update', { id: tax.id, text: 'IPTU 2027\nPago.' });
        expect(rewritten.text).toBe('IPTU 2027\nPago.');
        expect((await world.ok('notes.list', { profileId })).map((note) => note.id)).toEqual([tax.id, refunds.id]);
    });

    it('apara as pontas e recusa texto vazio, que seria uma anotação invisível', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        expect((await world.ok('notes.create', { profileId, text: '\n\n  Lembrete  \n' })).text).toBe('Lembrete');
        expect((await world.failure('notes.create', { profileId, text: ' \n ' })).code).toBe('VALIDATION_FAILED');
    });

    it('excluída some da lista e não pode mais ser editada', async () => {
        const world = new TestWorld();
        const profileId = world.profile();
        const note = await world.ok('notes.create', { profileId, text: 'Apagar' });
        await world.ok('notes.delete', { id: note.id });
        expect(await world.ok('notes.list', { profileId })).toEqual([]);
        expect((await world.failure('notes.update', { id: note.id, text: 'outra' })).code).toBe('NOT_FOUND');
    });

    it('cada perfil vê só as próprias anotações', async () => {
        const world = new TestWorld();
        const mine = world.profile();
        await world.ok('notes.create', { profileId: world.profile(), text: 'De outro perfil' });
        expect(await world.ok('notes.list', { profileId: mine })).toEqual([]);
    });
});
