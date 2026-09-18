import { DeployLive } from './Workspace.jsx';
import React, { useEffect, useState } from 'react';
import { I } from './Icons.jsx';
import { Alert, Btn, Skeleton, usePesan } from './UI.jsx';

const j = async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

export default function Deploy() {
  const say = usePesan();
  const [daftar, setDaftar] = useState(null);
  const [aktif, setAktif] = useState('situs');
  const [st, setSt] = useState(null);
  const [galat, setGalat] = useState('');
  const [uji, setUji] = useState(false);
  const [log, setLog] = useState('');
  const [hasil, setHasil] = useState(null);

  const segarkan = async (kunci = aktif) => {
    setGalat('');
    setSt(null);
    try {
      setSt(await fetch(`/api/git/status?proyek=${kunci}`).then(j));
    } catch (e) {
      setGalat(e.message);
      setSt({ gagal: true });
    }
  };

  // daftar proyek sekali di awal
  useEffect(() => {
    fetch('/api/git/proyek').then(j).then(setDaftar).catch((e) => setGalat(e.message));
  }, []);

  // ganti proyek -> muat ulang status
  useEffect(() => {
    setLog('');
    setHasil(null);
    segarkan(aktif);
  }, [aktif]);

  async function ujiKoneksi() {
    setUji(true);
    setLog('');
    setHasil(null);
    try {
      const r = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proyek: aktif }),
      }).then(j);
      setLog(r.log || '');
      setHasil(r.url);
      say('Koneksi GitHub teruji');
      segarkan();
    } catch (e) {
      setLog(e.message);
      say(e.message, 'err');
    } finally {
      setUji(false);
    }
  }

  return (
    <>
      <header className="top">
        <div>
          <h2>Deploy</h2>
          <div className="sub">Status repositori &amp; auto-deploy Vercel</div>
        </div>
        <div className="spacer" />
        <a className="btn btn-g" href="/push.html" target="_blank" rel="noreferrer">
          <I.link /> Halaman status GitHub
        </a>
        <Btn onClick={() => segarkan()} k="icon" aria-label="Segarkan status"><I.refresh /></Btn>
      </header>

      <div className="body workspace">
        <DeployLive/>
        {galat && <Alert tipe="err" k="mb">{galat}</Alert>}

        {daftar && (
          <div className="ptabs">
            {daftar.map((p) => (
              <button
                key={p.kunci}
                className={`ptab ${aktif === p.kunci ? 'on' : ''}`}
                onClick={() => setAktif(p.kunci)}
              >
                <I.git />
                <span>
                  <strong>{p.nama}</strong>
                  <small>{p.ket}</small>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ---- status repo (dari GitHub API) ---- */}
        {!st ? (
          <Skeleton pola="stat" />
        ) : st.gagal ? null : (
          <div className="gstat">
            <div className="gitem">
              <div className="k">Cabang default</div>
              <div className="v mono">{st.cabang}</div>
            </div>
            <div className="gitem">
              <div className="k">Total commit</div>
              <div className="v">{st.totalCommit}</div>
            </div>
            <div className="gitem">
              <div className="k">Push terakhir</div>
              <div className="v">{st.didorong} <span className="pill ok">otomatis</span></div>
            </div>
            <div className="gitem">
              <div className="k">Token GitHub</div>
              <div className="v">
                {st.tokenTerpasang
                  ? <span className="pill ok">terpasang</span>
                  : <span className="pill wr">belum ada</span>}
              </div>
            </div>
          </div>
        )}

        {st && !st.gagal && (
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 className="sec">Commit terakhir</h3>
            <div className="glog" style={{ maxHeight: 'none' }}>{st.terakhir}</div>
            {st.commitUrl && (
              <a
                href={st.commitUrl} target="_blank" rel="noreferrer"
                style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 13 }}
              >
                Lihat commit di GitHub →
              </a>
            )}
          </div>
        )}

        {/* ---- alur serverless ---- */}
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="sec">Alur auto-deploy</h3>
          <ol style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13.5, lineHeight: 1.95, color: 'var(--txt-2)' }}>
            <li>
              Simpan konten dari dashboard → <strong style={{ color: 'var(--txt)' }}>commit langsung ke
              GitHub</strong> (Contents API — tidak ada checkout lokal).
            </li>
            <li>
              Commit memicu <strong style={{ color: 'var(--txt)' }}>Vercel deploy otomatis</strong> situs
              dalam ±30 detik.
            </li>
            <li>
              Repositori: <a href={st?.url} target="_blank" rel="noreferrer"
                style={{ color: 'var(--brand)', fontWeight: 600 }}>{st?.url || '…'}</a>
            </li>
          </ol>
        </div>

        {/* ---- uji koneksi ---- */}
        <div className="card">
          <h3 className="sec">Uji koneksi GitHub</h3>
          <p style={{ fontSize: 13, color: 'var(--txt-2)', marginTop: 4, lineHeight: 1.65 }}>
            Memastikan token <code>GH_TOKEN</code> di lingkungan Vercel valid dan repositori terjangkau.
            Token dikelola di <strong>dashboard Vercel → Environment Variables</strong> — tidak pernah
            lewat peramban (lebih aman dari model token sekali pakai yang lama).
          </p>
          <Btn jenis="p" muat={uji} onClick={ujiKoneksi}><I.link /> Uji koneksi</Btn>

          {hasil && (
            <div style={{ marginTop: 14 }}>
              <Alert tipe="ok" judul="Koneksi berhasil">
                Repositori tersedia di{' '}
                <a href={hasil} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--brand)', fontWeight: 600 }}>{hasil}</a>
              </Alert>
            </div>
          )}
        </div>

        {log && (
          <div className="card" style={{ marginTop: 18 }}>
            <h3 className="sec">Keluaran</h3>
            <div className="glog">{log}</div>
          </div>
        )}
      </div>
    </>
  );
}
