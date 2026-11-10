const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, 'site');
const SUPABASE = 'https://zbpcsfpyjdvonpfajwdb.supabase.co';

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  const isCrm = /^\/crm(?:\.html|\.js|\.css)?\/?$/.test(req.path);

  if (isCrm) {
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; connect-src ${SUPABASE}; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests`
    );
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
  } else {
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ${SUPABASE}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`
    );
  }
  next();
});

app.use(express.static(SITE_DIR, {
  dotfiles: 'ignore',
  etag: true,
  index: 'index.html',
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (/[/\\]crm(?:\.html|\.js|\.css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/crm', (_req, res) => res.redirect(301, '/crm.html'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LEADFLOW is listening on port ${PORT}`);
});
