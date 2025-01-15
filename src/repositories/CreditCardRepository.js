let creditCards = require("../mocks/creditCards");
const Repository = require("./Repository");

module.exports = {

    findById(id) {
        return Repository.findById(id, creditCards);
    },

    get(filters) {
        return Repository.get(filters, creditCards);
    },

    create(creditCard) {
        creditCards.push({ id: Repository.lastId(creditCards), ...creditCard });
    },

    update(id, data) {
        creditCards = Repository.update(id, data, creditCards);
    },

    delete(id) {
        creditCards = Repository.delete(id, creditCards);
    }

};
