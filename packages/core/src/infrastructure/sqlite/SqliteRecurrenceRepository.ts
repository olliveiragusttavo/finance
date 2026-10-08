import { Recurrence, type RecurrenceSource, type RecurrenceTerms } from '../../domain/recurrence/Recurrence.ts';
import { RecurrenceSchedule } from '../../domain/recurrence/RecurrenceSchedule.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { recurrenceTagIdFor } from '../../domain/shared/DeterministicIds.ts';
import { CorruptRowError } from '../../domain/shared/errors.ts';
import { AccountId, CreditCardId, GoalId, PartnerId, ProfileId, RecurrenceId, SubCategoryId, TagId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlParams, SqlRow } from '../../ports/Database.ts';
import type { RecurrenceRepository } from '../../repositories/RecurrenceRepository.ts';
import { decodeEnum, INSTALLMENT_VALUE_TYPE_CODE, RECURRENCE_FREQUENCY_CODE, RECURRENCE_KIND_CODE, TRANSACTION_TYPE_CODE } from './enumCodes.ts';
import { RowReader } from './RowReader.ts';

// As tags do modelo vêm numa coluna só, como nas transações; a moeda do dinheiro é a do
// perfil, que é a de todo valor gravado (database-design §4.13). Regra de perfil excluído não
// existe mais para ninguém, inclusive para o complemento.
const SELECT_RECURRENCE = `
    SELECT r.*, p.currency AS profile_currency,
        (SELECT group_concat(linked.tag_id, ',') FROM (
            SELECT rt.tag_id FROM recurrences_tags rt
            JOIN tags tg ON tg.id = rt.tag_id AND tg.deleted_at IS NULL
            WHERE rt.recurrence_id = r.id AND rt.deleted_at IS NULL
            ORDER BY tg.name COLLATE NOCASE, tg.id
        ) linked) AS tag_ids
    FROM recurrences r
    JOIN profiles p ON p.id = r.profile_id AND p.deleted_at IS NULL
    WHERE r.deleted_at IS NULL
`;

/** Implementação SQLite de `RecurrenceRepository`. */
export class SqliteRecurrenceRepository implements RecurrenceRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Regra procurada.
     * @return A regra viva, ou `null`.
     */
    public findById(id: RecurrenceId): Recurrence | null {
        const row = this.database.get(`${SELECT_RECURRENCE} AND r.id = :id`, { id });
        return row === undefined ? null : this.toRecurrence(row);
    }

    /**
     * @param profileId Perfil dono.
     * @return As regras vivas do perfil.
     */
    public listByProfile(profileId: ProfileId): readonly Recurrence[] {
        return this.database.all(`${SELECT_RECURRENCE} AND r.profile_id = :profileId ORDER BY r.starts_on, r.name, r.id`, { profileId }).map((row) => this.toRecurrence(row));
    }

    /**
     * Só os ids, sem montar as regras, para que uma linha corrompida falhe ao ser lida sozinha
     * (`findById`) e não na listagem de todas.
     *
     * @return Os ids das regras vivas de todos os perfis.
     */
    public listAllIds(): readonly RecurrenceId[] {
        return this.database
            .all(`SELECT r.id FROM recurrences r JOIN profiles p ON p.id = r.profile_id AND p.deleted_at IS NULL WHERE r.deleted_at IS NULL ORDER BY r.profile_id, r.starts_on, r.id`)
            .map((row) => RecurrenceId(new RowReader('recurrences', row).text('id')));
    }

    /**
     * @param recurrence Regra nova.
     * @return void
     */
    public insert(recurrence: Recurrence): void {
        this.database.run(
            `INSERT INTO recurrences (id, profile_id, type, recurrence, installments, value_type, end_at, starts_on, starts_at,
                anchor_day, materialized_count, transaction_type, account_id, credit_card_id, invoice_offset, destination_account_id,
                sub_category_id, partner_id, goal_id, name, description, value, charges, currency, conversion_rate, updated_at)
            VALUES (:id, :profileId, :kind, :frequency, :installments, :valueType, :endAt, :startsOn, :startsAt,
                :anchorDay, :materializedCount, :transactionType, :accountId, :creditCardId, :invoiceOffset, :destinationAccountId,
                :subCategoryId, :partnerId, :goalId, :name, :description, :value, :charges, :currency, :conversionRate, :now)`,
            { ...this.params(recurrence), profileId: recurrence.profileId },
        );
        this.syncTags(recurrence);
    }

    /**
     * @param recurrence Regra revisada.
     * @return void
     */
    public update(recurrence: Recurrence): void {
        this.database.run(
            `UPDATE recurrences SET type = :kind, recurrence = :frequency, installments = :installments, value_type = :valueType,
                end_at = :endAt, starts_on = :startsOn, starts_at = :startsAt, anchor_day = :anchorDay,
                -- A marca d'água só avança, mesmo que uma regeneração tenha emitido menos.
                materialized_count = max(materialized_count, :materializedCount),
                transaction_type = :transactionType, account_id = :accountId, credit_card_id = :creditCardId,
                invoice_offset = :invoiceOffset, destination_account_id = :destinationAccountId, sub_category_id = :subCategoryId,
                partner_id = :partnerId, goal_id = :goalId, name = :name, description = :description, value = :value,
                charges = :charges, currency = :currency, conversion_rate = :conversionRate, updated_at = :now
            WHERE id = :id AND deleted_at IS NULL`,
            this.params(recurrence),
        );
        this.syncTags(recurrence);
    }

    /**
     * @param id Regra a excluir.
     * @return void
     */
    public softDelete(id: RecurrenceId): void {
        const params = { id, now: this.clock.now() };
        this.database.run('UPDATE recurrences SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', params);
        this.database.run('UPDATE recurrences_tags SET deleted_at = :now, updated_at = :now WHERE recurrence_id = :id AND deleted_at IS NULL', params);
    }

    /**
     * Deixa vivos exatamente os vínculos das tags do modelo, tocando só nos que mudaram, pelo
     * mesmo motivo das transações: uma revisão que não mexe nas tags não pode carimbar
     * `updated_at` em vínculos intactos, que a sincronização trataria como alterados.
     *
     * @param recurrence Regra gravada.
     * @return void
     */
    private syncTags(recurrence: Recurrence): void {
        const now = this.clock.now();
        const linked = new Set(
            this.database
                .all('SELECT tag_id FROM recurrences_tags WHERE recurrence_id = :id AND deleted_at IS NULL', { id: recurrence.id })
                .map((row) => TagId(new RowReader('recurrences_tags', row).text('tag_id'))),
        );
        const wanted = new Set(recurrence.template.tagIds);
        for (const tagId of linked) {
            if (!wanted.has(tagId)) {
                this.database.run(
                    'UPDATE recurrences_tags SET deleted_at = :now, updated_at = :now WHERE recurrence_id = :id AND tag_id = :tagId AND deleted_at IS NULL',
                    { id: recurrence.id, tagId, now },
                );
            }
        }
        for (const tagId of wanted) {
            if (!linked.has(tagId)) {
                this.database.run(
                    `INSERT INTO recurrences_tags (id, recurrence_id, tag_id, updated_at)
                    VALUES (:linkId, :id, :tagId, :now)
                    ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`,
                    { linkId: recurrenceTagIdFor(recurrence.id, tagId), id: recurrence.id, tagId, now },
                );
            }
        }
    }

    /**
     * Parâmetros comuns ao insert e ao update. Dinheiro é arredondado aqui, na fronteira de
     * persistência (database-design §3.7).
     *
     * @param recurrence Regra de origem.
     * @return Os parâmetros nomeados.
     */
    private params(recurrence: Recurrence): SqlParams {
        const { terms, schedule, template } = recurrence;
        const { source } = template;
        return {
            id: recurrence.id,
            kind: RECURRENCE_KIND_CODE[terms.kind],
            frequency: RECURRENCE_FREQUENCY_CODE[schedule.frequency],
            installments: terms.kind === 'installments' ? terms.installments : null,
            valueType: terms.kind === 'installments' ? INSTALLMENT_VALUE_TYPE_CODE[terms.valueType] : null,
            endAt: terms.kind === 'fixed' ? (terms.endAt?.toString() ?? null) : null,
            startsOn: schedule.startsOn.toString(),
            startsAt: schedule.startsAt,
            anchorDay: schedule.anchorDay,
            materializedCount: recurrence.materializedCount,
            transactionType: TRANSACTION_TYPE_CODE[template.type],
            accountId: source.kind === 'account' ? source.accountId : null,
            creditCardId: source.kind === 'creditCard' ? source.creditCardId : null,
            invoiceOffset: source.kind === 'creditCard' ? source.invoiceOffset : null,
            destinationAccountId: template.destinationAccountId,
            subCategoryId: template.subCategoryId,
            partnerId: template.partnerId,
            goalId: template.goalId,
            name: template.name,
            description: template.description,
            value: template.value.rounded().amount,
            charges: template.charges.rounded().amount,
            currency: template.origin.currency.code,
            conversionRate: template.origin.conversionRate,
            now: this.clock.now(),
        };
    }

    /**
     * @param row Linha do `SELECT_RECURRENCE`.
     * @return A regra de domínio.
     * @throws {CorruptRowError} Quando a regra não tem exatamente uma origem ou os campos do
     * tipo não batem — estados que a aplicação nunca grava.
     */
    private toRecurrence(row: SqlRow): Recurrence {
        const reader = new RowReader('recurrences', row);
        const currency = Currency.of(reader.text('profile_currency'));
        const frequency = decodeEnum(RECURRENCE_FREQUENCY_CODE, reader.number('recurrence'), 'recurrences');
        /**
         * @param column Coluna da chave estrangeira anulável.
         * @param parse Conversor do id marcado.
         * @return O id, ou `null`.
         */
        const nullableId = <T>(column: string, parse: (raw: string) => T): T | null => {
            const value = reader.nullableText(column);
            return value === null ? null : parse(value);
        };
        return Recurrence.restore({
            id: RecurrenceId(reader.text('id')),
            profileId: ProfileId(reader.text('profile_id')),
            terms: this.toTerms(reader),
            schedule: RecurrenceSchedule.of({
                frequency,
                startsOn: LocalDate.parse(reader.text('starts_on')),
                startsAt: reader.number('starts_at'),
                anchorDay: reader.nullableNumber('anchor_day'),
            }),
            materializedCount: reader.number('materialized_count'),
            template: {
                type: decodeEnum(TRANSACTION_TYPE_CODE, reader.number('transaction_type'), 'recurrences'),
                source: this.toSource(reader),
                destinationAccountId: nullableId('destination_account_id', AccountId),
                subCategoryId: SubCategoryId(reader.text('sub_category_id')),
                partnerId: nullableId('partner_id', PartnerId),
                goalId: nullableId('goal_id', GoalId),
                name: reader.text('name'),
                description: reader.nullableText('description'),
                value: Money.of(reader.number('value'), currency),
                charges: Money.of(reader.number('charges'), currency),
                origin: { currency: Currency.of(reader.text('currency')), conversionRate: reader.number('conversion_rate') },
                tagIds: (reader.nullableText('tag_ids') ?? '').split(',').filter((id) => id !== '').map((id) => TagId(id)),
            },
        });
    }

    /**
     * @param reader Leitor da linha.
     * @return A forma da série.
     * @throws {CorruptRowError} Quando a parcelada não tem quantidade ou forma de valor.
     */
    private toTerms(reader: RowReader): RecurrenceTerms {
        const kind = decodeEnum(RECURRENCE_KIND_CODE, reader.number('type'), 'recurrences');
        if (kind === 'fixed') {
            const endAt = reader.nullableText('end_at');
            return { kind, endAt: endAt === null ? null : LocalDate.parse(endAt) };
        }
        const installments = reader.nullableNumber('installments');
        const valueType = reader.nullableNumber('value_type');
        if (installments === null || valueType === null) {
            throw new CorruptRowError('recurrences', `parcelada ${reader.text('id')} sem quantidade ou forma de valor`);
        }
        return { kind, installments, valueType: decodeEnum(INSTALLMENT_VALUE_TYPE_CODE, valueType, 'recurrences') };
    }

    /**
     * @param reader Leitor da linha.
     * @return A origem do modelo.
     * @throws {CorruptRowError} Quando a regra não tem exatamente uma origem.
     */
    private toSource(reader: RowReader): RecurrenceSource {
        const accountId = reader.nullableText('account_id');
        const creditCardId = reader.nullableText('credit_card_id');
        if (accountId !== null && creditCardId === null) {
            return { kind: 'account', accountId: AccountId(accountId) };
        }
        if (creditCardId !== null && accountId === null) {
            return { kind: 'creditCard', creditCardId: CreditCardId(creditCardId), invoiceOffset: reader.nullableNumber('invoice_offset') ?? 0 };
        }
        throw new CorruptRowError('recurrences', `regra ${reader.text('id')} fora de exatamente uma origem`);
    }
}
