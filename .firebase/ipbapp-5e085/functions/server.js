const { onRequest } = require('firebase-functions/v2/https');
  const server = import('firebase-frameworks');
  exports.ssripbapp5e085 = onRequest({}, (req, res) => server.then(it => it.handle(req, res)));
  