import { InvoiceController } from '../controllers/InvoiceController.ts';
import type { CoreResult, UnexpectedErrorListener } from '../controllers/CoreResult.ts';
import type { CoreApi, CoreRoute, RouteHandlers } from '../controllers/routes.ts';
import { StatementController } from '../controllers/StatementController.ts';
import { TransactionController } from '../controllers/TransactionController.ts';
import { embeddedMigrations } from '../infrastructure/migrations/embedded.generated.ts';
import type { Migration } from '../infrastructure/migrations/Migration.ts';
import { MigrationRunner, type MigrationReport } from '../infrastructure/migrations/MigrationRunner.ts';
import { configureConnection } from '../infrastructure/sqlite/connection.ts';
import { SqliteAccountRepository } from '../infrastructure/sqlite/SqliteAccountRepository.ts';
import { SqliteBalanceLedgerRepository } from '../infrastructure/sqlite/SqliteBalanceLedgerRepository.ts';
import { SqliteBankStatementRepository } from '../infrastructure/sqlite/SqliteBankStatementRepository.ts';
import { SqliteCreditCardRepository } from '../infrastructure/sqlite/SqliteCreditCardRepository.ts';
import { SqliteInvoiceRepository } from '../infrastructure/sqlite/SqliteInvoiceRepository.ts';
import { SqliteProfileRepository } from '../infrastructure/sqlite/SqliteProfileRepository.ts';
import { SqliteReferenceRepository } from '../infrastructure/sqlite/SqliteReferenceRepository.ts';
import { SqliteTransactionRepository } from '../infrastructure/sqlite/SqliteTransactionRepository.ts';
import type { Clock } from '../ports/Clock.ts';
import type { Database } from '../ports/Database.ts';
import type { IdGenerator } from '../ports/IdGenerator.ts';
import { AccountBalanceService } from '../services/balance/AccountBalanceService.ts';
import { BalanceRecalculationService } from '../services/balance/BalanceRecalculationService.ts';
import { ImpactCalculator } from '../services/balance/ImpactCalculator.ts';
import { InvoiceService } from '../services/invoice/InvoiceService.ts';
import { StatementConsolidationService } from '../services/statement/StatementConsolidationService.ts';
import { TransactionService } from '../services/transaction/TransactionService.ts';
import { UnitOfWork } from '../services/UnitOfWork.ts';

/** Adaptadores que cada plataforma fornece ao núcleo (backend-design §3.4). */
export interface CorePorts {
    readonly database: Database;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    /** Log de falhas inesperadas; o padrão descarta, para quem não tem onde registrar. */
    readonly onUnexpectedError?: UnexpectedErrorListener;
}

/** Os Services montados, para quem compõe casos de uso no próprio processo (testes, jobs). */
export interface CoreServices {
    readonly transactions: TransactionService;
    readonly consolidation: StatementConsolidationService;
    readonly invoices: InvoiceService;
    readonly balances: AccountBalanceService;
    readonly recalculation: BalanceRecalculationService;
}

/** O núcleo montado. */
export interface Core extends CoreApi {
    readonly services: CoreServices;
}

/**
 * Prepara o banco para uso: configuração obrigatória da conexão e migrations pendentes,
 * nessa ordem (backend-design §4.5, passos 1 a 4). Fica separado de `createCore` porque
 * pode falhar de formas que a plataforma trata antes de existir UI — banco mais novo que o
 * app, migration que falhou.
 *
 * @param database Conexão recém-aberta pelo adaptador da plataforma.
 * @param migrations Migrations embutidas; parametrizável só para testar o runner.
 * @return O relatório das migrations aplicadas.
 * @throws {SchemaNewerThanAppError} Quando o banco é mais novo que o app.
 */
export function openDatabase(database: Database, migrations: readonly Migration[] = embeddedMigrations): MigrationReport {
    configureConnection(database);
    return new MigrationRunner(database, migrations).migrate();
}

/**
 * Raiz de composição do núcleo: o único lugar que conhece as implementações concretas.
 * Services e Controllers dependem de interfaces de Repository e de portas, e só aqui elas
 * são ligadas ao SQLite e aos adaptadores da plataforma — trocar o driver é trocar a
 * `Database` injetada, sem tocar em regra (database-design §3.3).
 *
 * @param ports Adaptadores da plataforma; o banco já precisa ter passado por `openDatabase`.
 * @return O núcleo com o despacho de rotas e os Services.
 */
export function createCore(ports: CorePorts): Core {
    const { database, clock, ids } = ports;
    const onUnexpected = ports.onUnexpectedError ?? ((): void => undefined);
    const unitOfWork = new UnitOfWork(database);

    const profiles = new SqliteProfileRepository(database);
    const accounts = new SqliteAccountRepository(database, clock);
    const creditCards = new SqliteCreditCardRepository(database);
    const statements = new SqliteBankStatementRepository(database, clock);
    const invoices = new SqliteInvoiceRepository(database, clock);
    const transactions = new SqliteTransactionRepository(database, clock);
    const references = new SqliteReferenceRepository(database);
    const ledger = new SqliteBalanceLedgerRepository(database);

    const recalculation = new BalanceRecalculationService(unitOfWork, accounts, statements, invoices, ledger, clock);
    const impacts = new ImpactCalculator(invoices, creditCards);
    const consolidation = new StatementConsolidationService(unitOfWork, accounts, statements, invoices, transactions);
    const invoiceService = new InvoiceService(unitOfWork, creditCards, accounts, invoices, transactions, consolidation, impacts, recalculation);
    const transactionService = new TransactionService(
        unitOfWork, ids, profiles, accounts, creditCards, transactions, references, consolidation, invoiceService, impacts, recalculation,
    );
    const balances = new AccountBalanceService(unitOfWork, profiles, accounts, recalculation);

    const transactionController = new TransactionController(transactionService, onUnexpected);
    const statementController = new StatementController(consolidation, balances, onUnexpected);
    const invoiceController = new InvoiceController(invoiceService, onUnexpected);

    const handlers: RouteHandlers = {
        'transactions.create': (raw) => transactionController.create(raw),
        'transactions.update': (raw) => transactionController.update(raw),
        'transactions.delete': (raw) => transactionController.delete(raw),
        'transactions.get': (raw) => transactionController.get(raw),
        'transactions.listByPeriod': (raw) => transactionController.listByPeriod(raw),
        'statements.get': (raw) => statementController.getStatement(raw),
        'balances.ofProfile': (raw) => statementController.profileBalances(raw),
        'balances.rebuildAccount': (raw) => statementController.rebuildAccount(raw),
        'invoices.suggest': (raw) => invoiceController.suggest(raw),
        'invoices.get': (raw) => invoiceController.get(raw),
        'invoices.pay': (raw) => invoiceController.pay(raw),
        'invoices.reopen': (raw) => invoiceController.reopen(raw),
    };

    return {
        services: { transactions: transactionService, consolidation, invoices: invoiceService, balances, recalculation },
        call: (route, input) => handlers[route](input),
        dispatch: (route, input): Promise<CoreResult<unknown>> => {
            if (!isRoute(route, handlers)) {
                return Promise.resolve({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Rota desconhecida', details: { field: 'route', reason: route } } });
            }
            return handlers[route](input);
        },
    };
}

/**
 * @param route Nome recebido do transporte.
 * @param handlers Tabela de rotas conhecidas.
 * @return `true` quando o nome é uma rota do mapa; estreita o tipo para indexar a tabela
 * sem cast.
 */
function isRoute(route: string, handlers: RouteHandlers): route is CoreRoute {
    return Object.hasOwn(handlers, route);
}
