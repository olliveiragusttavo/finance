import { columnLetter, type ImportTable } from '@finance/client';
import { Link } from '@tanstack/react-router';
import { FileTextIcon, UploadIcon } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { bridge } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import type { FileReading, LoadedFile } from './ImportScreen.tsx';
import { ImportCard, NativeSelect, Pill, StepFooter } from './importParts.tsx';
import {
    DATE_FORMAT_OPTIONS,
    DECIMAL_OPTIONS,
    DELIMITER_OPTIONS,
    detectedKindText,
    ENCODING_OPTIONS,
    formatCount,
    formatFileSize,
    KIND_OPTIONS,
    openFailureMessage,
    type FileEncoding,
} from './importView.ts';

/** Linhas brutas mostradas na prévia: o bastante para conferir separador e colunas. */
const RAW_PREVIEW_ROWS = 4;

/** Mesmo limite do processo principal para o arquivo arrastado, que não passa por ele. */
const DROP_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Etapa 1 — Arquivo (mockup `DesktopImportArquivo`): escolher o arquivo, confirmar o tipo e
 * ajustar como lê-lo, vendo as linhas brutas.
 *
 * @param props.reading Leitura atual; `null` antes de escolher o arquivo.
 * @param props.table Tabela lida; `null` antes do arquivo.
 * @param props.decodedEncoding Codificação usada, para o seletor mostrar a detectada.
 * @param props.lineCount Linhas de dados do arquivo.
 * @param props.onOpen Avisado com o arquivo escolhido.
 * @param props.onChange Avisado com a mudança de leitura.
 * @param props.onNext Avança para as colunas.
 * @return A etapa.
 */
export function FileStep({
    reading,
    table,
    decodedEncoding,
    lineCount,
    onOpen,
    onChange,
    onNext,
}: {
    readonly reading: FileReading | null;
    readonly table: ImportTable | null;
    readonly decodedEncoding: FileEncoding | null;
    readonly lineCount: number;
    readonly onOpen: (file: LoadedFile) => void;
    readonly onChange: (changes: Partial<Pick<FileReading, 'encoding' | 'settings' | 'kind'>>) => void;
    readonly onNext: () => void;
}): ReactNode {
    const [failure, setFailure] = useState<string | null>(null);
    const [opening, setOpening] = useState(false);

    /** Pede o arquivo ao processo principal, que mostra o diálogo e o lê. */
    const choose = (): void => {
        setFailure(null);
        setOpening(true);
        void bridge.importFile.open().then((result) => {
            setOpening(false);
            if (result.ok) {
                onOpen({ name: result.name, size: result.size, bytes: result.bytes });
            } else {
                setFailure(openFailureMessage(result.reason));
            }
        });
    };

    /**
     * Lê o arquivo arrastado da área de soltar. O conteúdo vem do próprio arrastar, sem caminho
     * algum, então não precisa passar pelo processo principal.
     *
     * @param event Evento de soltar.
     */
    const drop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file === undefined) {
            return;
        }
        if (file.size > DROP_MAX_BYTES) {
            setFailure(openFailureMessage('too-large'));
            return;
        }
        setFailure(null);
        void file.arrayBuffer().then(
            (buffer) => {
                onOpen({ name: file.name, size: file.size, bytes: new Uint8Array(buffer) });
            },
            () => {
                setFailure(openFailureMessage('read-failed'));
            },
        );
    };

    return (
        <>
            <div className="flex flex-col gap-1">
                <h1 className="text-24 font-semibold">Importar transações</h1>
                <span className="text-12 text-muted">Traga lançamentos de outro app ou de uma planilha. Um arquivo por vez.</span>
            </div>

            <ImportCard title="Arquivo">
                {reading !== null && (
                    <div className="flex items-center gap-3.5 rounded-10 border border-accent bg-soft px-4 py-3.5 text-soft-ink">
                        <FileTextIcon aria-hidden="true" className="size-7 shrink-0" />
                        <span className="flex flex-1 flex-col">
                            <span className="text-14 font-semibold">{reading.file.name}</span>
                            <span className="text-12">
                                {formatFileSize(reading.file.size)} · {formatCount(lineCount)} linhas · {String(table?.headers.length ?? 0)} colunas
                            </span>
                        </span>
                        <Pill tone="ok">Lido</Pill>
                    </div>
                )}
                <div
                    onDragOver={(event) => {
                        event.preventDefault();
                    }}
                    onDrop={drop}
                    className="flex items-center gap-4 rounded-10 border-[1.5px] border-dashed border-line bg-surface2 p-4.5 text-13"
                >
                    <UploadIcon aria-hidden="true" className="size-5 text-muted" />
                    <span className="text-muted">{reading === null ? 'Arraste um arquivo .csv aqui, ou' : 'Arraste outro arquivo .csv aqui, ou'}</span>
                    <Button variant="outline" size="sm" className="border-line text-13 font-normal" disabled={opening} onClick={choose}>
                        {reading === null ? 'Escolher arquivo…' : 'Trocar arquivo…'}
                    </Button>
                </div>
                {failure !== null && (
                    <p role="alert" className="text-13 text-danger">
                        {failure}
                    </p>
                )}
            </ImportCard>

            {reading !== null && table !== null && (
                <>
                    <ImportCard title="O que o arquivo contém" aside={detectedKindText(reading.detection)}>
                        <div role="radiogroup" aria-label="Tipo do arquivo" className="grid grid-cols-4 gap-3">
                            {KIND_OPTIONS.map((option) => {
                                const checked = option.kind === reading.kind;
                                return (
                                    <button
                                        key={option.kind}
                                        type="button"
                                        role="radio"
                                        aria-checked={checked}
                                        onClick={() => {
                                            onChange({ kind: option.kind });
                                        }}
                                        className={cn(
                                            'flex min-h-24 flex-col gap-1 rounded-10 border p-3.5 text-left',
                                            checked ? 'border-accent bg-soft ring-1 ring-accent ring-inset' : 'border-line bg-surface',
                                        )}
                                    >
                                        <span className="flex items-center gap-2 text-14 font-semibold">
                                            <span aria-hidden="true" className={cn('size-4 shrink-0 rounded-full', checked ? 'border-[5px] border-accent' : 'border-2 border-muted')} />
                                            {option.label}
                                        </span>
                                        <span className="text-12 text-muted">{option.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </ImportCard>

                    <ImportCard title="Como ler o arquivo" aside="Valores detectados; ajuste se a prévia sair errada">
                        <div className="flex flex-wrap items-end gap-4 text-13">
                            <label className="flex flex-col gap-1">
                                <span className="text-muted">Separador de colunas</span>
                                <NativeSelect
                                    label="Separador de colunas"
                                    value={reading.settings.delimiter}
                                    options={DELIMITER_OPTIONS}
                                    onChange={(delimiter) => {
                                        onChange({ settings: { ...reading.settings, delimiter } });
                                    }}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-muted">Separador decimal</span>
                                <NativeSelect
                                    label="Separador decimal"
                                    value={reading.settings.decimal}
                                    options={DECIMAL_OPTIONS}
                                    onChange={(decimal) => {
                                        onChange({ settings: { ...reading.settings, decimal } });
                                    }}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-muted">Formato de data</span>
                                <NativeSelect
                                    label="Formato de data"
                                    value={reading.settings.dateFormat}
                                    options={DATE_FORMAT_OPTIONS}
                                    onChange={(dateFormat) => {
                                        onChange({ settings: { ...reading.settings, dateFormat } });
                                    }}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-muted">Codificação</span>
                                <NativeSelect
                                    label="Codificação"
                                    value={decodedEncoding ?? 'utf-8'}
                                    options={ENCODING_OPTIONS}
                                    onChange={(encoding) => {
                                        onChange({ encoding });
                                    }}
                                />
                            </label>
                            <label className="flex h-9 items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="accent-accent"
                                    checked={reading.settings.hasHeader}
                                    onChange={(event) => {
                                        onChange({ settings: { ...reading.settings, hasHeader: event.target.checked } });
                                    }}
                                />
                                1ª linha é cabeçalho
                            </label>
                        </div>
                        <RawPreview table={table} />
                    </ImportCard>

                    <div className="rounded-8 bg-soft px-3 py-2.5 text-13 text-soft-ink">
                        Arquivos de outros tipos (por exemplo, Receitas e Transferências) entram em importações separadas, cada uma com seu mapeamento.
                    </div>
                </>
            )}

            <StepFooter
                back={
                    <Button variant="outline" className="border-line text-13 font-normal" asChild>
                        <Link to="/settings">Cancelar</Link>
                    </Button>
                }
            >
                <Button disabled={reading === null || lineCount === 0} onClick={onNext}>
                    Próximo: ligar colunas ›
                </Button>
            </StepFooter>
        </>
    );
}

/**
 * Primeiras linhas como estão no arquivo, com a letra de cada coluna — a mesma letra da etapa
 * Colunas.
 *
 * @param props.table Tabela lida.
 * @return A prévia bruta, rolável na horizontal.
 */
function RawPreview({ table }: { readonly table: ImportTable }): ReactNode {
    return (
        <div className="overflow-x-auto rounded-8 border border-line">
            <table aria-label="Primeiras linhas do arquivo" className="font-mono text-12">
                <thead>
                    <tr>
                        {table.headers.map((_, index) => (
                            <th key={index} scope="col" className="border-r border-b border-line bg-surface2 px-3 py-1 text-center text-11 font-normal text-muted">
                                {columnLetter(index)}
                            </th>
                        ))}
                    </tr>
                    <tr>
                        {table.headers.map((header, index) => (
                            <th key={index} scope="col" className="border-r border-b border-line2 bg-surface2 px-3 py-1.5 text-left font-medium whitespace-nowrap">
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.slice(0, RAW_PREVIEW_ROWS).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {row.map((cell, index) => (
                                <td key={index} className="max-w-60 truncate border-r border-b border-line2 px-3 py-1.5 whitespace-nowrap">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
