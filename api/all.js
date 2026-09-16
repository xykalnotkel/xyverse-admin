/**
 * Vercel Function — gerbang SATU-SATUNYA untuk semua rute /api/*.
 *
 * Proyek non-Next di Vercel tidak mendukung catch-all function
 * ([...path] hanya satu segmen), jadi semua permintaan /api/* di-rewrite
 * ke fungsi ini (lihat vercel.json). URL asli tetap utuh di req.url,
 * dan router inti (server/core.js) yang menentukan rutenya — pola yang
 * sama dengan adapter Express klasik di Vercel.
 *
 * Konfigurasi:
 * - runtime 'nodejs' (bukan edge) — dipakai untuk crypto/bcryptjs
 * - maxDuration 60 dtk: cukup untuk draf-penuh (3 tahap Groq berurutan)
 */
import { tanganiApi } from '../server/core.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default function handler(req, res) {
  return tanganiApi(req, res);
}
