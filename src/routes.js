const UserController = require("./controllers/UserController");

module.exports = [
    {
        endpoint: '/users',
        method: 'GET',
        handler: UserController.getUsers
    },
    {
        endpoint: '/users/:param',
        method: 'GET',
        handler: UserController.findById
    },
    {
        endpoint: '/users',
        method: 'POST',
        handler: UserController.create
    },
    {
        endpoint: '/users/:param',
        method: 'PUT',
        handler: UserController.update
    },
    {
        endpoint: '/users/:param',
        method: 'DELETE',
        handler: UserController.delete
    }
];
