import { useEffect, useState } from 'react';
import { I } from './Icons.jsx';

const post = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

/* ============ PANEL AI DI EDITOR ============ */
export function PanelAI({ col, judul, body, setJudul, setBody, setFm, say }) {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [sibuk, setSibuk] = useState('');
  const [arahan, setArahan] = useState('');
  const [panjang, setPanjang] = useState('sedang');
  const [buka, setBuka] = useState(true);

  useEffect(() => {
    fetch('/api/ai/status').then((r) => r.json()).then((s) => {
      setStatus(s); setModel(s.model);
    }).catch(() => setStatus({ aktif: false, pesan: 'API tidak merespons' }));
    fetch('/api/ai/models').then((r) => r.json()).then((d) => setModels(d.models || [])).catch(() => {});
  }, []);

  const jalankan = async (nama, fn) => {
    setSibuk(nama);
    try { await fn(); } catch (e) { say(e.message, true); }
    finally { setSibuk(''); }
  };

  const tulis = () => jalankan('tulis', async () => {
    if (!judul.trim()) throw new Error('Isi judul dulu sebelum menulis');
    const d = await post('/api/ai/tulis', { col, judul, arahan, panjang, model });
    setBody(d.body);
    say(`Konten dibuat · ${d.pakai?.total_tokens || '?'} token`);
  });

  const metaAI = () => jalankan('meta', async () => {
    if (!body.trim()) throw new Error('Isi konten masih kosong');
    const d = await post('/api/ai/meta', { col, judul, body, model });
    const patch = {};
    if (d.desc) patch.desc = d.desc;
    if (d.kategori) patch.kategori = d.kategori;
    if (d.baca) patch.baca = d.baca;
    if (d.layanan) patch.layanan = d.layanan;
    if (Array.isArray(d.stack) && d.stack.length) patch.stack = d.stack.join(', ');
    if (d.status) patch.status = d.status;
    if (d.tag) patch.tag = d.tag;
    setFm((p) => ({ ...p, ...patch }));
    say('Metadata terisi otomatis');
  });

  const perbaiki = (mode) => jalankan(mode, async () => {
    if (!body.trim()) throw new Error('Isi konten masih kosong');
    const d = await post('/api/ai/perbaiki', { body, mode, model });
    setBody(d.body);
    say('Tulisan diperbarui');
  });

  const drafPenuh = () => jalankan('draf', async () => {
    const topik = arahan.trim() || judul.trim();
    if (!topik) throw new Error('Isi topik di kolom arahan atau judul dulu');
    const d = await post('/api/ai/draf-penuh', { col, topik, panjang, model });
    setJudul(d.judul);
    setBody(d.body);
    const m = d.meta || {};
    const patch = {};
    for (const k of ['desc', 'kategori', 'baca', 'layanan', 'status', 'tag']) if (m[k]) patch[k] = m[k];
    if (Array.isArray(m.stack) && m.stack.length) patch.stack = m.stack.join(', ');
    setFm((p) => ({ ...p, ...patch }));
    say('Draf lengkap siap — periksa sebelum disimpan');
  });

  const mati = status && !status.aktif;

  return (
    <div className="card ai">
      <button className="aihead" onClick={() => setBuka(!buka)}>
        <span className="aibadge"><I.spark /></span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <h3 className="sec" style={{ margin: 0 }}>Asisten AI</h3>
          <span className="aisub">
            {!status ? 'memeriksa…' : status.aktif ? `Groq · ${model.split('/').pop()}` : 'belum aktif'}
          </span>
        </div>
        <span className={`chev ${buka ? 'up' : ''}`} />
      </button>

      {buka && (
        <div className="aibody">
          {mati ? (
            <div className="aiwarn">
              <strong>Groq belum terhubung.</strong>
              <p>Tambahkan kunci di <code>xyverse-admin/.env</code> lalu jalankan ulang server:</p>
              <pre>GROQ_API_KEY=gsk_xxxxx</pre>
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Ambil kunci gratis →</a>
            </div>
          ) : (
            <>
              <div className="field">
                <label>Topik / arahan untuk AI</label>
                <textarea rows={2} value={arahan} onChange={(e) => setArahan(e.target.value)}
                  placeholder={col === 'proyek'
                    ? 'mis. migrasi render farm untuk studio animasi, hemat 60% biaya'
                    : 'mis. bandingkan biaya sewa Cloud PC vs beli PC sendiri'} />
              </div>

              <div className="two" style={{ marginBottom: 13 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Panjang</label>
                  <select value={panjang} onChange={(e) => setPanjang(e.target.value)}>
                    <option value="pendek">Pendek (±500 kata)</option>
                    <option value="sedang">Sedang (±850 kata)</option>
                    <option value="panjang">Panjang (±1400 kata)</option>
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Model</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {(models.length ? models : [model]).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <button className="btn btn-p" style={{ width: '100%', marginBottom: 9 }}
                onClick={drafPenuh} disabled={!!sibuk}>
                {sibuk === 'draf' ? <span className="spin" /> : <I.spark />}
                {sibuk === 'draf' ? 'Menyusun draf…' : 'Buat draf lengkap'}
              </button>

              <div className="aigrid">
                <button className="btn btn-g" onClick={tulis} disabled={!!sibuk}>
                  {sibuk === 'tulis' ? <span className="spin" /> : <I.pen />} Tulis isi
                </button>
                <button className="btn btn-g" onClick={metaAI} disabled={!!sibuk}>
                  {sibuk === 'meta' ? <span className="spin" /> : <I.tag />} Isi metadata
                </button>
              </div>

              <div className="ailbl">Perbaiki tulisan</div>
              <div className="aigrid3">
                {[
                  ['rapikan', 'Rapikan'],
                  ['ringkas', 'Ringkas'],
                  ['kembangkan', 'Perluas'],
                  ['santai', 'Santai'],
                  ['formal', 'Formal'],
                  ['seo', 'SEO'],
                ].map(([m, t]) => (
                  <button key={m} className="btn btn-g sm" onClick={() => perbaiki(m)} disabled={!!sibuk}>
                    {sibuk === m ? <span className="spin" /> : t}
                  </button>
                ))}
              </div>

              <p className="ainote">Hasil AI selalu perlu diperiksa sebelum dipublikasikan.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ GENERATOR IDE (HALAMAN TERSENDIRI) ============ */
export function StudioAI({ go, say }) {
  const [col, setCol] = useState('blog');
  const [topik, setTopik] = useState('');
  const [ide, setIde] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch('/api/ai/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ aktif: false }));
  }, []);

  const cari = async () => {
    setSibuk(true); setIde(null);
    try {
      const d = await post('/api/ai/ide', { col, topik, jumlah: 6 });
      setIde(d.ide || []);
    } catch (e) { say(e.message, true); }
    finally { setSibuk(false); }
  };

  const label = { blog: 'Blog', proyek: 'Proyek', berita: 'Berita' };

  return (
    <>
      <header className="top">
        <div>
          <h1>Studio AI</h1>
          <div className="sub">Cari ide konten, lalu langsung tulis</div>
        </div>
      </header>

      <div className="body">
        {status && !status.aktif && (
          <div className="card aiwarn" style={{ marginBottom: 18 }}>
            <strong>Groq belum terhubung.</strong>
            <p>Tambahkan <code>GROQ_API_KEY</code> di <code>xyverse-admin/.env</code> lalu jalankan ulang server.</p>
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Ambil kunci gratis →</a>
          </div>
        )}

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="two">
            <div className="field">
              <label>Jenis konten</label>
              <select value={col} onChange={(e) => setCol(e.target.value)}>
                <option value="blog">Blog</option>
                <option value="proyek">Proyek</option>
                <option value="berita">Berita</option>
              </select>
            </div>
            <div className="field">
              <label>Topik <span style={{ fontWeight: 400, opacity: .7 }}>(opsional)</span></label>
              <input value={topik} onChange={(e) => setTopik(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cari()}
                placeholder="mis. cloud gaming, otomasi UMKM, biaya rendering" />
            </div>
          </div>
          <button className="btn btn-p" onClick={cari} disabled={sibuk || (status && !status.aktif)}>
            {sibuk ? <span className="spin" /> : <I.spark />} {sibuk ? 'Mencari ide…' : 'Cari ide'}
          </button>
        </div>

        {ide && (
          ide.length === 0 ? (
            <div className="card empty"><I.doc /><p>AI tidak mengembalikan ide. Coba topik lain.</p></div>
          ) : (
            <div className="idegrid">
              {ide.map((x, i) => (
                <div key={i} className="card idecard">
                  <h3>{x.judul}</h3>
                  <p>{x.desc}</p>
                  {x.alasan && <p className="alasan">{x.alasan}</p>}
                  <button className="btn btn-g" style={{ marginTop: 14 }}
                    onClick={() => go({ name: 'edit', col, slug: null, seed: x.judul })}>
                    <I.pen /> Tulis ini
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
