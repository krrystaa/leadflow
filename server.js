const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'site');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const PUBLIC_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https://zbpcsfpyjdvonpfajwdb.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const CRM_CSP = "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; connect-src https://zbpcsfpyjdvonpfajwdb.supabase.co; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests";

function applyHeaders(res, pathname) {
  const isCrm = /^\/crm(?:\.html|\.js|\.css)?\/?$/.test(pathname);
  res.setHeader('Content-Security-Policy', isCrm ? CRM_CSP : PUBLIC_CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', isCrm ? 'no-referrer' : 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

  if (isCrm) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
  }
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }
  if (pathname === '/crm') {
    res.writeHead(301, { Location: '/crm.html' });
    return res.end();
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      applyHeaders(res, pathname);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    applyHeaders(res, pathname);
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    if (!/^\/crm(?:\.html|\.js|\.css)?\/?$/.test(pathname)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    if (req.method === 'HEAD') {
      res.writeHead(200);
      return res.end();
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end('Method Not Allowed');
    }
    res.writeHead(200);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LEADFLOW listening on port ${PORT}`);
});
