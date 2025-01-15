let users = require('../mocks/accounts');
const AccountRepository = require('../repositories/AccountRepository');

module.exports = {

    get(request, response) {
        response.send(200, AccountRepository.get());
    },

    findById(request, response) {
        const accountId = request.params[0];

        const account = AccountRepository.findById(accountId);

        if (!account) {
            return response.send(400, { error: 'Account not found' });
        }

        return response.send(200, account);
    },

    create(request, response) {
        const { name } = request.body;

        if (!name) {
            return response.send(400, { error: 'form invalid' });
        }

        AccountRepository.create({ name });

        return response.send(201);
    },

    update(request, response) {
        const id = Number(request.params[0]);

        if (!id) {
            return response.send(400, { error: 'invalid user ID' });
        }

        const account = AccountRepository.findById(id);

        if (!account) {
            return response.send(404, { error: 'Account not found' });
        }

        const { name } = request.body;

        if (!name) {
            return response.send(400, { error: 'form invalid' });
        }

        AccountRepository.update(id, { name });

        return response.send(200);
    },

    delete(request, response) {
        const id = Number(request.params[0]);

        if (!id) {
            return response.send(400, { error: 'invalid user ID' });
        }

        const account = AccountRepository.findById(id);

        if (!account) {
            return response.send(404, { error: 'Account not found' });
        }

        AccountRepository.delete(id);

        return response.send(200);
    }

};
