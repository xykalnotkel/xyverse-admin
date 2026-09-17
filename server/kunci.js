/**
 * Kunci API — jalan masuk kedua ke seluruh /api/*, selain login peramban.
 *
 * Untuk agen AI dan skrip: tidak ada cookie, tidak ada Turnstile, cukup
 * header
 *
 *     Authorization: Bearer xya_<40 hex>
 *
 * atau `X-Api-Key: xya_...`. Keduanya setara.
 *
 * PENYIMPANAN. Kunci TIDAK PERNAH disimpan sebagai teks polos. Yang disimpan
 * adalah hash SHA-256-nya, di sebuah berkas JSON dalam repo `xyverse-admin`
 * (bawaan: `.xyverse/api-keys.json`, bisa diubah lewat ADMIN_API_KEYS_PATH).
 * Repo itu dipakai sebagai "database" karena backend ini serverless — tidak
 * ada disk yang bertahan antar-request, dan GH_TOKEN sudah tersedia.
 *
 * Teks polos kunci hanya muncul SEKALI, pada respons pembuatan. Kalau hilang,
 * cabut dan buat baru.
 *
 * KUNCI BOOTSTRAP. Selain kunci tersimpan, nilai ADMIN_API_KEY di lingkungan
 * juga diterima. Gunanya untuk bootstrap (membuat kunci tersimpan pertama
 * lewat API) dan untuk lingkungan yang tidak mau menulis ke repo. Kunci ini
 * tidak bisa dicabut lewat API — matikan lewat dashboard Vercel.
 *
 * YANG SENGAJA DIBATASI: membuat dan mencabut kunci HANYA boleh lewat sesi
 * peramban. Kunci API punya akses penuh ke konten, jadi kalau kunci API juga
 * boleh menerbitkan kunci baru, satu kunci yang bocor bisa menanam kunci
 * yang tidak kelihatan di daftar.
 */
import crypto from 'node:crypto';
import { Galat } from './http.js';
import * as gh from './github.js';

const AWALAN = 'xya_';

const CFG = {
  jalur: () => process.env.ADMIN_API_KEYS_PATH || '.xyverse/api-keys.json',
  cabang: () => process.env.GH_ADMIN_KEYS_BRANCH || gh.CFG.cabang(),
  bootstrap: () => process.env.ADMIN_API_KEY || '',
};

/* ---------- utilitas ---------- */

/** Perbandingan waktu tetap; aman untuk panjang berbeda. */
function setara(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const hash = (teks) => crypto.createHash('sha256').update(String(teks)).digest('hex');

/** Kunci baru: `xya_` + 40 karakter hex acak (160 bit entropi). */
function buatKunci() {
  return AWALAN + crypto.randomBytes(20).toString('hex');
}

const idKunci = (h) => h.slice(0, 12);

/**
 * Bentuk hash untuk penyimpanan. Enam belas byte pertama sudah 128 bit —
 * cukup untuk kunci berentropi 160 bit, dan membuat berkas JSON-nya pendek.
 */
const hashSimpan = (teks) => hash(teks).slice(0, 32);

/* ---------- penyimpanan di GitHub ---------- */

const cache = { waktu: 0, daftar: null };
const TILIK = 15 * 1000;

async function bacaDaftar() {
  if (cache.daftar && Date.now() - cache.waktu < TILIK) return cache.daftar;
  let daftar = [];
  try {
    const mentah = await gh.bacaIsiBercabang(gh.reposAdmin(), CFG.jalur(), CFG.cabang());
    const j = JSON.parse(mentah);
    if (Array.isArray(j)) daftar = j;
  } catch (e) {
    // 404 = belum pernah ada kunci tersimpan. Itu keadaan normal, bukan error.
    if (e.status !== 404) throw e;
  }
  // Entri lama ada yang menyimpan masa berlaku dalam DETIK. Tanpa ini, kunci
  // berumur 90 hari terbaca kedaluwarsa pada tahun 58928 dan tidak pernah
  // ditandai mati di panel.
  for (const k of daftar) {
    if (typeof k?.kedaluwarsa === 'number' && k.kedaluwarsa > 0 && k.kedaluwarsa < 1e12) {
      k.kedaluwarsa *= 1000;
    }
  }
  cache.daftar = daftar;
  cache.waktu = Date.now();
  return daftar;
}

async function tulisDaftar(daftar, pesan) {
  await gh.tulisBerkasBercabang(
    gh.reposAdmin(),
    CFG.jalur(),
    JSON.stringify(daftar, null, 2) + '\n',
    pesan,
    CFG.cabang(),
  );
  cache.daftar = daftar;
  cache.waktu = Date.now();
}

/* ---------- verifikasi ---------- */

/**
 * Cocokkan kunci dari header permintaan.
 * Mengembalikan null bila tidak ada/tidak cocok; objek identitas bila cocok.
 */
export async function verifikasiKunci(req) {
  const dari =
    req.headers['x-api-key'] ||
    String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const kunci = String(dari || '').trim();
  if (!kunci.startsWith(AWALAN)) return null;

  const target = hashSimpan(kunci);
  const targetBuf = Buffer.from(target);

  for (const k of await bacaDaftar()) {
    if (typeof k?.hash !== 'string' || k.hash.length !== targetBuf.length) continue;
    if (!crypto.timingSafeEqual(Buffer.from(k.hash), targetBuf)) continue;
    if (k.kedaluwarsa && Date.now() > k.kedaluwarsa) continue;
    k.terakhirDipakai = Date.now();
    return { jenis: 'api', id: k.id, label: k.label || 'kunci API', cakupan: k.cakupan || 'penuh' };
  }

  // Kunci bootstrap dari lingkungan.
  const boot = CFG.bootstrap();
  if (boot && setara(kunci, boot)) {
    return { jenis: 'api', id: 'env', label: 'ADMIN_API_KEY (lingkungan)', cakupan: 'penuh' };
  }
  return null;
}

/* ---------- daftar untuk UI (tanpa hash) ---------- */

export async function daftarPublik() {
  const daftar = await bacaDaftar();
  const kini = Date.now();
  const keluar = daftar.map((k) => ({
    id: k.id,
    label: k.label,
    awalan: k.awalan,
    dibuat: k.dibuat,
    kedaluwarsa: k.kedaluwarsa || null,
    // Di serverless angka ini hanya akurat selama instans hidup (cache 15 dtk).
    // Menyimpannya ke GitHub berarti satu commit per pemakaian — tidak sepadan.
    terakhirDipakai: k.terakhirDipakai || null,
    mati: Boolean(k.kedaluwarsa && k.kedaluwarsa < kini),
  }));
  keluar.sort((a, b) => String(b.dibuat).localeCompare(String(a.dibuat)));
  if (CFG.bootstrap()) {
    keluar.push({
      id: 'env',
      label: 'ADMIN_API_KEY (lingkungan)',
      awalan: CFG.bootstrap().slice(0, 10) + '…',
      dibuat: null,
      kedaluwarsa: null,
      terakhirDipakai: null,
      mati: false,
      env: true,
    });
  }
  return keluar;
}

/* ---------- masa berlaku ---------- */

/**
 * Satu-satunya tempat yang menafsirkan nilai masa berlaku.
 *
 * Menerima:
 *   - stempel waktu ms  (yang dikirim panel)
 *   - stempel waktu DETIK — entri lama pernah menyimpan satuan ini; kalau
 *     dibaca apa adanya jadi tahun 58928
 *   - string tanggal/ISO ("2026-12-31", "2026-12-31T17:00:00Z")
 *
 * Mengembalikan `undefined` bila nilai tidak bermakna — ini PENTING: nilai
 * yang tidak bisa dibaca tidak boleh diam-diam menjadi "selamanya", karena
 * itu berarti tanggal yang salah ketik meloloskan kunci tanpa batas.
 */
export function normalKedaluwarsa(v) {
  if (v === null || v === undefined || v === '' || v === false) return undefined;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    // Batas 1e12 ms = 2001-09-09. Angka positif di bawah itu pasti detik.
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    if (/^\d+$/.test(t)) return normalKedaluwarsa(Number(t));
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

/**
 * Ubah { kedaluwarsaHari, kedaluwarsaPada } menjadi stempel waktu (ms) atau
 * null (= tidak pernah kedaluwarsa).
 *
 * `kedaluwarsaPada` adalah waktu mutlak dan menang bila keduanya diisi;
 * `kedaluwarsaHari` umur dalam hari. Keduanya kosong -> tanpa batas.
 * Melempar 400 bila yang dikirim adalah tanggal yang tidak bisa dibaca atau
 * sudah lewat — diam-diam mengabaikannya lebih berbahaya daripada menolak.
 */
export function hitungKedaluwarsa({ kedaluwarsaHari = null, kedaluwarsaPada = null } = {}) {
  const kini = Date.now();

  const pada = normalKedaluwarsa(kedaluwarsaPada);
  if (pada !== undefined) {
    if (pada <= kini) throw new Galat('Tanggal kedaluwarsa sudah lewat.', 400);
    return pada;
  }
  if (kedaluwarsaPada !== null && kedaluwarsaPada !== undefined && kedaluwarsaPada !== '') {
    throw new Galat('Tanggal kedaluwarsa tidak terbaca. Pakai tanggal seperti 2026-12-31.', 400);
  }

  const hari = Number(kedaluwarsaHari);
  if (Number.isFinite(hari) && hari > 0) return kini + hari * 86400000;
  return null;
}

/* ---------- buat, ubah, cabut ---------- */

export async function buat({ label = '', kedaluwarsaHari = null, kedaluwarsaPada = null } = {}) {
  const nama = String(label || '').trim().slice(0, 60);
  if (!nama) throw new Galat('Label wajib diisi supaya kunci mudah dikenali nanti.', 400);

  const daftar = [...(await bacaDaftar())];
  if (daftar.length >= 20) throw new Galat('Maksimal 20 kunci. Cabut yang tidak terpakai dulu.', 400);

  // Melempar 400 bila tanggalnya lampau/tak terbaca — jangan bikin kuncinya.
  const exp = hitungKedaluwarsa({ kedaluwarsaHari, kedaluwarsaPada });

  const teks = buatKunci();
  const h = hashSimpan(teks);
  const entri = {
    id: idKunci(h),
    label: nama,
    hash: h,
    awalan: teks.slice(0, 10),
    cakupan: 'penuh',
    dibuat: new Date().toISOString(),
    kedaluwarsa: exp,
  };
  daftar.push(entri);
  await tulisDaftar(daftar, `Tambah kunci API "${nama}" (via dashboard)`);

  return {
    id: entri.id,
    label: nama,
    awalan: entri.awalan,
    kunci: teks, // hanya di respons ini
    kedaluwarsa: exp,
    dibuat: entri.dibuat,
  };
}

/**
 * Ubah label dan/atau masa berlaku kunci yang sudah ada — tanpa membuat
 * kunci baru, jadi agen yang memakainya tidak perlu di-setup ulang.
 *
 * Kirim `kedaluwarsaHari: 0` (atau `kedaluwarsaPada: 0`) untuk menghapus
 * batas waktu dan membuatnya berlaku selamanya.
 */
export async function ubah(id, { label, kedaluwarsaHari, kedaluwarsaPada, hapusBatas = false } = {}) {
  const daftar = await bacaDaftar();
  const korban = daftar.find((k) => k.id === id);
  if (!korban) throw new Galat('Kunci tidak ditemukan.', 404);

  const adaLabel = typeof label === 'string' && label.trim();
  const adaWaktu =
    hapusBatas === true || kedaluwarsaHari != null || kedaluwarsaPada != null;
  if (!adaLabel && !adaWaktu) throw new Galat('Tidak ada yang diubah.', 400);

  const diperbarui = { ...korban };
  if (adaLabel) diperbarui.label = label.trim().slice(0, 60);
  if (hapusBatas === true) diperbarui.kedaluwarsa = null;
  else if (adaWaktu) {
    // hitungKedaluwarsa menolak tanggal lampau/tak terbaca dengan 400.
    diperbarui.kedaluwarsa = hitungKedaluwarsa({ kedaluwarsaHari, kedaluwarsaPada });
  }

  const baru = daftar.map((k) => (k.id === id ? diperbarui : k));
  await tulisDaftar(baru, `Ubah kunci API "${diperbarui.label}" (via dashboard)`);
  return {
    id: diperbarui.id,
    label: diperbarui.label,
    kedaluwarsa: diperbarui.kedaluwarsa || null,
  };
}

export async function cabut(id) {
  const daftar = await bacaDaftar();
  const korban = daftar.find((k) => k.id === id);
  if (!korban) throw new Galat('Kunci tidak ditemukan.', 404);
  const sisa = daftar.filter((k) => k.id !== id);
  await tulisDaftar(sisa, `Cabut kunci API "${korban.label}" (via dashboard)`);
  return { ok: true, id, label: korban.label };
}

/* ---------- pembatasan laju per kunci ---------- */

const pakai = new Map(); // id -> { n, sampai }
const MAKS = 600;
const JENDELA = 60 * 1000;

/** Sisa detik bila kunci sedang dibatasi; 0 bila boleh lanjut. */
export function dibatasi(sesi) {
  const c = pakai.get(sesi?.id || '');
  if (!c) return 0;
  if (Date.now() > c.sampai) {
    pakai.delete(sesi.id);
    return 0;
  }
  return c.n >= MAKS ? Math.ceil((c.sampai - Date.now()) / 1000) : 0;
}

export function catatPakai(sesi) {
  if (!sesi) return;
  const c = pakai.get(sesi.id) || { n: 0, sampai: Date.now() + JENDELA };
  c.n += 1;
  c.sampai = Date.now() + JENDELA;
  pakai.set(sesi.id, c);
}

export const INFO = {
  awalan: AWALAN,
  jalur: CFG.jalur,
  repo: () => gh.reposAdmin(),
  bootstrapAktif: () => Boolean(CFG.bootstrap()),
  batasPerMenit: MAKS,
};
