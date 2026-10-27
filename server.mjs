import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405); response.end(); return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep) || !types[extname(path)] || pathname.includes('\\')) {
      response.writeHead(404); response.end('Não encontrado'); return;
    }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'hid=(self)',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Não encontrado'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Vibetar editor: http://localhost:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
