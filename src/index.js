const http = require('http');
const { URL } = require('url');

const routes = require('./routes');
const bodyParse = require('./helpers/bodyParse');

const server = http.createServer((request, response) => {

    const parsedURL = new URL(`http://localhost:3000${request.url}`);

    // first try: dynamic path params for numbers
    // but is this case it not works when the param is not a number and it's not put the param name in request.params
    const pathSplit = parsedURL.pathname.split('/').filter(Boolean);
    // get only texts in url and replace numbers with ':param'
    const pathname = "/" + pathSplit.map((pathItem) => !isNaN(Number(pathItem)) ? ':param' : pathItem).join('/');

    // set in request the params and queries
    request.params = pathSplit.filter((pathItem) => !isNaN(Number(pathItem)));
    request.query = Object.fromEntries(parsedURL.searchParams);

    // set helper to return response
    response.send = (statusCode, body) => {
        response.writeHead(statusCode, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
    };

    // search route
    const route = routes.find((routeObj) => {
        return routeObj.method === request.method && routeObj.endpoint === pathname;
    });

    if (!route) {
        return response.send(400, { error: 'bad request' });
    }

    if (['POST', 'PUT'].includes(request.method)) {
        return bodyParse(request, () => {
            return route.handler(request, response);
        });
    }

    return route.handler(request, response);
});

server.listen(3000, console.log('Server is running on port 3000'));
