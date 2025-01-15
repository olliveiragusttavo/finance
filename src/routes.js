const AccountController = require("./controllers/AccountController");
const CreditCardController = require('./controllers/CreditCardController');

module.exports = [
    {
        endpoint: '/accounts',
        method: 'GET',
        handler: AccountController.get
    },
    {
        endpoint: '/accounts/:param',
        method: 'GET',
        handler: AccountController.findById
    },
    {
        endpoint: '/accounts',
        method: 'POST',
        handler: AccountController.create
    },
    {
        endpoint: '/accounts/:param',
        method: 'PUT',
        handler: AccountController.update
    },
    {
        endpoint: '/accounts/:param',
        method: 'DELETE',
        handler: AccountController.delete
    },
    {
        endpoint: '/credits_cards',
        method: 'GET',
        handler: CreditCardController.get
    },
    {
        endpoint: '/credits_cards/:param',
        method: 'GET',
        handler: CreditCardController.findById
    }
];
