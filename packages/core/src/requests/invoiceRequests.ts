import { z } from 'zod';
import { CreditCardId, InvoiceId } from '../domain/shared/ids.ts';
import { localDateField, parsedText } from './fields.ts';

export const suggestInvoiceRequest = z.strictObject({ creditCardId: parsedText(CreditCardId), purchaseDate: localDateField });

export const invoiceIdRequest = z.strictObject({ invoiceId: parsedText(InvoiceId) });

export const payInvoiceRequest = z.strictObject({ invoiceId: parsedText(InvoiceId), paymentDate: localDateField });
