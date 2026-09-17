/**
 * Mini router HTTP — bebas framework, dipakai bersama oleh:
 *   - dev server lokal  (server/index.js)
 *   - Vercel Function   (api/[...path].js)
 *
 * Handler boleh sinkron atau async; middleware memanggil next().
 * Error yang dilempar (atau next(err)) dijawab sebagai JSON.
 */

/** Baca tubuh permintaan sebagai JSON (maks. 2 MB). */
// 8 MB: cukup untuk gambar base64 (+33%) setelah dikompresi di peramban.
// Di Vercel batas tubuh permintaan Function adalah 4,5 MB, jadi berkas yang
// lewat dari situ sudah ditolak lebih dulu oleh platform.
export function bacaBody(req, maks = 8 * 1024 * 1024) {
  return new Promise((selesai, gagal) => {
    const bagian = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maks) {
        req.destroy();
        return gagal(Object.assign(new Error('Muatan terlalu besar.'), { status: 413 }));
      }
      bagian.push(c);
    });
    req.on('end', () => {
      if (!bagian.length) return selesai({});
      try {
        selesai(JSON.parse(Buffer.concat(bagian).toString('utf8')));
      } catch {
        gagal(Object.assign(new Error('Tubuh permintaan bukan JSON yang valid.'), { status: 400 }));
      }
    });
    req.on('error', gagal);
  });
}

/** Kirim respons JSON. */
export function json(res, status, obj) {
  const t = JSON.stringify(obj ?? {});
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(Buffer.byteLength(t)));
  res.end(t);
}

/** Galat dengan status HTTP yang melekat. */
export class Galat extends Error {
  constructor(pesan, status = 500) {
    super(pesan);
    this.status = status;
  }
}

/**
 * Router sederhana dengan pola '/api/:col/:slug' dan middleware.
 * Rute pertama yang cocok menang — urutan pendaftaran penting.
 */
export class Router {
  constructor() {
    this.tengah = []; // middleware global (dijalankan sebelum rute mana pun)
    this.rute = [];
    this.praTerbang = null; // penangan preflight CORS (OPTIONS)
  }

  /**
   * Pasang penangan preflight.
   *
   * OPTIONS tidak akan pernah cocok dengan rute mana pun — pencocokan rute
   * memakai method DAN path, dan tidak ada rute yang didaftarkan untuk
   * OPTIONS. Tanpa kaitan ini, preflight jatuh ke "Rute tidak ditemukan"
   * (404) dan peramban membatalkan permintaan aslinya, jadi middleware CORS
   * di `tengah` tidak pernah sempat berjalan.
   */
  pra(fn) {
    this.praTerbang = fn;
    return this;
  }

  /** Tambah middleware: (req, res, next) */
  pakai(fn) {
    this.tengah.push(fn);
    return this;
  }

  /** Daftarkan rute: jalan('GET', '/api/:col/:slug', handler, ...) */
  jalan(method, pola, ...fn) {
    const bagian = pola.split('/');
    const regex = new RegExp(
      '^' +
        bagian
          .map((b) => (b.startsWith(':') ? '([^/]+)' : b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
          .join('/') +
        '$',
    );
    const nama = bagian.map((b) => (b.startsWith(':') ? b.slice(1) : null));
    this.rute.push({ method, regex, nama, fn: fn.length ? fn : [fn[0]] });
    return this;
  }

  /** Jalankan permintaan; setiap respons dijamin JSON. */
  tangani(req, res) {
    const u = new URL(req.url || '/', 'http://localhost');
    req.urlPath = u.pathname;
    req.query = Object.fromEntries(u.searchParams);

    let rantai = null;
    for (const r of this.rute) {
      if (r.method !== (req.method || 'GET')) continue;
      const m = u.pathname.match(r.regex);
      if (!m) continue;
      req.params = {};
      let grup = 1; // nomor capture group regex (urutan param, bukan posisi pola)
      r.nama.forEach((k) => {
        if (k) req.params[k] = decodeURIComponent(m[grup++]);
      });
      rantai = [...this.tengah, ...r.fn];
      break;
    }

    (async () => {
      if (!rantai) {
        if ((req.method || 'GET') === 'OPTIONS' && this.praTerbang) {
          await this.praTerbang(req, res);
          if (res.writableEnded) return;
        }
        json(res, 404, { error: 'Rute tidak ditemukan.' });
        return;
      }
      let i = 0;
      try {
        while (i < rantai.length) {
          const f = rantai[i++];
          await new Promise((selesai, gagal) => {
            let sudah = false;
            const tutup = (err) => {
              if (sudah) return;
              sudah = true;
              if (err) gagal(err);
              else selesai();
            };
            const next = (err) => tutup(err);
            let hasil;
            try {
              hasil = f(req, res, next);
            } catch (e) {
              return tutup(e);
            }
            if (hasil && typeof hasil.then === 'function') hasil.then(() => tutup(), (e) => tutup(e));
          });
        }
      } catch (e) {
        if (res.writableEnded) return;
        console.error('[api]', e);
        json(res, e.status || 500, { error: e.message || 'Kesalahan server' });
      }
    })();
  }
}
