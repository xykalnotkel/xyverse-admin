/**
 * Vercel Function — gerbang API admin (semua rute /api/*).
 *
 * Menjalankan router inti yang sama dengan dev server lokal
 * (server/core.js), jadi perilaku lokal dan produksi identik.
 *
 * Konfigurasi:
 * - runtime 'nodejs' (bukan edge) — dipakai untuk crypto/bcryptjs
 * - maxDuration 60 dtk: cukup untuk pemanggilan Groq terpanjang
 *   (draf-penuh = 3 tahap berurutan). Naikkan di vercel.json bila
 *   memakai plan yang mendukung batas lebih besar.
 */
import { tanganiApi } from '../server/core.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default function handler(req, res) {
  return tanganiApi(req, res);
}
