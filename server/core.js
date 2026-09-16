/**
 * Inti API admin — router tunggal yang dipakai bersama oleh:
 *   - dev server lokal  (server/index.js)
 *   - Vercel Function   (api/[...path].js)
 *
 * Konten disimpan di repositori GitHub (Contents API), BUKAN di disk
 * lokal: setiap simpan = satu commit di GitHub, lalu Vercel
 * auto-deploy situs secara otomatis. Tidak ada checkout lokal yang
 * dibutuhkan — itu yang membuat arsitektur ini cocok serverless.
 */
import matter from 'gray-matter';
import { Router, bacaBody, json, Galat } from './http.js';
import { pasangAuth, wajibMasuk } from './auth.js';
import { pasangAI } from './ai.js';
import * as gh from './github.js';

export const COLLECTIONS = {
  blog: {
    dir: 'blog',
    label: 'Blog',
    fields: ['title', 'desc', 'date', 'kategori', 'penulis', 'baca', 'unggulan', 'draft'],
    defaults: { kategori: 'Umum', penulis: 'Tim Xyverse', baca: 5, unggulan: false, draft: false },
  },
  proyek: {
    dir: 'proyek',
    label: 'Proyek',
    fields: ['title', 'desc', 'date', 'klien', 'layanan', 'stack', 'status', 'unggulan', 'draft'],
    defaults: { klien: '', layanan: 'Cloud PC', stack: [], status: 'Selesai', unggulan: false, draft: false },
  },
  berita: {
    dir: 'berita',
    label: 'Berita',
    fields: ['title', 'desc', 'date', 'tag', 'draft'],
    defaults: { tag: 'Pengumuman', draft: false },
  },
};

const BASE = 'src/content';

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

function pathKonten(col, slug) {
  if (!COLLECTIONS[col]) throw new Galat('Koleksi tidak dikenal.', 400);
  const clean = String(slug || '')
    .split('/')
    .map((s) => s.replace(/[^a-zA-Z0-9-_]/g, ''))
    .join('/');
  if (!clean) throw new Galat('Slug tidak valid.', 400);
  return `${BASE}/${COLLECTIONS[col].dir}/${clean}.md`;
}

/* ---------- cache ringan (20 dtk; per instans — wajar di serverless) ---------- */
const TILIK = 20 * 1000;
const cache = new Map();

async function daftarKoleksi(key) {
  const col = COLLECTIONS[key];
  if (!col) throw new Galat('Koleksi tidak dikenal.', 400);
  const c = cache.get(key);
  if (c && Date.now() - c.waktu < TILIK) return c.data;

  const repo = gh.reposSitus();
  const berkas = (await gh.daftarDirektori(repo, `${BASE}/${col.dir}`)).filter(
    (f) => f.type === 'file' && f.name.endsWith('.md'),
  );
  const items = await Promise.all(
    berkas.map(async (f) => {
      const raw = await gh.bacaIsi(repo, f.path);
      const { data, content } = matter(raw);
      return {
        slug: f.name.replace(/\.md$/, ''),
        ...data,
        date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date,
        kata: content.trim().split(/\s+/).filter(Boolean).length,
        diubah: f.last_modified || null,
      };
    }),
  );
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  cache.set(key, { waktu: Date.now(), data: items });
  return items;
}

function proyekDari(req) {
  const k = String(req.query?.proyek || req.body?.proyek || 'situs');
  if (k === 'admin') {
    return {
      kunci: 'admin',
      nama: 'Dashboard Admin',
      ket: 'Panel React + API serverless (Vercel)',
      repo: gh.reposAdmin(),
      repoBawaan: gh.CFG.repoAdmin(),
    };
  }
  return {
    kunci: 'situs',
    nama: 'Website Xyverse',
    ket: 'Situs publik Astro (xyverse.my.id)',
    repo: gh.reposSitus(),
    repoBawaan: gh.CFG.repoSitus(),
  };
}

function buatRouter() {
  const r = new Router();

  // tubuh JSON untuk POST/PUT/DELETE
  r.pakai(async (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      req.body = await bacaBody(req);
    }
    next();
  });

  pasangAuth(r);

  // wajib masuk untuk semua rute kecuali endpoint autentikasi terbuka
  const TERBUKA = new Set(['/api/auth/konfig', '/api/auth/saya', '/api/auth/masuk', '/api/auth/keluar']);
  r.pakai((req, res, next) => {
    if (TERBUKA.has(req.urlPath)) return next();
    return wajibMasuk(req, res, next);
  });

  pasangAI(r);

  /* ---- meta & statistik ---- */

  r.jalan('GET', '/api/meta', (_req, res) => {
    json(res, 200, {
      mode: 'serverless',
      repo: gh.reposSitus(),
      url: `https://github.com/${gh.reposSitus()}`,
      cabang: gh.CFG.cabang(),
      collections: Object.entries(COLLECTIONS).map(([key, v]) => ({
        key,
        label: v.label,
        fields: v.fields,
        defaults: v.defaults,
      })),
    });
  });

  r.jalan('GET', '/api/stats', async (_req, res) => {
    const out = {};
    for (const [key, col] of Object.entries(COLLECTIONS)) {
      const items = await daftarKoleksi(key);
      const draft = items.filter((i) => i.draft).length;
      out[key] = { total: items.length, draft, publik: items.length - draft, label: col.label };
    }
    json(res, 200, out);
  });

  /*
   * CATATAN URUTAN: rute literal di bawah INI harus terdaftar SEBELUM
   * wildcard /api/:col — router memakai first-match-wins, jadi kalau
   * wildcard duluan, /api/git/* akan ditelan sebagai :col="git".
   */

  /* ---- panel deploy: status & koneksi (semua via GitHub API) ---- */

  r.jalan('GET', '/api/git/proyek', (_req, res) => {
    json(res, 200, [
      {
        kunci: 'situs',
        nama: 'Website Xyverse',
        ket: 'Situs publik Astro (xyverse.my.id)',
        repoBawaan: gh.CFG.repoSitus(),
        url: `https://github.com/${gh.reposSitus()}`,
      },
      {
        kunci: 'admin',
        nama: 'Dashboard Admin',
        ket: 'Panel React + API serverless (Vercel)',
        repoBawaan: gh.CFG.repoAdmin(),
        url: `https://github.com/${gh.reposAdmin()}`,
      },
    ]);
  });

  r.jalan('GET', '/api/git/status', async (req, res) => {
    const P = proyekDari(req);
    const info = await gh.infoRepo(P.repo);
    const commit = await gh.commitTerakhir(P.repo).catch(() => null);
    const total = await gh.jumlahCommit(P.repo).catch(() => null);
    json(res, 200, {
      proyek: P.kunci,
      nama: P.nama,
      ket: P.ket,
      dir: null,
      repoBawaan: P.repoBawaan,
      url: info.html_url,
      cabang: info.default_branch,
      adaRemote: true,
      terakhir: commit
        ? `${commit.sha.slice(0, 7)} · ${commit.commit.message.split('\n')[0]} · ${gh.waktuRelatif(commit.commit.author?.date)}`
        : '-',
      commitUrl: commit?.html_url || null,
      commitPenulis: commit?.commit?.author?.name || null,
      totalCommit: total ?? 0,
      berubah: 0,
      belumDidorong: 0,
      berkas: [],
      didorong: info.pushed_at ? gh.waktuRelatif(info.pushed_at) : '-',
      serverless: true,
      tokenTerpasang: Boolean(gh.CFG.token()),
    });
  });

  r.jalan('POST', '/api/git/commit', (_req, res) => {
    // Di mode serverless tidak ada checkout lokal — commit terjadi
    // otomatis setiap kali konten disimpan. Endpoint dipertahankan
    // agar klien lama tidak error.
    json(res, 200, {
      ok: true,
      kosong: true,
      log: 'Mode serverless: tidak ada checkout lokal. Setiap simpan konten dari dashboard langsung menjadi commit di GitHub.',
    });
  });

  r.jalan('POST', '/api/git/push', async (req, res) => {
    // Dulu: git push dari disk lokal dengan token sekali pakai.
    // Sekarang: uji koneksi — token dikelola di lingkungan Vercel.
    const P = proyekDari(req);
    const u = await gh.ujiToken(P.repo);
    const baris = u.login
      ? [`Token GitHub: aktif (masuk sebagai @${u.login})`]
      : ['GH_TOKEN: BELUM TERPASANG — repo bisa dibaca, tetapi konten tidak bisa disimpan.'];
    baris.push(
      `Repositori ${P.repo}: terjangkau — cabang ${u.cabang}, ${u.url}`,
      'Sinkronisasi serverless: konten di-commit langsung ke GitHub oleh API, lalu Vercel deploy otomatis.',
    );
    json(res, 200, { ok: true, proyek: P.kunci, url: u.url, log: baris.join('\n') });
  });

  /* ---- CRUD konten (GitHub Contents API) ---- */

  r.jalan('GET', '/api/:col', async (req, res) => {
    json(res, 200, await daftarKoleksi(req.params.col));
  });

  r.jalan('GET', '/api/:col/:slug', async (req, res) => {
    const { col, slug } = req.params;
    const raw = await gh.bacaIsi(gh.reposSitus(), pathKonten(col, slug));
    const { data, content } = matter(raw);
    json(res, 200, {
      slug,
      frontmatter: { ...data, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date },
      body: content.trim(),
    });
  });

  r.jalan('PUT', '/api/:col/:slug', async (req, res) => {
    const { col, slug } = req.params;
    const cfg = COLLECTIONS[col];
    if (!cfg) throw new Galat('Koleksi tidak dikenal.', 400);
    const { frontmatter = {}, body = '', slugBaru } = req.body || {};
    if (!frontmatter.title) throw new Galat('Judul wajib diisi.', 400);

    const fm = { ...cfg.defaults, ...frontmatter };
    if (!fm.date) fm.date = new Date().toISOString().slice(0, 10);
    if (typeof fm.stack === 'string') fm.stack = fm.stack.split(',').map((s) => s.trim()).filter(Boolean);
    if (fm.baca != null) fm.baca = Number(fm.baca) || 5;

    // hanya simpan field yang dikenal skema
    const clean = {};
    for (const k of cfg.fields) if (fm[k] !== undefined) clean[k] = fm[k];

    const repo = gh.reposSitus();
    const target = slugBaru ? slugify(slugBaru) : slug;
    const isi = matter.stringify(`\n${body.trim()}\n`, clean);

    if (slugBaru && target !== slug) {
      // ganti nama: hapus berkas lama (abaikan kalau memang belum ada)
      await gh
        .hapusBerkas(repo, pathKonten(col, slug), `Ganti nama ${col}/${slug} → ${col}/${target} (via dashboard)`)
        .catch(() => {});
    }
    await gh.tulisBerkas(
      repo,
      pathKonten(col, target),
      isi,
      slugBaru
        ? `Buat ${col}/${target} (via dashboard)`
        : `Perbarui ${col}/${target} (via dashboard)`,
    );
    cache.delete(col);
    json(res, 200, { ok: true, slug: target });
  });

  r.jalan('DELETE', '/api/:col/:slug', async (req, res) => {
    const { col, slug } = req.params;
    await gh.hapusBerkas(gh.reposSitus(), pathKonten(col, slug), `Hapus ${col}/${slug} (via dashboard)`);
    cache.delete(col);
    json(res, 200, { ok: true });
  });

  return r;
}

const router = buatRouter();

/** Gerbang utama: tangani permintaan /api/* (dev server & Vercel Function). */
export function tanganiApi(req, res) {
  return router.tangani(req, res);
}
