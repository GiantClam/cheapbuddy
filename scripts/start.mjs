import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

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
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

const appPaths = new Set(['/', '/api-docs', '/api-docs/', '/comfyui', '/comfyui/', '/hypit', '/hypit/', '/payment/result']);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname.startsWith('/api/')) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Sub2API API is not attached to this frontend service' }));
    return;
  }

  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const candidate = resolve(root, `.${requestedPath}`);
  const isInsideRoot = candidate === root || candidate.startsWith(`${root}${sep}`);
  const filePath = isInsideRoot
    ? candidate
    : null;
  let servedPath = null;

  if (filePath) {
    try {
      const fileInfo = await stat(filePath);
      servedPath = fileInfo.isFile() ? filePath : join(filePath, 'index.html');
      const servedInfo = await stat(servedPath);
      if (!servedInfo.isFile()) servedPath = null;
    } catch {
      servedPath = null;
    }
  }

  const isBlogPath = requestedPath === '/blog' || requestedPath.startsWith('/blog/');
  if (!servedPath && (appPaths.has(requestedPath) || isBlogPath)) {
    servedPath = resolve(root, 'index.html');
  }

  if (!servedPath) {
    const notFoundPath = resolve(root, '404.html');
    try {
      await stat(notFoundPath);
      servedPath = notFoundPath;
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes[extname(servedPath)] || 'text/html; charset=utf-8',
    });
    createReadStream(servedPath).on('error', () => response.destroy()).pipe(response);
    return;
  }

  const isHtmlDocument = extname(servedPath) === '.html';
  response.writeHead(200, {
    // The HTML shell selects the current hashed bundle, so it must always be
    // revalidated after a deploy. Only immutable asset files may be cached long-term.
    'Cache-Control': isHtmlDocument ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Type': mimeTypes[extname(servedPath)] || 'application/octet-stream',
  });
  createReadStream(servedPath).on('error', () => response.destroy()).pipe(response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`CheapBuddy static server listening on ${port}`);
});
