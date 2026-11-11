import { CoreCallError } from '@finance/client';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeRoot } from '../src/theme/ThemeRoot.tsx';
import { AppText } from '../src/ui/AppText.tsx';
import { Button } from '../src/ui/Button.tsx';
import { SelectField } from '../src/ui/Select.tsx';
import { Sheet } from '../src/ui/Sheet.tsx';
import { EmptyState, ErrorState } from '../src/ui/states.tsx';
import { TextField } from '../src/ui/TextField.tsx';
import { TEST_METRICS } from './support/renderApp.tsx';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/**
 * @param ui Componente a renderizar.
 * @return Promessa resolvida com o componente na tela, dentro do tema e da área segura.
 */
async function renderUi(ui: ReactNode): Promise<void> {
    await render(
        <SafeAreaProvider initialMetrics={TEST_METRICS}>
            <ThemeRoot preference="light">{ui}</ThemeRoot>
        </SafeAreaProvider>,
    );
}

describe('componentes base (mobile-mvp-plan, Fase 6)', () => {
    it('o botão em andamento não aceita outro toque, para não gravar duas vezes', async () => {
        const onPress = jest.fn();
        await renderUi(<Button label="Salvar" busy onPress={onPress} />);

        await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));

        expect(onPress).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Salvar' })).toBeBusy();
    });

    it('o erro de consulta mostra a frase do describeError e tenta de novo', async () => {
        const onRetry = jest.fn();
        const error = new CoreCallError('accounts.list', { code: 'NOT_FOUND', message: 'Account não encontrada', details: { entity: 'Account', id: 'x' } });
        await renderUi(<ErrorState error={error} onRetry={onRetry} />);

        expect(screen.getByText('A conta não existe mais; pode ter sido excluído(a).')).toBeOnTheScreen();
        expect(screen.getByText('Código: NOT_FOUND')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('a lista vazia diz o que fazer', async () => {
        await renderUi(<EmptyState title="Nenhuma conta" body="Crie a primeira conta pelo +." />);

        expect(screen.getByText('Crie a primeira conta pelo +.')).toBeOnTheScreen();
    });

    it('o erro do campo é lido junto com o rótulo, para quem não vê a borda', async () => {
        await renderUi(<TextField label="Nome" value="" error="Informe o nome." />);

        expect(screen.getByLabelText('Nome. Informe o nome.')).toBeOnTheScreen();
        expect(screen.getByText('Informe o nome.')).toBeOnTheScreen();
    });

    it('a escolha abre numa folha inferior e fecha ao escolher', async () => {
        /** @return O campo com o estado da escolha. */
        function Field(): ReactNode {
            const [value, setValue] = useState<'brl' | 'usd' | null>(null);
            return (
                <SelectField
                    label="Moeda"
                    value={value}
                    onChange={setValue}
                    options={[
                        { value: 'brl', label: 'Real', description: 'BRL' },
                        { value: 'usd', label: 'Dólar', description: 'USD' },
                    ]}
                />
            );
        }
        await renderUi(<Field />);

        await fireEvent.press(screen.getByRole('button', { name: 'Moeda: Escolher' }));
        const sheet = screen.getByTestId('bottom-sheet');
        expect(within(sheet).getByRole('header', { name: 'Moeda' })).toBeOnTheScreen();
        await fireEvent.press(within(sheet).getByRole('radio', { name: 'Dólar, USD' }));

        expect(screen.queryByTestId('bottom-sheet')).toBeNull();
        expect(screen.getByRole('button', { name: 'Moeda: Dólar' })).toBeOnTheScreen();
    });

    it('o "voltar" do Android fecha a folha aberta antes de sair da tela', async () => {
        /** @return Uma folha aberta, com o estado de quem a abriu. */
        function Opened(): ReactNode {
            const [open, setOpen] = useState(true);
            return (
                <View>
                    <AppText>{open ? 'aberta' : 'fechada'}</AppText>
                    <Sheet
                        open={open}
                        title="Filtros"
                        onClose={() => {
                            setOpen(false);
                        }}
                    >
                        <AppText>Conteúdo</AppText>
                    </Sheet>
                </View>
            );
        }
        await renderUi(<Opened />);
        expect(screen.getByText('Conteúdo')).toBeOnTheScreen();

        // O "voltar" do Android chega ao `Modal` como `onRequestClose`.
        await fireEvent(screen.getByTestId('sheet-modal'), 'requestClose');

        expect(screen.getByText('fechada')).toBeOnTheScreen();
        expect(screen.queryByText('Conteúdo')).toBeNull();
    });
});
