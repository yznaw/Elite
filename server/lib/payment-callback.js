// SADAD's form POST is authenticated by its checksum, not by a browser origin
// or session CSRF token. Keep browser-policy exceptions confined to this route.
function isSadadCallback(req) {
  return req.method === 'POST'
    && /^\/api\/payments\/sadad\/callback\/?$/.test(req.path);
}

module.exports = { isSadadCallback };
