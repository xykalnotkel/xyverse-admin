import crypto from 'node:crypto';
import { Galat } from './http.js';
export const configured = () => {
  const ready=Boolean(process.env.DB_GATEWAY_URL && process.env.DB_GATEWAY_TOKEN);
  if(process.env.TEAM_DB_REQUIRED==='1' && !ready) throw new Galat('Konfigurasi penyimpanan akun tidak lengkap.',503);
  return ready;
};
export async function query(sql, params = []) {
  if (!configured()) throw new Galat('Penyimpanan operasional belum dikonfigurasi.', 503);
  let r;
  try {
    r = await fetch(process.env.DB_GATEWAY_URL, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.DB_GATEWAY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Galat('Penyimpanan sedang tidak tersedia. Coba lagi.', 503); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success || d.result?.some(x => x.success === false)) {
    // Never send SQL, database responses, or credentials to the browser/log.
    throw new Galat('Operasi penyimpanan gagal. Coba lagi atau periksa konflik data.', 503);
  }
  return d.result?.[0]?.results || [];
}
export async function rateLimit(scope, ip, max, ms) {
  if (!configured()) return false;
  const bucket = Math.floor(Date.now() / ms);
  const digest = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'local').update(String(ip)).digest('hex');
  const key = `${scope}:${bucket}:${digest}`;
  const rows = await query('INSERT INTO rate_limits(key,n,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n', [key, (bucket + 1) * ms]);
  // Delete expired counters; bounded retention, never store raw IPs.
  if (rows[0]?.n === 1) await query('DELETE FROM rate_limits WHERE expires < ?', [Date.now() - ms]);
  return Number(rows[0]?.n || 0) > max;
}
export const userById = async id => (await query('SELECT * FROM users WHERE id=?', [id]))[0] || null;
export const userByName = async name => (await query('SELECT * FROM users WHERE username=? COLLATE NOCASE', [name]))[0] || null;
export function publicUser(u) { return { id: u.id, pengguna: u.username, nama: u.name, peran: u.role, aktif: !!u.enabled, wajibGanti: !!u.must_change }; }
export async function audit(actor, action, subject = '') {
  if (configured()) await query('INSERT INTO audit(actor,action,subject) VALUES (?,?,?)', [String(actor).slice(0,100), action.slice(0,120), String(subject).slice(0,300)]);
}
