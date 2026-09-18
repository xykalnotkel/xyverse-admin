import crypto from 'node:crypto';
import { pasangPlatform, izin } from './platform.js';
import * as db from './database.js';
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
import { pasangAuth, wajibMasuk, ipDari } from './auth.js';
import { kirimPesan } from './surat.js';
import * as kunci from './kunci.js';
import * as media from './media.js';
import { cerminMediaLokal, hapusCerminLokal } from './cermin.js';
import { pasangAI } from './ai.js';
import * as gh from './github.js';

/*
 * DAFTAR KOLEKSI — HARUS cocok dengan skema di xyverse-web/src/content.config.ts.
 *
 * `lang` WAJIB masuk `fields`. Tanpa itu, whitelist di bawah (clean) membuang
 * frontmatter `lang: "en"` setiap kali berkas terjemahan disimpan, dan situs
 * kehilangan halaman EN-nya secara diam-diam.
 *
 * Aturan yang sama berlaku untuk `gambar`, `og`, `diperbarui`, dan `tags`:
 * semuanya ada di skema situs. Kalau tidak terdaftar di sini, panel akan
 * menghapus gambar sampul artikel setiap kali artikelnya disimpan — hilang
 * tanpa pesan apa pun.
 */
export const BAHASA = ['id', 'en'];

export const COLLECTIONS = {
  blog: {
    dir: 'blog',
    label: 'Blog',
    fields: ['title', 'desc', 'date', 'kategori', 'penulis', 'baca', 'unggulan', 'draft', 'lang', 'gambar', 'og', 'diperbarui', 'tags'],
    defaults: { kategori: 'Umum', penulis: 'Tim Xyverse', baca: 5, unggulan: false, draft: false, lang: 'id', tags: [] },
  },
  proyek: {
    dir: 'proyek',
    label: 'Proyek',
    fields: ['title', 'desc', 'date', 'klien', 'layanan', 'stack', 'status', 'unggulan', 'draft', 'lang', 'gambar', 'og', 'diperbarui', 'tags'],
    defaults: { klien: '', layanan: 'Cloud PC', stack: [], status: 'Selesai', unggulan: false, draft: false, lang: 'id', tags: [] },
  },
  berita: {
    dir: 'berita',
    label: 'Berita',
    fields: ['title', 'desc', 'date', 'tag', 'draft', 'lang', 'gambar', 'og', 'diperbarui', 'tags'],
    defaults: { tag: 'Pengumuman', draft: false, lang: 'id', tags: [] },
  },
  legal: {
    dir: 'legal',
    label: 'Legal',
    // Skema legal situs: title, desc, diperbarui (string, bukan Date), ringkas?, lang
    fields: ['title', 'desc', 'diperbarui', 'ringkas', 'lang', 'gambar', 'og', 'tags'],
    defaults: { ringkas: '', lang: 'id' },
    // Tidak punya kolom `date` — daftar diurutkan menurut judul.
    tanpaTanggal: true,
  },
};

const BASE = 'src/content';

/** Normalisasi kode bahasa dari query/body. Salah nilai -> 400, bukan diam-diam jadi 'id'. */
export function bahasaDari(nilai) {
  const b = String(nilai ?? 'id').toLowerCase().trim();
  if (!BAHASA.includes(b)) throw new Galat(`Bahasa tidak dikenal: "${b}". Pakai ${BAHASA.join(' atau ')}.`, 400);
  return b;
}

/** Subfolder bahasa: 'id' -> '', 'en' -> 'en' (sesuai tata letak repo situs). */
const subBahasa = (b) => (b === 'id' ? '' : b);

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

function pathKonten(col, slug, bahasa = 'id') {
  if (!COLLECTIONS[col]) throw new Galat('Koleksi tidak dikenal.', 400);
  const clean = String(slug || '')
    .split('/')
    .map((s) => s.replace(/[^a-zA-Z0-9-_]/g, ''))
    .join('/');
  if (!clean) throw new Galat('Slug tidak valid.', 400);
  const sub = subBahasa(bahasa);
  return `${BASE}/${COLLECTIONS[col].dir}/${sub ? sub + '/' : ''}${clean}.md`;
}

/* ---------- cache ringan (20 dtk; per instans — wajar di serverless) ---------- */
const TILIK = 20 * 1000;
const cache = new Map();

/** "17 September 2026" — format `diperbarui` yang dipakai dokumen legal. */
function tanggalPanjang(bahasa = 'id') {
  return new Date().toLocaleDateString(bahasa === 'en' ? 'en-GB' : 'id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

async function daftarKoleksi(key, bahasa = 'id') {
  const col = COLLECTIONS[key];
  if (!col) throw new Galat('Koleksi tidak dikenal.', 400);
  const kunci = `${key}:${bahasa}`;
  const c = cache.get(kunci);
  if (c && Date.now() - c.waktu < TILIK) return c.data;

  const repo = gh.reposSitus();
  const sub = subBahasa(bahasa);
  const dir = `${BASE}/${col.dir}${sub ? '/' + sub : ''}`;
  // Hanya .md langsung di folder ini — subfolder `en/` bukan berkas konten.
  const berkas = (await gh.daftarDirektori(repo, dir)).filter(
    (f) => f.type === 'file' && f.name.endsWith('.md'),
  );
  const items = await Promise.all(
    berkas.map(async (f) => {
      const raw = await gh.bacaIsi(repo, f.path);
      const { data, content } = matter(raw);
      return {
        slug: f.name.replace(/\.md$/, ''),
        ...data,
        // Frontmatter tanpa `lang` berarti bahasa utama — jangan biarkan undefined.
        lang: data.lang ?? 'id',
        date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date,
        kata: content.trim().split(/\s+/).filter(Boolean).length,
        diubah: f.last_modified || null,
      };
    }),
  );
  if (col.tanpaTanggal) items.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  cache.set(kunci, { waktu: Date.now(), data: items });
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

  /*
   * CORS — HANYA untuk rute publik yang memang dipanggil dari domain situs.
   *
   * Panel admin sendiri satu asal dengan API ini, jadi tidak butuh CORS.
   * Yang butuh cuma form kontak di xyverse.my.id, yang mengirim ke
   * admin.xyverse.my.id. Daftar asal dibiarkan sempit dan bisa diperluas
   * lewat CORS_ASAL (dipisah koma); '*' sengaja tidak pernah dipakai karena
   * rute lain membawa sesi dan kunci API.
   */
  const ASAL_DIIZINKAN = new Set(
    (process.env.CORS_ASAL || 'https://www.xyverse.my.id,https://xyverse.my.id,http://localhost:4321,http://127.0.0.1:4321')
      .split(',').map((x) => x.trim()).filter(Boolean),
  );
  const RUTE_PUBLIK = new Set(['/api/pesan']);

  /** Tulis kepala CORS bila asalnya diizinkan. Mengembalikan true bila ditulis. */
  const kepalaCors = (req, res) => {
    const asal = String(req.headers.origin || '');
    if (!ASAL_DIIZINKAN.has(asal)) return false;
    res.setHeader('access-control-allow-origin', asal);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '600');
    return true;
  };

  /*
   * Preflight ditangani DI SINI, bukan di middleware: router mencocokkan rute
   * memakai method dan path, jadi OPTIONS tidak pernah sampai ke `tengah`.
   * Tanpa ini peramban menerima 404 untuk preflight dan membatalkan
   * permintaan aslinya — form kontak akan gagal tanpa pesan yang jelas.
   */
  r.pra((req, res) => {
    if (!RUTE_PUBLIK.has(req.urlPath)) return json(res, 404, { error: 'Rute tidak ditemukan.' });
    kepalaCors(req, res);
    return json(res, 204, {});
  });

  r.pakai((req, res, next) => {
    if (RUTE_PUBLIK.has(req.urlPath)) kepalaCors(req, res);
    return next();
  });

  // tubuh JSON untuk POST/PUT/DELETE
  r.pakai(async (req, res, next) => {
    // Semua kata kerja yang bisa membawa tubuh JSON. PATCH sengaja ikut:
    // tanpa baris ini, PATCH /api/kunci/:id menerima req.body kosong dan
    // selalu dibalas "Tidak ada yang diubah."
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      req.body = await bacaBody(req);
    }
    next();
  });

  // Reject browser cross-origin mutations except the deliberately public contact form.
  r.pakai((req,res,next) => {
    res.setHeader('cache-control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.urlPath !== '/api/pesan' && req.headers.origin) {
      let same=false;
      try { same = new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (!same) return json(res,403,{error:'Asal permintaan tidak diizinkan.'});
    }
    next();
  });
  pasangAuth(r);

  // wajib masuk untuk semua rute kecuali endpoint autentikasi terbuka
  const TERBUKA = new Set([
    '/api/auth/konfig', '/api/auth/saya', '/api/auth/masuk', '/api/auth/keluar',
    // Form kontak situs: pengunjung belum tentu punya akun apa pun.
    '/api/pesan',
  ]);
  r.pakai((req, res, next) => {
    if (TERBUKA.has(req.urlPath)) return next();
    return wajibMasuk(req, res, next);
  });

  r.pakai(izin);
  pasangPlatform(r);

  /* ---- surat masuk dari form kontak situs ----
   *
   * Publik dengan sengaja: penjaganya ada di server/surat.js (honeypot,
   * batas laju per IP, batas panjang bidang).
   */
  r.jalan('POST', '/api/pesan', async (req, res) => {
    json(res, 200, await kirimPesan(req.body || {}, ipDari(req)));
  });

  pasangAI(r);

  /* ---- kunci API ----
   *
   * Rute ini berada di luar jangkauan kunci API dengan SENGAJA: yang boleh
   * membuat dan mencabut kunci hanyalah sesi peramban. Kalau kunci API bisa
   * menerbitkan kunci baru, satu kunci yang bocor bisa menanam kunci lain
   * yang tidak pernah muncul di daftar.
   */

  const wajibSesi = (req, res, next) => {
    if (req.admin?.jenis === 'sesi') return next();
    return json(res, 403, {
      error: 'Mengelola kunci API hanya bisa dari panel yang sedang masuk, bukan lewat kunci API.',
      kode: 'BUTUH_SESI',
    });
  };

  r.jalan('GET', '/api/kunci', wajibSesi, async (_req, res) => {
    json(res, 200, {
      kunci: await kunci.daftarPublik(),
      repo: kunci.INFO.repo(),
      jalur: kunci.INFO.jalur(),
      bootstrap: kunci.INFO.bootstrapAktif(),
      batasPerMenit: kunci.INFO.batasPerMenit,
    });
  });

  r.jalan('POST', '/api/kunci', wajibSesi, async (req, res) => {
    // kedaluwarsaHari : umur dalam hari (untuk manusia)
    // kedaluwarsaPada : stempel waktu ms mutlak, menang bila keduanya diisi
    const { label = '', kedaluwarsaHari = null, kedaluwarsaPada = null } = req.body || {};
    const baru = await kunci.buat({ label, kedaluwarsaHari, kedaluwarsaPada });
    // Teks polos hanya ada di respons ini dan tidak pernah disimpan ulang.
    json(res, 201, {
      ...baru,
      peringatan:
        'Salin sekarang. Kunci ini tidak bisa dilihat lagi setelah respons ini — ' +
        'yang tersimpan hanya hash-nya.',
    });
  });

  // Ubah label dan/atau masa berlaku tanpa membuat kunci baru.
  // Kirim hapusBatas: true untuk membuatnya berlaku selamanya.
  r.jalan('PATCH', '/api/kunci/:id', wajibSesi, async (req, res) => {
    const { label, kedaluwarsaHari, kedaluwarsaPada, hapusBatas } = req.body || {};
    json(res, 200, await kunci.ubah(req.params.id, {
      label, kedaluwarsaHari, kedaluwarsaPada, hapusBatas,
    }));
  });

  r.jalan('DELETE', '/api/kunci/:id', wajibSesi, async (req, res) => {
    json(res, 200, await kunci.cabut(req.params.id));
  });

  /* ---- gambar ----
   *
   * Rute literal, jadi tidak bentrok dengan wildcard /api/:col.
   * Boleh diakses sesi maupun kunci API: agen juga perlu menyisipkan gambar.
   */

  r.jalan('GET', '/api/media', async (_req, res) => {
    json(res, 200, await media.daftar());
  });

  r.jalan('POST', '/api/media', async (req, res) => {
    const { nama = '', dataBase64 = '', ekstensi = null } = req.body || {};
    const hasil = await media.simpan({ nama, dataBase64, ekstensiPaksa: ekstensi });
    // Di dev lokal, simpan salinan supaya pratinjau editor langsung hidup.
    // Fungsi ini tidak ada di Vercel Function — di sana gambar dilayani dari
    // hasil build repo situs.
    cerminMediaLokal(
      hasil.nama,
      Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, ''), 'base64'),
    );
    json(res, 201, hasil);
  });

  r.jalan('DELETE', '/api/media/:nama', async (req, res) => {
    const hasil = await media.hapus(req.params.nama);
    hapusCerminLokal(hasil.nama);
    json(res, 200, hasil);
  });

  /* ---- meta & statistik ---- */

  r.jalan('GET', '/api/meta', (_req, res) => {
    json(res, 200, {
      mode: 'serverless',
      repo: gh.reposSitus(),
      url: `https://github.com/${gh.reposSitus()}`,
      cabang: gh.CFG.cabang(),
      bahasa: BAHASA,
      media: {
        folder: media.INFO.folder(),
        repo: media.INFO.repo(),
        maksMB: media.INFO.maksMB,
        jenis: media.INFO.jenis,
      },
      kunciApi: {
        header: 'Authorization: Bearer xya_...',
        awalan: kunci.INFO.awalan,
        repo: kunci.INFO.repo(),
        jalur: kunci.INFO.jalur(),
        bootstrap: kunci.INFO.bootstrapAktif(),
        batasPerMenit: kunci.INFO.batasPerMenit,
      },
      collections: Object.entries(COLLECTIONS).map(([key, v]) => ({
        key,
        label: v.label,
        fields: v.fields,
        defaults: v.defaults,
        tanpaTanggal: Boolean(v.tanpaTanggal),
      })),
    });
  });

  r.jalan('GET', '/api/stats', async (_req, res) => {
    const out = {};
    for (const [key, col] of Object.entries(COLLECTIONS)) {
      // Dua bahasa dihitung terpisah; `total` = gabungan keduanya.
      const [id, en] = await Promise.all([daftarKoleksi(key, 'id'), daftarKoleksi(key, 'en')]);
      const draft = id.filter((i) => i.draft).length;
      out[key] = {
        label: col.label,
        total: id.length + en.length,
        draft,
        publik: id.length - draft,
        id: id.length,
        en: en.length,
      };
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

  r.jalan('GET','/api/history/:col/:slug',async(req,res)=>{
    const path=pathKonten(req.params.col,req.params.slug,bahasaDari(req.query.bahasa));
    json(res,200,{items:await gh.riwayat(gh.reposSitus(),path)});
  });
  r.jalan('GET','/api/history/:col/:slug/:sha',async(req,res)=>{
    if(!/^[a-f0-9]{40}$/.test(req.params.sha))throw new Galat('Revisi tidak valid.',400);
    const path=pathKonten(req.params.col,req.params.slug,bahasaDari(req.query.bahasa));
    const raw=await gh.bacaIsiBercabang(gh.reposSitus(),path,req.params.sha);
    const {data,content}=matter(raw);
    json(res,200,{frontmatter:{...data,date:data.date instanceof Date?data.date.toISOString().slice(0,10):data.date},body:content.trim()});
  });

  /* ---- CRUD konten (GitHub Contents API) ---- */

  r.jalan('GET', '/api/:col', async (req, res) => {
    const bahasa = bahasaDari(req.query?.bahasa);
    json(res, 200, await daftarKoleksi(req.params.col, bahasa));
  });

  /*
   * RUTE INI HARUS TERDAFTAR SEBELUM '/api/:col/:slug'.
   * Kalau tidak, 'terjemahan' akan tertangkap sebagai :slug.
   */
  r.jalan('GET', '/api/:col/terjemahan/:slug', async (req, res) => {
    const { col, slug } = req.params;
    const repo = gh.reposSitus();
    const ada = async (bahasa) => {
      try {
        await gh.bacaIsiBercabang(repo, pathKonten(col, slug, bahasa), gh.CFG.cabang());
        return true;
      } catch {
        return false;
      }
    };
    const [id, en] = await Promise.all([ada('id'), ada('en')]);
    json(res, 200, { slug, id, en, lengkap: id && en });
  });

  r.jalan('GET', '/api/:col/:slug', async (req, res) => {
    const bahasa = bahasaDari(req.query?.bahasa);
    const { col, slug } = req.params;
    const raw = await gh.bacaIsi(gh.reposSitus(), pathKonten(col, slug, bahasa));
    const { data, content } = matter(raw);
    json(res, 200, {
      slug,
      bahasa,
      frontmatter: { ...data, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date },
      body: content.trim(),
      revision: crypto.createHash('sha1').update(`blob ${Buffer.byteLength(raw)}\0${raw}`).digest('hex'),
    });
  });

  r.jalan('PUT', '/api/:col/:slug', async (req, res) => {
    const bahasa = bahasaDari(req.query?.bahasa ?? req.body?.bahasa);
    const { col, slug } = req.params;
    const cfg = COLLECTIONS[col];
    if (!cfg) throw new Galat('Koleksi tidak dikenal.', 400);
    const { frontmatter = {}, body = '', slugBaru } = req.body || {};
    if (!frontmatter.title) throw new Galat('Judul wajib diisi.', 400);
    if (req.body?.revision != null && !/^[a-f0-9]{40}$/.test(req.body.revision)) throw new Galat('Revisi tidak valid.',400);

    const fm = { ...cfg.defaults, ...frontmatter };
    // Bahasa ditentukan oleh folder tujuan, BUKAN oleh isi form — ini yang
    // mencegah frontmatter `lang` ketimpa saat berkas terjemahan disimpan.
    fm.lang = bahasa;
    if (!cfg.tanpaTanggal) {
      if (!fm.date) fm.date = new Date().toISOString().slice(0, 10);
      if (typeof fm.stack === 'string') fm.stack = fm.stack.split(',').map((s) => s.trim()).filter(Boolean);
      if (fm.baca != null) fm.baca = Number(fm.baca) || 5;
    } else if (!fm.diperbarui) {
      fm.diperbarui = tanggalPanjang(bahasa);
    }

    // hanya simpan field yang dikenal skema
    const clean = {};
    for (const k of cfg.fields) if (fm[k] !== undefined) clean[k] = fm[k];
    // Tanggal dinormalkan ke "YYYY-MM-DD".
    //
    // Disimpan sebagai STRING, bukan Date. gray-matter/js-yaml akan menulis
    // `date: '2026-09-03'` (diapit kutip). Kutip itu perlu: tanpa kutip YAML
    // membaca ulang nilainya sebagai Date, bukan string, dan tiap commit
    // berikutnya bolak-balik mengubah format. Situs tidak peduli — skemanya
    // `z.coerce.date()` di content.config.ts, jadi keduanya valid.
    if (clean.date instanceof Date) clean.date = clean.date.toISOString().slice(0, 10);
    // `diperbarui` di blog/berita/proyek adalah tanggal; di legal ia teks
    // tampilan ("17 September 2026"). Hanya yang benar-benar Date yang
    // dinormalkan, supaya teks di legal tidak ikut diubah.
    if (clean.diperbarui instanceof Date) clean.diperbarui = clean.diperbarui.toISOString().slice(0, 10);

    const repo = gh.reposSitus();
    const target = slugBaru ? slugify(slugBaru) : slug;
    const isi = matter.stringify(`\n${body.trim()}\n`, clean);
    const lokasi = bahasa === 'id' ? `${col}/${target}` : `${col}/en/${target}`;

    // Urutan sengaja: tulis berkas BARU dulu, baru hapus yang lama.
    // Kalau tulis gagal, tidak ada yang hilang; kalau hapus gagal,
    // konten tetap aman (hanya ada dua file — dilaporkan, bukan ditelan).
    const tersimpan = await gh.tulisBerkas(
      repo,
      pathKonten(col, target, bahasa),
      isi,
      slugBaru
        ? `Buat ${lokasi} (via dashboard: ${req.admin?.pengguna || req.admin?.id || "API"})`
        : `Perbarui ${lokasi} (via dashboard: ${req.admin?.pengguna || req.admin?.id || "API"})`,
      req.body?.create === true ? null : req.body?.revision,
    );

    if (slugBaru && target !== slug) {
      try {
        await gh.hapusBerkas(
          repo,
          pathKonten(col, slug, bahasa),
          `Ganti nama ${lokasi} ← ${bahasa === 'id' ? col : col + '/en'}/${slug} (via dashboard)`,
        );
      } catch (e) {
        if (e.status !== 404) {
          cache.delete(`${col}:${bahasa}`);
          throw new Galat(
            `Berkas "${target}" dibuat, tetapi berkas lama "${slug}" gagal dihapus: ${e.message}. Hapus manual bila perlu.`,
            502,
          );
        }
      }
    }
    cache.delete(`${col}:${bahasa}`);
    await db.audit(req.admin?.pengguna || req.admin?.id || 'API', 'content_saved', lokasi);
    json(res, 200, { ok: true, slug: target, bahasa, ...tersimpan });
  });

  r.jalan('DELETE', '/api/:col/:slug', async (req, res) => {
    const bahasa = bahasaDari(req.query?.bahasa);
    const { col, slug } = req.params;
    await gh.hapusBerkas(
      gh.reposSitus(),
      pathKonten(col, slug, bahasa),
      `Hapus ${bahasa === 'id' ? col : col + '/en'}/${slug} (via dashboard)`,
    );
    cache.delete(`${col}:${bahasa}`);
    json(res, 200, { ok: true });
  });

  return r;
}

const router = buatRouter();

/** Gerbang utama: tangani permintaan /api/* (dev server & Vercel Function). */
export function tanganiApi(req, res) {
  return router.tangani(req, res);
}
