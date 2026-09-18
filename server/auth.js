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
import * as db from './database.js';
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

async function sesiAktif(req) {
  const s = periksa(baca(req)[NAMA_COOKIE]);
  if (!s || !db.configured()) return s;
  if (!s.uid) return null;
  const u = await db.userById(s.uid);
  if (!u?.enabled || u.version !== s.ver) return null;
  return { ...s, u: u.username, peran: u.role, wajibGanti: !!u.must_change };
}

/* ---------- pembatasan laju ---------- */
const percobaan = new Map(); // ip -> { n, sampai }
const MAKS = 6;
const JEDA = 1000 * 60 * 10; // 10 menit

export function ipDari(req) {
  return (req.headers['x-vercel-forwarded-for'] ||
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
  const sesi = await sesiAktif(req);
  if (sesi) {
    req.admin = { jenis: 'sesi', pengguna: sesi.u, id: sesi.uid || `sesi:${sesi.u}`, peran: sesi.peran || 'owner', wajibGanti: !!sesi.wajibGanti };
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
  r.jalan('GET', '/api/auth/konfig', async (_req, res) => {
    json(res, 200, {
      turnstile: turnstileAktif(),
      siteKey: process.env.TURNSTILE_SITE_KEY || '',
      siapPakai: db.configured() ? Boolean((await db.userById('owner'))?.enabled) : Boolean(process.env.ADMIN_PASS_HASH),
      xyteam: db.configured(),
    });
  });

  r.jalan('GET', '/api/auth/saya', async (req, res) => {
    const sesi = await sesiAktif(req);
    if (!sesi) return json(res, 401, { masuk: false });
    json(res, 200, { masuk: true, pengguna: sesi.u, peran: sesi.peran || 'owner', wajibGanti: !!sesi.wajibGanti, id: sesi.uid || 'owner', kedaluwarsa: sesi.exp });
  });

  r.jalan('POST', '/api/auth/masuk', async (req, res) => {
    const PENGGUNA = process.env.ADMIN_USER || 'admin';
    const HASH = process.env.ADMIN_PASS_HASH || '';
    const ip = ipDari(req);

    if (await db.rateLimit('login', ip, 15, 10 * 60 * 1000)) return json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' });
    const sisa = terkunci(ip);
    if (sisa) {
      return json(res, 429, {
        error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(sisa / 60)} menit.`,
      });
    }

    if (!HASH && !db.configured()) {
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

    const akun = db.configured() ? await db.userByName(String(pengguna).trim().toLowerCase()) : null;
    const namaCocok = db.configured() ? !!akun?.enabled : String(pengguna) === PENGGUNA;
    const dummyHash = '$2a$12$KsAOgAqRQx51XJnWqsFtDu/gvj0iEddMzGBTSHDABapUAolZoZm6C';
    const sandiCocok = await bcrypt.compare(String(sandi), db.configured() ? (akun?.pass_hash || dummyHash) : HASH);

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
    const muatan = { u: akun?.username || PENGGUNA, exp, ...(akun ? { uid: akun.id, ver: akun.version } : {}) };
    await db.audit(muatan.u, 'login');
    pasang(res, tandatangani(muatan), UMUR_SESI);
    json(res, 200, { ok: true, pengguna: muatan.u, id: akun?.id || 'owner', peran: akun?.role || 'owner', wajibGanti: !!akun?.must_change, kedaluwarsa: exp });
  });

  r.jalan('POST', '/api/auth/password', async (req, res) => {
    if (req.admin?.jenis !== 'sesi' || !db.configured()) return json(res, 403, { error: 'Perlu sesi akun individual.' });
    const { lama = '', baru = '' } = req.body || {};
    if (typeof baru !== 'string' || baru.length < 12 || Buffer.byteLength(baru) > 72) return json(res, 400, { error: 'Password baru minimal 12 karakter, maksimal 72 byte.' });
    if (await db.rateLimit('password', ipDari(req), 6, 600000)) return json(res, 429, { error: 'Terlalu banyak percobaan.' });
    const u = await db.userById(req.admin.id);
    if (!u || !await bcrypt.compare(String(lama), u.pass_hash)) return json(res, 400, { error: 'Password saat ini salah.' });
    if (await bcrypt.compare(baru,u.pass_hash)) return json(res,400,{error:'Gunakan password baru yang berbeda.'});
    const hash = await bcrypt.hash(baru, 12);
    const rows = await db.query('UPDATE users SET pass_hash=?,version=version+1,must_change=0 WHERE id=? AND version=? RETURNING id', [hash, u.id, u.version]);
    if (!rows.length) return json(res, 409, { error: 'Akun berubah. Silakan login kembali.' });
    await db.audit(u.username, 'password_changed', u.id);
    hapus(res);
    json(res, 200, { ok: true, loginUlang: true });
  });

  r.jalan('POST', '/api/auth/keluar', (_req, res) => {
    hapus(res);
    json(res, 200, { ok: true });
  });
}
