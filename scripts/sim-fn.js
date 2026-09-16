// Simulasi Vercel Function: jalankan handler dari api/[...path].js
// persis seperti Vercel (Node runtime, req/res mentah).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler, { config } from '../api/[...path].js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('function config =', JSON.stringify(config));

// muat .env (satu-satunya bedanya vs Vercel: di Vercel env sudah terpasang)
try {
  const raw = readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

http.createServer((req, res) => handler(req, res)).listen(4600, '0.0.0.0', () => {
  console.log('function simulator : http://127.0.0.1:4600');
});
