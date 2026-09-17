/**
 * Klien GitHub API — pengganti operasi berkas lokal & git CLI.
 *
 * Setiap simpan konten dari dashboard menjadi commit langsung di
 * repositori (Contents API), lalu Vercel meng-deploy situs secara
 * otomatis. Token diambil dari lingkungan (GH_TOKEN) — tidak pernah
 * disentuh oleh peramban.
 */
import { Galat } from './http.js';

const API = 'https://api.github.com';

export const CFG = {
  token: () => process.env.GH_TOKEN || '',
  pemilik: () => process.env.GH_OWNER || '',
  repoSitus: () => process.env.GH_SITE_REPO || 'xyverse-web',
  repoAdmin: () => process.env.GH_ADMIN_REPO || 'xyverse-admin',
  cabang: () => process.env.GH_BRANCH || 'main',
};

export const reposSitus = () => `${CFG.pemilik()}/${CFG.repoSitus()}`;
export const reposAdmin = () => `${CFG.pemilik()}/${CFG.repoAdmin()}`;

function kepala(ekstra = {}) {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'xyverse-admin',
    'x-github-api-version': '2022-11-28',
    ...(CFG.token() ? { authorization: `Bearer ${CFG.token()}` } : {}),
    ...ekstra,
  };
}

function petaGalat(status, pesan, headers = null) {
  if (status === 401) return new Galat('GH_TOKEN belum diatur atau tidak valid.', 400);
  if (status === 404) return new Galat(pesan || 'Berkas atau repositori tidak ditemukan.', 404);
  if (status === 409)
    return new Galat('Berkas sudah berubah di GitHub sejak dimuat. Muat ulang lalu coba simpan lagi.', 409);
  if (status === 403 || status === 429) {
    const sisa = headers?.get?.('x-ratelimit-remaining');
    const reset = headers?.get?.('x-ratelimit-reset');
    const rateLimit = /rate limit/i.test(pesan) || status === 429 || sisa === '0';
    if (rateLimit) {
      let kapan = 'beberapa menit';
      if (reset) {
        const detik = Math.max(0, Math.ceil((Number(reset) * 1000 - Date.now()) / 1000));
        kapan = detik < 60
          ? 'kurang dari 1 menit'
          : waktuRelatif(new Date(Number(reset) * 1000).toISOString());
      }
      return new Galat(
        `Limit panggilan GitHub tercapai — coba lagi dalam ${kapan}. ` +
          (CFG.token()
            ? '(Limit terautentikasi 5000/jam; periksa juga apakah ada pemanggilan berlebihan.)'
            : '(Tanpa GH_TOKEN limit hanya 60/jam per IP — pasang GH_TOKEN di lingkungan Vercel.)'),
        429,
      );
    }
    return new Galat('Token GitHub ditolak atau izinnya kurang (butuh Contents: Read & Write).', 403);
  }
  return new Galat(pesan || `GitHub error ${status}`, 502);
}

async function panggil(path, opsi = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opsi,
    headers: kepala({ 'content-type': 'application/json', ...(opsi.headers || {}) }),
  });
  const teks = await r.text();
  let data = null;
  try {
    data = teks ? JSON.parse(teks) : null;
  } catch {
    data = teks;
  }
  if (!r.ok) throw petaGalat(r.status, data?.message || '', r.headers);
  return data;
}

/** Encode tiap segmen path (slug konten aman, ini sekadar jaga-jaga). */
export function segmen(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

/** Baca isi berkas mentah (teks) dari repositori. */
export async function bacaIsi(repo, pathFile) {
  return bacaIsiBercabang(repo, pathFile, CFG.cabang());
}

/** Sama seperti bacaIsi, tetapi cabangnya ditentukan pemanggil. */
export async function bacaIsiBercabang(repo, pathFile, cabang) {
  const p = segmen(pathFile);
  const r = await fetch(`${API}/repos/${repo}/contents/${p}?ref=${encodeURIComponent(cabang)}`, {
    headers: kepala({ accept: 'application/vnd.github.raw+json' }),
  });
  if (r.status === 404) throw new Galat('Berkas tidak ditemukan di repositori.', 404);
  if (!r.ok) throw petaGalat(r.status, 'Gagal membaca berkas dari GitHub.', r.headers);
  return r.text();
}

/**
 * Daftarkan isi direktori (file & folder).
 *
 * GitHub Contents API memakai `per_page` bawaan 30 dan TIDAK memberi tanda
 * bahwa masih ada halaman berikutnya selain lewat header `Link`. Tanpa
 * paginasi, pustaka gambar yang lewat 30 berkas akan terpotong diam-diam —
 * jadi halaman demi halaman diambil sampai header Link-nya habis.
 */
export async function daftarDirektori(repo, pathDir, cabang = CFG.cabang()) {
  const p = segmen(pathDir);
  const out = [];
  let url = `${API}/repos/${repo}/contents/${p}?ref=${encodeURIComponent(cabang)}&per_page=100`;

  for (let i = 0; i < 30 && url; i += 1) {
    const r = await fetch(url, { headers: kepala() });
    if (r.status === 404) return out; // folder belum ada = kosong
    if (!r.ok) throw petaGalat(r.status, 'Gagal membaca daftar direktori dari GitHub.', r.headers);
    const data = await r.json();
    if (Array.isArray(data)) out.push(...data);

    // Ambil URL halaman berikutnya dari header Link bila ada.
    const link = r.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return out;
}

async function ambilSHA(repo, pathFile, cabang = CFG.cabang()) {
  const p = segmen(pathFile);
  const data = await panggil(`/repos/${repo}/contents/${p}?ref=${encodeURIComponent(cabang)}`);
  return data?.sha || null;
}

/** Tulis (buat/perbarui) berkas — menghasilkan satu commit di GitHub. */
export async function tulisBerkas(repo, pathFile, isi, pesan) {
  return tulisBerkasBercabang(repo, pathFile, isi, pesan, CFG.cabang());
}

/**
 * Sama seperti tulisBerkas, tetapi cabangnya ditentukan pemanggil.
 * `isi` boleh string (teks) atau Buffer (biner, mis. gambar) — keduanya
 * dikirim sebagai base64, itu yang diminta Contents API.
 */
export async function tulisBerkasBercabang(repo, pathFile, isi, pesan, cabang) {
  if (!CFG.token())
    throw new Galat(
      'GH_TOKEN belum diatur di lingkungan deployment. Tanpa token, konten tidak bisa disimpan.',
      400,
    );
  const p = segmen(pathFile);
  const ada = await ambilSHA(repo, pathFile, cabang).catch(() => null);
  const muatan = {
    message: pesan,
    content: Buffer.isBuffer(isi) ? isi.toString('base64') : Buffer.from(isi, 'utf8').toString('base64'),
    branch: cabang,
  };
  if (ada) muatan.sha = ada;
  const data = await panggil(`/repos/${repo}/contents/${p}`, {
    method: 'PUT',
    body: JSON.stringify(muatan),
  });
  return { commitSha: data?.commit?.sha || null, fileSha: data?.content?.sha || null };
}

/** Hapus berkas — menghasilkan satu commit di GitHub. */
export async function hapusBerkas(repo, pathFile, pesan) {
  if (!CFG.token()) throw new Galat('GH_TOKEN belum diatur di lingkungan deployment.', 400);
  const p = segmen(pathFile);
  const sha = await ambilSHA(repo, pathFile);
  if (!sha) throw new Galat('Berkas tidak ditemukan di repositori.', 404);
  const data = await panggil(`/repos/${repo}/contents/${p}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: pesan, sha, branch: CFG.cabang() }),
  });
  return { commitSha: data?.commit?.sha || null };
}

/* ---------- info repositori (untuk panel deploy) ---------- */

export async function infoRepo(repo) {
  return panggil(`/repos/${repo}`);
}

export async function commitTerakhir(repo) {
  const data = await panggil(`/repos/${repo}/commits?per_page=1&sha=${CFG.cabang()}`);
  return Array.isArray(data) ? data[0] || null : null;
}

/** Jumlah commit total via header Link (rel="last"). */
export async function jumlahCommit(repo) {
  const r = await fetch(`${API}/repos/${repo}/commits?per_page=1`, { headers: kepala() });
  if (!r.ok) throw petaGalat(r.status, 'Gagal menghitung commit.', r.headers);
  const link = r.headers.get('link') || '';
  const m = link.match(/page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : 1;
}

/** Uji token (bila ada) + akses repositori. */
export async function ujiToken(repo) {
  let login = null;
  if (CFG.token()) {
    const u = await panggil('/user');
    login = u.login;
  }
  const info = await infoRepo(repo);
  return { login, url: info.html_url, cabang: info.default_branch };
}

/** "5 menit lalu", "2 jam lalu", dst — gaya %cr dari git log lama. */
export function waktuRelatif(iso) {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return 'baru saja';
  if (s < 60) return `${s} detik lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const j = Math.floor(m / 60);
  if (j < 24) return `${j} jam lalu`;
  const h = Math.floor(j / 24);
  if (h < 30) return `${h} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
