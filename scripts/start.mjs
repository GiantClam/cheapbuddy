import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, resolve, sep } from 'node:path';

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
const LONG_CACHE = 'public, max-age=31536000, immutable';

function isContentHashedAsset(filePath) {
  // Vite fingerprints build output as dist/assets/<name>-<hash>.<ext>.
  // Public files such as llms.txt stay outside assets/ and must not match.
  if (!filePath.split(sep).includes('assets')) return false;
  return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(filePath));
}

function cacheControlFor(filePath) {
  const extension = extname(filePath);
  // HTML picks the current bundle. llms.txt, robots.txt, and sitemap.xml are
  // unhashed and change on deploy, so they revalidate. Year-long immutable
  // caching is only for content-hashed files under assets/.
  if (extension === '.html' || extension === '.txt' || extension === '.xml') return 'no-cache';
  if (isContentHashedAsset(filePath)) return LONG_CACHE;
  return 'public, max-age=3600';
}

function isSpaDocumentRoute(pathname) {
  if (appPaths.has(pathname) || pathname === '/en' || pathname.startsWith('/en/')) return true;
  // /blog and /blog/{slug} are React routes. Extensioned misses such as /blog.js stay 404s.
  if (pathname === '/blog' || pathname === '/blog/') return true;
  return pathname.startsWith('/blog/') && extname(pathname) === '';
}

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

  const isModelLandingPath = requestedPath.startsWith('/model/') || requestedPath.startsWith('/en/model/');
  const isAppRoute = isSpaDocumentRoute(requestedPath);
  if (!servedPath && isModelLandingPath) {
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes['.html'],
    });
    createReadStream(resolve(root, '404.html')).on('error', () => response.destroy()).pipe(response);
    return;
  }
  if (!servedPath && isAppRoute) {
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

  response.writeHead(200, {
    'Cache-Control': cacheControlFor(servedPath),
    'Content-Type': mimeTypes[extname(servedPath)] || 'application/octet-stream',
  });
  createReadStream(servedPath).on('error', () => response.destroy()).pipe(response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`CheapBuddy static server listening on ${port}`);
});
