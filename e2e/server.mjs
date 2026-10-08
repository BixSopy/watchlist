/* Mini serveur de test : sert les fichiers du site comme Vercel (liste blanche .vercelignore,
   en-têtes de vercel.json dont la CSP, cleanUrls) et simule les fonctions /api.
   La CSP est appliquée telle quelle (sauf upgrade-insecure-requests, inutile en http local). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const ALLOWED = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l.startsWith('!')).map(l => l.slice(1));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function headersFor(urlPath) {
  const out = {};
  for (const rule of vercel.headers) {
    const re = new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '(.*)') + '$');
    if (re.test(urlPath)) for (const h of rule.headers) out[h.key] = h.value;
  }
  if (out['Content-Security-Policy']) out['Content-Security-Policy'] = out['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  delete out['Strict-Transport-Security'];
  return out;
}

export function startServer({ config = { turnstileSiteKey: '', signupsOpen: true } } = {}) {
  const state = { config, apiCalls: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(u.pathname);
    const send = (status, body, type, extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...headersFor(u.pathname), ...extra });
      res.end(body);
    };
    if (p.startsWith('/api/')) {
      state.apiCalls.push({ path: p, auth: req.headers.authorization || '' });
      if (p === '/api/config') return send(200, JSON.stringify(state.config), 'application/json');
      if (!req.headers.authorization) return send(401, JSON.stringify({ error: 'unauthorized' }), 'application/json');
      return send(200, JSON.stringify({ results: [], page: 1, total_pages: 1, total_results: 0 }), 'application/json');
    }
    if (p === '/') p = '/index.html';
    if (vercel.cleanUrls && !path.extname(p)) p += '.html';
    const top = p.split('/')[1];
    if (!ALLOWED.includes(top)) return send(404, 'Not found', 'text/plain');
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'Not found', 'text/plain');
    send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    state.url = 'http://127.0.0.1:' + server.address().port;
    state.close = () => new Promise(r => server.close(r));
    resolve(state);
  }));
}
