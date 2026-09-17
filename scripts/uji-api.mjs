/**
 * Uji asap (smoke test) untuk router inti — server/core.js.
 *
 * Menjalankan kode produksi yang SESUNGGUHNYA (`tanganiApi`), dengan
 * `fetch` global dipalsukan supaya tidak menyentuh GitHub. Bertujuan
 * mengunci perilaku yang dulu rusak:
 *
 *   1. Menyimpan berkas `en/...` harus tetap menulis `lang: "en"`
 *      (dulu `lang` dibuang whitelist field -> halaman EN lenyap dari situs).
 *   2. Tanggal disimpan sebagai `date: 2026-09-03`, bukan ISO penuh.
 *   3. Koleksi `legal` terdaftar dan bisa dibaca/ditulis.
 *   4. Bahasa yang tidak dikenal ditolak 400, bukan diam-diam jadi `id`.
 *
 * Jalankan:  node scripts/uji-api.mjs
 */

import bcrypt from 'bcryptjs';
import matter from 'gray-matter';

/* ---- lingkungan harus diset SEBELUM server/ apa pun diimpor ---- */
process.env.GH_TOKEN = 'ghp_uji_palsu';
process.env.GH_OWNER = 'xykalnotkel';
process.env.GH_SITE_REPO = 'xyverse-web';
process.env.GH_ADMIN_REPO = 'xyverse-admin';
process.env.GH_BRANCH = 'main';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS_HASH = bcrypt.hashSync('sandi-uji-api', 10);
process.env.SESSION_SECRET = 'x'.repeat(48);

const { tanganiApi } = await import('../server/core.js');

/* ---- GitHub API tiruan ---- */
const MD_EN = matter.stringify('\nIsi EN\n', {
  title: 'Parsec vs RDP (EN)', desc: 'EN desc', date: '2026-09-03',
  kategori: 'Technical', baca: 5, lang: 'en',
});
const isiLama = {
  'src/content/blog/en/parsec-vs-rdp.md': MD_EN,
  'src/content/blog/parsec-vs-rdp.md': matter.stringify('\nIsi ID\n', {
    title: 'Parsec vs RDP', desc: 'ID desc', date: '2026-09-03', kategori: 'Teknis', baca: 5,
  }),
};
const ditulis = [];   // { path, pesan, isi }
const dihapus = [];   // path

const okJSON = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opsi = {}) => {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
  const method = (opsi.method || 'GET').toUpperCase();

  if (method === 'PUT') {
    const muatan = JSON.parse(opsi.body);
    const isi = Buffer.from(muatan.content, 'base64').toString('utf8');
    ditulis.push({ path, pesan: muatan.message, isi });
    isiLama[path] = isi; // tirukan efek commit agar lookup SHA berikutnya jalan
    return okJSON({ commit: { sha: 'c0ffee' }, content: { sha: 'beef' } });
  }
  if (method === 'DELETE') {
    dihapus.push(path);
    delete isiLama[path];
    return okJSON({ commit: { sha: 'd0d' } });
  }
  // GET — daftar direktori bila path tanpa .md
  if (!path.endsWith('.md')) {
    // GitHub Contents API tidak rekursif: hanya anak langsung folder ini.
    const daftar = Object.keys(isiLama)
      .filter((p) => p.startsWith(path + '/'))
      .filter((p) => !p.slice(path.length + 1).includes('/'))
      .filter((p) => p.endsWith('.md'))
      .map((p) => ({ name: p.split('/').pop(), path: p, type: 'file', last_modified: '2026-09-01T00:00:00Z' }));
    return okJSON(daftar);
  }
  if (isiLama[path] != null) {
    // `accept: application/vnd.github.raw+json` -> isi mentah (dipakai bacaIsi).
    if ((opsi.headers?.accept || '').includes('raw')) {
      return new Response(isiLama[path], { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    // metadata konten, termasuk `sha` yang dibutuhkan tulis/hapus.
    return okJSON({ name: path.split('/').pop(), path, sha: 'sha-' + path.length, type: 'file' });
  }
  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
};

/* ---- panggil router inti langsung (req/res tiruan, tanpa HTTP) ----
 * Catatan: `globalThis.fetch` di atas juga menangkap fetch dari tes ini,
 * jadi permintaan tidak boleh dikirim lewat jaringan — cukup panggil
 * `tanganiApi` dengan objek req/res palsu. Ini tetap menjalankan kode
 * produksi yang sama persis dengan Vercel Function (api/all.js).
 */
import { Readable } from 'node:stream';

function kirim(method, url, { body, cookie } = {}) {
  return new Promise((selesai) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body), "utf8")] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.connection = req.socket;

    const kepala = {};
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader(k, v) { kepala[k.toLowerCase()] = v; },
      getHeader(k) { return kepala[k.toLowerCase()]; },
      end(t) {
        this.writableEnded = true;
        let data = null;
        try { data = t ? JSON.parse(t) : null; } catch { data = t; }
        selesai({ status: this.statusCode, data, kepala: { ...kepala } });
      },
    };

    tanganiApi(req, res);
  });
}

let gagal = 0;
const cek = (nama, syarat, detail = '') => {
  if (syarat) console.log(`  ok   ${nama}`);
  else { gagal++; console.log(`  GAGAL ${nama}${detail ? ' → ' + detail : ''}`); }
};

/* ---- masuk ---- */
const masuk = await kirim('POST', '/api/auth/masuk', {
  body: { pengguna: 'admin', sandi: 'sandi-uji-api' },
});
const HDR = (r) => r[Object.keys(r).find((k) => k !== 'status' && k !== 'data')] || {};
const cookie = (HDR(masuk)['set-cookie'] || '').split(';')[0];
cek('login berhasil', masuk.status === 200 && Boolean(cookie), `status ${masuk.status} cookie=${cookie}`);
const H = { cookie };

console.log('\n[1] GET daftar per bahasa');
const listEN = (await kirim('GET', '/api/blog?bahasa=en', H)).data;
cek('blog EN terbaca', listEN.length === 1 && listEN[0].slug === 'parsec-vs-rdp', JSON.stringify(listEN));
cek('field lang terbawa di daftar', listEN[0]?.lang === 'en', `lang=${listEN[0]?.lang}`);
const listID = (await kirim('GET', '/api/blog', H)).data;
cek('blog ID terbaca (default id)', listID.length === 1 && listID[0]?.lang === 'id', JSON.stringify(listID.map((i) => i.slug + ':' + i.lang)));

console.log('\n[2] PUT berkas EN — ini bug yang dulu merusak');
ditulis.length = 0;
const simpanEN = await kirim('PUT', '/api/blog/parsec-vs-rdp?bahasa=en', {
  ...H,
  body: { frontmatter: { title: 'Parsec vs RDP (EN)', desc: 'EN desc', date: '2026-09-03', kategori: 'Technical', baca: 5 }, body: 'Isi EN' },
});
cek('simpan EN 200', simpanEN.status === 200, `status ${simpanEN.status} ${JSON.stringify(simpanEN.data)}`);
cek('path tulis ke folder en/', ditulis[0]?.path === 'src/content/blog/en/parsec-vs-rdp.md', ditulis[0]?.path);
const fmEN = matter(ditulis[0]?.isi || '').data;
cek('frontmatter masih punya lang: "en"', fmEN.lang === 'en', `lang=${fmEN.lang}`);
// js-yaml mengutip tanggal karena nilainya string — itu disengaja, lihat core.js.
cek('tanggal ditulis YYYY-MM-DD', /(^|\n)date: '?2026-09-03'?(\n|$)/.test(ditulis[0]?.isi || ''), JSON.stringify((ditulis[0]?.isi || '').split('\n').find((l) => l.startsWith('date'))));
cek('pesan commit menyebut blog/en/', /blog\/en\/parsec-vs-rdp/.test(ditulis[0]?.pesan || ''), ditulis[0]?.pesan);

console.log('\n[3] PUT berkas ID');
ditulis.length = 0;
await kirim('PUT', '/api/blog/parsec-vs-rdp', {
  ...H,
  body: { frontmatter: { title: 'Parsec vs RDP', desc: 'ID desc', date: '2026-09-03', kategori: 'Teknis', baca: 5 }, body: 'Isi ID' },
});
cek('path tulis ke folder utama', ditulis[0]?.path === 'src/content/blog/parsec-vs-rdp.md', ditulis[0]?.path);
cek('lang ID tertulis eksplisit', matter(ditulis[0]?.isi || '').data.lang === 'id');

console.log('\n[4] Koleksi legal');
isiLama['src/content/legal/sla.md'] = matter.stringify('\n## 1. Cakupan\n', {
  title: 'SLA', desc: 'Uptime', diperbarui: '16 September 2026', ringkas: 'Ringkas', lang: 'id',
});
isiLama['src/content/legal/en/sla.md'] = matter.stringify('\n## 1. Scope\n', {
  title: 'SLA (EN)', desc: 'Uptime', diperbarui: '16 September 2026', ringkas: 'Summary', lang: 'en',
});
const legalID = (await kirim('GET', '/api/legal', H)).data;
cek('legal ID terdaftar', Array.isArray(legalID) && legalID[0]?.slug === 'sla', JSON.stringify(legalID));
const stats = (await kirim('GET', '/api/stats', H)).data;
cek('stats punya legal', stats.legal?.total === 2, JSON.stringify(stats.legal));
cek('stats blog id/en terpisah', stats.blog?.id === 1 && stats.blog?.en === 1, JSON.stringify(stats.blog));

ditulis.length = 0;
await kirim('PUT', '/api/legal/sla?bahasa=en', {
  ...H,
  body: { frontmatter: { title: 'SLA (EN)', desc: 'Uptime', diperbarui: '16 September 2026', ringkas: 'Summary' }, body: '## 1. Scope' },
});
cek('legal EN ditulis ke legal/en/', ditulis[0]?.path === 'src/content/legal/en/sla.md', ditulis[0]?.path);
const fmLegal = matter(ditulis[0]?.isi || '').data;
cek('legal EN punya lang + diperbarui', fmLegal.lang === 'en' && fmLegal.diperbarui === '16 September 2026', JSON.stringify(fmLegal));
cek('legal tanpa kolom date', fmLegal.date === undefined, `date=${fmLegal.date}`);

console.log('\n[5] Validasi bahasa');
const logAsli = console.error;
console.error = () => {}; // 400 di bawah memang diharapkan, jangan bikin bising
const buruk = await kirim('GET', '/api/blog?bahasa=jawa', H);
console.error = logAsli;
cek('bahasa tak dikenal → 400', buruk.status === 400, `status ${buruk.status}`);
cek('rute tanpa login → 401', (await kirim('GET', '/api/blog')).status === 401);

console.log('\n[6] Rename di dalam namespace EN tidak menyentuh ID');
ditulis.length = 0; dihapus.length = 0;
const galatDitangkap = [];
const logAsli2 = console.error;
console.error = (e) => galatDitangkap.push(e);
await kirim('PUT', '/api/blog/parsec-vs-rdp?bahasa=en', {
  ...H,
  body: { frontmatter: { title: 'Parsec vs RDP (EN)', desc: 'EN', date: '2026-09-03', kategori: 'Technical', baca: 5 }, body: 'Isi EN', slugBaru: 'parsec-vs-rdp-baru' },
});
console.error = logAsli2;
cek('berkas baru di en/', ditulis[0]?.path === 'src/content/blog/en/parsec-vs-rdp-baru.md', ditulis[0]?.path);
cek('yang dihapus juga di en/', dihapus[0] === 'src/content/blog/en/parsec-vs-rdp.md',
  `dihapus=${JSON.stringify(dihapus)} galat=${galatDitangkap.map((e) => e?.message || e).join('; ')}`);

console.log('\n[7] meta menyebut legal + bahasa');
const meta = (await kirim('GET', '/api/meta', H)).data;
cek('meta.bahasa = [id, en]', JSON.stringify(meta.bahasa) === '["id","en"]', JSON.stringify(meta.bahasa));
cek('meta.collections memuat legal', meta.collections.some((c) => c.key === 'legal'));

console.log(gagal ? `\n${gagal} pemeriksaan GAGAL\n` : '\nSemua pemeriksaan lolos\n');
process.exit(gagal ? 1 : 0);
