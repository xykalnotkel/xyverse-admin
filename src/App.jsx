import { useEffect, useState, useCallback, useRef } from 'react';
import { api, slugify, fmtTgl, BAHASA } from './api.js';
import { I } from './Icons.jsx';
import { PanelAI, StudioAI } from './AI.jsx';
import Login from './Login.jsx';
import Deploy from './Deploy.jsx';
import { ToastHost, usePesan, Skeleton, Memuat, Alert, Btn, Modal } from './UI.jsx';
import KunciApi from './KunciApi.jsx';
import { UnggahGambar } from './Unggah.jsx';
import SampulPilih from './SampulPilih.jsx';

// Lokal: Astro dev server. Produksi: domain situs (bisa ditimpa VITE_SITE_URL).
const SITE = import.meta.env.DEV
  ? 'http://localhost:4321'
  : import.meta.env.VITE_SITE_URL || 'https://xyverse.my.id';
const SITE_LANG = import.meta.env.VITE_SITE_LANG || 'id';

/* ============ PEMBANTU EDITOR ============ */

/** Kelas warna untuk penghitung panjang judul/deskripsi (SEO). */
function panjangKelas(n, min, maks) {
  const x = n || 0;
  if (x === 0) return 'seo-n';
  if (x < min) return 'seo-p';
  if (x > maks) return 'seo-l';
  return 'seo-ok';
}

/**
 * Perender Markdown ringan untuk pratinjau di editor.
 *
 * Bukan pengganti markdown-it — hanya cukup untuk melihat bentuk tulisan.
 * Situs merender ulang dari berkas aslinya lewat Astro, jadi yang dipakai
 * produksi tetap perender Astro.
 *
 * Semua input di-escape lebih dulu, baru markup disisipkan. Karena itu
 * `dangerouslySetInnerHTML` di sini tidak membuka lubang XSS.
 */
const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  escHtml(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

function renderMarkdown(teks) {
  const baris = String(teks || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let mode = null;      // 'ul' | 'ol' | null
  let kode = false;
  let kodeBuf = [];

  const tutupDaftar = () => {
    if (mode) { out.push(`</${mode}>`); mode = null; }
  };

  for (const mentah of baris) {
    const b = mentah.trimEnd();

    if (/^```/.test(b)) {
      if (kode) { out.push(`<pre><code>${escHtml(kodeBuf.join('\n'))}</code></pre>`); kodeBuf = []; }
      kode = !kode;
      continue;
    }
    if (kode) { kodeBuf.push(mentah); continue; }

    if (!b.trim()) { tutupDaftar(); continue; }

    const h = b.match(/^(#{1,6})\s+(.*)$/);
    if (h) { tutupDaftar(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^>\s?/.test(b)) { tutupDaftar(); out.push(`<blockquote>${inline(b.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(b.trim())) { tutupDaftar(); out.push('<hr />'); continue; }

    const li = b.match(/^\s*[-*+]\s+(.*)$/);
    if (li) {
      if (mode !== 'ul') { tutupDaftar(); out.push('<ul>'); mode = 'ul'; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const ol = b.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (mode !== 'ol') { tutupDaftar(); out.push('<ol>'); mode = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    tutupDaftar();
    out.push(`<p>${inline(b)}</p>`);
  }
  if (kode) out.push(`<pre><code>${escHtml(kodeBuf.join('\n'))}</code></pre>`);
  tutupDaftar();
  return out.join('\n');
}

/* ============ GERBANG AUTENTIKASI ============ */
export default function App() {
  const [sesi, setSesi] = useState(undefined); // undefined = sedang memeriksa

  useEffect(() => {
    fetch('/api/auth/saya')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSesi(d?.masuk ? d.pengguna : null))
      .catch(() => setSesi(null));
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('xy-admin-theme') || 'dark';
    document.documentElement.dataset.theme = t;
  }, []);

  if (sesi === undefined) {
    return <div className="lwrap"><Memuat teks="Memeriksa sesi…" /></div>;
  }
  if (sesi === null) {
    return (
      <ToastHost>
        <Login onMasuk={setSesi} />
      </ToastHost>
    );
  }
  return (
    <ToastHost>
      <Dashboard pengguna={sesi} onKeluar={() => setSesi(null)} />
    </ToastHost>
  );
}

/* ============ DASHBOARD ============ */
function Dashboard({ pengguna, onKeluar }) {
  const [view, setView] = useState({ name: 'dash' });
  const [stats, setStats] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('xy-admin-theme') || 'dark');
  const [keluarBuka, setKeluarBuka] = useState(false);
  const pesan = usePesan();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('xy-admin-theme', theme);
  }, [theme]);

  // jaga tanda tangan lama say(msg, err) yang dipakai List/Editor/AI
  const say = useCallback((msg, err = false) => pesan(msg, err ? 'err' : 'ok'), [pesan]);

  const refresh = useCallback(() => {
    api.stats().then(setStats).catch((e) => {
      if (e.kode === 'AUTH' || /Belum masuk/i.test(e.message)) return onKeluar();
      say(e.message, true);
    });
  }, [say, onKeluar]);

  useEffect(() => { refresh(); }, [refresh]);

  // sesi kedaluwarsa di tengah jalan -> kembali ke layar masuk
  useEffect(() => {
    const h = () => onKeluar();
    window.addEventListener('xy-sesi-habis', h);
    return () => window.removeEventListener('xy-sesi-habis', h);
  }, [onKeluar]);

  const cols = [
    { key: 'blog', label: 'Blog', Ic: I.blog },
    { key: 'proyek', label: 'Proyek', Ic: I.proyek },
    { key: 'berita', label: 'Berita', Ic: I.berita },
    { key: 'legal', label: 'Legal', Ic: I.shield },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/mark.webp" alt="" />
          <div>XYVERSE<small>Admin Panel</small></div>
        </div>

        <div className="navlbl">Umum</div>
        <button className={`nav ${view.name === 'dash' ? 'on' : ''}`} onClick={() => setView({ name: 'dash' })}>
          <I.dash /> Dasbor
        </button>

        <button className={`nav ${view.name === 'ai' ? 'on' : ''}`} onClick={() => setView({ name: 'ai' })}>
          <I.spark /> Studio AI
        </button>

        <button className={`nav ${view.name === 'deploy' ? 'on' : ''}`} onClick={() => setView({ name: 'deploy' })}>
          <I.git /> Deploy
        </button>

        <button className={`nav ${view.name === 'kunci' ? 'on' : ''}`} onClick={() => setView({ name: 'kunci' })}>
          <I.lock /> Kunci API
        </button>

        <div className="navlbl">Konten</div>
        {cols.map(({ key, label, Ic }) => (
          <button
            key={key}
            className={`nav ${view.name === 'list' && view.col === key ? 'on' : ''}`}
            onClick={() => setView({ name: 'list', col: key })}
          >
            <Ic /> {label}
            {stats?.[key] && <span className="cnt">{stats[key].total}</span>}
          </button>
        ))}

        <div className="sfoot">
          <div className="sme"><I.user /> <span>{pengguna}</span></div>
          <a className="slink" href={SITE} target="_blank" rel="noreferrer"><I.link /> Buka website</a>
          <button className="slink" style={{ border: 0, background: 'none', cursor: 'pointer', width: '100%' }}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <I.sun /> : <I.moon />} Mode {theme === 'dark' ? 'terang' : 'gelap'}
          </button>
          <button className="slink" style={{ border: 0, background: 'none', cursor: 'pointer', width: '100%' }}
            onClick={() => setKeluarBuka(true)}>
            <I.logout /> Keluar
          </button>
        </div>
      </aside>

      <main className="main">
        {view.name === 'dash' && <Dash stats={stats} go={setView} />}
        {view.name === 'deploy' && <Deploy />}
        {view.name === 'kunci' && <KunciApi say={say} />}
        {view.name === 'ai' && <StudioAI go={setView} say={say} />}
        {view.name === 'list' && <List col={view.col} go={setView} say={say} onChange={refresh} />}
        {view.name === 'edit' && (
          <Editor key={`${view.col}-${view.bahasa || 'id'}-${view.slug || 'baru'}-${view.seed || ''}`}
            col={view.col} slug={view.slug} seed={view.seed} bahasa={view.bahasa || 'id'}
            go={setView} say={say} onChange={refresh} />
        )}
      </main>

      {keluarBuka && (
        <Modal
          judul="Keluar dari dashboard?"
          onTutup={() => setKeluarBuka(false)}
          aksi={
            <>
              <Btn onClick={() => setKeluarBuka(false)}>Batal</Btn>
              <Btn jenis="d" onClick={async () => {
                await fetch('/api/auth/keluar', { method: 'POST' }).catch(() => {});
                onKeluar();
              }}><I.logout /> Keluar</Btn>
            </>
          }
        >
          <p style={{ color: 'var(--txt-2)', fontSize: 14 }}>
            Sesi akan diakhiri dan kamu perlu masuk lagi. Perubahan yang belum disimpan bisa hilang.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ============ DASBOR ============ */
function Dash({ stats, go }) {
  const map = { blog: I.blog, proyek: I.proyek, berita: I.berita, legal: I.shield };
  return (
    <>
      <header className="top">
        <div>
          <h1>Dasbor</h1>
          <div className="sub">Ringkasan konten website Xyverse</div>
        </div>
      </header>
      <div className="body">
        {!stats ? (
          <Skeleton pola="stat" />
        ) : (
          <>
            <div className="stats">
              {Object.entries(stats).map(([key, s]) => {
                const Ic = map[key] || I.doc;
                return (
                  <button key={key} className="stat" style={{ textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => go({ name: 'list', col: key })}>
                    <div className="lbl"><Ic /> {s.label}</div>
                    <div className="num">{s.total}</div>
                    <div className="sub">
                      {s.en != null ? `${s.id} ID · ${s.en} EN` : `${s.publik} publik · ${s.draft} draf`}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="card">
              <h3 className="sec">Aksi cepat</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(stats).map(([key, s]) => (
                  <button key={key} className="btn btn-g"
                    onClick={() => go({ name: 'edit', col: key, slug: null })}>
                    <I.plus /> {s.label} baru
                  </button>
                ))}
                <a className="btn btn-g" href={SITE} target="_blank" rel="noreferrer"><I.eye /> Pratinjau situs</a>
              </div>
              <p style={{ fontSize: 13, color: 'var(--txt-2)', marginTop: 16, lineHeight: 1.65 }}>
                Setiap simpan menjadi satu commit Markdown di repo{' '}
                <code>xyverse-web</code>, lalu Vercel men-deploy ulang situs —
                biasanya muncul dalam ±30 detik. Tab <strong>Deploy</strong>{' '}
                memperlihatkan commit terakhir dan status token.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ============ DAFTAR ============ */
function List({ col, go, say, onChange }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  // Bahasa yang sedang dibuka — menentukan folder di repo situs.
  const [bahasa, setBahasa] = useState('id');

  const load = useCallback(() => {
    setItems(null);
    api.list(col, bahasa).then(setItems).catch((e) => say(e.message, true));
  }, [col, bahasa, say]);

  useEffect(() => { load(); }, [load]);

  const del = async (slug) => {
    if (!confirm(`Hapus "${slug}" (${bahasa.toUpperCase()})? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await api.remove(col, slug, bahasa);
      say('Berhasil dihapus');
      load(); onChange();
    } catch (e) { say(e.message, true); }
  };

  const label = { blog: 'Blog', proyek: 'Proyek', berita: 'Berita', legal: 'Dokumen Legal' }[col];
  const tanpaTanggal = col === 'legal';
  const shown = (items || []).filter(
    (i) => !q || (i.title + ' ' + i.slug).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <header className="top">
        <div>
          <h1>{label}</h1>
          <div className="sub">{items ? `${items.length} entri` : 'Memuat…'}</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-p" onClick={() => go({ name: 'edit', col, slug: null, bahasa })}>
          <I.plus /> Buat baru
        </button>
      </header>

      <div className="body">
        <div className="bar">
          <div className="search">
            <I.search />
            <input placeholder={`Cari ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="segs" role="tablist" aria-label="Bahasa konten">
            {BAHASA.map((b) => (
              <button key={b.kode} role="tab" aria-selected={bahasa === b.kode}
                className={`seg ${bahasa === b.kode ? 'on' : ''}`}
                title={b.label} onClick={() => setBahasa(b.kode)}>{b.kode.toUpperCase()}</button>
            ))}
          </div>
        </div>

        {!items ? (
          <Skeleton pola="tabel" n={5} />
        ) : shown.length === 0 ? (
          <div className="card empty">
            <I.doc />
            <p>{q ? 'Tidak ada hasil yang cocok.' : `Belum ada ${label.toLowerCase()}.`}</p>
            {!q && (
              <button className="btn btn-p" style={{ marginTop: 14 }}
                onClick={() => go({ name: 'edit', col, slug: null, bahasa })}>
                <I.plus /> Buat yang pertama
              </button>
            )}
          </div>
        ) : (
          <div className="tw"><div className="tscroll">
            <table>
              <thead>
                <tr>
                  <th>Judul</th>
                  {col === 'blog' && <th>Kategori</th>}
                  {col === 'proyek' && <th>Layanan</th>}
                  {col === 'proyek' && <th>Status</th>}
                  {col === 'berita' && <th>Tag</th>}
                  <th>{tanpaTanggal ? 'Diperbarui' : 'Tanggal'}</th>
                  <th>Kata</th>
                  {!tanpaTanggal && <th>Status</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.slug}>
                    <td>
                      <div className="ttl" onClick={() => go({ name: 'edit', col, slug: it.slug, bahasa })}>{it.title}</div>
                      <div className="slug">/{col}/{it.slug}</div>
                    </td>
                    {col === 'blog' && <td><span className="pill br">{it.kategori}</span></td>}
                    {col === 'proyek' && <td><span className="pill br">{it.layanan}</span></td>}
                    {col === 'proyek' && (
                      <td><span className={`pill ${it.status === 'Selesai' ? 'ok' : it.status === 'Berjalan' ? 'wr' : ''}`}>{it.status}</span></td>
                    )}
                    {col === 'berita' && <td><span className="pill br">{it.tag}</span></td>}
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--txt-2)' }}>
                      {tanpaTanggal ? (it.diperbarui || '—') : fmtTgl(it.date)}
                    </td>
                    <td style={{ color: 'var(--txt-2)' }}>{it.kata}</td>
                    {!tanpaTanggal && (
                      <td>
                        {it.draft
                          ? <span className="pill wr">Draf</span>
                          : <span className="pill ok">Publik</span>}
                      </td>
                    )}
                    <td>
                      <div className="acts">
                        {!it.draft && (
                          <a className="btn btn-g icon" title="Lihat di situs"
                            href={`${SITE}/${bahasa}/${col}/${it.slug}/`} target="_blank" rel="noreferrer"><I.eye /></a>
                        )}
                        <button className="btn btn-g icon" title="Ubah"
                          onClick={() => go({ name: 'edit', col, slug: it.slug, bahasa })}><I.edit /></button>
                        <button className="btn btn-d icon" title="Hapus" onClick={() => del(it.slug)}><I.trash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </div>
    </>
  );
}

/* ============ EDITOR ============ */
const KOSONG = {
  blog: { title: '', desc: '', date: '', kategori: 'Panduan', penulis: 'Tim Xyverse', baca: 5, unggulan: false, draft: false, gambar: '', og: '', tags: [] },
  proyek: { title: '', desc: '', date: '', klien: '', layanan: 'Cloud PC', stack: '', status: 'Selesai', unggulan: false, draft: false, gambar: '', og: '', tags: [] },
  berita: { title: '', desc: '', date: '', tag: 'Pengumuman', draft: false },
  legal: { title: '', desc: '', diperbarui: '', ringkas: '', lang: 'id' },
};

/** Tanggal panjang gaya dokumen legal: "17 September 2026". */
const tglPanjang = (bahasa = 'id') =>
  new Date().toLocaleDateString(bahasa === 'en' ? 'en-GB' : 'id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

function Editor({ col, slug, seed, bahasa = 'id', go, say, onChange }) {
  const baru = !slug;
  const legal = col === 'legal';
  const [fm, setFm] = useState(() => ({
    ...KOSONG[col],
    title: seed || '',
    lang: bahasa,
    ...(legal
      ? { diperbarui: tglPanjang(bahasa) }
      : { date: new Date().toISOString().slice(0, 10) }),
  }));
  const [body, setBody] = useState('');
  const [slugNow, setSlugNow] = useState('');
  const [loading, setLoading] = useState(!baru);
  const [saving, setSaving] = useState(false);
  const [pratinjau, setPratinjau] = useState(false);
  const [terj, setTerj] = useState(null);
  const areaIsi = useRef(null);

  useEffect(() => {
    if (baru) return;
    api.get(col, slug, bahasa)
      .then((d) => {
        const f = { ...KOSONG[col], ...d.frontmatter };
        if (Array.isArray(f.stack)) f.stack = f.stack.join(', ');
        setFm(f); setBody(d.body); setSlugNow(d.slug); setLoading(false);
      })
      .catch((e) => { say(e.message, true); setLoading(false); });
  }, [col, slug, bahasa, baru, say]);

  // Apakah padanan bahasa lain sudah ada?
  useEffect(() => {
    if (!slugNow) return;
    api.terjemahan(col, slugNow).then(setTerj).catch(() => setTerj(null));
  }, [col, slugNow]);

  const set = (k, v) => setFm((p) => ({ ...p, [k]: v }));
  const slugFinal = baru ? slugify(fm.title || '') : slugNow;

  const simpan = async () => {
    if (!fm.title.trim()) return say('Judul wajib diisi', true);
    if (!slugFinal) return say('Judul belum menghasilkan slug yang valid', true);
    setSaving(true);
    try {
      const r = await api.save(col, baru ? slugFinal : slug, {
        frontmatter: { ...fm, lang: bahasa },
        body,
        slugBaru: baru ? slugFinal : undefined,
      }, bahasa);
      say(baru ? 'Berhasil dibuat' : 'Perubahan tersimpan');
      onChange();
      go({ name: 'list', col, bahasa });
      return r;
    } catch (e) { say(e.message, true); }
    finally { setSaving(false); }
  };

  /** Sisipkan teks di posisi kursor area isi, atau di akhir bila tak ada fokus. */
  const sisip = (teks) => {
    const el = areaIsi.current;
    const jarak = (t) => (t && !t.endsWith('\n\n') ? (t.endsWith('\n') ? '\n' : '\n\n') : '');
    if (!el || document.activeElement !== el) return setBody((b) => b + jarak(b) + teks + '\n');
    const awal = el.selectionStart;
    const depan = body.slice(0, awal);
    const belakang = body.slice(el.selectionEnd).replace(/^\n+/, '');
    const next = depan + jarak(depan) + teks + '\n\n' + belakang;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (depan + jarak(depan) + teks).length;
      el.setSelectionRange(pos, pos);
    });
  };

  const simpanRef = useRef(simpan);
  simpanRef.current = simpan;

  // Ctrl/Cmd+S = simpan, Ctrl/Cmd+\ = pratinjau.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        simpanRef.current();
      } else if (e.key === '\\') {
        e.preventDefault();
        setPratinjau((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const kata = body.trim().split(/\s+/).filter(Boolean).length;
  const menitBaca = Math.max(1, Math.round(kata / 200));
  const bahasaLain = bahasa === 'id' ? 'en' : 'id';

  const label = { blog: 'Blog', proyek: 'Proyek', berita: 'Berita', legal: 'Dokumen Legal' }[col];

  if (loading) return <div className="body"><Skeleton pola="editor" /></div>;

  return (
    <>
      <header className="top">
        <button className="btn btn-g icon" onClick={() => go({ name: 'list', col, bahasa })}><I.back /></button>
        <div>
          <h1>{baru ? `${label} Baru` : 'Ubah Konten'}</h1>
          <div className="sub">
            <span className="pill br">{bahasa.toUpperCase()}</span>{' '}
            {slugFinal ? `/${bahasa}/${col}/${slugFinal}/` : 'Slug dibuat dari judul'}
            {terj && !terj[bahasaLain] && (
              <button className="pill wr" style={{ marginLeft: 8, cursor: 'pointer' }}
                title={`Belum ada versi ${bahasaLain.toUpperCase()}`}
                onClick={() => go({ name: 'edit', col, slug: slugFinal, bahasa: bahasaLain })}>
                <I.alert /> Belum ada {bahasaLain.toUpperCase()} — buat
              </button>
            )}
            {terj?.lengkap && <span className="pill ok" style={{ marginLeft: 8 }}>Dua bahasa lengkap</span>}
          </div>
        </div>
        <div className="spacer" />
        <button className={`btn btn-g ${pratinjau ? 'on' : ''}`} onClick={() => setPratinjau((p) => !p)}
          title={'Pratinjau (Ctrl+\\)'}>
          <I.eye /> Pratinjau
        </button>
        <button className="btn btn-p" onClick={simpan} disabled={saving} title="Simpan (Ctrl+S)">
          {saving ? <span className="spin" /> : <I.save />} {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </header>

      <div className="body">
        <div className="ed">
          <div className="card">
            <div className="field">
              <label>Judul *</label>
              <input value={fm.title} onChange={(e) => set('title', e.target.value)} placeholder="Judul yang menarik…" />
            </div>
            <div className="field">
              <label>Deskripsi singkat *</label>
              <textarea rows={2} value={fm.desc} onChange={(e) => set('desc', e.target.value)}
                placeholder="Satu–dua kalimat ringkasan, dipakai untuk kartu dan SEO." />
              <div className="seo">
                <span className={panjangKelas(fm.title?.length, 30, 65)}>Judul {fm.title?.length || 0}/60</span>
                <span className={panjangKelas(fm.desc?.length, 70, 165)}>Deskripsi {fm.desc?.length || 0}/160</span>
                <span className="hint" style={{ margin: 0 }}>{kata} kata · ±{menitBaca} menit baca</span>
              </div>
            </div>
            <div className="field">
              <label>Isi konten (Markdown)</label>
              {pratinjau ? (
                <div className="pratinjau" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
              ) : (
              <textarea ref={areaIsi} className="mono" rows={22} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={'## Subjudul\n\nTulis isi di sini. Mendukung **tebal**, *miring*, daftar, tabel, dan kode.'} />
              )}
              <span className="hint">{kata} kata · Ctrl+S simpan · Ctrl+\ pratinjau</span>
            </div>
          </div>

          <div className="card">
            <h3 className="sec">Gambar</h3>
            <UnggahGambar onSisip={sisip} say={say} />
          </div>

          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 className="sec">Publikasi</h3>
              {!legal && (
                <div className="field">
                  <label>Tanggal</label>
                  <input type="date" value={fm.date || ''} onChange={(e) => set('date', e.target.value)} />
                </div>
              )}
              <label className="chk" style={{ marginBottom: 9 }}>
                <input type="checkbox" checked={!!fm.draft} onChange={(e) => set('draft', e.target.checked)} />
                Simpan sebagai draf
              </label>
              {'unggulan' in KOSONG[col] && (
                <label className="chk">
                  <input type="checkbox" checked={!!fm.unggulan} onChange={(e) => set('unggulan', e.target.checked)} />
                  Tandai sebagai unggulan
                </label>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <PanelAI
                col={col}
                judul={fm.title}
                body={body}
                setJudul={(v) => set('title', v)}
                setBody={setBody}
                setFm={setFm}
                say={say}
              />
            </div>

            <div className="card">
              <h3 className="sec">Metadata</h3>

              {/*
                Berlaku untuk semua koleksi. `gambar` dipakai situs sebagai
                sampul kartu, og:image, dan entri image sitemap; `og` memaksa
                gambar Open Graph sendiri bila sampulnya tidak layak jadi
                pratinjau tautan.
              */}
              <SampulPilih nilai={fm.gambar || ''} onUbah={(v) => set('gambar', v)} say={say} />
              <div className="field">
                <label>Gambar Open Graph <span className="hint">(opsional)</span></label>
                <input
                  value={fm.og || ''}
                  onChange={(e) => set('og', e.target.value.trim())}
                  placeholder="Kosong = pakai gambar sampul"
                />
              </div>
              {'tags' in (KOSONG[col] || {}) && (
                <div className="field">
                  <label>Tag</label>
                  <input
                    value={Array.isArray(fm.tags) ? fm.tags.join(', ') : (fm.tags || '')}
                    onChange={(e) =>
                      set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
                    placeholder="cloud, gpu, studio"
                  />
                </div>
              )}

              {col === 'blog' && (
                <>
                  <div className="field">
                    <label>Kategori</label>
                    <select value={fm.kategori} onChange={(e) => set('kategori', e.target.value)}>
                      {['Panduan', 'Teknis', 'Produksi', 'Automation', 'Umum'].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="two">
                    <div className="field">
                      <label>Penulis</label>
                      <input value={fm.penulis} onChange={(e) => set('penulis', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Menit baca</label>
                      <input type="number" min="1" max="60" value={fm.baca} onChange={(e) => set('baca', e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              {col === 'proyek' && (
                <>
                  <div className="field">
                    <label>Klien</label>
                    <input value={fm.klien} onChange={(e) => set('klien', e.target.value)} placeholder="Nama klien" />
                  </div>
                  <div className="field">
                    <label>Layanan</label>
                    <select value={fm.layanan} onChange={(e) => set('layanan', e.target.value)}>
                      {['Cloud PC', 'Produksi Apps', 'Software Custom', 'Tools & Automation'].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <select value={fm.status} onChange={(e) => set('status', e.target.value)}>
                      {['Selesai', 'Berjalan', 'Maintenance'].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Teknologi</label>
                    <input value={fm.stack} onChange={(e) => set('stack', e.target.value)} placeholder="Flutter, Node.js, PostgreSQL" />
                    <span className="hint">Pisahkan dengan koma</span>
                  </div>
                </>
              )}

              {col === 'berita' && (
                <div className="field">
                  <label>Tag</label>
                  <select value={fm.tag} onChange={(e) => set('tag', e.target.value)}>
                    {['Pengumuman', 'Produk', 'Infrastruktur', 'Perusahaan'].map((k) => <option key={k}>{k}</option>)}
                  </select>
                </div>
              )}

              {legal && (
                <>
                  <div className="field">
                    <label>Diperbarui</label>
                    <input value={fm.diperbarui || ''} onChange={(e) => set('diperbarui', e.target.value)}
                      placeholder="17 September 2026" />
                    <span className="hint">Teks bebas, tampil apa adanya di halaman legal.</span>
                  </div>
                  <div className="field">
                    <label>Ringkasnya</label>
                    <textarea rows={4} value={fm.ringkas || ''} onChange={(e) => set('ringkas', e.target.value)}
                      placeholder="Versi bahasa sehari-hari dari dokumen ini — tampil di kotak atas halaman." />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
