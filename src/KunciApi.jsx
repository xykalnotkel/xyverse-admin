import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { I } from './Icons.jsx';
import { Alert, Btn, Modal, Skeleton } from './UI.jsx';

const PILIHAN_UMUR = [
  { nilai: '', label: 'Tidak pernah kedaluwarsa' },
  { nilai: 7, label: '7 hari' },
  { nilai: 30, label: '30 hari' },
  { nilai: 90, label: '90 hari' },
  { nilai: 365, label: '1 tahun' },
];

const fmt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return String(iso);
  }
};

/**
 * Halaman Kunci API.
 *
 * Hanya bisa dibuka oleh sesi peramban — server menolak kunci API yang
 * mencoba mengelola kunci (kode BUTUH_SESI). Lihat server/kunci.js.
 */
export default function KunciApi({ say }) {
  const [data, setData] = useState(null);
  const [baru, setBaru] = useState(null); // hasil pembuatan, teks polos ada di sini
  const [label, setLabel] = useState('');
  const [umur, setUmur] = useState('');
  const [membuat, setMembuat] = useState(false);
  const [hapus, setHapus] = useState(null);
  const [tersalin, setTersalin] = useState(false);

  const muat = useCallback(() => {
    api.kunci.list()
      .then(setData)
      .catch((e) => say(e.message, true));
  }, [say]);

  useEffect(() => { muat(); }, [muat]);

  const buat = async () => {
    if (!label.trim()) return say('Label wajib diisi', true);
    setMembuat(true);
    try {
      const r = await api.kunci.buat({ label: label.trim(), kedaluwarsaHari: umur || null });
      setBaru(r);
      setLabel('');
      setUmur('');
      muat();
      say('Kunci dibuat — salin sekarang');
    } catch (e) {
      say(e.message, true);
    } finally {
      setMembuat(false);
    }
  };

  const salin = async (teks) => {
    try {
      await navigator.clipboard.writeText(teks);
      setTersalin(true);
      setTimeout(() => setTersalin(false), 1800);
      say('Kunci disalin');
    } catch {
      say('Peramban menolak akses papan klip — pilih manual teksnya', true);
    }
  };

  const contoh = `curl -H "Authorization: Bearer xya_..." \\
  https://admin.xyverse.my.id/api/blog?bahasa=en`;

  return (
    <>
      <header className="top">
        <div>
          <h1>Kunci API</h1>
          <div className="sub">Akses /api/* untuk agen AI dan skrip, tanpa login peramban</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-g icon" title="Muat ulang" onClick={muat}><I.refresh /></button>
      </header>

      <div className="body">
        <Alert tipe="info" judul="Kunci hanya ditampilkan sekali">
          Yang disimpan di server hanyalah hash SHA-256. Kalau kunci hilang, cabut lalu buat baru —
          tidak ada cara memunculkannya lagi.
        </Alert>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="sec">Buat kunci baru</h3>
          <div className="two">
            <div className="field">
              <label>Label *</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="mis. Agen penerjemah, Skrip backup"
                onKeyDown={(e) => e.key === 'Enter' && buat()} />
              <span className="hint">Supaya nanti jelas kunci ini dipakai apa.</span>
            </div>
            <div className="field">
              <label>Masa berlaku</label>
              <select value={umur} onChange={(e) => setUmur(e.target.value)}>
                {PILIHAN_UMUR.map((p) => (
                  <option key={String(p.nilai)} value={p.nilai}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-p" onClick={buat} disabled={membuat}>
            {membuat ? <span className="spin" /> : <I.plus />} {membuat ? 'Membuat…' : 'Buat kunci'}
          </button>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="sec">Kunci aktif</h3>
          {!data ? (
            <Skeleton pola="tabel" n={3} />
          ) : data.kunci.length === 0 ? (
            <div className="empty" style={{ padding: '26px 0' }}>
              <I.lock />
              <p>Belum ada kunci. Buat satu di atas untuk mulai.</p>
            </div>
          ) : (
            <div className="tw"><div className="tscroll">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Awalan</th>
                    <th>Dibuat</th>
                    <th>Kedaluwarsa</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.kunci.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <div className="ttl">{k.label}</div>
                        <div className="slug">{k.id}</div>
                      </td>
                      <td><code style={{ fontSize: 12.5 }}>{k.awalan}…</code></td>
                      <td style={{ color: 'var(--txt-2)', whiteSpace: 'nowrap' }}>{fmt(k.dibuat)}</td>
                      <td style={{ color: 'var(--txt-2)', whiteSpace: 'nowrap' }}>{fmt(k.kedaluwarsa)}</td>
                      <td>
                        {k.env
                          ? <span className="pill">env</span>
                          : k.mati
                            ? <span className="pill er">Kedaluwarsa</span>
                            : <span className="pill ok">Aktif</span>}
                      </td>
                      <td>
                        {!k.env && (
                          <button className="btn btn-d icon" title="Cabut" onClick={() => setHapus(k)}>
                            <I.trash />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          )}
          {data && (
            <p style={{ fontSize: 12.5, color: 'var(--txt-2)', marginTop: 12, lineHeight: 1.7 }}>
              Disimpan sebagai hash di <code>{data.repo}</code> → <code>{data.jalur}</code>.
              {' '}Batas {data.batasPerMenit} permintaan/menit per kunci.
              {data.bootstrap && <> Kunci <code>ADMIN_API_KEY</code> dari lingkungan Vercel juga aktif.</>}
            </p>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="sec">Cara pakai</h3>
          <pre className="mono" style={{
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
            padding: 14, fontSize: 12.5, overflowX: 'auto', margin: 0, lineHeight: 1.7,
          }}>{contoh}</pre>
          <p style={{ fontSize: 13.5, color: 'var(--txt-2)', marginTop: 14, lineHeight: 1.75 }}>
            Header <code>X-Api-Key: xya_...</code> juga diterima dan setara.
            Kunci API punya hak penuh atas konten — buat, ubah, hapus blog, proyek, berita,
            dan dokumen legal, di kedua bahasa (tambahkan <code>?bahasa=en</code> untuk terjemahan).
          </p>
          <Alert tipe="warn" judul="Yang sengaja tidak bisa">
            Kunci API tidak bisa membuat atau mencabut kunci API. Kalau tidak begitu, satu kunci
            yang bocor bisa menanam kunci lain yang tidak pernah muncul di daftar ini.
            Pengelolaan kunci hanya lewat panel yang sedang masuk.
          </Alert>
        </div>
      </div>

      {baru && (
        <Modal
          judul="Salin kuncinya sekarang"
          onTutup={() => setBaru(null)}
          aksi={<Btn jenis="d" onClick={() => setBaru(null)}>Sudah kusalin</Btn>}
        >
          <p style={{ color: 'var(--txt-2)', fontSize: 14, lineHeight: 1.7 }}>
            Ini satu-satunya kesempatan melihat kunci <strong>{baru.label}</strong> dalam bentuk utuh.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <code style={{
              flex: 1, padding: '11px 13px', borderRadius: 8, fontSize: 13, wordBreak: 'break-all',
              background: 'var(--surface)', border: '1px solid var(--line)', userSelect: 'all',
            }}>{baru.kunci}</code>
            <button className="btn btn-g icon" title="Salin" onClick={() => salin(baru.kunci)}>
              {tersalin ? <I.check /> : <I.save />}
            </button>
          </div>
          {baru.kedaluwarsa && (
            <p style={{ color: 'var(--txt-2)', fontSize: 13, marginTop: 12 }}>
              Kedaluwarsa: {fmt(baru.kedaluwarsa)}
            </p>
          )}
        </Modal>
      )}

      {hapus && (
        <Modal
          judul={`Cabut kunci "${hapus.label}"?`}
          onTutup={() => setHapus(null)}
          aksi={
            <>
              <Btn onClick={() => setHapus(null)}>Batal</Btn>
              <Btn jenis="d" onClick={async () => {
                try {
                  await api.kunci.cabut(hapus.id);
                  say('Kunci dicabut');
                  muat();
                } catch (e) { say(e.message, true); }
                setHapus(null);
              }}><I.trash /> Cabut</Btn>
            </>
          }
        >
          <p style={{ color: 'var(--txt-2)', fontSize: 14, lineHeight: 1.7 }}>
            Semua agen atau skrip yang memakai kunci ini langsung kehilangan akses.
            Tindakan ini tidak bisa dibatalkan.
          </p>
        </Modal>
      )}
    </>
  );
}
