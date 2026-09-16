import React, { useEffect, useRef, useState } from 'react';
import { I } from './Icons.jsx';
import { Alert, Btn, Field } from './UI.jsx';

const SKRIP_TS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Memuat skrip Turnstile satu kali saja. */
function muatTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (window.__xyTsPromise) return window.__xyTsPromise;
  window.__xyTsPromise = new Promise((selesai, gagal) => {
    const s = document.createElement('script');
    s.src = SKRIP_TS;
    s.async = true;
    s.defer = true;
    s.onload = selesai;
    s.onerror = () => gagal(new Error('Gagal memuat skrip Turnstile'));
    document.head.appendChild(s);
  });
  return window.__xyTsPromise;
}

export default function Login({ onMasuk }) {
  const [konfig, setKonfig] = useState(null);
  const [pengguna, setPengguna] = useState('');
  const [sandi, setSandi] = useState('');
  const [lihat, setLihat] = useState(false);
  const [galat, setGalat] = useState('');
  const [galatF, setGalatF] = useState({});
  const [kirim, setKirim] = useState(false);
  const [tsToken, setTsToken] = useState('');
  const [tsSiap, setTsSiap] = useState(false);
  const kotakTs = useRef(null);
  const widget = useRef(null);

  /* ---- ambil konfigurasi (turnstile aktif? site key?) ---- */
  useEffect(() => {
    fetch('/api/auth/konfig')
      .then((r) => r.json())
      .then(setKonfig)
      .catch(() => setKonfig({ turnstile: false, siapPakai: false, gagalKonfig: true }));
  }, []);

  /* ---- pasang widget Turnstile ---- */
  useEffect(() => {
    if (!konfig?.turnstile || !konfig.siteKey || !kotakTs.current || widget.current) return;
    let batal = false;
    muatTurnstile()
      .then(() => {
        if (batal || !window.turnstile || !kotakTs.current) return;
        widget.current = window.turnstile.render(kotakTs.current, {
          sitekey: konfig.siteKey,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          callback: (t) => { setTsToken(t); setTsSiap(true); },
          'expired-callback': () => { setTsToken(''); setTsSiap(false); },
          'error-callback': () => setGalat('Widget Turnstile bermasalah. Muat ulang halaman.'),
        });
      })
      .catch(() => setGalat('Tidak dapat memuat Cloudflare Turnstile. Periksa koneksi.'));
    return () => { batal = true; };
  }, [konfig]);

  function nilai() {
    const g = {};
    if (!pengguna.trim()) g.pengguna = 'Nama pengguna wajib diisi.';
    if (!sandi) g.sandi = 'Kata sandi wajib diisi.';
    setGalatF(g);
    return Object.keys(g).length === 0;
  }

  async function masuk(e) {
    e.preventDefault();
    setGalat('');
    if (!nilai()) return;
    if (konfig?.turnstile && !tsToken) {
      setGalat('Selesaikan verifikasi Turnstile dulu.');
      return;
    }

    setKirim(true);
    try {
      const r = await fetch('/api/auth/masuk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pengguna: pengguna.trim(), sandi, turnstile: tsToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGalat(j.error || `Gagal masuk (HTTP ${r.status})`);
        setSandi('');
        if (window.turnstile && widget.current !== null) {
          window.turnstile.reset(widget.current);
          setTsToken(''); setTsSiap(false);
        }
        return;
      }
      onMasuk(j.pengguna);
    } catch {
      setGalat('Tidak dapat menghubungi server. Pastikan API berjalan.');
    } finally {
      setKirim(false);
    }
  }

  return (
    <div className="lwrap">
      <form className="lbox" onSubmit={masuk} noValidate>
        <div className="lhead">
          <img src="/mark.webp" alt="" width="46" height="46" />
          <div>
            <h1>Xyverse Admin</h1>
            <p>Masuk untuk mengelola konten situs</p>
          </div>
        </div>

        {konfig === null && (
          <div className="loading" style={{ padding: 26 }}>
            <span className="spin" /> <span>Menyiapkan…</span>
          </div>
        )}

        {konfig && konfig.siapPakai === false && (
          <Alert tipe="warn" judul="Kata sandi belum diatur">
            Jalankan <code>npm run hash -- "katasandi"</code> lalu tempel hasilnya ke{' '}
            <code>ADMIN_PASS_HASH</code> di berkas <code>.env</code>, kemudian mulai ulang server.
          </Alert>
        )}

        {galat && <Alert tipe="err">{galat}</Alert>}

        {konfig && (
          <>
            <Field label="Nama pengguna" galat={galatF.pengguna}>
              <div className="ic-wrap">
                <I.user />
                <input
                  type="text" value={pengguna} autoComplete="username" autoFocus
                  placeholder="admin" onChange={(e) => setPengguna(e.target.value)}
                />
              </div>
            </Field>

            <Field label="Kata sandi" galat={galatF.sandi}>
              <div className="ic-wrap">
                <I.lock />
                <input
                  type={lihat ? 'text' : 'password'} value={sandi} autoComplete="current-password"
                  placeholder="••••••••••" onChange={(e) => setSandi(e.target.value)}
                />
                <button
                  type="button" className="peek" onClick={() => setLihat((v) => !v)}
                  aria-label={lihat ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                >
                  {lihat ? <I.eyeOff /> : <I.eye />}
                </button>
              </div>
            </Field>

            {konfig.turnstile ? (
              <div className="tsbox">
                <div ref={kotakTs} />
                {!tsSiap && <span className="tshint"><span className="spin" /> Menunggu verifikasi…</span>}
              </div>
            ) : (
              <Alert tipe="info">
                Turnstile nonaktif — kunci belum diisi di <code>.env</code>. Aman untuk lokal,
                tetapi <strong>isi sebelum dipakai daring</strong>.
              </Alert>
            )}

            <Btn type="submit" jenis="p" muat={kirim} k="lbtn">
              <I.lock /> Masuk
            </Btn>

            <p className="lnote">
              <I.shield /> Sesi berlaku 12 jam. Percobaan gagal berulang akan dikunci sementara.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
