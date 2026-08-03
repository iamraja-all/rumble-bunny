import fs from 'node:fs';
import path from 'node:path';

/**
 * static-files.js — serve the built client from stdlib `node:http`, with no
 * dependency and no user-controlled filesystem path.
 *
 * WHY THIS EXISTS (R06):
 * `express` was in this project for exactly one line — `express.static(publicDir)` —
 * while `node:http` was already imported two lines above it. R06 permits an external
 * dependency only when it is absolutely unavoidable, and a dependency carrying a
 * whole HTTP framework to serve a fixed folder of files is not that.
 *
 * WHY A WHITELIST AND NOT A SANITISER (R15):
 * the obvious hand-rolled static server does `path.join(root, req.url)` and then
 * tries to prove the result stayed inside `root`. That is the single most reliably
 * got-wrong check in web servers — every encoding trick, `..%2f`, unicode
 * normalisation and symlink is an attempt on it. So this module never concatenates a
 * request into a path at all. It walks the build output ONCE at boot and records the
 * exact set of URLs that exist; a request is a Map lookup that either hits a known
 * file or 404s. Traversal is not filtered, it is unrepresentable — the same reasoning
 * ADR-0008 used when it chose to STRIP delimiters rather than escape them, and R15's
 * "write the quarantine layer before the parsing logic" applied to a filesystem.
 *
 * A fixed client bundle is what makes this cheap: there is no user content to serve,
 * no directory listing anyone wants, and no client-side router needing a catch-all.
 *
 * Big-O: O(F) once at boot over F build files; O(1) per request.
 */

// Extensions the built client actually ships. Anything absent is served as
// octet-stream rather than guessed at — a wrong Content-Type on a script is a
// silently broken page, and on an unknown type it is a security question.
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
});

export function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Walk the build output and return Map<urlPath, absoluteFilePath>.
 *
 * Returns an EMPTY map when the directory is absent, which is the normal local-dev
 * case (Vite serves the client on :5173 and nothing is built into ../public). An
 * empty map means every asset request 404s, exactly as the old express.static did,
 * rather than crashing a server whose real job is the WebSocket game loop.
 */
export function buildStaticIndex(rootDir) {
  const index = new Map();
  if (!fs.existsSync(rootDir)) {
    return index;
  }

  const walk = (dir, urlPrefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const urlPath = `${urlPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(absolute, urlPath);
      } else if (entry.isFile()) {
        index.set(urlPath, absolute);
        // `/` and `/sub/` resolve to the index.html of that directory, the one
        // convention a browser genuinely requires.
        if (entry.name === 'index.html') {
          index.set(`${urlPrefix}/`, absolute);
          if (urlPrefix === '') index.set('/', absolute);
        }
      }
      // Symlinks are deliberately neither followed nor indexed: a link inside the
      // build output is the one way a whitelist could still point outside it.
    }
  };

  walk(rootDir, '');
  return index;
}

/**
 * Create the `node:http` request handler.
 *
 * The WebSocket upgrade is untouched — `ws` attaches to the same server and handles
 * `upgrade` events, which never reach a request listener.
 */
export function createStaticHandler(rootDir) {
  const index = buildStaticIndex(rootDir);

  return function handleRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    // Take the path only. A query string or fragment is not part of a file's
    // identity, and `URL` does the decoding once, correctly, instead of us
    // hand-rolling percent-decoding. A malformed URL is simply not in the map.
    //
    // WHY CONCATENATED AND NOT `new URL(req.url, base)`: the two-argument form
    // performs RELATIVE RESOLUTION, so a request line beginning `//` is read as a
    // protocol-relative URL — `//secret.txt` parsed as host `secret.txt` with path
    // `/`, and the server answered 200 with index.html. It leaked nothing, but a
    // request path had been allowed to become a hostname, and anything that turns
    // one part of a URL into another is the beginning of a bypass. Concatenating
    // forces the whole of req.url to stay in the path component, so `//secret.txt`
    // is just an unknown key and 404s. Caught by reading test T5's status, not its
    // pass/fail — it was green for the wrong reason.
    let urlPath;
    try {
      urlPath = new URL(`http://localhost${req.url}`).pathname;
    } catch {
      urlPath = '';
    }

    const filePath = index.get(urlPath);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypeFor(filePath),
      // Vite fingerprints its assets, so the bundle is safe to cache hard; the
      // entry HTML must not be, or a deploy never reaches anyone.
      'Cache-Control': urlPath.endsWith('.html') || urlPath.endsWith('/')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    // Streamed rather than read whole: the client ships multi-megabyte wasm and
    // model files, and this process is also running a 60Hz simulation on the same
    // thread — a synchronous read would stall the game loop for every request (R07).
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      // The file was indexed at boot and has gone since. Nothing to recover, but the
      // game server must not die because someone deleted an asset.
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  };
}
