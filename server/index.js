/**
 * Dev server API lokal (port 4500) — dipakai oleh `npm run dev`.
 *
 * Melayani /api/* lewat router inti yang SAMA PERSIS dengan Vercel
 * Function (api/[...path].js), sehingga perilaku lokal = produksi.
 * Vite mem-proxy /api ke server ini (lihat vite.config.js).
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nyalakan cermin media lokal SEBELUM modul lain dibaca env-nya.
process.env.XY_CERMIN_MEDIA = '1';
import { tanganiApi } from './core.js';
import { layaniCermin, cerminAktif } from './cermin.js';
import { json } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// muat .env sederhana (tanpa dependensi tambahan)
try {
  const envFile = path.resolve(__dirname, '../.env');
  const raw = readFileSync(envFile, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log('[xyverse-admin] .env dimuat');
} catch {}

const PORT = process.env.PORT || 4500;
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api')) return tanganiApi(req, res);
  if (layaniCermin(req, res)) return;

  json(res, 404, {
    error: 'Server dev ini hanya melayani /api/* dan /media/* — buka http://localhost:4400 untuk panel.',
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[xyverse-admin] API    : http://0.0.0.0:${PORT}`);
  console.log('[xyverse-admin] Panel  : http://localhost:4400');
  console.log(
    `[xyverse-admin] GitHub : ${
      process.env.GH_TOKEN
        ? `token aktif (${process.env.GH_OWNER || 'pemilik belum diisi'}/${process.env.GH_SITE_REPO || 'xyverse-web'})`
        : 'GH_TOKEN kosong — mode baca saja (repo publik tetap bisa dibaca)'
    }`,
  );
  console.log(
    `[xyverse-admin] Groq   : ${
      process.env.GROQ_API_KEY
        ? `aktif (${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'})`
        : 'nonaktif — atur GROQ_API_KEY di .env'
    }`,
  );
  console.log(
    `[xyverse-admin] Login  : pengguna "${process.env.ADMIN_USER || 'admin'}" · ${
      process.env.ADMIN_PASS_HASH ? 'hash terpasang' : 'BELUM ADA HASH — jalankan: npm run hash -- "katasandi"'
    }`,
  );
});
