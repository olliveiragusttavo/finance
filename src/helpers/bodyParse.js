module.exports = (request, callback) => {
    let body = '';

    // body is sended in chunks, we merge all data the server receive and then when it's end's we parse
    request.on('data', (chunk) => {
        body += chunk;
    });

    request.on('end', () => {
        // setting in request the parsed body
        request.body = JSON.parse(body);
        callback();
    });
};
