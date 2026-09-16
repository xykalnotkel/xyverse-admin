/** Membuat hash bcrypt untuk kata sandi admin.
 *  Pemakaian:  npm run hash -- "katasandi rahasia"          */
import bcrypt from 'bcryptjs';

const sandi = process.argv.slice(2).join(' ').trim();
if (!sandi) {
  console.error('\nPemakaian: npm run hash -- "katasandi"\n');
  process.exit(1);
}
if (sandi.length < 10) {
  console.warn('\n⚠  Kata sandi kurang dari 10 karakter. Sangat disarankan lebih panjang.\n');
}
const hash = bcrypt.hashSync(sandi, 12);
console.log(`
Salin baris ini ke berkas .env:

ADMIN_PASS_HASH=${hash}
`);
