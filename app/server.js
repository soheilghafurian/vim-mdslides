'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { renderSlidesHtml } = require('./render');

const [, , sourcePath, portArg, assetsDirArg] = process.argv;
// 0 (the default) tells Node to bind an OS-assigned free port, so each
// mdslides instance (one per Vim buffer presenting at once) gets its own
// server without colliding on a shared fixed port.
const parsedPort = Number(portArg);
const port = Number.isNaN(parsedPort) ? 0 : parsedPort;
const assetsDir = assetsDirArg || path.dirname(sourcePath);

if (!sourcePath) {
  console.error('usage: node server.js <source-file> <port> [assets-dir]');
  process.exit(1);
}

const pageTemplate = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
const vendorDir = path.join(__dirname, 'vendor');

const mimeTypes = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** @type {Set<http.ServerResponse>} */
const sseClients = new Set();

function currentSlidesHtml() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  return renderSlidesHtml(source);
}

function broadcastUpdate() {
  let html;
  try {
    html = currentSlidesHtml();
  } catch (err) {
    console.error('mdslides: failed to render slides:', err.message);
    return;
  }
  const payload = `event: update\ndata: ${JSON.stringify({ html })}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

let debounceTimer = null;
function scheduleUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcastUpdate, 120);
}

fs.watch(sourcePath, { persistent: true }, () => scheduleUpdate());

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    let html;
    try {
      html = currentSlidesHtml();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`mdslides: failed to render source: ${err.message}`);
      return;
    }
    const page = pageTemplate.replace('__SLIDES__', html);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
    return;
  }

  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.url.startsWith('/vendor/')) {
    const rel = req.url.slice('/vendor/'.length).split('?')[0];
    const filePath = path.join(vendorDir, rel);
    if (!filePath.startsWith(vendorDir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Anything else is resolved relative to the markdown file's own
  // directory, so relative image links (![alt](images/foo.png)) work the
  // same way they do for any other markdown previewer.
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const filePath = path.join(assetsDir, rel);
  if (filePath.startsWith(assetsDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.on('error', (err) => {
  console.error(`mdslides: failed to start server: ${err.message}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  // The autoload/mdslides.vim side parses this exact line to learn which
  // port got bound (relevant when port is 0 / OS-assigned) before it opens
  // the browser -- keep the "listening on http://..." wording in sync with
  // the pattern matched there if either side changes.
  console.log(`mdslides server listening on http://127.0.0.1:${server.address().port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
