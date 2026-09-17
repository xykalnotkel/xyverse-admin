import { useEffect, useState } from 'react';
import { media as apiMedia, urlGambar } from './api.js';
import { Btn, Modal, Skeleton } from './UI.jsx';

/**
 * Kolom "Gambar sampul" di penyunting.
 *
 * Tanpa ini field `gambar` ada di skema situs dan di whitelist API, tapi
 * tidak ada satu pun tempat di panel untuk mengisinya — jadi gambar yang
 * diunggah hanya bisa dipakai di tengah isi markdown, bukan sebagai sampul
 * kartu daftar, og:image, dan entri sitemap.
 *
 * Nilainya jalur relatif (`/media/20260917-ab12-foto.webp`), BUKAN URL
 * absolut: situs dan og:image yang mengubahnya jadi absolut. Menyimpan URL
 * absolut akan membuat gambar mati begitu domain berubah.
 */
export default function SampulPilih({ nilai, onUbah, say }) {
  const [buka, setBuka] = useState(false);
  const [daftar, setDaftar] = useState(null);
  const [cari, setCari] = useState('');
  const [galat, setGalat] = useState('');

  useEffect(() => {
    if (!buka || daftar) return;
    let hidup = true;
    apiMedia.list()
      .then((r) => { if (hidup) setDaftar(r.berkas || []); })
      .catch((e) => { if (hidup) setGalat(e.message || 'Gagal memuat pustaka gambar.'); });
    return () => { hidup = false; };
  }, [buka, daftar]);

  const tersaring = (daftar || []).filter((f) =>
    !cari.trim() || f.nama.toLowerCase().includes(cari.trim().toLowerCase()),
  );

  return (
    <div className="field">
      <label>Gambar sampul</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={nilai || ''}
          onChange={(e) => onUbah(e.target.value.trim())}
          placeholder="/media/nama-berkas.webp — atau pilih dari pustaka"
          style={{ flex: 1 }}
        />
        <Btn onClick={() => setBuka(true)}>Pilih</Btn>
        {nilai ? <Btn jenis="g" onClick={() => onUbah('')}>Hapus</Btn> : null}
      </div>
      {nilai ? (
        <div style={{ marginTop: 8 }}>
          <img
            src={urlGambar(nilai)}
            alt=""
            style={{
              maxWidth: '100%', maxHeight: 150, objectFit: 'cover',
              borderRadius: 8, border: '1px solid var(--garis, #2a2438)', display: 'block',
            }}
          />
        </div>
      ) : (
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Kosong = kartu daftar tanpa gambar, dan og:image memakai generator SVG.
        </p>
      )}

      {buka && (
        <Modal judul="Pilih gambar sampul" onTutup={() => setBuka(false)} lebar>
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama berkas…"
            style={{ width: '100%', marginBottom: 12 }}
            autoFocus
          />
          {galat && <p className="hint" style={{ color: '#f87171' }}>{galat}</p>}
          {!daftar && !galat && <Skeleton n={3} />}
          {daftar && (
            <div className="grid-media">
              {tersaring.length === 0 && (
                <p className="hint">
                  {daftar.length === 0
                    ? 'Belum ada gambar. Unggah dulu lewat kartu "Gambar" di atas.'
                    : 'Tidak ada yang cocok dengan pencarian itu.'}
                </p>
              )}
              {tersaring.map((f) => (
                <button
                  key={f.nama}
                  type="button"
                  className="mcard"
                  onClick={() => { onUbah('/' + f.url.replace(/^\/+/, '')); setBuka(false); say?.('Sampul dipilih'); }}
                  title={f.nama}
                  style={{ cursor: 'pointer', textAlign: 'left' }}
                >
                  <img src={urlGambar(f.url)} alt="" loading="lazy" />
                  <span className="upnama">{f.nama}</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
