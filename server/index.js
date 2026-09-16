import express from 'express';
import matter from 'gray-matter';
import aiRouter from './ai.js';
import { pasangAuth, wajibMasuk, turnstileAktif } from './auth.js';
import gitRouter from './git.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// >>> INI JEMBATANNYA: admin menulis langsung ke folder konten website Astro <<<
const SITE = process.env.XY_SITE_DIR || path.resolve(__dirname, '../../xyverse-web');
const CONTENT = path.join(SITE, 'src/content');

const COLLECTIONS = {
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

// muat .env sederhana (tanpa dependensi tambahan)
try {
  const envFile = path.resolve(__dirname, '../.env');
  const raw = await (await import('node:fs')).promises.readFile(envFile, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log('[xyverse-admin] .env dimuat');
} catch {}

const app = express();
app.use(express.json({ limit: '2mb' }));

// rute autentikasi terbuka; selebihnya butuh sesi
pasangAuth(app);
app.use('/api', wajibMasuk);
app.use('/api', aiRouter);
app.use('/api', gitRouter);

const slugify = (s) =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

const dirOf = (c) => {
  const col = COLLECTIONS[c];
  if (!col) throw Object.assign(new Error('Koleksi tidak dikenal'), { status: 400 });
  return path.join(CONTENT, col.dir);
};

const safeFile = (c, slug) => {
  const clean = path.basename(String(slug)).replace(/[^a-zA-Z0-9-_]/g, '');
  if (!clean) throw Object.assign(new Error('Slug tidak valid'), { status: 400 });
  return path.join(dirOf(c), `${clean}.md`);
};

// --- meta ---
app.get('/api/meta', (_req, res) => {
  res.json({
    siteDir: SITE,
    contentDir: CONTENT,
    collections: Object.entries(COLLECTIONS).map(([k, v]) => ({
      key: k, label: v.label, fields: v.fields, defaults: v.defaults,
    })),
  });
});

// --- stats ---
app.get('/api/stats', async (_req, res, next) => {
  try {
    const out = {};
    for (const [key, col] of Object.entries(COLLECTIONS)) {
      const dir = path.join(CONTENT, col.dir);
      let files = [];
      try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')); } catch {}
      let draft = 0;
      for (const f of files) {
        const { data } = matter(await fs.readFile(path.join(dir, f), 'utf8'));
        if (data.draft) draft++;
      }
      out[key] = { total: files.length, draft, publik: files.length - draft, label: col.label };
    }
    res.json(out);
  } catch (e) { next(e); }
});

// --- list ---
app.get('/api/:col', async (req, res, next) => {
  try {
    const dir = dirOf(req.params.col);
    let files = [];
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')); } catch {}
    const items = await Promise.all(files.map(async (f) => {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const { data, content } = matter(raw);
      const stat = await fs.stat(path.join(dir, f));
      return {
        slug: f.replace(/\.md$/, ''),
        ...data,
        date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date,
        kata: content.trim().split(/\s+/).filter(Boolean).length,
        diubah: stat.mtime.toISOString(),
      };
    }));
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json(items);
  } catch (e) { next(e); }
});

// --- read one ---
app.get('/api/:col/:slug', async (req, res, next) => {
  try {
    const raw = await fs.readFile(safeFile(req.params.col, req.params.slug), 'utf8');
    const { data, content } = matter(raw);
    res.json({
      slug: req.params.slug,
      frontmatter: { ...data, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date },
      body: content.trim(),
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'Tidak ditemukan' });
    next(e);
  }
});

// --- create / update ---
app.put('/api/:col/:slug', async (req, res, next) => {
  try {
    const { col, slug } = req.params;
    const { frontmatter = {}, body = '', slugBaru } = req.body;
    const cfg = COLLECTIONS[col];
    if (!cfg) return res.status(400).json({ error: 'Koleksi tidak dikenal' });
    if (!frontmatter.title) return res.status(400).json({ error: 'Judul wajib diisi' });

    const fm = { ...cfg.defaults, ...frontmatter };
    if (!fm.date) fm.date = new Date().toISOString().slice(0, 10);
    if (typeof fm.stack === 'string') {
      fm.stack = fm.stack.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (fm.baca != null) fm.baca = Number(fm.baca) || 5;

    // hanya simpan field yang dikenal skema
    const clean = {};
    for (const k of cfg.fields) if (fm[k] !== undefined) clean[k] = fm[k];

    await fs.mkdir(dirOf(col), { recursive: true });
    const target = slugBaru ? slugify(slugBaru) : slug;
    const file = safeFile(col, target);

    await fs.writeFile(file, matter.stringify(`\n${body.trim()}\n`, clean), 'utf8');
    if (slugBaru && target !== slug) {
      await fs.rm(safeFile(col, slug), { force: true });
    }
    res.json({ ok: true, slug: target });
  } catch (e) { next(e); }
});

// --- delete ---
app.delete('/api/:col/:slug', async (req, res, next) => {
  try {
    await fs.rm(safeFile(req.params.col, req.params.slug), { force: true });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Kesalahan server' });
});

const PORT = process.env.PORT || 4500;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[xyverse-admin] API  : http://0.0.0.0:${PORT}`);
  console.log(`[xyverse-admin] Situs: ${SITE}`);
  console.log(`[xyverse-admin] Groq : ${process.env.GROQ_API_KEY ? 'aktif (' + (process.env.GROQ_MODEL || 'openai/gpt-oss-20b') + ')' : 'nonaktif — atur GROQ_API_KEY di .env'}`);
  console.log(`[xyverse-admin] Login: pengguna "${process.env.ADMIN_USER || 'admin'}" · ${process.env.ADMIN_PASS_HASH ? 'hash terpasang' : 'BELUM ADA HASH — jalankan: npm run hash -- "katasandi"'}`);
  console.log(`[xyverse-admin] Turnstile: ${turnstileAktif() ? 'aktif' : 'nonaktif (mode pengembangan, verifikasi dilewati)'}`);
});
