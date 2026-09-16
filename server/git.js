/**
 * Endpoint Git: status, commit, dan push ke GitHub.
 *
 * Token TIDAK PERNAH disimpan ke disk. Ia dikirim per permintaan,
 * dipakai sekali untuk satu operasi push, lalu dibuang dari memori.
 * URL remote yang mengandung token tidak pernah ditulis ke .git/config —
 * kami memakai `git push <url>` sekali jalan.
 */
import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const jalankan = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.XY_SITE_DIR || path.resolve(__dirname, '../../xyverse-web');
const ADMIN = process.env.XY_ADMIN_DIR || path.resolve(__dirname, '..');

/** Daftar proyek yang boleh disentuh. Kunci dipakai sebagai ?proyek=<kunci>. */
export const PROYEK = {
  situs: {
    kunci: 'situs',
    nama: 'Website Xyverse',
    ket: 'Situs publik Astro (xyverse.my.id)',
    dir: SITE,
    repoBawaan: 'xyverse-web',
  },
  admin: {
    kunci: 'admin',
    nama: 'Dashboard Admin',
    ket: 'Panel React + API Express',
    dir: ADMIN,
    repoBawaan: 'xyverse-admin',
  },
};

/** Pilih proyek dari query/body; tolak kunci yang tidak dikenal. */
function ambilProyek(req) {
  const k = String(req.query?.proyek || req.body?.proyek || 'situs');
  const p = PROYEK[k];
  if (!p) {
    const e = new Error(`Proyek "${k}" tidak dikenal.`);
    e.status = 400;
    throw e;
  }
  return p;
}

const r = Router();

async function git(args, dir, opts = {}) {
  const { stdout, stderr } = await jalankan('git', args, {
    cwd: dir,
    maxBuffer: 1024 * 1024 * 8,
    timeout: 120000,
    ...opts,
  });
  return (stdout || stderr || '').trim();
}

/** Buang token dari teks apa pun sebelum dikirim ke klien. */
function bersihkan(teks, token) {
  let t = String(teks);
  if (token) t = t.split(token).join('***');
  return t.replace(/https:\/\/[^@\s]+@/g, 'https://***@');
}

/* ---------- daftar proyek ---------- */
r.get('/git/proyek', (_req, res) => {
  res.json(Object.values(PROYEK).map(({ kunci, nama, ket, dir, repoBawaan }) => ({
    kunci, nama, ket, dir, repoBawaan,
  })));
});

/* ---------- status repo ---------- */
r.get('/git/status', async (req, res) => {
  let P;
  try { P = ambilProyek(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const d = P.dir;
  try {
    const [cabang, kotor, terakhir, remote, jumlah] = await Promise.all([
      git(['rev-parse', '--abbrev-ref', 'HEAD'], d).catch(() => '-'),
      git(['status', '--porcelain'], d).catch(() => ''),
      git(['log', '-1', '--pretty=%h · %s · %cr'], d).catch(() => '-'),
      git(['remote', 'get-url', 'origin'], d).catch(() => ''),
      git(['rev-list', '--count', 'HEAD'], d).catch(() => '0'),
    ]);

    const berkas = kotor ? kotor.split('\n').filter(Boolean) : [];
    let belumDidorong = 0;
    try {
      const n = await git(['rev-list', '--count', '@{u}..HEAD'], d);
      belumDidorong = Number(n) || 0;
    } catch {
      belumDidorong = -1; // belum ada upstream
    }

    res.json({
      proyek: P.kunci,
      nama: P.nama,
      ket: P.ket,
      repoBawaan: P.repoBawaan,
      dir: P.dir,
      cabang,
      terakhir,
      remote: bersihkan(remote),
      adaRemote: Boolean(remote),
      totalCommit: Number(jumlah) || 0,
      berubah: berkas.length,
      berkas: berkas.slice(0, 60),
      belumDidorong,
    });
  } catch (e) {
    res.status(500).json({ error: bersihkan(e.message) });
  }
});

/* ---------- commit ---------- */
r.post('/git/commit', async (req, res) => {
  let P;
  try { P = ambilProyek(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const d = P.dir;
  const pesan = String(req.body?.pesan || '').trim();
  if (!pesan) return res.status(400).json({ error: 'Pesan commit wajib diisi.' });
  try {
    await git(['add', '-A'], d);
    const kotor = await git(['status', '--porcelain'], d);
    if (!kotor) return res.json({ ok: true, kosong: true, log: 'Tidak ada perubahan untuk di-commit.' });

    const log = await git([
      '-c', 'user.email=halo@xyverse.my.id',
      '-c', 'user.name=Xyverse',
      'commit', '-m', pesan,
    ], d);
    res.json({ ok: true, log: bersihkan(log) });
  } catch (e) {
    res.status(500).json({ error: bersihkan(e.message) });
  }
});

/* ---------- push ---------- */
r.post('/git/push', async (req, res) => {
  let P;
  try { P = ambilProyek(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const d = P.dir;
  const { token = '', pemilik = '', repo = '', cabang = 'main', buatRemote = true } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token GitHub wajib diisi.' });
  if (!pemilik || !repo) return res.status(400).json({ error: 'Pemilik dan nama repo wajib diisi.' });
  if (!/^[A-Za-z0-9._-]+$/.test(pemilik) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Nama pemilik atau repo mengandung karakter tidak sah.' });
  }
  if (!/^[A-Za-z0-9._\/-]+$/.test(cabang)) {
    return res.status(400).json({ error: 'Nama cabang tidak sah.' });
  }

  const urlBersih = `https://github.com/${pemilik}/${repo}.git`;
  const urlToken = `https://${encodeURIComponent(token)}@github.com/${pemilik}/${repo}.git`;
  const langkah = [];

  try {
    // pastikan ada commit
    const total = await git(['rev-list', '--count', 'HEAD'], d).catch(() => '0');
    if (Number(total) === 0) {
      return res.status(400).json({ error: 'Repositori belum punya commit. Lakukan commit dulu.' });
    }

    // simpan remote bersih (tanpa token) agar repo tetap rapi
    if (buatRemote) {
      try {
        await git(['remote', 'get-url', 'origin'], d);
        await git(['remote', 'set-url', 'origin', urlBersih], d);
        langkah.push(`remote origin diperbarui → ${urlBersih}`);
      } catch {
        await git(['remote', 'add', 'origin', urlBersih], d);
        langkah.push(`remote origin ditambahkan → ${urlBersih}`);
      }
    }

    // push memakai URL bertoken sekali jalan; tidak ditulis ke config
    const hasil = await git(['push', '-u', urlToken, `HEAD:${cabang}`], d);
    langkah.push(bersihkan(hasil, token) || 'push selesai');

    // pastikan upstream menunjuk ke URL bersih
    try {
      await git(['branch', `--set-upstream-to=origin/${cabang}`], d);
    } catch {}

    res.json({
      ok: true,
      proyek: P.kunci,
      url: `https://github.com/${pemilik}/${repo}`,
      log: langkah.join('\n'),
    });
  } catch (e) {
    const pesan = bersihkan(e.message, token);
    let ramah = pesan;
    if (/Authentication failed|403|invalid username or password/i.test(pesan)) {
      ramah = 'Autentikasi ditolak GitHub. Pastikan token punya cakupan "repo" dan belum kedaluwarsa.';
    } else if (/not found|404/i.test(pesan)) {
      ramah = `Repositori ${pemilik}/${repo} tidak ditemukan. Buat dulu di GitHub, atau periksa ejaannya.`;
    } else if (/non-fast-forward|rejected/i.test(pesan)) {
      ramah = 'Push ditolak: remote punya commit yang belum ada di lokal. Tarik (pull) dulu.';
    }
    res.status(500).json({ error: ramah, rinci: pesan });
  }
});

export default r;
