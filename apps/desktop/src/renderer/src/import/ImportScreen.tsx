import {
    applyTemplate,
    completeMapping,
    DEFAULT_IMPORT_OPTIONS,
    detectFileKind,
    detectReadSettings,
    findTemplate,
    interpretRows,
    mappingForKind,
    readTable,
    suggestMapping,
    templateFrom,
    type ColumnMapping,
    type ImportFileKind,
    type ImportReadProblem,
    type ImportRowInput,
    type ImportTable,
    type KindDetection,
    type ReadSettings,
    type ReviewState,
} from '@finance/client';
import { analyzeImport, LocalDate, type ImportAnalysis, type ImportResponse } from '@finance/core';
import { importRowSchema } from '@finance/core/requests';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { bridge } from '@/lib/bridge';
import { useActiveProfile } from '@/shell/activeProfile';
import { currentDate } from '@/shell/referenceMonth';
import { ColumnsStep } from './ColumnsStep.tsx';
import { FileStep } from './FileStep.tsx';
import { ImportDone } from './ImportDone.tsx';
import { decodeImportFile, defaultTemplateName, IMPORT_STEPS, type FileEncoding, type ImportStep } from './importView.ts';
import { ReviewStep } from './ReviewStep.tsx';

/** Chave do cache dos modelos de mapeamento; vêm do processo principal, não do núcleo. */
export const TEMPLATES_KEY = ['device', 'importTemplates'] as const;

/** Arquivo escolhido, como o processo principal (ou o arrastar e soltar) o entregou. */
export interface LoadedFile {
    readonly name: string;
    readonly size: number;
    readonly bytes: Uint8Array;
}

/** Leitura do arquivo: o que a etapa Arquivo decide. */
export interface FileReading {
    readonly file: LoadedFile;
    /** Codificação escolhida; `null` detecta. */
    readonly encoding: FileEncoding | null;
    readonly settings: ReadSettings;
    readonly kind: ImportFileKind;
    readonly detection: KindDetection;
}

/** Linhas lidas que chegam ao núcleo, e as que ficaram de fora no client. */
export interface ReadRows {
    readonly rows: readonly ImportRowInput[];
    readonly problems: readonly ImportReadProblem[];
}

/** Modelo de mapeamento a salvar ao avançar das colunas. */
export interface TemplateChoice {
    readonly save: boolean;
    readonly name: string;
}

/**
 * Importar transações (desktop-mvp-plan Fase 13.1; mockups `DesktopImportArquivo`,
 * `DesktopImportMapear` e `DesktopImportRevisar`): assistente de três etapas, um arquivo por vez.
 * O estado vive aqui, e as etapas só o mostram e pedem mudanças; tabela, linhas e análise são
 * derivadas, para que trocar o separador ou uma coluna refaça a prévia e os números da revisão na
 * hora. **Decisão:** o indicador das etapas fica no topo da tela, e não na barra superior do
 * mockup, porque a barra é do shell e mantém o "+ Lançamento" de toda tela.
 *
 * @return A tela de importação.
 */
export function ImportScreen(): ReactNode {
    const { profile } = useActiveProfile();
    const queryClient = useQueryClient();
    const templates = useQuery({ queryKey: TEMPLATES_KEY, queryFn: () => bridge.importFile.templates() });
    const [step, setStep] = useState<ImportStep>('file');
    const [reading, setReading] = useState<FileReading | null>(null);
    const [mapping, setMapping] = useState<ColumnMapping>({});
    const [template, setTemplate] = useState<TemplateChoice>({ save: true, name: '' });
    const [review, setReview] = useState<ReviewState | null>(null);
    const [outcome, setOutcome] = useState<ImportResponse | null>(null);

    const decoded = useMemo(() => (reading === null ? null : decodeImportFile(reading.file.bytes, reading.encoding)), [reading]);
    const table = useMemo(() => (reading === null || decoded === null ? null : readTable(decoded.text, reading.settings)), [reading, decoded]);
    const read = useMemo(() => (reading === null || table === null ? null : readRows(table, mapping, reading)), [reading, table, mapping]);
    const options = review?.options ?? DEFAULT_IMPORT_OPTIONS;
    const analysis = useMemo<ImportAnalysis | null>(
        () => (read === null ? null : analyzeImport(read.rows.map((row) => importRowSchema.parse(row)), options, LocalDate.parse(currentDate(new Date())))),
        [read, options],
    );

    /**
     * Abre um arquivo novo: detecta como lê-lo, reconhece um modelo salvo pelos cabeçalhos e liga
     * as colunas pelo modelo ou pelos nomes. Decisões de uma importação anterior não valem para
     * outro arquivo.
     *
     * @param file Arquivo escolhido.
     */
    const openFile = (file: LoadedFile): void => {
        const text = decodeImportFile(file.bytes, null).text;
        const settings = detectReadSettings(text);
        const headers = readTable(text, settings).headers;
        const saved = findTemplate(templates.data ?? [], headers);
        const detection = saved === null ? detectFileKind(file.name, headers) : { kind: saved.kind, reasons: [`modelo “${saved.name}”`] };
        setReading({ file, encoding: null, settings, kind: detection.kind, detection });
        setMapping(saved === null ? suggestMapping(headers, detection.kind) : applyTemplate(saved, headers));
        setTemplate({ save: true, name: saved?.name ?? defaultTemplateName(detection.kind, file.name) });
        setReview(null);
    };

    /**
     * Muda como ler o arquivo. Trocar separador, cabeçalho ou codificação muda as colunas, e a
     * ligação é refeita pelos nomes; trocar só o tipo mantém o que ele aceita e liga o resto.
     *
     * @param changes Campos a mudar.
     */
    const changeReading = (changes: Partial<Pick<FileReading, 'encoding' | 'settings' | 'kind'>>): void => {
        if (reading === null) {
            return;
        }
        const next = { ...reading, ...changes };
        const headers = readTable(decodeImportFile(next.file.bytes, next.encoding).text, next.settings).headers;
        const columnsChanged = next.encoding !== reading.encoding
            || next.settings.delimiter !== reading.settings.delimiter
            || next.settings.hasHeader !== reading.settings.hasHeader;
        setReading(next);
        setMapping(columnsChanged ? suggestMapping(headers, next.kind) : completeMapping(mappingForKind(mapping, next.kind), suggestMapping(headers, next.kind)));
    };

    /**
     * Avança para a revisão, salvando o modelo se pedido. O modelo é conveniência do aparelho: se o
     * processo principal recusá-lo (nome, cabeçalho ou número de colunas fora do limite), a
     * importação segue sem ele e o usuário é avisado — uma promessa rejeitada sem tratamento
     * derrubaria o app na tela de erro fatal (`lib/failures.ts`).
     */
    const goToReview = (): void => {
        if (reading !== null && table !== null && template.save && template.name.trim() !== '') {
            bridge.importFile.saveTemplate(templateFrom(template.name, reading.kind, table.headers, mapping))
                .then((saved) => {
                    queryClient.setQueryData(TEMPLATES_KEY, saved);
                })
                .catch(() => {
                    toast.error('Não foi possível salvar o modelo neste aparelho. A importação continua normalmente.');
                });
        }
        setStep('review');
    };

    if (outcome !== null) {
        return (
            <ImportDone
                outcome={outcome}
                onAnother={() => {
                    setOutcome(null);
                    setReading(null);
                    setReview(null);
                    setStep('file');
                }}
            />
        );
    }

    return (
        <div className="flex max-w-280 flex-col gap-4.5">
            <StepIndicator current={step} />
            {step === 'file' && (
                <FileStep
                    reading={reading}
                    table={table}
                    decodedEncoding={decoded?.encoding ?? null}
                    lineCount={table?.rows.length ?? 0}
                    onOpen={openFile}
                    onChange={changeReading}
                    onNext={() => {
                        setStep('columns');
                    }}
                />
            )}
            {step === 'columns' && reading !== null && table !== null && read !== null && (
                <ColumnsStep
                    reading={reading}
                    table={table}
                    mapping={mapping}
                    read={read}
                    currency={profile.currency}
                    template={template}
                    onKind={(kind) => {
                        changeReading({ kind });
                    }}
                    onMapping={setMapping}
                    onTemplate={setTemplate}
                    onBack={() => {
                        setStep('file');
                    }}
                    onNext={goToReview}
                />
            )}
            {step === 'review' && reading !== null && read !== null && analysis !== null && (
                <ReviewStep
                    reading={reading}
                    read={read}
                    analysis={analysis}
                    paymentDateMapped={mapping.paymentDate !== undefined}
                    review={review}
                    onReview={setReview}
                    onBack={() => {
                        setStep('columns');
                    }}
                    onDone={setOutcome}
                />
            )}
        </div>
    );
}

/**
 * @param table Tabela do arquivo.
 * @param mapping Campos ligados.
 * @param reading Tipo e formatos.
 * @return As linhas que o núcleo aceita — a linha que o schema da rota recusaria (um valor acima
 * do teto do dinheiro) vira problema aqui, para nunca derrubar a importação inteira.
 */
function readRows(table: ImportTable, mapping: ColumnMapping, reading: FileReading): ReadRows {
    const interpreted = interpretRows(table, mapping, { kind: reading.kind, decimal: reading.settings.decimal, dateFormat: reading.settings.dateFormat });
    const accepted: ImportRowInput[] = [];
    const problems: ImportReadProblem[] = [...interpreted.problems];
    for (const row of interpreted.rows) {
        if (importRowSchema.safeParse(row).success) {
            accepted.push(row);
        } else {
            problems.push({ line: row.line, field: 'value', reason: 'invalid-number' });
        }
    }
    problems.sort((a, b) => a.line - b.line);
    return { rows: accepted, problems };
}

/**
 * Indicador "1 Arquivo — 2 Colunas — 3 Revisar" do mockup.
 *
 * @param props.current Etapa atual.
 * @return O indicador, com a etapa atual marcada para leitores de tela.
 */
function StepIndicator({ current }: { readonly current: ImportStep }): ReactNode {
    return (
        <ol aria-label="Etapas" className="flex items-center gap-2 text-13 text-muted">
            {IMPORT_STEPS.map((item, index) => {
                const active = item.id === current;
                return (
                    <li key={item.id} aria-current={active ? 'step' : undefined} className={active ? 'flex items-center gap-1.5 font-semibold text-ink' : 'flex items-center gap-1.5'}>
                        {index > 0 && <span aria-hidden="true" className="mr-1.5 h-px w-6 bg-line" />}
                        <span aria-hidden="true" className={active ? 'flex size-5.5 items-center justify-center rounded-full bg-accent text-12 text-on-accent' : 'flex size-5.5 items-center justify-center rounded-full border border-line text-12'}>
                            {index + 1}
                        </span>
                        {item.label}
                    </li>
                );
            })}
        </ol>
    );
}
