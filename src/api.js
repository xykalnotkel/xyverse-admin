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
  list: (col) => fetch(`/api/${col}`).then(j),
  get: (col, slug) => fetch(`/api/${col}/${slug}`).then(j),
  save: (col, slug, payload) =>
    fetch(`/api/${col}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  remove: (col, slug) => fetch(`/api/${col}/${slug}`, { method: 'DELETE' }).then(j),
};

export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

export const fmtTgl = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(d); }
};
