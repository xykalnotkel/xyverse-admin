/**
 * Cermin media lokal — HANYA untuk kenyamanan pratinjau saat pengembangan.
 *
 * Masalahnya: gambar yang diunggah masuk ke GitHub, bukan ke working tree
 * lokal. Jadi Astro dev di :4321 tidak punya berkasnya dan pratinjau editor
 * menampilkan gambar rusak.
 *
 * Solusinya: server dev lokal menyimpan salinan di `public/media/` dan
 * menyajikannya di `/media/*`; Vite mem-proxy `/media` ke sana. Folder itu
 * di-gitignore.
 *
 * Di Vercel Function modul ini tidak melakukan apa-apa — `XY_CERMIN_MEDIA`
 * tidak diset, dan gambar memang dilayani dari hasil build repo situs.
 */
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FOLDER_MEDIA_LOKAL = path.resolve(__dirname, '..', 'public', 'media');

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

export const cerminAktif = () => process.env.XY_CERMIN_MEDIA === '1';

/** Simpan salinan lokal. Kegagalan ditelan — pratinjau bukan urusan kritis. */
export function cerminMediaLokal(nama, isi) {
  if (!cerminAktif()) return false;
  const aman = String(nama || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!aman) return false;
  try {
    mkdirSync(FOLDER_MEDIA_LOKAL, { recursive: true });
    writeFileSync(path.join(FOLDER_MEDIA_LOKAL, aman), isi);
    return true;
  } catch {
    return false;
  }
}

export function hapusCerminLokal(nama) {
  if (!cerminAktif()) return false;
  const aman = String(nama || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!aman) return false;
  try {
    rmSync(path.join(FOLDER_MEDIA_LOKAL, aman), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Balas permintaan GET /media/<nama> bila salinan lokalnya ada. */
export function layaniCermin(req, res) {
  if (!cerminAktif()) return false;
  if (req.method !== 'GET' || !req.url?.startsWith('/media/')) return false;

  const nama = decodeURIComponent(req.url.slice('/media/'.length).split('?')[0]);
  if (nama.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(nama)) return false;

  try {
    const berkas = path.join(FOLDER_MEDIA_LOKAL, nama);
    if (!existsSync(berkas)) return false;
    res.statusCode = 200;
    res.setHeader('content-type', MIME[path.extname(nama).toLowerCase()] || 'application/octet-stream');
    res.setHeader('cache-control', 'public, max-age=300');
    res.end(readFileSync(berkas));
    return true;
  } catch {
    return false;
  }
}
