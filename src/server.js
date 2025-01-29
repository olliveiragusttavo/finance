const http = require('http');
const { URL } = require('url');

const serverConstants = require('./constants/server');

const routes = require('./routes');
const bodyParse = require('./helpers/bodyParse');

module.exports = {

    __port: null,
    __server: null,

    createServer(port) {
        this.__port = port ?? serverConstants.defaultPort;
        this.__server = http.createServer((request, response) => this._handleRequest(request, response));
        this.__server.listen(port, console.log('Server is running on port 3000'));
        return this;
    },

    _handleRequest(request, response) {
        // set helper in response
        this.__setResponseSender(response);

        // get router handle by url
        const route = this.__getRoute(request);
        // if don't exists justo send back bad request
        if (!route) {
            return response.send(400, { error: 'bad request' });
        }

        // validate if request is a post or put method, in this case make body parse and execute de callback handle
        // if don't, just execute de callback handle
        this.__handleRequest(request, () => {
            return route.handler(request, response);
        });
    },

    __getRoute(request) {
        const parsedURL = new URL(`http://localhost:${this.__port}${request.url}`);

        // first try: dynamic path params for numbers
        // but is this case it not works when the param is not a number and it's not put the param name in request.params
        const pathSplit = parsedURL.pathname.split('/').filter(Boolean);
        // get only texts in url and replace numbers with ':param'
        const pathname = "/" + pathSplit.map((pathItem) => !isNaN(Number(pathItem)) ? ':param' : pathItem).join('/');

        // set in request the params and queries
        request.params = pathSplit.filter((pathItem) => !isNaN(Number(pathItem)));
        request.query = Object.fromEntries(parsedURL.searchParams);

        // search route
        return routes.find((routeObj) => {
            return routeObj.method === request.method && routeObj.endpoint === pathname;
        });
    },

    __setResponseSender(response) {
        // set helper to return response
        response.send = (statusCode, body) => {
            response.writeHead(statusCode, { 'content-type': 'application/json' });
            response.end(JSON.stringify(body));
        };
    },

    __handleRequest(request, handle) {
        if (['POST', 'PUT'].includes(request.method)) {
            bodyParse(request, handle);
        }

        handle();
    }

};
