import { colorTokens, spacingUnitPx, type ColorTokenName, type FontSizePx } from '@finance/tokens';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { formatReportLog, type ContractReport } from './contractReport.ts';

/** Título do resultado: o texto que o Maestro procura no CI. */
const TITLE_SIZE: FontSizePx = 22;

/** Texto do resumo e das falhas. */
const BODY_SIZE: FontSizePx = 13;

/**
 * Tela única do app de contrato: mostra "Contrato: passou" ou "Contrato: falhou" e a lista do
 * que divergiu. O texto do título é o contrato com o fluxo do Maestro (`.maestro/contract.yaml`);
 * mudar um sem o outro faz o CI esperar até o tempo limite em vez de acusar a falha.
 *
 * O contrato roda depois do primeiro frame, e não no corpo do componente, para que a tela de
 * "rodando" apareça: a suíte é síncrona e prende a thread JavaScript até terminar.
 *
 * @param props.run Execução do contrato; o app passa a do aparelho, os testes uma falsa.
 * @return A tela com o resultado, ou o aviso de que ainda está rodando.
 */
export function ContractScreen({ run }: { readonly run: () => ContractReport }): ReactNode {
    const [report, setReport] = useState<ContractReport | null>(null);
    const color = useThemeColor();

    useEffect(() => {
        const timer = setTimeout(() => {
            const result = run();
            // O log é a saída que o CI guarda; a tela é a que o Maestro lê.
            console.log(formatReportLog(result));
            setReport(result);
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [run]);

    const title = report === null ? 'Contrato: rodando…' : report.passed ? 'Contrato: passou' : 'Contrato: falhou';
    return (
        <View style={[styles.screen, { backgroundColor: color('bg') }]}>
            <Text testID="contract-status" style={[styles.title, { color: report === null || report.passed ? color('ink') : color('danger') }]}>
                {title}
            </Text>
            {report !== null && (
                <Text style={[styles.body, { color: color('muted') }]}>
                    {`SQLite ${report.sqliteVersion} · ${report.databaseCases} casos do banco · ${report.goldenCases} vetores de ouro`}
                </Text>
            )}
            <ScrollView contentContainerStyle={styles.failures}>
                {report?.failures.map((failure, index) => (
                    <Text key={index} style={[styles.body, { color: color('ink2') }]}>
                        {`${failure.source} — ${failure.description}`}
                    </Text>
                ))}
            </ScrollView>
        </View>
    );
}

/**
 * Cores do tema do aparelho, direto dos tokens: o app de contrato não usa NativeWind, mas
 * segue a regra de nenhuma cor literal fora de `packages/tokens`.
 *
 * @return Uma função que dá a cor do token no tema atual.
 */
function useThemeColor(): (token: ColorTokenName) => string {
    const theme = useColorScheme() === 'dark' ? 'dark' : 'light';
    return (token) => colorTokens[token][theme];
}

/** Espaçamento e tamanhos na escala dos tokens (unidade de 4px). */
const styles = StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: spacingUnitPx * 4, paddingTop: spacingUnitPx * 16, gap: spacingUnitPx * 2 },
    title: { fontSize: TITLE_SIZE, fontWeight: '600' },
    body: { fontSize: BODY_SIZE },
    failures: { gap: spacingUnitPx * 2, paddingBottom: spacingUnitPx * 8 },
});
