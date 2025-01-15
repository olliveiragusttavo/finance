const AccountRepository = require('../repositories/AccountRepository');
const CreditCardRepository = require('../repositories/CreditCardRepository');

module.exports = {

    get(request, response) {
        const { bankId: accountId } = request.query;

        if (accountId) {
            const account = AccountRepository.get({ id: Number(accountId) });

            if (account) {
                return response.send(200, CreditCardRepository.get({ account_id: accountId }));
            }
        }

        return response.send(200, CreditCardRepository.get());
    },

    findById(request, response) {
        const creditCardId = Number(request.param[0]);

        const creditCard = CreditCardRepository.findById(creditCardId);

        if (!creditCard) {
            return response.send(404, { error: 'Credit card not found' });
        }

        return response.send(200, creditCard);
    },

    create(request, response) {
        const { accountId, closingDate, dueDate, limit, number } = request.body;

        if (!accountId || !closingDate || !dueDate || !limit || !number) {
            return response.send(400, { error: 'Form invalid' });
        }

        CreditCardRepository.create({ account_id: accountId, closing_date: closingDate, due_date: dueDate, limit, number });

        return response.send(201);
    },

    update(request, response) {
        const creditCardId = Number(request.params[0]);

        if (!creditCardId || isNaN(creditCardId)) {
            return response.send(400, { error: 'Param invalid' });
        }

        const { accountId, closingDate, dueDate, limit, number } = request.body;

        if (!accountId && !closingDate && !dueDate && !limit && !number) {
            return response.send(400, { error: 'Nothing to update' });
        }

        const creditCard = CreditCardRepository.findById(creditCardId);

        if (!creditCard) {
            return response.send(404, { error: 'Credit card not found' });
        }

        CreditCardRepository.update(creditCardId, {
            account_id: accountId ?? creditCard.account_id,
            closing_date: closingDate ?? creditCard.closing_date,
            due_date: dueDate ?? creditCard.due_date,
            limit: limit ?? creditCard.limit,
            number: number ?? creditCard.number
        });

        return response.send(200);
    },

    delete(request, response) {
        const creditCardId = Number(request.params[0]);

        if (!creditCardId || isNaN(creditCardId)) {
            return response.send(400, { error: 'Param invalid' });
        }

        const creditCard = CreditCardRepository.findById(creditCardId);

        if (!creditCard) {
            return response.send(404, { error: 'Credit card not found' });
        }

        CreditCardRepository.delete(creditCardId);

        return response.send(200);
    }

};
