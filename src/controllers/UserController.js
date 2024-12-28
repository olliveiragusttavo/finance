let users = require('../mocks/users');

module.exports = {

    getUsers(request, response) {

        const { order } = request.query;

        let sortedUsers = users;

        if (order === 'asc') {
            sortedUsers = users.sort((a, b) => {
                return a.name > b.name ? 1 : -1;
            })
        } else if (order === 'desc') {
            sortedUsers = users.sort((a, b) => {
                return a.name < b.name ? 1 : -1;
            });
        }

        response.send(200, sortedUsers);
    },

    findById(request, response) {
        const userId = request.params[0];

        const user = users.find((user) => user.id === Number(userId));

        if (!user) {
            return response.send(400, { error: 'user not found' });
        }

        response.send(200, user);
    },

    create(request, response) {
        const { name, email, age } = request.body;

        if (!name || !email || !age) {
            return response.send(400, { error: 'form invalid' });
        }

        users.push({
            id: (users[users.length - 1].id ?? 0) + 1,
            name: name,
            email: email,
            age: age,
        });

        response.send(201);
    },

    update(request, response) {
        const id = Number(request.params[0]);

        if (!id || !users.find(user => user.id === id)) {
            return response.send(400, { error: 'invalid user ID' });
        }

        const { name, email, age } = request.body;

        if (!name || !email || !age) {
            return response.send(400, { error: 'form invalid' });
        }

        users = users.map(user => user.id === id ? { ...user, name, email, age } : user);

        response.send(200);
    },

    delete(request, response) {
        const id = Number(request.params[0]);

        if (!id || !users.find(user => user.id === id)) {
            return response.send(400, { error: 'invalid user ID' });
        }

        users = users.filter(user => user.id !== id);

        response.send(200);
    }

};
