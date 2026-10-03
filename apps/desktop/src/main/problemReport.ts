import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import type { ProblemReport, ReportChannel } from '../shared/bridge.ts';

/**
 * Destino fixo dos relatos. Fica no processo principal, e não no renderer, para que um
 * conteúdo injetado na janela não consiga desviar o relato — com o log junto — para outro
 * lugar: o renderer manda só texto.
 */
export const REPORT_DESTINATION = {
    /** Repositório público do projeto, onde a issue é aberta pela conta do próprio usuário. */
    repository: 'olliveiragusttavo/finance',
    /** Endereço provisório, a definir; usado por quem não tem conta no GitHub. */
    email: 'exemple@exemple.com',
} as const;

/**
 * Tamanho máximo do endereço por destino. O GitHub recusa `issues/new` acima de ~8 KB, e o
 * `mailto:` quebra em torno de 2 KB em clientes de e-mail do Windows; acima disso o navegador
 * abriria uma página de erro, e o relato se perderia.
 */
const URL_LIMITS: Readonly<Record<ReportChannel, number>> = { github: 8000, email: 1800 };

/** Linhas finais de cada log que entram no relato; o resto fica no arquivo. */
const LOG_TAIL_LINES = 40;

/** Quanto do fim de cada arquivo de log é lido, para não carregar um log antigo inteiro. */
const LOG_TAIL_BYTES = 64 * 1024;

/**
 * O relato como chega do renderer, que é entrada não confiável (desktop-shell-design §3.6):
 * os limites impedem que um texto gigante trave a montagem do endereço.
 */
export const problemReportSchema = z.object({
    title: z.string().trim().min(1).max(200),
    details: z.string().max(20_000),
    description: z.string().max(5_000),
    includeLog: z.boolean(),
});

/** Destinos aceitos, validados no processo principal pelo mesmo motivo do relato. */
export const reportChannelSchema = z.enum(['github', 'email']);

/** O que acompanha o relato além do texto do usuário. */
export interface ReportContext {
    /** Versão do app, do Electron e do sistema, numa linha cada. */
    readonly environment: readonly string[];
    /** Fim dos logs, já sem a pasta pessoal do usuário. */
    readonly logTail: string;
}

/** O endereço pronto para abrir. */
export interface ReportUrl {
    readonly url: string;
    /** O log foi cortado (das linhas mais antigas) para caber no limite do destino. */
    readonly logTruncated: boolean;
}

/**
 * Lê o fim dos arquivos de log para o relato. Só o fim, porque é ali que está o erro que
 * acabou de acontecer, e porque o endereço do relato tem limite de tamanho.
 *
 * A pasta pessoal vira `~`: o log tem caminhos de `userData`, que trazem o nome do usuário no
 * sistema, e a issue é pública. Ver `homeDirForms` para as grafias procuradas.
 *
 * @param paths Arquivos de log, na ordem em que entram no relato.
 * @param homeDir Pasta pessoal, a esconder.
 * @return As últimas linhas de cada arquivo, com o nome do arquivo antes; vazio quando não há
 * log algum.
 */
export function readLogTail(paths: readonly string[], homeDir: string): string {
    const sections: string[] = [];
    for (const path of paths) {
        const lines = readTail(path).split('\n').filter((line) => line !== '').slice(-LOG_TAIL_LINES);
        if (lines.length > 0) {
            sections.push([`# ${basename(path)}`, ...lines].join('\n'));
        }
    }
    return homeDirForms(homeDir).reduce((text, form) => text.replaceAll(form, '~'), sections.join('\n\n'));
}

/**
 * Grafias da pasta pessoal que aparecem no log. Só o caminho cru não basta: as linhas são
 * JSON, e no Windows as barras invertidas chegam duplicadas (`C:\\Users\\nome`); e as pilhas
 * de módulos ES trazem URLs `file:///C:/Users/nome`, com barras normais. Sem essas formas, o
 * nome do usuário iria para a issue pública.
 *
 * @param homeDir Pasta pessoal.
 * @return As grafias distintas da pasta; vazio quando ela é desconhecida.
 */
function homeDirForms(homeDir: string): readonly string[] {
    if (homeDir === '') {
        return [];
    }
    const jsonEscaped = JSON.stringify(homeDir).slice(1, -1);
    return [...new Set([jsonEscaped, homeDir, homeDir.replaceAll('\\', '/')])];
}

/**
 * @param path Arquivo de log.
 * @return Os últimos bytes do arquivo, sem a primeira linha, que pode ter sido cortada no
 * meio; vazio quando o arquivo não existe ou não pode ser lido — o relato segue sem ele.
 */
function readTail(path: string): string {
    if (!existsSync(path)) {
        return '';
    }
    try {
        const size = statSync(path).size;
        const length = Math.min(size, LOG_TAIL_BYTES);
        const buffer = Buffer.alloc(length);
        const fd = openSync(path, 'r');
        try {
            readSync(fd, buffer, 0, length, size - length);
        } finally {
            closeSync(fd);
        }
        const text = buffer.toString('utf8');
        return length < size ? text.slice(text.indexOf('\n') + 1) : text;
    } catch {
        return '';
    }
}

/**
 * Monta o endereço da issue pré-preenchida ou do e-mail. Abrir a issue pelo navegador, e não
 * pela API do GitHub, é deliberado: a API exige um token com escrita no repositório, e um
 * token embutido no app pode ser extraído por qualquer um; sem um servidor intermediário, o
 * caminho seguro é o usuário revisar e enviar pela própria conta.
 *
 * Quando o texto passa do limite do destino, saem primeiro as linhas mais antigas do log, e
 * só depois o fim dos detalhes técnicos — a descrição do usuário e o erro ficam.
 *
 * @param channel Destino escolhido.
 * @param report Relato já validado.
 * @param context Ambiente e log a anexar.
 * @return O endereço e se o log foi cortado.
 */
export function buildReportUrl(channel: ReportChannel, report: ProblemReport, context: ReportContext): ReportUrl {
    const limit = URL_LIMITS[channel];
    const fullLog = report.includeLog && context.logTail !== '' ? context.logTail.split('\n') : [];
    let logLines = fullLog;
    let details = report.details;
    let description = report.description;
    let url = urlOf(channel, report.title, description, details, logLines, context);
    while (url.length > limit && logLines.length > 0) {
        logLines = logLines.slice(Math.max(1, Math.ceil(logLines.length / 10)));
        url = urlOf(channel, report.title, description, details, logLines, context);
    }
    while (url.length > limit && details.length > 0) {
        details = shorten(details);
        url = urlOf(channel, report.title, description, details, logLines, context);
    }
    while (url.length > limit && description.length > 0) {
        description = shorten(description);
        url = urlOf(channel, report.title, description, details, logLines, context);
    }
    return { url, logTruncated: logLines.length < fullLog.length };
}

/**
 * @param text Texto que não coube.
 * @return O texto com um décimo a menos, marcado com reticências; vazio quando já era curto.
 */
function shorten(text: string): string {
    const kept = cut(text.replace(/…$/, ''), Math.floor(text.length * 0.9) - 1);
    return kept === '' ? '' : `${kept}…`;
}

/**
 * Corta o texto sem partir um caractere fora do plano básico (emoji, por exemplo) ao meio. O
 * `slice` conta unidades UTF-16, e a metade alta de um par substituto que sobra no fim faz o
 * `encodeURIComponent` lançar `URIError` — o relato inteiro falharia por um corte que bastava
 * recuar uma posição.
 *
 * @param text Texto a cortar.
 * @param length Quantas unidades UTF-16 manter, no máximo.
 * @return O começo do texto, uma unidade mais curto quando o corte cairia no meio de um par.
 */
function cut(text: string, length: number): string {
    return text.slice(0, Math.max(0, length)).replace(/[\uD800-\uDBFF]$/, '');
}

/**
 * @param channel Destino.
 * @param errorTitle Título do erro.
 * @param description Descrição do usuário, talvez cortada.
 * @param details Detalhes técnicos, talvez cortados.
 * @param logLines Linhas do log que cabem.
 * @param context Ambiente.
 * @return O endereço codificado.
 */
function urlOf(channel: ReportChannel, errorTitle: string, description: string, details: string, logLines: readonly string[], context: ReportContext): string {
    const title = cut(`[Erro] ${errorTitle}`, 120);
    const body = bodyOf(description, errorTitle, details, logLines, context.environment);
    if (channel === 'github') {
        return `https://github.com/${REPORT_DESTINATION.repository}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    }
    return `mailto:${REPORT_DESTINATION.email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * Texto do relato em Markdown, que a issue renderiza e o e-mail lê bem como texto puro.
 *
 * @param description O que o usuário estava fazendo.
 * @param title Título do erro.
 * @param details Detalhes técnicos.
 * @param logLines Linhas do log; a seção some quando não há nenhuma.
 * @param environment Linhas de ambiente.
 * @return O corpo do relato.
 */
function bodyOf(description: string, title: string, details: string, logLines: readonly string[], environment: readonly string[]): string {
    const sections = [
        '## O que aconteceu',
        description.trim() === '' ? '_Não informado._' : description.trim(),
        '## Erro',
        `**${title}**`,
        fence(details),
        '## Ambiente',
        environment.map((line) => `- ${line}`).join('\n'),
    ];
    if (logLines.length > 0) {
        sections.push('## Log (últimas linhas)', fence(logLines.join('\n')));
    }
    return sections.join('\n\n');
}

/**
 * @param text Texto técnico.
 * @return O texto num bloco de código; crases triplas dentro dele são quebradas para não
 * fecharem o bloco antes da hora.
 */
function fence(text: string): string {
    return `\`\`\`\n${text.replaceAll('```', '`​``')}\n\`\`\``;
}
