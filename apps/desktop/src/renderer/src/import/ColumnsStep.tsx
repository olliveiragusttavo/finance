import {
    assignField,
    columnHint,
    columnLetter,
    columnSamples,
    fieldsFor,
    IMPORT_FIELD_GROUPS,
    importField,
    missingRequired,
    suggestMapping,
    withoutColumn,
    type ColumnMapping,
    type ImportFieldGroup,
    type ImportFieldId,
    type ImportFileKind,
    type ImportTable,
} from '@finance/client';
import { useState, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { TEMPLATE_NAME_MAX_LENGTH } from '../../../shared/bridge.ts';
import type { FileReading, ReadRows, TemplateChoice } from './ImportScreen.tsx';
import { Pill, StepFooter } from './importParts.tsx';
import { formatCount, KIND_OPTIONS, kindLabel, previewRows, readProblemText, readSummary } from './importView.ts';

/** Nome de cada grupo da paleta de campos, como no mockup. */
const GROUP_LABELS: Readonly<Record<ImportFieldGroup, string>> = {
    essentials: 'Essenciais',
    accounts: 'Conta e cartão',
    classification: 'Classificação',
    dates: 'Datas e situação',
    repetition: 'Repetição',
};

/** Tipo de dado do arrastar, para a coluna aceitar só campos do app. */
const DRAG_TYPE = 'application/x-finance-import-field';

/** Problemas listados abaixo da prévia; o resto vira contagem. */
const LISTED_PROBLEMS = 5;

/**
 * Etapa 2 — Ligar colunas (mockup `DesktopImportMapear`): cada campo do app vai para uma coluna,
 * arrastando até ela ou clicando no campo e depois na coluna — a alternativa pelo teclado.
 *
 * @param props.reading Leitura do arquivo.
 * @param props.table Tabela lida.
 * @param props.mapping Campos ligados.
 * @param props.read Linhas lidas e problemas, para a prévia.
 * @param props.currency Moeda do perfil ativo, para os valores da prévia.
 * @param props.template Modelo a salvar.
 * @param props.onKind Avisado ao trocar o tipo do arquivo.
 * @param props.onMapping Avisado com a ligação nova.
 * @param props.onTemplate Avisado com o modelo editado.
 * @param props.onBack Volta ao arquivo.
 * @param props.onNext Avança para a revisão.
 * @return A etapa.
 */
export function ColumnsStep({
    reading,
    table,
    mapping,
    read,
    currency,
    template,
    onKind,
    onMapping,
    onTemplate,
    onBack,
    onNext,
}: {
    readonly reading: FileReading;
    readonly table: ImportTable;
    readonly mapping: ColumnMapping;
    readonly read: ReadRows;
    readonly currency: string;
    readonly template: TemplateChoice;
    readonly onKind: (kind: ImportFileKind) => void;
    readonly onMapping: (mapping: ColumnMapping) => void;
    readonly onTemplate: (template: TemplateChoice) => void;
    readonly onBack: () => void;
    readonly onNext: () => void;
}): ReactNode {
    const { kind } = reading;
    const [picked, setPicked] = useState<ImportFieldId | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const fields = fieldsFor(kind);
    const missing = missingRequired(mapping, kind);
    const mappedCount = table.headers.filter((_, index) => fields.some((field) => mapping[field.id] === index)).length;
    const ignored = table.headers.filter((_, index) => !fields.some((field) => mapping[field.id] === index));

    /**
     * @param column Coluna que recebe o campo.
     * @param field Campo arrastado ou escolhido.
     */
    const place = (column: number, field: ImportFieldId): void => {
        onMapping(assignField(mapping, field, column));
        setPicked(null);
        setOver(null);
    };

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-24 font-semibold">Ligue as colunas do arquivo aos campos do app</h1>
                    <span className="text-12 text-muted">Arraste um campo da esquerda até a coluna correspondente. Ou clique no campo e depois na coluna.</span>
                </div>
                <div role="group" aria-label="Tipo do arquivo" className="flex overflow-hidden rounded-8 border border-line text-13">
                    {KIND_OPTIONS.map((option) => (
                        <button
                            key={option.kind}
                            type="button"
                            aria-pressed={option.kind === kind}
                            onClick={() => {
                                onKind(option.kind);
                            }}
                            className={cn('px-3 py-1.5', option.kind === kind ? 'bg-accent text-on-accent' : 'bg-surface')}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-10 border border-line bg-surface px-4 py-3 text-13">
                <span className="font-medium">{reading.file.name}</span>
                <span className="text-12 text-muted">
                    {formatCount(table.rows.length)} linhas · {String(table.headers.length)} colunas · {readSummary(reading.settings.delimiter, reading.settings.decimal, reading.settings.dateFormat)}
                </span>
                <Pill tone={missing.length === 0 ? 'ok' : 'warn'}>
                    {String(mappedCount)} de {String(table.headers.length)} colunas ligadas
                </Pill>
                <span className="flex-1" />
                <Button
                    variant="outline"
                    size="sm"
                    className="border-line text-13 font-normal"
                    onClick={() => {
                        onMapping(suggestMapping(table.headers, kind));
                    }}
                >
                    Sugerir pelo cabeçalho
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-line text-13 font-normal"
                    onClick={() => {
                        onMapping({});
                    }}
                >
                    Limpar tudo
                </Button>
            </div>

            <div className="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-4.5">
                <aside aria-label="Campos do app" className="sticky top-20 flex flex-col gap-4 rounded-10 border border-line bg-surface p-4">
                    <div className="flex flex-col">
                        <h2 className="text-16 font-semibold">Campos do app</h2>
                        <span className="text-12 text-muted">
                            <span className="text-danger">*</span> obrigatório para {kindLabel(kind).toLowerCase()}
                        </span>
                    </div>
                    {IMPORT_FIELD_GROUPS.map((group) => {
                        const inGroup = fields.filter((field) => field.group === group);
                        if (inGroup.length === 0) {
                            return null;
                        }
                        return (
                            <div key={group} className="flex flex-col gap-1.5">
                                <h3 className="text-12 font-medium text-muted">{GROUP_LABELS[group]}</h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {inGroup.map((field) => {
                                        const column = mapping[field.id];
                                        return (
                                            <button
                                                key={field.id}
                                                type="button"
                                                draggable
                                                title={field.hint ?? undefined}
                                                aria-pressed={picked === field.id}
                                                onDragStart={(event) => {
                                                    event.dataTransfer.setData(DRAG_TYPE, field.id);
                                                    event.dataTransfer.effectAllowed = 'move';
                                                }}
                                                onClick={() => {
                                                    setPicked(picked === field.id ? null : field.id);
                                                }}
                                                className={cn(
                                                    'flex flex-col items-start rounded-6 border px-2 py-1 text-left text-13',
                                                    picked === field.id ? 'border-accent bg-soft text-soft-ink' : column === undefined ? 'border-line bg-surface' : 'border-line2 bg-surface2 text-muted',
                                                )}
                                            >
                                                <span>
                                                    <span aria-hidden="true" className="mr-1 text-muted">
                                                        ⋮⋮
                                                    </span>
                                                    {field.label}
                                                    {field.requiredIn.includes(kind) && <span className="text-danger"> *</span>}
                                                </span>
                                                {column !== undefined && <span className="text-11">→ {columnLetter(column)}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                    <span className="text-12 text-muted">Colunas sem campo são ignoradas.</span>
                </aside>

                <div className="flex min-w-0 flex-col gap-4">
                    <section aria-label="Colunas do arquivo" className="overflow-hidden rounded-10 border border-line bg-surface">
                        <div className="grid grid-cols-[48px_180px_minmax(0,1fr)_220px_32px] gap-3 border-b border-line bg-surface2 px-4 py-2 text-12 text-muted">
                            <span>Col.</span>
                            <span>Cabeçalho no arquivo</span>
                            <span>Exemplos</span>
                            <span>Campo do app</span>
                            <span />
                        </div>
                        {table.headers.map((header, index) => {
                            const field = fields.find((item) => mapping[item.id] === index);
                            const hint = field === undefined ? columnHint(header, kind, mapping) : null;
                            const samples = columnSamples(table, index).join(' · ');
                            return (
                                <div key={index} className="grid grid-cols-[48px_180px_minmax(0,1fr)_220px_32px] items-center gap-3 border-b border-line2 px-4 py-2 text-13 last:border-b-0">
                                    <span className="font-mono text-12 text-muted">{columnLetter(index)}</span>
                                    <span className="truncate font-medium" title={header}>
                                        {header}
                                    </span>
                                    <span className="truncate text-12 text-muted" title={samples}>
                                        {samples}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={field === undefined ? `Coluna ${columnLetter(index)} sem campo${picked === null ? '' : `: ligar a ${importField(picked).label}`}` : `Coluna ${columnLetter(index)} ligada a ${field.label}`}
                                        onDragOver={(event: DragEvent<HTMLButtonElement>) => {
                                            if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                                                event.preventDefault();
                                                setOver(index);
                                            }
                                        }}
                                        onDragLeave={() => {
                                            setOver(null);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const id = fields.find((item) => item.id === event.dataTransfer.getData(DRAG_TYPE))?.id;
                                            if (id !== undefined) {
                                                place(index, id);
                                            }
                                        }}
                                        onClick={() => {
                                            if (picked !== null) {
                                                place(index, picked);
                                            }
                                        }}
                                        className={cn(
                                            'flex min-h-9 flex-col justify-center rounded-6 border px-2.5 py-1 text-left',
                                            over === index ? 'border-accent bg-soft' : field === undefined ? 'border-dashed border-line text-muted' : 'border-accent bg-soft text-soft-ink',
                                            picked !== null && field === undefined && 'border-accent',
                                        )}
                                    >
                                        {field === undefined ? (
                                            <>
                                                <span>{picked === null ? 'Solte um campo aqui' : 'Clique para ligar'}</span>
                                                {hint !== null && <span className="text-11 text-warn-ink">{hint}</span>}
                                            </>
                                        ) : (
                                            <span>{field.label}</span>
                                        )}
                                    </button>
                                    {field === undefined ? (
                                        <span />
                                    ) : (
                                        <button
                                            type="button"
                                            aria-label={`Soltar ${field.label} da coluna ${columnLetter(index)}`}
                                            onClick={() => {
                                                onMapping(withoutColumn(mapping, index));
                                            }}
                                            className="text-muted hover:text-ink"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </section>

                    {missing.length > 0 ? (
                        <div role="status" className="rounded-8 bg-warn-bg px-3 py-2.5 text-13 text-warn-ink">
                            <b>Faltam campos obrigatórios:</b> {missing.map((field) => field.label).join(', ')}. Arraste cada um até a coluna certa.
                        </div>
                    ) : (
                        <div role="status" className="rounded-8 bg-ok-bg px-3 py-2.5 text-13 text-ok-ink">
                            Todos os campos obrigatórios estão ligados.{ignored.length > 0 && ` Ignoradas: ${ignored.join(', ')}.`}
                        </div>
                    )}

                    <Preview read={read} currency={currency} kind={kind} total={table.rows.length} />

                    <div className="flex flex-wrap items-center gap-4 rounded-10 border border-line bg-surface px-4 py-3 text-13">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                className="accent-accent"
                                checked={template.save}
                                onChange={(event) => {
                                    onTemplate({ ...template, save: event.target.checked });
                                }}
                            />
                            Salvar este mapeamento como modelo
                        </label>
                        <label className="flex items-center gap-2">
                            <span className="text-12 text-muted">Nome</span>
                            <Input
                                className="h-8 w-64"
                                value={template.name}
                                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                                disabled={!template.save}
                                onChange={(event) => {
                                    onTemplate({ ...template, name: event.target.value });
                                }}
                            />
                        </label>
                        <span className="text-12 text-muted">Na próxima importação, as colunas são ligadas sozinhas.</span>
                    </div>

                    <StepFooter
                        back={
                            <Button variant="outline" className="border-line text-13 font-normal" onClick={onBack}>
                                ‹ Voltar
                            </Button>
                        }
                    >
                        <Button disabled={missing.length > 0 || read.rows.length === 0} onClick={onNext}>
                            Próximo: revisar ›
                        </Button>
                    </StepFooter>
                </div>
            </div>
        </>
    );
}

/**
 * "Como os lançamentos vão ficar": as primeiras linhas já interpretadas e os problemas de leitura.
 *
 * @param props.read Linhas lidas e problemas.
 * @param props.currency Moeda para os valores.
 * @param props.kind Tipo do arquivo, que decide o título da coluna de origem.
 * @param props.total Linhas do arquivo.
 * @return A prévia.
 */
function Preview({ read, currency, kind, total }: { readonly read: ReadRows; readonly currency: string; readonly kind: ImportFileKind; readonly total: number }): ReactNode {
    const rows = previewRows(read.rows, currency);
    return (
        <section aria-label="Prévia" className="overflow-hidden rounded-10 border border-line bg-surface">
            <div className="flex items-baseline justify-between px-4 py-3">
                <h2 className="text-16 font-semibold">Como os lançamentos vão ficar</h2>
                <span className="text-12 text-muted">
                    {String(rows.length)} de {formatCount(total)} linhas
                </span>
            </div>
            <table className="w-full text-13">
                <thead>
                    <tr className="border-y border-line bg-surface2 text-left text-12 text-muted">
                        <th className="px-4 py-2 font-normal">Vencimento</th>
                        <th className="px-2 py-2 font-normal">Nome</th>
                        <th className="px-2 py-2 font-normal">Categoria › Sub</th>
                        <th className="px-2 py-2 font-normal">{kind === 'transfers' ? 'Origem → destino' : 'Conta / cartão'}</th>
                        <th className="px-2 py-2 font-normal">Repetição</th>
                        <th className="px-2 py-2 font-normal">Situação</th>
                        <th className="px-4 py-2 text-right font-normal">Valor</th>
                    </tr>
                </thead>
                <tbody className="tabular-nums">
                    {rows.map((row) => (
                        <tr key={row.line} className="border-b border-line2 last:border-b-0">
                            <td className="px-4 py-2">{row.dueDate}</td>
                            <td className="px-2 py-2">{row.name}</td>
                            <td className="px-2 py-2 text-muted">{row.classification}</td>
                            <td className="px-2 py-2">{row.where}</td>
                            <td className="px-2 py-2">{row.repetition}</td>
                            <td className="px-2 py-2">
                                <Pill tone={row.paid ? 'ok' : 'neutral'}>{row.status}</Pill>
                            </td>
                            <td className={cn('px-4 py-2 text-right', row.direction === 'in' ? 'text-in' : row.direction === 'out' ? 'text-out' : '')}>{row.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {read.problems.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-line px-4 py-3 text-12 text-warn-ink">
                    <span className="font-medium">
                        {formatCount(read.problems.length)} {read.problems.length === 1 ? 'linha não pôde ser lida e fica' : 'linhas não puderam ser lidas e ficam'} de fora:
                    </span>
                    {read.problems.slice(0, LISTED_PROBLEMS).map((problem) => (
                        <span key={problem.line}>{readProblemText(problem)}</span>
                    ))}
                    {read.problems.length > LISTED_PROBLEMS && <span>e mais {formatCount(read.problems.length - LISTED_PROBLEMS)}.</span>}
                </div>
            )}
        </section>
    );
}
