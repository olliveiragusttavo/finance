module.exports = {

    filter(collection, filters) {

        const filtersKeys = Object.keys(filters);

        return collection.filter((account) => {
            return !filtersKeys.map(key => account[key] === filters[key]).includes(false);
        });
    },

    findById(id, collection) {
        return collection.find(item => item.id === id);
    },

    get(filters, collection) {
        if (!filters) {
            return collection;
        }

        return this.filter(collection, filters);
    },

    lastId(collection) {
        if (collection.length && collection.length > 0) {
            return collection[collection.length - 1].id;
        }

        return 0;
    },

    update(id, data, collection) {
        return collection.map(item => {
            if (item.id === id) {
                return {
                    ...item,
                    ...data
                };
            }

            return item;
        });
    },

    delete(id, collection) {
        return collection.filter(account => account.id !== id);
    }

};
