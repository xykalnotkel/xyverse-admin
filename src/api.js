const j = async (r) => {
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(d.error || `HTTP ${r.status}`);
    e.kode = d.kode || (r.status === 401 ? 'AUTH' : undefined);
    e.status = r.status;
    // sesi habis: paksa kembali ke layar masuk
    if (e.kode === 'AUTH') window.dispatchEvent(new CustomEvent('xy-sesi-habis'));
    throw e;
  }
  return r.json();
};

export const api = {
  git: {
    status: () => fetch('/api/git/status').then(j),
  },
  meta: () => fetch('/api/meta').then(j),
  stats: () => fetch('/api/stats').then(j),
  // `bahasa` menentukan folder tujuan di repo situs:
  //   id -> src/content/<col>/<slug>.md
  //   en -> src/content/<col>/en/<slug>.md
  list: (col, bahasa = 'id') => fetch(`/api/${col}?bahasa=${bahasa}`).then(j),
  get: (col, slug, bahasa = 'id') => fetch(`/api/${col}/${slug}?bahasa=${bahasa}`).then(j),
  save: (col, slug, payload, bahasa = 'id') =>
    fetch(`/api/${col}/${slug}?bahasa=${bahasa}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  remove: (col, slug, bahasa = 'id') =>
    fetch(`/api/${col}/${slug}?bahasa=${bahasa}`, { method: 'DELETE' }).then(j),

  // Apakah slug ini punya padanan di bahasa lain? Dipakai penanda
  // "belum diterjemahkan" di daftar dan editor.
  terjemahan: (col, slug) => fetch(`/api/${col}/terjemahan/${slug}`).then(j),

  // Kunci API. Hanya bisa dipakai dari sesi peramban — server menolak
  // kunci API yang mencoba mengelola kunci (kode BUTUH_SESI).
  kunci: {
    list: () => fetch('/api/kunci').then(j),
    buat: (payload) =>
      fetch('/api/kunci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(j),
    ubah: (id, payload) =>
      fetch(`/api/kunci/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(j),
    cabut: (id) => fetch(`/api/kunci/${id}`, { method: 'DELETE' }).then(j),
  },
};

// Basis URL situs publik. Di dev, gambar yang baru di-commit ke repo situs
// langsung dilayani Astro di :4321; di produksi pakai domain Vercel.
export const SITUS_URL = import.meta.env.DEV
  ? 'http://localhost:4321'
  : import.meta.env.VITE_SITE_URL || 'https://www.xyverse.my.id';

export const urlSitus = (u) => (/^https?:\/\//.test(u) ? u : `${SITUS_URL}${u}`);

/**
 * URL untuk MENAMPILKAN gambar di panel.
 *
 * Di dev: jalur relatif, sehingga lewat proxy Vite ke server API yang punya
 * salinan lokalnya. Ke :4321 tidak bisa — Astro hanya menyajikan berkas yang
 * ada di working tree, sedangkan gambar baru hanya ada di GitHub.
 * Di produksi: domain situs, karena Vercel mem-build dari repo itu.
 */
export const urlGambar = (u) =>
  /^https?:\/\//.test(u) ? u : import.meta.env.DEV ? u : `${SITUS_URL}${u}`;

export const media = {
  list: () => fetch('/api/media').then(j),
  kirim: (payload) =>
    fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  hapus: (nama) => fetch(`/api/media/${encodeURIComponent(nama)}`, { method: 'DELETE' }).then(j),
};

export const BAHASA = [
  { kode: 'id', label: 'Indonesia' },
  { kode: 'en', label: 'English' },
];

export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

export const fmtTgl = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(d); }
};
