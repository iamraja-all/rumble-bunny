import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { buildStaticIndex, createStaticHandler, mimeTypeFor } from './static-files.js';

/**
 * test_static_files_v1.js — the replacement for express.static must be provably safe.
 *
 * WHY THIS TEST IS NOT OPTIONAL:
 * dropping express for R06 moved the game's entire public HTTP surface into code this
 * project owns. That is only an improvement if the thing that replaced it cannot be
 * walked out of. R15 treats every external input as hostile, so the traversal cases
 * below are written as ATTACKS with a real secret file planted outside the web root —
 * if any of them can read it, the test fails loudly rather than reporting a 404 it
 * got for some incidental reason.
 *
 * The Rung-2 note: these run against a temporary directory built here rather than
 * against a real Vite build, so the suite has no dependency on `npm run build` having
 * been run. Same reason test_race_circuit_v1 derives its coordinates — a test that
 * needs a prior manual step is a test that silently stops running.
 *
 * INPUT:  a temp web root with a nested asset, and a secret planted one level above.
 * OUTPUT: known files serve with correct types; everything else 404s.
 * PASS:   every assertion green and exit code 0.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

// ── Fixture: a web root, and a secret OUTSIDE it ──────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-static-'));
const webRoot = path.join(tmp, 'public');
fs.mkdirSync(path.join(webRoot, 'assets'), { recursive: true });
fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>rb</title>');
fs.writeFileSync(path.join(webRoot, 'assets', 'main-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(webRoot, 'favicon.svg'), '<svg/>');
const SECRET = 'TOP_SECRET_LEDGER_KEY';
fs.writeFileSync(path.join(tmp, 'secret.txt'), SECRET);

// ── Test 1: the index only contains what is really in the build ───────────────
(() => {
  const index = buildStaticIndex(webRoot);
  assert(index.has('/index.html'), 'T1a: index.html is served at its own path');
  assert(index.has('/'), 'T1b: root resolves to index.html');
  assert(index.has('/assets/main-abc123.js'), 'T1c: nested assets are indexed');
  assert(index.has('/favicon.svg'), 'T1d: top-level assets are indexed');
  assert(!index.has('/secret.txt'), 'T1e: a file above the web root is NOT indexed');
  assert(!index.has('/assets'), 'T1f: directories themselves are not served');
})();

// ── Test 2: a missing web root is empty, not fatal ────────────────────────────
// This is the normal local-dev state. A throw here would mean the game server
// refuses to boot on a developer machine.
(() => {
  const index = buildStaticIndex(path.join(tmp, 'does-not-exist'));
  assert(index.size === 0, `T2: an absent web root yields an empty index (got ${index.size})`);
})();

// ── Test 3: MIME types ────────────────────────────────────────────────────────
(() => {
  assert(mimeTypeFor('a/b.js').startsWith('text/javascript'), 'T3a: .js is javascript');
  assert(mimeTypeFor('a/b.html').startsWith('text/html'), 'T3b: .html is html');
  assert(mimeTypeFor('x.wasm') === 'application/wasm', 'T3c: .wasm is wasm (draco needs this)');
  assert(mimeTypeFor('x.glb') === 'model/gltf-binary', 'T3d: .glb is a binary model');
  // Unknown must NOT be guessed. Serving an unknown blob as text/html is how an
  // uploaded file becomes stored XSS.
  assert(mimeTypeFor('x.weird') === 'application/octet-stream', 'T3e: unknown extensions fall back to octet-stream');
  assert(mimeTypeFor('X.JS').startsWith('text/javascript'), 'T3f: extension match is case-insensitive');
})();

// ── Tests 4-6: live over real HTTP ────────────────────────────────────────────
const server = createServer(createStaticHandler(webRoot));

function request(rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    // http.request would re-normalise `..` before it ever left the client, which
    // would test Node's URL parser instead of our handler. Writing the request line
    // onto the socket by hand is the only way to deliver a hostile path verbatim —
    // which is exactly what an attacker's curl does.
    const socket = new net.Socket();
    let raw = '';
    socket.connect(port, '127.0.0.1', () => {
      socket.write(`${method} ${rawPath} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (d) => { raw += d.toString(); });
    socket.on('end', () => {
      const status = Number(raw.slice(9, 12));
      const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
      resolve({ status, body, raw });
    });
    socket.on('error', reject);
  });
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

// Test 4: known files serve
{
  const root = await request('/');
  assert(root.status === 200, `T4a: / returns 200 (got ${root.status})`);
  assert(root.body.includes('<title>rb</title>'), 'T4b: / serves the index body');
  assert(root.raw.includes('no-cache'), 'T4c: the entry HTML is not cached, so a deploy is visible');

  const asset = await request('/assets/main-abc123.js');
  assert(asset.status === 200, `T4d: a nested asset returns 200 (got ${asset.status})`);
  assert(asset.body.includes('console.log(1)'), 'T4e: asset body is correct');
  assert(asset.raw.includes('immutable'), 'T4f: fingerprinted assets are cached hard');
  assert(asset.raw.includes('text/javascript'), 'T4g: asset carries a javascript Content-Type');

  const head = await request('/index.html', 'HEAD');
  assert(head.status === 200 && head.body === '', 'T4h: HEAD returns headers with no body');

  const post = await request('/', 'POST');
  assert(post.status === 405, `T4i: POST is rejected 405 (got ${post.status})`);
}

// Test 5: THE ATTACKS. Every one must fail to reach the planted secret.
{
  const attacks = [
    '/../secret.txt',
    '/../../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E%2Fsecret.txt',
    '/..%2fsecret.txt',
    '/....//secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/./../secret.txt',
    '//secret.txt',
    '/secret.txt',
    '/index.html/../../secret.txt',
  ];

  for (const attack of attacks) {
    const res = await request(attack);
    const leaked = res.body.includes(SECRET);
    assert(!leaked, `T5: traversal blocked — ${attack} (status ${res.status})`);
    // Not leaking is the security property; 404 is the CORRECT way to not leak.
    // Asserting the status too is what caught `//secret.txt` quietly answering 200
    // with index.html because the URL parser had read `secret.txt` as a hostname.
    assert(res.status === 404, `T5b: and it 404s rather than answering something — ${attack} (got ${res.status})`);
  }

  // A doubled slash must stay in the path, not become a host.
  const doubled = await request('//assets/main-abc123.js');
  assert(doubled.status === 404, `T5c: //assets/... is an unknown path, not a host (got ${doubled.status})`);
}

// Test 6: unknown paths 404 rather than erroring or hanging
{
  const missing = await request('/does/not/exist.js');
  assert(missing.status === 404, `T6a: unknown path 404s (got ${missing.status})`);
  const weird = await request('/%zz');
  assert(weird.status === 404, `T6b: a malformed escape 404s instead of throwing (got ${weird.status})`);
  // The server must still be alive after all of the above.
  const after = await request('/');
  assert(after.status === 200, 'T6c: server still serving after the whole attack set');
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);
