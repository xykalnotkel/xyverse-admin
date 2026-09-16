import React, { useEffect, useState } from 'react';
import { I } from './Icons.jsx';
import { Alert, Btn, Field, Skeleton, usePesan } from './UI.jsx';

const j = async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

export default function Deploy() {
  const say = usePesan();
  const [st, setSt] = useState(null);
  const [galat, setGalat] = useState('');

  const [pesan, setPesan] = useState('Perbarui konten dari dashboard');
  const [pemilik, setPemilik] = useState(() => localStorage.getItem('xy-gh-pemilik') || 'xykalnotkel');
  const [repo, setRepo] = useState(() => localStorage.getItem('xy-gh-repo') || 'xyverse-web');
  const [cabang, setCabang] = useState(() => localStorage.getItem('xy-gh-cabang') || 'main');
  const [token, setToken] = useState('');
  const [lihat, setLihat] = useState(false);

  const [muatC, setMuatC] = useState(false);
  const [muatP, setMuatP] = useState(false);
  const [log, setLog] = useState('');
  const [hasil, setHasil] = useState(null);

  async function segarkan() {
    setGalat('');
    try {
      setSt(await fetch('/api/git/status').then(j));
    } catch (e) {
      setGalat(e.message);
      setSt({ gagal: true });
    }
  }

  useEffect(() => { segarkan(); }, []);

  async function commit() {
    if (!pesan.trim()) return say('Pesan commit wajib diisi', 'err');
    setMuatC(true); setLog(''); setHasil(null);
    try {
      const r = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pesan: pesan.trim() }),
      }).then(j);
      setLog(r.log || '');
      say(r.kosong ? 'Tidak ada perubahan untuk di-commit' : 'Commit dibuat');
      segarkan();
    } catch (e) {
      setLog(e.message);
      say(e.message, 'err');
    } finally {
      setMuatC(false);
    }
  }

  async function push() {
    if (!token.trim()) return say('Token GitHub wajib diisi', 'err');
    setMuatP(true); setLog(''); setHasil(null);
    try {
      localStorage.setItem('xy-gh-pemilik', pemilik);
      localStorage.setItem('xy-gh-repo', repo);
      localStorage.setItem('xy-gh-cabang', cabang);

      const r = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), pemilik: pemilik.trim(), repo: repo.trim(), cabang: cabang.trim() }),
      }).then(j);

      setLog(r.log || '');
      setHasil(r.url);
      setToken(''); // token dibuang setelah dipakai
      say('Berhasil di-push ke GitHub');
      segarkan();
    } catch (e) {
      setLog(e.message);
      say(e.message, 'err');
    } finally {
      setMuatP(false);
    }
  }

  return (
    <>
      <header className="top">
        <div>
          <h2>Deploy</h2>
          <div className="sub">Commit perubahan dan kirim ke GitHub</div>
        </div>
        <div className="spacer" />
        <Btn onClick={segarkan} k="icon" aria-label="Segarkan status"><I.refresh /></Btn>
      </header>

      <div className="body">
        {galat && <Alert tipe="err" k="mb">{galat}</Alert>}

        {/* ---- status repo ---- */}
        {!st ? (
          <Skeleton pola="stat" />
        ) : st.gagal ? null : (
          <div className="gstat">
            <div className="gitem">
              <div className="k">Cabang</div>
              <div className="v mono">{st.cabang}</div>
            </div>
            <div className="gitem">
              <div className="k">Perubahan belum di-commit</div>
              <div className="v">
                {st.berubah}{' '}
                {st.berubah > 0
                  ? <span className="pill wr">perlu commit</span>
                  : <span className="pill ok">bersih</span>}
              </div>
            </div>
            <div className="gitem">
              <div className="k">Commit belum di-push</div>
              <div className="v">
                {st.belumDidorong < 0
                  ? <span className="pill">belum ada upstream</span>
                  : st.belumDidorong > 0
                    ? <>{st.belumDidorong} <span className="pill wr">tertunda</span></>
                    : <span className="pill ok">sinkron</span>}
              </div>
            </div>
            <div className="gitem">
              <div className="k">Total commit</div>
              <div className="v">{st.totalCommit}</div>
            </div>
          </div>
        )}

        {st && !st.gagal && (
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 className="sec">Commit terakhir</h3>
            <div className="glog" style={{ maxHeight: 'none' }}>{st.terakhir}</div>
            {st.berkas?.length > 0 && (
              <>
                <h3 className="sec" style={{ marginTop: 18 }}>Berkas berubah ({st.berubah})</h3>
                <div className="gfiles">
                  {st.berkas.map((f) => <code key={f}>{f}</code>)}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- commit ---- */}
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="sec">1 · Commit</h3>
          <Field label="Pesan commit" hint="Jelaskan singkat apa yang berubah.">
            <input value={pesan} onChange={(e) => setPesan(e.target.value)} placeholder="Perbarui konten" />
          </Field>
          <Btn jenis="g" muat={muatC} onClick={commit} disabled={st && st.berubah === 0}>
            <I.save /> {st && st.berubah === 0 ? 'Tidak ada perubahan' : 'Buat commit'}
          </Btn>
        </div>

        {/* ---- push ---- */}
        <div className="card">
          <h3 className="sec">2 · Push ke GitHub</h3>

          <div className="two">
            <Field label="Pemilik / organisasi">
              <input value={pemilik} onChange={(e) => setPemilik(e.target.value)} placeholder="xykalnotkel" />
            </Field>
            <Field label="Nama repositori">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="xyverse-web" />
            </Field>
          </div>

          <Field label="Cabang tujuan">
            <input value={cabang} onChange={(e) => setCabang(e.target.value)} placeholder="main" />
          </Field>

          <Field
            label="Personal Access Token"
            hint="Butuh cakupan repo. Token dipakai sekali untuk push ini lalu dibuang — tidak disimpan di server maupun di .git/config."
          >
            <div className="ic-wrap">
              <I.lock />
              <input
                type={lihat ? 'text' : 'password'} value={token} autoComplete="off"
                placeholder="ghp_…" onChange={(e) => setToken(e.target.value)}
              />
              <button type="button" className="peek" onClick={() => setLihat((v) => !v)}
                aria-label={lihat ? 'Sembunyikan token' : 'Tampilkan token'}>
                {lihat ? <I.eyeOff /> : <I.eye />}
              </button>
            </div>
          </Field>

          <Btn jenis="p" muat={muatP} onClick={push}><I.upload /> Push sekarang</Btn>

          <p style={{ fontSize: 12.5, color: 'var(--txt-2)', marginTop: 11, lineHeight: 1.6 }}>
            Buat token di <strong>github.com → Settings → Developer settings → Personal access
            tokens</strong>. Untuk token berbutir halus, beri izin <em>Contents: Read and write</em>.
          </p>
        </div>

        {/* ---- hasil ---- */}
        {hasil && (
          <div style={{ marginTop: 18 }}>
            <Alert tipe="ok" judul="Push berhasil">
              Repositori tersedia di{' '}
              <a href={hasil} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                {hasil}
              </a>
            </Alert>
          </div>
        )}

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
