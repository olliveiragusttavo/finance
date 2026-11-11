import { render, screen } from '@testing-library/react-native';
import type { ContractReport } from '../src/contractReport.ts';
import { ContractScreen } from '../src/ContractScreen.tsx';

/**
 * Resultado de teste com os contadores preenchidos.
 *
 * @param failures Falhas do resultado; vazia para o caso que passou.
 * @return O resultado.
 */
function report(failures: ContractReport['failures']): ContractReport {
    return { passed: failures.length === 0, sqliteVersion: '3.53.3', databaseCases: 13, goldenCases: 900, failures };
}

describe('tela do contrato', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('mostra o texto que o Maestro espera quando passa, e registra no log', async () => {
        await render(<ContractScreen run={() => report([])} />);

        expect(await screen.findByText('Contrato: passou')).toBeOnTheScreen();
        expect(screen.getByText('SQLite 3.53.3 · 13 casos do banco · 900 vetores de ouro')).toBeOnTheScreen();
        expect(console.log).toHaveBeenCalledWith('[contrato] PASSOU sqlite=3.53.3 banco=13 vetores=900 falhas=0');
    });

    it('mostra cada falha quando diverge', async () => {
        await render(<ContractScreen run={() => report([{ source: 'vetores:client', description: 'format.money {"amount":1}: Node "R$ 1,00", aqui "R$ 1,00"' }])} />);

        expect(await screen.findByText('Contrato: falhou')).toBeOnTheScreen();
        expect(screen.getByText('vetores:client — format.money {"amount":1}: Node "R$ 1,00", aqui "R$ 1,00"')).toBeOnTheScreen();
    });
});
