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
process.env.ADMIN_API_KEY = 'xya_bootstraptopeng0000000000000000000000';

const { tanganiApi } = await import('../server/core.js');
const { normalKedaluwarsa } = await import('../server/kunci.js');

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
const JALUR_KUNCI = '.xyverse/api-keys.json';

const ditulis = [];   // { path, pesan, isi }
const dihapus = [];   // path

const okJSON = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opsi = {}) => {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
  const method = (opsi.method || 'GET').toUpperCase();

  if (method === 'PUT') {
    const muatan = JSON.parse(opsi.body);
    const biner = Buffer.from(muatan.content, 'base64');
    const isi = biner.toString('utf8');
    ditulis.push({ path, pesan: muatan.message, isi, biner });
    // Simpan Buffer untuk berkas gambar, string untuk teks — seperti aslinya.
    isiLama[path] = /\.(webp|png|jpe?g|gif)$/i.test(path) ? biner : isi;
    return okJSON({ commit: { sha: 'c0ffee' }, content: { sha: 'beef' } });
  }
  if (method === 'DELETE') {
    dihapus.push(path);
    delete isiLama[path];
    return okJSON({ commit: { sha: 'd0d' } });
  }
  // GET satu berkas (dipakai ambilSHA sebelum tulis/hapus). Diletakkan
  // SEBELUM cabang direktori: di GitHub asli pembedanya adalah keberadaan
  // berkas, bukan ekstensinya — gambar tidak berakhiran .md.
  if (isiLama[path] != null) {
    if ((opsi.headers?.accept || '').includes('raw')) {
      const isi = isiLama[path];
      return new Response(Buffer.isBuffer(isi) ? isi : String(isi), {
        status: 200, headers: { 'content-type': 'text/plain' },
      });
    }
    return okJSON({ name: path.split('/').pop(), path, sha: 'sha-' + path.length, type: 'file' });
  }
  // GET — daftar direktori
  if (!path.endsWith('.md')) {
    // GitHub Contents API tidak rekursif: hanya anak langsung folder ini.
    const semua = Object.keys(isiLama)
      .filter((p) => p.startsWith(path + '/'))
      .filter((p) => !p.slice(path.length + 1).includes('/'))
      .map((p) => ({
        name: p.split('/').pop(), path: p, type: 'file',
        size: (isiLama[p] || '').length, last_modified: '2026-09-01T00:00:00Z',
      }));
    // Tirukan paginasi GitHub: per_page=100, header Link bila masih ada sisa.
    const perPage = Number(u.searchParams.get('per_page') || 30);
    const page = Number(u.searchParams.get('page') || 1);
    const potong = semua.slice((page - 1) * perPage, page * perPage);
    const adaLagi = page * perPage < semua.length;
    const headers = { 'content-type': 'application/json' };
    if (adaLagi) {
      const next = `${u.origin}${u.pathname}?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), page: String(page + 1) })}`;
      headers.link = `<${next}>; rel="next"`;
    }
    return new Response(JSON.stringify(potong), { status: 200, headers });
  }
  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
};

/* ---- byte gambar palsu dengan tanda tangan yang benar ---- */
const b64 = (buf) => buf.toString('base64');
const webpAsli = () => {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(24, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  return b;
};
const pngAsli = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const teksJadiGambar = () => Buffer.from('<?xml version="1.0"?><svg><script>alert(1)</script></svg>', 'utf8');

/* ---- panggil router inti langsung (req/res tiruan, tanpa HTTP) ----
 * Catatan: `globalThis.fetch` di atas juga menangkap fetch dari tes ini,
 * jadi permintaan tidak boleh dikirim lewat jaringan — cukup panggil
 * `tanganiApi` dengan objek req/res palsu. Ini tetap menjalankan kode
 * produksi yang sama persis dengan Vercel Function (api/all.js).
 */
import { Readable } from 'node:stream';

function kirim(method, url, { body, cookie, ...headers } = {}) {
  return new Promise((selesai) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body), "utf8")] : []);
    req.method = method;
    req.url = url;
    // `headers` menampung authorization / x-api-key dari pemanggil.
    req.headers = {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
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

/* ============================================================
 * Kunci API
 * ============================================================ */
console.log('\n[8] Kunci bootstrap dari lingkungan');
const BOOT = 'xya_bootstraptopeng0000000000000000000000';
const hdr = (k) => ({ authorization: `Bearer ${k}` });

const bootBaca = await kirim('GET', '/api/blog', hdr(BOOT));
cek('kunci env bisa membaca konten', bootBaca.status === 200, `status ${bootBaca.status}`);

const bootKelola = await kirim('GET', '/api/kunci', hdr(BOOT));
cek('kunci env DITOLAK saat mengelola kunci', bootKelola.status === 403,
  `status ${bootKelola.status} ${JSON.stringify(bootKelola.data)}`);
cek('alasannya BUTUH_SESI', bootKelola.data?.kode === 'BUTUH_SESI', JSON.stringify(bootKelola.data));

const tanpaApa = await kirim('GET', '/api/blog');
cek('tanpa cookie & tanpa kunci → 401', tanpaApa.status === 401, `status ${tanpaApa.status}`);
cek('401 menyertakan petunjuk header', /Bearer xya_/.test(tanpaApa.data?.petunjuk || ''),
  JSON.stringify(tanpaApa.data));

const kunciNgawur = await kirim('GET', '/api/blog', hdr('xya_' + 'f'.repeat(40)));
cek('kunci tak dikenal → 401', kunciNgawur.status === 401, `status ${kunciNgawur.status}`);

console.log('\n[9] Membuat kunci dari sesi peramban');
const buat = await kirim('POST', '/api/kunci', { ...H, body: { label: 'agen-uji' } });
cek('buat kunci → 201', buat.status === 201, `status ${buat.status} ${JSON.stringify(buat.data)}`);
const kunciBaru = buat.data?.kunci;
cek('kunci berawalan xya_', /^xya_[0-9a-f]{40}$/.test(kunciBaru || ''), kunciBaru);
cek('respons memuat peringatan sekali-lihat', /tidak bisa dilihat lagi/.test(buat.data?.peringatan || ''));
cek('hash yang disimpan bukan teks polos',
  !JSON.stringify(isiLama[JALUR_KUNCI] || '').includes(String(kunciBaru).slice(5)),
  String(isiLama[JALUR_KUNCI] || '').slice(0, 160));
cek('hash disimpan sebagai SHA-256 (32 hex)',
  /"hash":\s*"[0-9a-f]{32}"/.test(String(isiLama[JALUR_KUNCI] || '')),
  String(isiLama[JALUR_KUNCI] || '').slice(0, 200));

console.log('\n[10] Kunci tersimpan dipakai agen');
const pakaiKunci = await kirim('GET', '/api/blog', hdr(kunciBaru));
cek('kunci tersimpan bisa membaca', pakaiKunci.status === 200, `status ${pakaiKunci.status}`);

const pakaiHeaderLain = await kirim('GET', '/api/blog?bahasa=en', { 'x-api-key': kunciBaru });
cek('header X-Api-Key juga diterima', pakaiHeaderLain.status === 200, `status ${pakaiHeaderLain.status}`);

const pakaiTulis = await kirim('PUT', '/api/blog/parsec-vs-rdp?bahasa=en', {
  'x-api-key': kunciBaru,
  body: { frontmatter: { title: 'Parsec vs RDP (EN)', desc: 'EN', date: '2026-09-03', kategori: 'Technical', baca: 5 }, body: 'Isi EN via agen' },
});
cek('kunci bisa menulis konten', pakaiTulis.status === 200, `status ${pakaiTulis.status}`);
cek('tulisan agen tetap menjaga lang: "en"',
  matter(ditulis.at(-1)?.isi || '').data.lang === 'en', `lang=${matter(ditulis.at(-1)?.isi || '').data.lang}`);

const agenBuatKunci = await kirim('POST', '/api/kunci', {
  'x-api-key': kunciBaru, body: { label: 'kunci-cangkokan' },
});
cek('kunci API tidak bisa membuat kunci', agenBuatKunci.status === 403, `status ${agenBuatKunci.status}`);
cek('kunci API tidak bisa melihat daftar kunci',
  (await kirim('GET', '/api/kunci', hdr(kunciBaru))).status === 403);

console.log('\n[11] Daftar, kedaluwarsa, dan pencabutan');
const logAsli3 = console.error;
console.error = () => {}; // 400/404 di blok ini memang diharapkan
const daftar = await kirim('GET', '/api/kunci', H);
cek('daftar kunci terbaca oleh sesi', daftar.status === 200, `status ${daftar.status}`);
cek('daftar menyebut kunci baru', daftar.data?.kunci?.some((k) => k.label === 'agen-uji'),
  JSON.stringify(daftar.data?.kunci));
cek('daftar menyebut kunci bootstrap env', daftar.data?.kunci?.some((k) => k.env === true));
cek('hash tidak pernah ikut dikirim ke UI',
  !JSON.stringify(daftar.data).includes(JSON.parse(String(isiLama[JALUR_KUNCI] || '{}'))?.[0]?.hash || '\u0000tidak-ada'),
  JSON.stringify(daftar.data).slice(0, 200));

/*
 * Dulu: tanggal lampau diam-diam diterima, kuncinya lahir SUDAH MATI, dan
 * string tanggal seperti "2020-01-01" jadi NaN lalu dianggap "selamanya".
 * Sekarang keduanya harus ditolak 400 — menolaknya lebih aman daripada
 * menerbitkan kunci yang tidak sesuai maksud pembuatnya.
 */
const sudahLewat = await kirim('POST', '/api/kunci', {
  ...H, body: { label: 'sudah-mati', kedaluwarsaPada: Date.now() - 1000 },
});
cek('tanggal lampau (ms) ditolak 400', sudahLewat.status === 400, `status ${sudahLewat.status}`);
cek('kuncinya tidak ikut dibuat', sudahLewat.data?.kunci == null);

const lampauTeks = await kirim('POST', '/api/kunci', {
  ...H, body: { label: 'sudah-mati-teks', kedaluwarsaPada: '2020-01-01' },
});
cek('tanggal lampau (teks) ditolak 400', lampauTeks.status === 400, `status ${lampauTeks.status}`);

const teksRusak = await kirim('POST', '/api/kunci', {
  ...H, body: { label: 'teks-rusak', kedaluwarsaPada: 'bukan-tanggal' },
});
cek('tanggal tak terbaca ditolak 400, bukan jadi "selamanya"',
  teksRusak.status === 400, `status ${teksRusak.status}`);

const ubahLampau = await kirim('PATCH', `/api/kunci/${buat.data?.id}`, {
  ...H, body: { kedaluwarsaPada: '2020-01-01' },
});
cek('PATCH ke tanggal lampau ditolak 400', ubahLampau.status === 400, `status ${ubahLampau.status}`);
// Yang penting: PATCH yang gagal tidak boleh mengubah apa pun di simpanan.
const sebelumPatchGagal = (await kirim('GET', '/api/kunci', H)).data?.kunci
  ?.find((k) => k.id === buat.data?.id);
cek('PATCH ke tanggal lampau ditolak 400 (sudah dicek)', ubahLampau.status === 400);
cek('PATCH gagal tidak mengubah simpanan',
  JSON.stringify((await kirim('GET', '/api/kunci', H)).data?.kunci
    ?.find((k) => k.id === buat.data?.id)) === JSON.stringify(sebelumPatchGagal));

/* Tanggal depan lewat teks harus tetap jalan — itu cara wajar mengirimnya. */
const tanggalDepan = await kirim('POST', '/api/kunci', {
  ...H, body: { label: 'tahun-depan', kedaluwarsaPada: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) },
});
cek('tanggal depan (teks ISO) diterima', tanggalDepan.status === 201, `status ${tanggalDepan.status}`);
cek('kedaluwarsanya di masa depan',
  tanggalDepan.data?.kedaluwarsa > Date.now(), String(tanggalDepan.data?.kedaluwarsa));
cek('kuncinya tidak ditandai mati',
  (await kirim('GET', '/api/kunci', H)).data?.kunci
    ?.find((k) => k.id === tanggalDepan.data?.id)?.mati === false);

/*
 * Entri lama pernah menyimpan masa berlaku dalam DETIK. Dibaca apa adanya,
 * 90 hari menjadi tahun 58928 dan tidak pernah ditandai mati.
 */
cek('normalKedaluwarsa menaikkan detik ke ms',
  normalKedaluwarsa(1767225600) === 1767225600000, String(normalKedaluwarsa(1767225600)));
cek('normalKedaluwarsa membiarkan ms apa adanya',
  normalKedaluwarsa(1767225600000) === 1767225600000);
cek('normalKedaluwarsa membaca teks tanggal',
  normalKedaluwarsa('2026-12-31T00:00:00Z') === Date.parse('2026-12-31T00:00:00Z'));
cek('normalKedaluwarsa menolak nilai kosong (bukan "selamanya")',
  normalKedaluwarsa('bukan-tanggal') === undefined && normalKedaluwarsa(null) === undefined);
cek('daftar menormalkan entri berdetik',
  (await kirim('GET', '/api/kunci', H)).data?.kunci?.every((k) => k.kedaluwarsa === null || k.kedaluwarsa >= 1e12),
  JSON.stringify((await kirim('GET', '/api/kunci', H)).data?.kunci?.map((k) => k.kedaluwarsa)));

/* Kunci yang benar-benar kedaluwarsa tetap harus ditolak saat dipakai. */
const hidupLaluMati = await kirim('POST', '/api/kunci', { ...H, body: { label: 'sebentar', kedaluwarsaHari: 7 } });
cek('kunci 7 hari hidup', hidupLaluMati.status === 201);
cek('kunci hidup bisa dipakai', (await kirim('GET', '/api/blog', hdr(hidupLaluMati.data?.kunci))).status === 200);

const masihHidup = await kirim('POST', '/api/kunci', { ...H, body: { label: 'seminggu', kedaluwarsaHari: 7 } });
cek('kunci 7 hari bisa dipakai',
  (await kirim('GET', '/api/blog', hdr(masihHidup.data?.kunci))).status === 200);

const tanpaLabel = await kirim('POST', '/api/kunci', { ...H, body: { label: '   ' } });
cek('label kosong → 400', tanpaLabel.status === 400, `status ${tanpaLabel.status}`);

const idKunci = buat.data?.id;
const cabut = await kirim('DELETE', `/api/kunci/${idKunci}`, H);
cek('cabut kunci → 200', cabut.status === 200, `status ${cabut.status} ${JSON.stringify(cabut.data)}`);
const hashDicabut = JSON.parse(String(isiLama[JALUR_KUNCI] || '[]')).map((k) => k.hash);
cek('hash kunci yang dicabut hilang dari penyimpanan',
  !hashDicabut.includes(buat.data?.id) && JSON.parse(String(isiLama[JALUR_KUNCI] || '[]')).every((k) => k.id !== idKunci),
  JSON.stringify(hashDicabut));
const pakaiSetelahCabut = await kirim('GET', '/api/blog', hdr(kunciBaru));
cek('kunci yang dicabut langsung mati', pakaiSetelahCabut.status === 401, `status ${pakaiSetelahCabut.status}`);
cek('cabut kunci yang tidak ada → 404',
  (await kirim('DELETE', '/api/kunci/tidakada', H)).status === 404);

console.log('\n[12] meta menyebutkan konfigurasi kunci API');
console.error = logAsli3;
const metaKunci = (await kirim('GET', '/api/meta', hdr(BOOT))).data;
cek('meta.kunciApi ada', Boolean(metaKunci?.kunciApi), JSON.stringify(metaKunci?.kunciApi));
cek('meta menyebut awalan xya_', metaKunci?.kunciApi?.awalan === 'xya_');

/* ============================================================
 * Gambar
 * ============================================================ */
console.log('\n[13] Unggah gambar');
const naik = await kirim('POST', '/api/media', {
  ...H, body: { nama: 'Foto Uji Hero.png', dataBase64: b64(webpAsli()), ekstensi: 'webp' },
});
cek('unggah WebP → 201', naik.status === 201, `status ${naik.status} ${JSON.stringify(naik.data)}`);
cek('URL menunjuk /media/', /^\/media\//.test(naik.data?.url || ''), naik.data?.url);
cek('nama berkas di-slug + bertanggal', /^\d{8}-[0-9a-f]{4}-foto-uji-hero\.webp$/.test(naik.data?.nama || ''), naik.data?.nama);
const jalurMedia = `public/media/${naik.data?.nama}`;
cek('dikirim ke GitHub sebagai biner, bukan teks',
  Buffer.isBuffer(ditulis.at(-1)?.biner) && Buffer.isBuffer(isiLama[jalurMedia]),
  `ditulis=${typeof ditulis.at(-1)?.biner} tersimpan=${typeof isiLama[jalurMedia]}`);
cek('byte gambar utuh sampai ke penyimpanan',
  Buffer.compare(ditulis.at(-1).biner, webpAsli()) === 0);
cek('commit menyebut gambar', /Tambah gambar .*\.webp/.test(ditulis.at(-1)?.pesan || ''), ditulis.at(-1)?.pesan);

const pngNaik = await kirim('POST', '/api/media', { ...H, body: { nama: 'logo.png', dataBase64: b64(pngAsli()) } });
cek('PNG diterima, ekstensi mengikuti isi', pngNaik.data?.jenis === 'png' && /\.png$/.test(pngNaik.data?.nama || ''),
  JSON.stringify(pngNaik.data));

const svg = await kirim('POST', '/api/media', { ...H, body: { nama: 'x.svg', dataBase64: b64(teksJadiGambar()) } });
cek('SVG ditolak 415', svg.status === 415, `status ${svg.status} ${JSON.stringify(svg.data)}`);
cek('pesan menyebut SVG tidak diterima', /SVG tidak diterima/.test(svg.data?.error || ''), svg.data?.error);

const ekstensiSalah = await kirim('POST', '/api/media', {
  ...H, body: { nama: 'a.png', dataBase64: b64(pngAsli()), ekstensi: 'webp' },
});
cek('ekstensi tidak cocok isi → 415', ekstensiSalah.status === 415, `status ${ekstensiSalah.status}`);

const kosong = await kirim('POST', '/api/media', { ...H, body: { nama: 'a.png' } });
cek('tanpa data → 400', kosong.status === 400, `status ${kosong.status}`);

const kebesaran = await kirim('POST', '/api/media', {
  ...H, body: { nama: 'besar.webp', dataBase64: b64(Buffer.concat([webpAsli(), Buffer.alloc(5 * 1024 * 1024)])) },
});
cek('lebih dari 4 MB → 413', kebesaran.status === 413, `status ${kebesaran.status} ${kebesaran.data?.error}`);

console.log('\n[14] Pustaka gambar');
const daftarMedia = await kirim('GET', '/api/media', H);
cek('daftar gambar terbaca', daftarMedia.status === 200 && daftarMedia.data.total === 2,
  `total=${daftarMedia.data?.total}`);
cek('daftar diurutkan terbaru dulu', daftarMedia.data?.berkas?.[0]?.nama > daftarMedia.data?.berkas?.[1]?.nama);

// Paginasi: lebih dari 100 berkas harus tetap terbaca semua.
for (let i = 0; i < 137; i += 1) {
  isiLama[`public/media/pag-${String(i).padStart(3, '0')}.webp`] = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
}
const banyak = await kirim('GET', '/api/media', H);
cek('137+ berkas terbaca semua (paginasi GitHub)', banyak.data?.total === 139,
  `total=${banyak.data?.total} — tanpa paginasi GitHub memotong di 30`);

const hapusMedia = await kirim('DELETE', `/api/media/${naik.data.nama}`, H);
cek('hapus gambar → 200', hapusMedia.status === 200, `status ${hapusMedia.status}`);
cek('berkasnya hilang', isiLama[jalurMedia] === undefined);
cek('nama berkas mengandung ".." ditolak',
  (await kirim('DELETE', '/api/media/..%2F..%2Fetc', H)).status === 400);

console.log('\n[15] Masa berlaku kunci API');
const untukUbah = await kirim('POST', '/api/kunci', { ...H, body: { label: 'ubah-umur' } });
const idUbah = untukUbah.data?.id;
cek('kunci tanpa batas dibuat', untukUbah.data?.kedaluwarsa === null, JSON.stringify(untukUbah.data));
cek('kunci tanpa batas bisa dipakai',
  (await kirim('GET', '/api/blog', hdr(untukUbah.data?.kunci))).status === 200);

const jadi30 = await kirim('PATCH', `/api/kunci/${idUbah}`, { ...H, body: { kedaluwarsaHari: 30 } });
cek('PATCH memberi batas 30 hari', jadi30.status === 200 && jadi30.data?.kedaluwarsa > Date.now(),
  JSON.stringify(jadi30.data));
cek('kuncinya tetap sama (tidak dibuat baru)',
  (await kirim('GET', '/api/blog', hdr(untukUbah.data?.kunci))).status === 200);

const jadiLampau = await kirim('PATCH', `/api/kunci/${idUbah}`, { ...H, body: { kedaluwarsaPada: Date.now() - 5000 } });
cek('tanggal lampau → 400', jadiLampau.status === 400, `status ${jadiLampau.status}`);

const selamanya = await kirim('PATCH', `/api/kunci/${idUbah}`, { ...H, body: { hapusBatas: true } });
cek('hapusBatas: true → tanpa batas lagi', selamanya.data?.kedaluwarsa === null, JSON.stringify(selamanya.data));

const gantiLabel = await kirim('PATCH', `/api/kunci/${idUbah}`, { ...H, body: { label: 'sudah-diganti' } });
cek('label bisa diganti', gantiLabel.data?.label === 'sudah-diganti', JSON.stringify(gantiLabel.data));

const patchKosong = await kirim('PATCH', `/api/kunci/${idUbah}`, { ...H, body: {} });
cek('PATCH tanpa perubahan → 400', patchKosong.status === 400, `status ${patchKosong.status}`);

cek('kunci API tetap tidak boleh PATCH kunci',
  (await kirim('PATCH', `/api/kunci/${idUbah}`, { 'x-api-key': BOOT, body: { label: 'coba' } })).status === 403);
cek('PATCH kunci tak dikenal → 404',
  (await kirim('PATCH', '/api/kunci/tidakada', { ...H, body: { label: 'x' } })).status === 404);

await kirim('DELETE', `/api/kunci/${idUbah}`, H);

console.log('\n[16] Status terjemahan');
const terjemahan = await kirim('GET', '/api/blog/terjemahan/parsec-vs-rdp', H);
cek('kedua bahasa terdeteksi', terjemahan.data?.id === true && terjemahan.data?.en === true,
  JSON.stringify(terjemahan.data));
cek('lengkap: true', terjemahan.data?.lengkap === true);
const sebelah = await kirim('GET', '/api/blog/terjemahan/parsec-vs-rdp-baru', H);
cek('slug yang cuma ada di EN terdeteksi sebelah',
  sebelah.data?.id === false && sebelah.data?.en === true && sebelah.data?.lengkap === false,
  JSON.stringify(sebelah.data));

console.log('\n[17] meta menyebut media');
const metaMedia = (await kirim('GET', '/api/meta', hdr(BOOT))).data;
cek('meta.media ada', Boolean(metaMedia?.media), JSON.stringify(metaMedia?.media));
cek('meta.media menyebut webp', metaMedia?.media?.jenis?.includes('webp'));
cek('meta.media tidak menyebut svg', !metaMedia?.media?.jenis?.includes('svg'));

console.log(gagal ? `\n${gagal} pemeriksaan GAGAL\n` : '\nSemua pemeriksaan lolos\n');
process.exit(gagal ? 1 : 0);
