import { useCallback, useEffect, useRef, useState } from 'react';
import { media as apiMedia, urlGambar } from './api.js';
import { I } from './Icons.jsx';
import { Btn, Modal } from './UI.jsx';

/* ============================================================
 * Kompresi di peramban
 *
 * Server hanya memvalidasi dan menyimpan — tidak ada pengolah gambar di
 * sisi server. Jadi pengecilan ukuran dan konversi WebP terjadi di sini,
 * sebelum berkas meninggalkan peramban. Targetnya 2,4 MB karena tubuh
 * permintaan Function Vercel dibatasi 4,5 MB dan base64 menambah ~33%.
 * ============================================================ */

const TARGET_BYTE = 2.4 * 1024 * 1024;

function muatGambar(berkas) {
  return new Promise((selesai, gagal) => {
    const url = URL.createObjectURL(berkas);
    const img = new Image();
    img.onload = () => selesai({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      gagal(new Error('Berkas ini bukan gambar yang bisa dibaca peramban.'));
    };
    img.src = url;
  });
}

function keKanvas(img, lebar) {
  const rasio = img.naturalHeight / img.naturalWidth;
  const kanvas = document.createElement('canvas');
  kanvas.width = Math.max(1, Math.round(lebar));
  kanvas.height = Math.max(1, Math.round(lebar * rasio));
  kanvas.getContext('2d').drawImage(img, 0, 0, kanvas.width, kanvas.height);
  return kanvas;
}

const keBase64 = (kanvas, kualitas) =>
  new Promise((selesai) => kanvas.toBlob((b) => selesai(b), 'image/webp', kualitas));

const byteBase64 = (b) => Math.ceil(b.size / 3) * 4;

/**
 * Kecilkan sampai di bawah TARGET_BYTE.
 * Urutannya kualitas dulu (0.85 → 0.62), baru dimensi — menurunkan kualitas
 * lebih murah secara visual daripada mengecilkan gambar.
 */
async function kompresi(berkas) {
  const { img, url } = await muatGambar(berkas);
  try {
    const rencana = [
      [Math.min(img.naturalWidth, 1600), 0.85],
      [Math.min(img.naturalWidth, 1400), 0.78],
      [Math.min(img.naturalWidth, 1200), 0.7],
      [1000, 0.62],
      [800, 0.55],
    ];
    let blob = null;
    for (const [lebar, kualitas] of rencana) {
      const hasil = await keBase64(keKanvas(img, lebar), kualitas);
      if (!hasil) continue;
      blob = hasil;
      if (byteBase64(hasil) <= TARGET_BYTE) break;
    }
    if (!blob) throw new Error('Peramban tidak bisa mengubah gambar ini ke WebP.');
    return { blob, lebar: blob.width || 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const bacaBase64 = (blob) =>
  new Promise((selesai, gagal) => {
    const fr = new FileReader();
    fr.onload = () => selesai(String(fr.result).split(',')[1] || '');
    fr.onerror = () => gagal(new Error('Gagal membaca berkas.'));
    fr.readAsDataURL(blob);
  });

const kb = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* ============================================================
 * Komponen unggah
 * ============================================================ */

/**
 * Kotak unggah gambar untuk editor konten.
 *
 * - seret & lepas, pilih berkas, atau tempel (Ctrl+V) — boleh banyak sekaligus
 * - dikompresi ke WebP di peramban
 * - setiap berkas yang selesai langsung disisipkan sebagai `![alt](/media/x.webp)`
 */
export function UnggahGambar({ onSisip, say }) {
  const [antrean, setAntrean] = useState([]); // { id, nama, asal, byte, status, url, pesan }
  const [seret, setSeret] = useState(false);
  const [pustakaBuka, setPustakaBuka] = useState(false);
  const input = useRef(null);

  const proses = useCallback(
    async (berkas) => {
      if (!/^image\//.test(berkas.type) && !/\.(png|jpe?g|gif|webp)$/i.test(berkas.name)) {
        say(`"${berkas.name}" bukan gambar`, true);
        return;
      }
      const id = Math.random().toString(36).slice(2);
      const alt = berkas.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      setAntrean((q) => [...q, { id, nama: berkas.name, byte: berkas.size, status: 'kompresi' }]);

      try {
        const { blob } = await kompresi(berkas);
        setAntrean((q) =>
          q.map((x) => (x.id === id ? { ...x, status: 'unggah', byte: blob.size } : x))
        );
        const dataBase64 = await bacaBase64(blob);
        const r = await apiMedia.kirim({ nama: berkas.name, dataBase64, ekstensi: 'webp' });
        setAntrean((q) =>
          q.map((x) => (x.id === id ? { ...x, status: 'selesai', url: r.url } : x))
        );
        onSisip?.(`![${alt}](${r.url})`);
        say(`Gambar terunggah · ${kb(r.byte)}`);
      } catch (e) {
        setAntrean((q) =>
          q.map((x) => (x.id === id ? { ...x, status: 'gagal', pesan: e.message } : x))
        );
        say(e.message, true);
      }
    },
    [onSisip, say]
  );

  const terima = useCallback(
    (daftar) => {
      const arr = Array.from(daftar || []);
      if (!arr.length) return;
      arr.forEach((b) => proses(b));
    },
    [proses]
  );

  // Tempel gambar dari papan klip.
  useEffect(() => {
    const onPaste = (e) => {
      const gambar = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (gambar.length) {
        e.preventDefault();
        terima(gambar);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [terima]);

  const aktif = antrean.some((x) => x.status === 'kompresi' || x.status === 'unggah');

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        className={`drop ${seret ? 'on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setSeret(true);
        }}
        onDragLeave={() => setSeret(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSeret(false);
          terima(e.dataTransfer?.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <I.upload />
        <strong>Seret gambar ke sini</strong>
        <span>
          atau klik untuk memilih · Ctrl+V untuk menempel · boleh banyak sekaligus
          <br />
          Dikecilkan ke maks. 1600px dan diubah ke WebP sebelum dikirim
        </span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            terima(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {antrean.length > 0 && (
        <ul className="uplist">
          {antrean.map((x) => (
            <li key={x.id} className={`up ${x.status}`}>
              {x.url && <img src={urlGambar(x.url)} alt="" loading="lazy" />}
              <div className="upinfo">
                <div className="upnama">{x.nama}</div>
                <div className="upket">
                  {x.status === 'kompresi' && 'Mengompresi…'}
                  {x.status === 'unggah' && `Mengunggah · ${kb(x.byte)}`}
                  {x.status === 'selesai' && (
                    <a href={urlGambar(x.url)} target="_blank" rel="noreferrer">
                      {x.url} · {kb(x.byte)}
                    </a>
                  )}
                  {x.status === 'gagal' && <span className="err">{x.pesan}</span>}
                </div>
              </div>
              {(x.status === 'selesai' || x.status === 'gagal') && (
                <button className="btn btn-g icon" title="Sisipkan lagi"
                  onClick={() => x.url && onSisip?.(`![${x.nama.replace(/\.[a-z0-9]+$/i, '')}](${x.url})`)}>
                  <I.plus />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-g" onClick={() => setPustakaBuka(true)}>
          <I.eye /> Pakai dari pustaka
        </button>
        {antrean.length > 0 && !aktif && (
          <button className="btn btn-g" onClick={() => setAntrean([])}>
            <I.x /> Bersihkan daftar
          </button>
        )}
      </div>

      {pustakaBuka && (
        <Pustaka
          onTutup={() => setPustakaBuka(false)}
          onPilih={(berkas) => {
            onSisip?.(`![${berkas.nama.replace(/\.[a-z0-9]+$/i, '').replace(/\d{8}-[0-9a-f]{4}-?/i, '')}](${berkas.url})`);
            setPustakaBuka(false);
            say('Gambar disisipkan');
          }}
          say={say}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Pustaka gambar
 * ============================================================ */

function Pustaka({ onTutup, onPilih, say }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [hapus, setHapus] = useState(null);

  const muat = useCallback(() => {
    apiMedia.list().then(setData).catch((e) => say(e.message, true));
  }, [say]);

  useEffect(() => { muat(); }, [muat]);

  const berkas = (data?.berkas || []).filter((b) => !q || b.nama.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal
      judul={`Pustaka gambar${data ? ` · ${data.total} berkas` : ''}`}
      lebar
      onTutup={onTutup}
      aksi={<Btn onClick={onTutup}>Tutup</Btn>}
    >
      <div className="search" style={{ marginBottom: 14 }}>
        <I.search />
        <input placeholder="Cari nama berkas…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>

      {!data ? (
        <p style={{ color: 'var(--txt-2)', fontSize: 14 }}>Memuat…</p>
      ) : berkas.length === 0 ? (
        <div className="empty" style={{ padding: '30px 0' }}>
          <I.doc />
          <p>{q ? 'Tidak ada yang cocok.' : 'Belum ada gambar. Unggah dulu dari editor.'}</p>
        </div>
      ) : (
        <div className="grid-media">
          {berkas.map((b) => (
            <figure key={b.nama} className="mcard">
              <img src={urlGambar(b.url)} alt={b.nama} loading="lazy" />
              <figcaption>
                <code title={b.nama}>{b.nama}</code>
                <small>{kb(b.byte)}</small>
              </figcaption>
              <div className="macts">
                <button className="btn btn-p icon" title="Sisipkan ke artikel" onClick={() => onPilih(b)}>
                  <I.plus />
                </button>
                <a className="btn btn-g icon" title="Buka" href={urlGambar(b.url)} target="_blank" rel="noreferrer">
                  <I.eye />
                </a>
                <button className="btn btn-g icon" title="Salin URL"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(urlGambar(b.url));
                      say('URL disalin');
                    } catch { say('Peramban menolak akses papan klip', true); }
                  }}>
                  <I.link />
                </button>
                <button className="btn btn-d icon" title="Hapus" onClick={() => setHapus(b)}>
                  <I.trash />
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {hapus && (
        <Modal
          judul={`Hapus "${hapus.nama}"?`}
          onTutup={() => setHapus(null)}
          aksi={
            <>
              <Btn onClick={() => setHapus(null)}>Batal</Btn>
              <Btn jenis="d" onClick={async () => {
                try {
                  await apiMedia.hapus(hapus.nama);
                  say('Gambar dihapus');
                  muat();
                } catch (e) { say(e.message, true); }
                setHapus(null);
              }}><I.trash /> Hapus</Btn>
            </>
          }
        >
          <p style={{ color: 'var(--txt-2)', fontSize: 14, lineHeight: 1.7 }}>
            Artikel yang masih merujuk <code>{hapus.url}</code> akan menampilkan gambar rusak.
            Pastikan tidak ada yang memakainya dulu.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
