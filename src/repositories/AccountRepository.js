let accounts = require('../mocks/accounts');
const Repository = require('./Repository');

module.exports = {

    findById(id) {
        return Repository.findById(id, accounts);
    },

    get(filters) {
        return Repository.get(filters, accounts);
    },

    create(account) {
        accounts.push({ id: Repository.lastId(accounts), ...account });
    },

    update(id, data) {
        accounts = Repository.update(id, data, accounts);
    },

    delete(id) {
        accounts = Repository.delete(id, accounts);
    }

}
