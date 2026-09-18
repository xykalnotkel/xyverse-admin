/**
 * Unggah gambar — berkas dikirim sebagai base64, disimpan sebagai commit
 * di folder `public/media/` repo situs, lalu langsung bisa dipakai sebagai
 * `/media/<nama>.webp` di artikel.
 *
 * Kenapa lewat GitHub, bukan ke penyimpanan berkas? Karena backend ini
 * serverless: tidak ada disk yang bertahan, dan Vercel tidak punya object
 * storage bawaan. GH_TOKEN sudah ada, situs memang di-build dari repo itu,
 * dan Astro menyalin apa pun di `public/` ke akar situs apa adanya. Jadi
 * gambar ikut ter-deploy bersama konten — satu alur, satu tempat.
 *
 * Kompresi terjadi di PERAMBAN (lihat src/Unggah.jsx): gambar dikecilkan ke
 * maksimum 1600px lalu diubah ke WebP sebelum dikirim. Server hanya
 * memvalidasi dan menyimpan — tidak ada dependensi pengolah gambar.
 *
 * SVG sengaja TIDAK diterima. SVG adalah XML yang bisa memuat <script>;
 * kalau disajikan sebagai image/svg+xml dari domain sendiri, ia bisa
 * mengeksekusi JavaScript. Untuk gambar biasa, WebP/PNG/JPEG sudah cukup.
 */
import { Galat } from './http.js';
import * as gh from './github.js';

const CFG = {
  folder: () => process.env.MEDIA_DIR || 'public/media',
};

/** Batas ukuran berkas TERDECODE (byte). */
const MAKS_BYTE = 4 * 1024 * 1024;

/**
 * Periksa tanda tangan berkas (magic bytes) dan kembalikan ekstensinya.
 * Ini yang mencegah seseorang mengunggah skrip berkedok gambar.
 */
function jenisDariByte(b) {
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.toString('latin1', 0, 3) === 'GIF' && b.toString('latin1', 3, 6) === 'GIF') {
    return 'gif';
  }
  return null;
}

/** Nama berkas aman: slug pendek + stempel waktu + 4 hex acak. */
function namaBerkas(namaAsli, ekstensi) {
  const dasar = String(namaAsli || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const kini = new Date();
  const tgl = `${kini.getFullYear()}${String(kini.getMonth() + 1).padStart(2, '0')}${String(kini.getDate()).padStart(2, '0')}`;
  const acak = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `${tgl}-${acak}${dasar ? '-' + dasar : ''}.${ekstensi}`;
}

/**
 * Simpan satu gambar.
 * @returns {{nama, url, byte, jenis, commit}}
 */
export async function simpan({ nama = '', dataBase64 = '', ekstensiPaksa = null }) {
  if (!dataBase64) throw new Galat('Tidak ada data gambar yang dikirim.', 400);

  const bersih = String(dataBase64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  let buf;
  try {
    buf = Buffer.from(bersih, 'base64');
  } catch {
    throw new Galat('Data base64 tidak valid.', 400);
  }
  if (!buf.length) throw new Galat('Data gambar kosong.', 400);
  if (buf.length > MAKS_BYTE) {
    throw new Galat(
      `Gambar ${(buf.length / 1048576).toFixed(1)} MB melewati batas ${(MAKS_BYTE / 1048576).toFixed(0)} MB. ` +
        'Perkecil dulu sebelum mengunggah.',
      413,
    );
  }

  const jenis = jenisDariByte(buf);
  if (!jenis) {
    throw new Galat(
      'Isi berkas bukan gambar yang dikenali (WebP, PNG, JPEG, atau GIF). SVG tidak diterima.',
      415,
    );
  }
  if (ekstensiPaksa && ekstensiPaksa !== jenis) {
    throw new Galat(`Ekstensi "${ekstensiPaksa}" tidak cocok dengan isi berkas (${jenis}).`, 415);
  }

  const namaFile = namaBerkas(nama, jenis);
  const jalur = `${CFG.folder()}/${namaFile}`;
  const hasil = await gh.tulisBerkas(
    gh.reposSitus(),
    jalur,
    buf,
    `Tambah gambar ${namaFile} (via dashboard)`,
  );

  // Folder public/media/ dipetakan ke /media/ di situs.
  const url = '/' + jalur.replace(/^public\//, '');
  return { nama: namaFile, url, byte: buf.length, jenis, commit: hasil.commitSha };
}

/** Daftar gambar yang sudah ada, terbaru dulu. */
export async function daftar() {
  const berkas = (await gh.daftarDirektori(gh.reposSitus(), CFG.folder())).filter(
    (f) => f.type === 'file' && /\.(webp|png|jpe?g|gif)$/i.test(f.name),
  );
  const urlAwal = '/' + CFG.folder().replace(/^public\//, '') + '/';
  const items = berkas.map((f) => ({
    nama: f.name,
    url: urlAwal + f.name,
    byte: f.size ?? null,
    diubah: f.last_modified || null,
  }));
  items.sort((a, b) => String(b.nama).localeCompare(String(a.nama)));
  return { folder: CFG.folder(), total: items.length, berkas: items };
}

/** Hapus satu gambar. */
export async function hapus(nama) {
  const bersih = String(nama || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!bersih || bersih.includes('..')) throw new Galat('Nama berkas tidak valid.', 400);
  await gh.hapusBerkas(
    gh.reposSitus(),
    `${CFG.folder()}/${bersih}`,
    `Hapus gambar ${bersih} (via dashboard)`,
  );
  return { ok: true, nama: bersih };
}

export const INFO = {
  folder: CFG.folder,
  repo: () => gh.reposSitus(),
  maksMB: MAKS_BYTE / 1048576,
  jenis: ['webp', 'png', 'jpg', 'gif'],
};
