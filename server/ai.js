/**
 * Studio AI — proksi Groq (OpenAI-compatible).
 *
 * Refactor serverless:
 * - tidak lagi memakai express.Router
 * - /ai/draf-penuh memanggil fungsi internal langsung (dulu fetch ke
 *   http://127.0.0.1:PORT — tidak mungkin di Vercel Function)
 */
import { json } from './http.js';

const GROQ = 'https://api.groq.com/openai/v1';

// Model produksi Groq per 2026. llama-3.1-8b & llama-3.3-70b sudah dimatikan 16 Agt 2026.
// (dibaca lazy agar .env lokal yang dimuat setelah import tetap terpakai)
const MODEL_DEFAULT = () => process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const MODEL_FALLBACK = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'groq/compound'];

const key = () => process.env.GROQ_API_KEY || '';
const aktif = () => key().length > 10;

/* ---------- pemanggil dasar ---------- */
async function groqChat({ system, user, model, temperature = 0.7, max_tokens = 4000, json: sebagaiJson = false }) {
  if (!aktif()) {
    const e = new Error('GROQ_API_KEY belum diatur. Tambahkan di lingkungan deployment (atau .env lokal).');
    e.status = 400;
    throw e;
  }

  const r = await fetch(`${GROQ}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || MODEL_DEFAULT(),
      temperature,
      max_tokens,
      ...(sebagaiJson ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    let pesan = `Groq error ${r.status}`;
    try {
      pesan = JSON.parse(t).error?.message || pesan;
    } catch {}
    if (r.status === 401) pesan = 'API key Groq ditolak. Periksa kembali kuncinya.';
    if (r.status === 429) pesan = 'Kuota Groq tercapai. Tunggu sebentar lalu coba lagi.';
    if (r.status === 404) pesan = `Model "${model || MODEL_DEFAULT()}" tidak tersedia. Pilih model lain di daftar.`;
    const e = new Error(pesan);
    e.status = r.status;
    throw e;
  }

  const d = await r.json();
  return {
    teks: d.choices?.[0]?.message?.content?.trim() || '',
    pakai: d.usage || null,
    model: d.model || model || MODEL_DEFAULT(),
  };
}

const ambilJSON = (s) => {
  try {
    return JSON.parse(s);
  } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  throw Object.assign(new Error('AI tidak mengembalikan JSON yang valid. Coba jalankan lagi.'), { status: 502 });
};

/* ---------- konteks brand ---------- */
const BRAND = `
Kamu adalah penulis konten untuk Xyverse, perusahaan teknologi asal Lombok Tengah, Nusa Tenggara Barat, Indonesia.

Layanan Xyverse:
1. Sewa Cloud PC — remote workstation bertenaga GPU (rendering, cloud gaming, AI, development, trading bot, kantor remote). Region Singapore & Jakarta. Paket: Starter Rp149rb, Creator Rp499rb, Studio Rp1,2jt per bulan.
2. Produksi Apps — aplikasi mobile & web (Flutter, React/Next.js, PWA), dari riset sampai rilis.
3. Software Custom — POS, ERP ringan, sistem lisensi, bot, integrasi payment gateway.
4. Tools & Automation — utility, panel, script otomasi.

Aturan menulis WAJIB:
- Bahasa Indonesia yang natural dan mengalir, bukan terjemahan kaku.
- Nada profesional tapi membumi. Boleh sesekali menyapa pembaca dengan "lu" pada artikel santai, tapi jangan berlebihan.
- Konkret dan berbasis angka. Hindari klise pemasaran seperti "solusi terbaik", "revolusioner", "di era digital ini".
- Jangan mengarang testimoni, nama klien asli, atau statistik yang tidak masuk akal.
- Format Markdown: gunakan "## " untuk subjudul. JANGAN tulis judul H1 di dalam isi.
- Paragraf pendek, 2–4 kalimat. Gunakan daftar dan tabel bila relevan.
`.trim();

/* ---------- tugas yang bisa dipanggil langsung (dipakai rute & draf-penuh) ---------- */

/** Tulis konten lengkap dari judul. */
export async function tulisKonten({ col = 'blog', judul = '', arahan = '', panjang = 'sedang', model }) {
  const kata = { pendek: '400-600', sedang: '700-1000', panjang: '1200-1600' }[panjang] || '700-1000';

  const struktur = {
    blog: `Tulis artikel blog ${kata} kata. Mulai dengan paragraf pembuka yang langsung menarik (tanpa subjudul). Lalu 3-5 bagian ber-subjudul "## ". Tutup dengan bagian kesimpulan yang praktis.`,
    proyek: `Tulis studi kasus ${kata} kata dengan struktur PERSIS: "## Tantangan", "## Solusi", lalu "## Hasil". Bagian Hasil berisi daftar poin dengan angka dampak yang konkret dan masuk akal.`,
    berita: `Tulis berita perusahaan ${kata} kata. Paragraf pertama merangkum inti kabar (5W1H ringkas). Lanjutkan dengan detail, dampak bagi pelanggan, dan langkah yang perlu diambil pelanggan. Nada faktual, tidak berlebihan.`,
    legal: `Tulis dokumen legal ${kata} kata dalam Bahasa Indonesia yang jelas dan mudah dipahami. Gunakan penomoran bagian "## 1. ...", "## 2. ...". Nada formal tapi tidak berbelit. Sertakan catatan bahwa dokumen ini perlu ditinjau penasihat hukum sebelum dipublikasikan.`,
  }[col];

  const { teks, pakai, model: dipakai } = await groqChat({
    model,
    temperature: 0.75,
    max_tokens: 6000,
    system: `${BRAND}\n\nKeluarkan HANYA isi Markdown. Tanpa pembuka seperti "Berikut artikelnya". Tanpa blok kode pembungkus.`,
    user: `Judul: "${judul}"\n\n${struktur}${arahan ? `\n\nArahan tambahan dari editor: ${arahan}` : ''}`,
  });

  let isi = teks.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/, '').trim();
  isi = isi.replace(/^#\s+.+\n+/, ''); // buang H1 kalau AI tetap menulisnya
  return { body: isi, pakai, model: dipakai };
}

/** Buat metadata (desc, kategori/dst) dari judul + isi. */
export async function buatMeta({ col = 'blog', judul = '', body = '', model }) {
  const potongan = body.slice(0, 4000);

  const skema = {
    blog: `{"desc":"ringkasan 1-2 kalimat maksimal 160 karakter","kategori":"salah satu dari: Panduan, Teknis, Produksi, Automation, Umum","baca":angka menit baca,"judulAlt":["alternatif judul 1","alternatif judul 2"]}`,
    proyek: `{"desc":"ringkasan 1-2 kalimat maksimal 160 karakter","layanan":"salah satu dari: Cloud PC, Produksi Apps, Software Custom, Tools & Automation","stack":["teknologi1","teknologi2"],"status":"salah satu dari: Selesai, Berjalan, Maintenance"}`,
    berita: `{"desc":"ringkasan 1-2 kalimat maksimal 160 karakter","tag":"salah satu dari: Pengumuman, Produk, Infrastruktur, Perusahaan"}`,
    legal: `{"desc":"ringkasan 1-2 kalimat maksimal 160 karakter tentang isi dokumen","ringkas":"penjelasan versi bahasa sehari-hari 2-3 kalimat, sapa pembaca dengan \"lu\"","diperbarui":"tanggal hari ini format \"17 September 2026\""}`,
  }[col];

  const { teks, pakai } = await groqChat({
    model,
    temperature: 0.3,
    max_tokens: 900,
    json: true,
    system: `${BRAND}\n\nKembalikan HANYA objek JSON sesuai skema.`,
    user: `Judul: "${judul}"\n\nIsi:\n${potongan}\n\nBuat metadata dengan skema: ${skema}`,
  });
  return { ...ambilJSON(teks), pakai };
}

/* ---------- rute ---------- */
export function pasangAI(r) {
  r.jalan('GET', '/api/ai/status', (_req, res) => {
    json(res, 200, {
      aktif: aktif(),
      model: MODEL_DEFAULT(),
      pesan: aktif() ? 'Groq terhubung' : 'GROQ_API_KEY belum diatur di lingkungan',
    });
  });

  r.jalan('GET', '/api/ai/models', async (_req, res) => {
    if (!aktif()) return json(res, 200, { models: MODEL_FALLBACK, live: false });
    try {
      const resp = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key()}` } });
      if (!resp.ok) throw new Error('gagal');
      const d = await resp.json();
      const models = (d.data || [])
        .map((m) => m.id)
        .filter((id) => !/whisper|tts|guard|orpheus/i.test(id))
        .sort();
      json(res, 200, { models: models.length ? models : MODEL_FALLBACK, live: true });
    } catch {
      json(res, 200, { models: MODEL_FALLBACK, live: false });
    }
  });

  r.jalan('POST', '/api/ai/ide', async (req, res) => {
    const { col = 'blog', topik = '', jumlah = 5, model } = req.body || {};
    const jenis = { blog: 'artikel blog', proyek: 'studi kasus proyek', berita: 'berita perusahaan', legal: 'dokumen legal' }[col] || 'artikel';
    const { teks, pakai } = await groqChat({
      model,
      temperature: 0.9,
      max_tokens: 1200,
      json: true,
      system: `${BRAND}\n\nKembalikan HANYA objek JSON.`,
      user: `Usulkan ${jumlah} ide ${jenis} untuk Xyverse${topik ? ` seputar topik: "${topik}"` : ''}.

Format JSON:
{"ide":[{"judul":"...","desc":"ringkasan 1 kalimat","alasan":"kenapa relevan untuk audiens Xyverse"}]}

Judul harus spesifik dan menggugah rasa ingin tahu, bukan generik.`,
    });
    json(res, 200, { ...ambilJSON(teks), pakai });
  });

  r.jalan('POST', '/api/ai/tulis', async (req, res) => {
    const { col = 'blog', judul = '', arahan = '', panjang = 'sedang', model } = req.body || {};
    if (!judul.trim()) return json(res, 400, { error: 'Judul wajib diisi' });
    const d = await tulisKonten({ col, judul, arahan, panjang, model });
    json(res, 200, d);
  });

  r.jalan('POST', '/api/ai/meta', async (req, res) => {
    const { col = 'blog', judul = '', body = '', model } = req.body || {};
    const d = await buatMeta({ col, judul, body, model });
    json(res, 200, d);
  });

  r.jalan('POST', '/api/ai/perbaiki', async (req, res) => {
    const { body = '', mode = 'rapikan', model } = req.body || {};
    if (!body.trim()) return json(res, 400, { error: 'Isi konten masih kosong' });

    const tugas = {
      rapikan: 'Perbaiki ejaan, tata bahasa, dan alur kalimat. Pertahankan makna, struktur, dan panjang tulisan.',
      ringkas: 'Padatkan menjadi sekitar 60% panjang aslinya tanpa membuang informasi penting.',
      kembangkan: 'Perluas dengan contoh konkret dan penjelasan tambahan. Target sekitar 150% panjang asli.',
      santai: 'Ubah menjadi lebih santai dan akrab, boleh menyapa pembaca dengan "lu". Tetap informatif.',
      formal: 'Ubah menjadi lebih formal dan profesional. Hilangkan sapaan kasual.',
      seo: 'Optimalkan untuk pencarian: perkuat subjudul dengan kata kunci alami, tambahkan poin-poin yang mudah dipindai. Jangan sampai terasa dipaksakan.',
    }[mode] || 'Perbaiki tulisan ini.';

    const { teks, pakai } = await groqChat({
      model,
      temperature: 0.6,
      max_tokens: 6000,
      system: `${BRAND}\n\nKeluarkan HANYA hasil Markdown-nya. Tanpa komentar atau penjelasan.`,
      user: `${tugas}\n\n---\n${body}`,
    });

    const isi = teks.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/, '').trim();
    json(res, 200, { body: isi, pakai });
  });

  r.jalan('POST', '/api/ai/draf-penuh', async (req, res) => {
    const { col = 'blog', topik = '', panjang = 'sedang', model } = req.body || {};
    if (!topik.trim()) return json(res, 400, { error: 'Topik wajib diisi' });

    // tahap 1: judul
    const { teks: t1 } = await groqChat({
      model,
      temperature: 0.9,
      max_tokens: 400,
      json: true,
      system: `${BRAND}\n\nKembalikan HANYA JSON.`,
      user: `Buat satu judul terbaik untuk ${col} bertopik "${topik}". Format: {"judul":"..."}`,
    });
    const judul = ambilJSON(t1).judul;

    // tahap 2 & 3: fungsi internal langsung (tanpa HTTP ke localhost)
    const r2 = await tulisKonten({ col, judul, panjang, model });
    const r3 = await buatMeta({ col, judul, body: r2.body, model });

    json(res, 200, { judul, body: r2.body, meta: r3 });
  });
}
