import crypto from 'node:crypto';
import * as db from './database.js';
/**
 * Surat masuk dari form kontak situs — dikirim lewat Resend.
 *
 * Kenapa endpoint ini ada: form kontak di situs sebelumnya memakai
 * `action="mailto:" enctype="text/plain"`, yang membuka aplikasi email
 * pengguna. Di ponsel sering tidak ada aplikasi yang terdaftar, di webmail
 * tidak jalan sama sekali, dan gagalnya tanpa pesan apa pun. Jadi pesan
 * terlihat terkirim padahal tidak pernah sampai.
 *
 * Rute ini publik — siapa pun boleh memanggilnya — jadi yang dijaga adalah:
 *
 *   1. Honeypot. Kolom tersembunyi yang hanya diisi bot. Kalau terisi,
 *      permintaan diterima dengan 200 dan dibuang diam-diam; membalas 400
 *      justru memberitahu bot bahwa ia ketahuan.
 *   2. Pembatasan laju per alamat IP.
 *   3. Batas panjang tiap bidang, supaya isi permintaan tidak dipakai
 *      untuk menyelundupkan surat sebesar apa pun.
 *   4. `Reply-To` diisi email pengirim, BUKAN `From`. Menaruh alamat
 *      sembarang di `From` membuat surat ditolak atau masuk spam.
 *
 * Resend hanya boleh mengirim ke alamat di domain yang sudah diverifikasi.
 * Selama `xyverse.my.id` belum diverifikasi di resend.com/domains, setel
 * SURAT_DARI=onboarding@resend.dev dan SURAT_TUJUAN ke alamat pemilik akun —
 * kalau tidak, API membalas 403 dan setiap pesan gagal.
 */
import { Galat } from './http.js';

const CFG = {
  kunci: () => process.env.RESEND_API_KEY || '',
  dari: () => process.env.SURAT_DARI || 'onboarding@resend.dev',
  tujuan: () => process.env.SURAT_TUJUAN || 'xycdigital@gmail.com',
  namaDari: () => process.env.SURAT_NAMA_DARI || 'Situs Xyverse',
};

const MAKS_PESAN = 5000;
const MAKS_PENDEK = 200;

/** Pembatasan laju per IP: 5 pesan per 10 menit. */
const pakai = new Map(); // ip -> { n, sampai }
const MAKS_LAJU = 5;
const JENDELA = 10 * 60 * 1000;

function kenaBatas(ip) {
  const kini = Date.now();
  const c = pakai.get(ip);
  if (!c || kini > c.sampai) {
    pakai.set(ip, { n: 1, sampai: kini + JENDELA });
    return false;
  }
  c.n += 1;
  return c.n > MAKS_LAJU;
}

const bersih = (v, maks) =>
  String(v ?? '').replace(/\r?\n{3,}/g, '\n\n').trim().slice(0, maks);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** HTML surat: tabel sederhana, aman di klien email yang membuang CSS. */
function htmlSurat({ nama, email, perusahaan, topik, budget, paket, pesan }) {
  const esc = (t) =>
    String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const baris = (label, nilai) =>
    nilai
      ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(label)}</td>` +
        `<td style="padding:6px 0;color:#111827">${esc(nilai)}</td></tr>`
      : '';
  return [
    `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827">`,
    `<p style="margin:0 0 14px">Pesan baru dari form kontak situs.</p>`,
    `<table style="border-collapse:collapse;margin-bottom:16px">`,
    baris('Nama', nama),
    baris('Email', email),
    baris('Perusahaan', perusahaan),
    baris('Kebutuhan', topik),
    baris('Anggaran', budget),
    baris('Paket', paket),
    `</table>`,
    `<div style="white-space:pre-wrap;border-left:3px solid #7c3aed;padding:4px 0 4px 14px;margin-bottom:14px">${esc(pesan)}</div>`,
    `<p style="margin:0;color:#6b7280;font-size:13px">Dikirim lewat xyverse.my.id</p>`,
    `</div>`,
  ].join('');
}

/**
 * Kirim satu pesan. Melempar Galat 400 untuk masukan yang tidak sah,
 * 429 bila IP-nya sudah terlalu sering, dan 502 bila Resend menolak.
 */
export async function kirimPesan(isi, ip = '') {
  const honeypot = isi?.situs_web ?? isi?.website ?? isi?.url_situs ?? '';
  // Bot mengisi kolom tersembunyi. Terima lalu buang tanpa suara.
  if (String(honeypot).trim()) return { ok: true, dibuang: true };

  if (db.configured() ? await db.rateLimit('contact',ip,5,JENDELA) : kenaBatas(String(ip || 'tanpa-ip'))) {
    throw new Galat('Terlalu banyak pesan dari alamat ini. Coba lagi sebentar.', 429);
  }

  const nama = bersih(isi?.nama, MAKS_PENDEK);
  const email = bersih(isi?.email, MAKS_PENDEK);
  const perusahaan = bersih(isi?.perusahaan, MAKS_PENDEK);
  const topik = bersih(isi?.topik, MAKS_PENDEK);
  const budget = bersih(isi?.budget, MAKS_PENDEK);
  const paket = bersih(isi?.paket, 120);
  const pesan = bersih(isi?.pesan, MAKS_PESAN);

  if (nama.length < 2) throw new Galat('Nama wajib diisi.', 400);
  if (!EMAIL.test(email)) throw new Galat('Alamat email tidak sah.', 400);
  if (pesan.length < 10) throw new Galat('Pesan terlalu pendek.', 400);

  let ticket = null;
  if (db.configured()) {
    ticket = crypto.randomUUID();
    await db.query('INSERT INTO inbox(id,name,email,company,topic,budget,package,message) VALUES (?,?,?,?,?,?,?,?)', [ticket,nama,email,perusahaan,topik,budget,bersih(isi?.paket,120),pesan]);
  }
  try {
  const kunci = CFG.kunci();
  if (!kunci) {
    throw new Galat('Pengiriman surat belum dikonfigurasi di server.', 503);
  }

  const jawaban = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${kunci}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${CFG.namaDari()} <${CFG.dari()}>`,
      to: [CFG.tujuan()],
      // Balas ke pengirim, bukan From — lihat catatan di kepala berkas.
      reply_to: email,
      subject: `[Situs] ${topik || 'Pesan baru'} — ${nama}`,
      html: htmlSurat({ nama, email, perusahaan, topik, budget, paket, pesan }),
      text: [
        `Nama: ${nama}`,
        `Email: ${email}`,
        paket ? `Paket: ${paket}` : '',
        perusahaan ? `Perusahaan: ${perusahaan}` : '',
        topik ? `Kebutuhan: ${topik}` : '',
        budget ? `Anggaran: ${budget}` : '',
        '',
        pesan,
      ].filter(Boolean).join('\n'),
    }),
  });

  if (!jawaban.ok) {
    const teks = await jawaban.text().catch(() => '');
    // Jangan bocorkan isi jawaban Resend ke pemanggil — bisa memuat detail akun.
    console.error('[surat] Resend menolak:', jawaban.status);
    throw new Galat('Pesan belum bisa dikirim. Coba lagi atau email langsung ke xycdigital@gmail.com.', 502);
  }

  const hasil = await jawaban.json().catch(() => ({}));
  if (ticket) await db.query("UPDATE inbox SET notification='sent' WHERE id=?",[ticket]);
  return { ok: true, id: ticket || hasil.id || null };
  } catch (e) {
    if (!ticket) throw e;
    // The customer request is already durable; do not encourage duplicate submission.
    await db.query("UPDATE inbox SET notification='failed' WHERE id=?",[ticket]).catch(()=>{});
    return { ok: true, id: ticket };
  }
}
