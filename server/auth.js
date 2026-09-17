/**
 * Autentikasi admin Xyverse.
 *
 * - Nama pengguna + kata sandi, hash bcrypt disimpan di lingkungan (ADMIN_PASS_HASH)
 * - Sesi berbasis cookie httpOnly bertanda tangan HMAC, tanpa penyimpanan server
 *   (cocok untuk serverless: cookie stateless, valid lintas instans)
 * - Verifikasi Cloudflare Turnstile pada endpoint login
 * - Pembatasan laju percobaan login per alamat IP
 *   (catatan serverless: memory per instans — tetap memperlambat brute force,
 *    ditambah proteksi Turnstile sebagai lapis utama)
 *
 * Buat hash kata sandi:  npm run hash -- "katasandiku"
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { json } from './http.js';
import { verifikasiKunci, dibatasi, catatPakai } from './kunci.js';

const NAMA_COOKIE = 'xy_adm';
const UMUR_SESI = 1000 * 60 * 60 * 12; // 12 jam

/* ---------- utilitas cookie ---------- */
function baca(req) {
  const out = {};
  for (const bagian of (req.headers.cookie || '').split(';')) {
    const i = bagian.indexOf('=');
    if (i > 0) out[bagian.slice(0, i).trim()] = decodeURIComponent(bagian.slice(i + 1).trim());
  }
  return out;
}

function pasang(res, nilai, maxAgeMs) {
  const bagian = [
    `${NAMA_COOKIE}=${encodeURIComponent(nilai)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (process.env.NODE_ENV === 'production') bagian.push('Secure');
  res.setHeader('Set-Cookie', bagian.join('; '));
}

function hapus(res) {
  res.setHeader('Set-Cookie', `${NAMA_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------- token sesi bertanda tangan ---------- */
function rahasia() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // fallback acak per proses: di serverless sesi hangus tiap cold start,
  // jadi SESSION_SECRET HARUS diisi di lingkungan deployment.
  if (!globalThis.__xySesiRahasia) {
    globalThis.__xySesiRahasia = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] SESSION_SECRET belum diatur — memakai rahasia sementara. Sesi hangus tiap instans baru.');
  }
  return globalThis.__xySesiRahasia;
}

function tandatangani(muatan) {
  const data = Buffer.from(JSON.stringify(muatan)).toString('base64url');
  const tanda = crypto.createHmac('sha256', rahasia()).update(data).digest('base64url');
  return `${data}.${tanda}`;
}

function periksa(token) {
  if (!token || !token.includes('.')) return null;
  const [data, tanda] = token.split('.');
  const harap = crypto.createHmac('sha256', rahasia()).update(data).digest('base64url');
  // perbandingan waktu tetap
  const a = Buffer.from(tanda);
  const b = Buffer.from(harap);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const m = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!m.exp || Date.now() > m.exp) return null;
    return m;
  } catch {
    return null;
  }
}

/* ---------- pembatasan laju ---------- */
const percobaan = new Map(); // ip -> { n, sampai }
const MAKS = 6;
const JEDA = 1000 * 60 * 10; // 10 menit

export function ipDari(req) {
  return (req.headers['cf-connecting-ip'] ||
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'tak-dikenal');
}

function terkunci(ip) {
  const c = percobaan.get(ip);
  if (!c) return 0;
  if (Date.now() > c.sampai) {
    percobaan.delete(ip);
    return 0;
  }
  return c.n >= MAKS ? Math.ceil((c.sampai - Date.now()) / 1000) : 0;
}

function catatGagal(ip) {
  const c = percobaan.get(ip) || { n: 0, sampai: Date.now() + JEDA };
  c.n += 1;
  c.sampai = Date.now() + JEDA;
  percobaan.set(ip, c);
}

/* ---------- Cloudflare Turnstile ---------- */
export function turnstileAktif() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
}

async function verifikasiTurnstile(token, ip) {
  if (!turnstileAktif()) {
    // Mode pengembangan: kunci belum diisi, lewati verifikasi.
    return { ok: true, lewati: true };
  }
  if (!token) return { ok: false, pesan: 'Verifikasi Turnstile belum selesai.' };
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
    });
    const j = await r.json();
    if (j.success) return { ok: true };
    return { ok: false, pesan: 'Verifikasi Turnstile gagal. Muat ulang halaman dan coba lagi.' };
  } catch {
    return { ok: false, pesan: 'Tidak dapat menghubungi Cloudflare Turnstile.' };
  }
}

/* ---------- middleware ---------- */

/**
 * Gerbang semua rute /api/* yang bukan endpoint autentikasi terbuka.
 *
 * Dua jalan masuk, setara haknya:
 *   1. Cookie sesi hasil login peramban (bcrypt + Turnstile).
 *   2. Kunci API di header `Authorization: Bearer xya_...` atau `X-Api-Key`.
 *
 * Yang membedakan keduanya cuma satu hal: mengelola kunci API (buat/cabut)
 * hanya boleh lewat cookie. Lihat `wajibSesi` di core.js.
 */
export async function wajibMasuk(req, res, next) {
  const sesi = periksa(baca(req)[NAMA_COOKIE]);
  if (sesi) {
    req.admin = { jenis: 'sesi', pengguna: sesi.u, id: `sesi:${sesi.u}` };
    return next();
  }

  const api = await verifikasiKunci(req);
  if (api) {
    const tunggu = dibatasi(api);
    if (tunggu) {
      return json(res, 429, {
        error: `Batas laju kunci API tercapai. Coba lagi dalam ${tunggu} detik.`,
        kode: 'RATE',
      });
    }
    catatPakai(api);
    req.admin = api;
    return next();
  }

  json(res, 401, {
    error: 'Belum masuk',
    kode: 'AUTH',
    petunjuk: 'Masuk lewat panel, atau kirim header Authorization: Bearer xya_...',
  });
}

/* ---------- rute ---------- */
// Catatan: env dibaca di dalam handler (lazy), karena .env lokal dimuat
// setelah modul diimpor — di Vercel env memang sudah ada sejak awal.
export function pasangAuth(r) {
  r.jalan('GET', '/api/auth/konfig', (_req, res) => {
    json(res, 200, {
      turnstile: turnstileAktif(),
      siteKey: process.env.TURNSTILE_SITE_KEY || '',
      siapPakai: Boolean(process.env.ADMIN_PASS_HASH),
    });
  });

  r.jalan('GET', '/api/auth/saya', (req, res) => {
    const sesi = periksa(baca(req)[NAMA_COOKIE]);
    if (!sesi) return json(res, 401, { masuk: false });
    json(res, 200, { masuk: true, pengguna: sesi.u, kedaluwarsa: sesi.exp });
  });

  r.jalan('POST', '/api/auth/masuk', async (req, res) => {
    const PENGGUNA = process.env.ADMIN_USER || 'admin';
    const HASH = process.env.ADMIN_PASS_HASH || '';
    const ip = ipDari(req);

    const sisa = terkunci(ip);
    if (sisa) {
      return json(res, 429, {
        error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(sisa / 60)} menit.`,
      });
    }

    if (!HASH) {
      return json(res, 500, {
        error: 'ADMIN_PASS_HASH belum diatur. Jalankan: npm run hash -- "katasandi"',
      });
    }

    const { pengguna = '', sandi = '', turnstile = '' } = req.body || {};

    const ts = await verifikasiTurnstile(turnstile, ip);
    if (!ts.ok) {
      catatGagal(ip);
      return json(res, 400, { error: ts.pesan });
    }

    const namaCocok = crypto.timingSafeEqual(
      Buffer.from(String(pengguna).padEnd(64).slice(0, 64)),
      Buffer.from(String(PENGGUNA).padEnd(64).slice(0, 64)),
    );
    const sandiCocok = await bcrypt.compare(String(sandi), HASH);

    if (!namaCocok || !sandiCocok) {
      catatGagal(ip);
      const c = percobaan.get(ip);
      const tersisa = Math.max(0, MAKS - (c?.n ?? 0));
      return json(res, 401, {
        error: 'Nama pengguna atau kata sandi salah.',
        tersisa,
      });
    }

    percobaan.delete(ip);
    const exp = Date.now() + UMUR_SESI;
    pasang(res, tandatangani({ u: PENGGUNA, exp }), UMUR_SESI);
    json(res, 200, { ok: true, pengguna: PENGGUNA, kedaluwarsa: exp });
  });

  r.jalan('POST', '/api/auth/keluar', (_req, res) => {
    hapus(res);
    json(res, 200, { ok: true });
  });
}
