import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname.startsWith('/api/')) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Sub2API API is not attached to this frontend service' }));
    return;
  }

  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const candidate = resolve(root, `.${requestedPath}`);
  const filePath = candidate === root || candidate.startsWith(`${root}${sep}`)
    ? candidate
    : resolve(root, 'index.html');
  let servedPath = filePath;

  try {
    const fileInfo = await stat(servedPath);
    if (!fileInfo.isFile()) servedPath = resolve(root, 'index.html');
  } catch {
    servedPath = resolve(root, 'index.html');
  }

  response.writeHead(200, {
    'Cache-Control': extname(servedPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Type': mimeTypes[extname(servedPath)] || 'application/octet-stream',
  });
  createReadStream(servedPath).on('error', () => response.destroy()).pipe(response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`CheapBuddy static server listening on ${port}`);
});
