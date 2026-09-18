import { deployCommit } from './deploy.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as db from './database.js';
import * as gh from './github.js';
import { json, Galat } from './http.js';

const SESSION_ONLY = /^\/api\/(team|audit|settings|kunci)(\/|$)/;
const OWNER_ONLY = /^\/api\/(team|audit|settings|kunci)(\/|$)/;
export function izin(req, res, next) {
  if (!req.admin) return next();
  if (req.admin.wajibGanti && req.urlPath !== '/api/auth/password') return json(res, 403, { error: 'Ganti password sementara sebelum melanjutkan.', kode: 'GANTI_PASSWORD' });
  if (SESSION_ONLY.test(req.urlPath) && req.admin.jenis !== 'sesi') return json(res, 403, { error: 'Bagian ini hanya untuk sesi owner di browser.', kode: 'BUTUH_SESI' });
  if (OWNER_ONLY.test(req.urlPath) && (req.admin.jenis !== 'sesi' || req.admin.peran !== 'owner')) return json(res, 403, { error: 'Hanya owner yang dapat mengelola bagian ini.' });
  return next();
}
const actor = req => req.admin?.jenis === 'api' ? `api:${req.admin.id} (${req.admin.label || 'operasional'})` : req.admin?.pengguna;
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const blobSha = s => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0${s}`).digest('hex');
const settingsPath = 'src/data/settings.json';
function validSettings(input) {
  const email = clean(input.email, 200), wa = clean(input.wa, 20);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Galat('Email publik tidak valid.',400);
  if (wa && !/^[1-9][0-9]{7,14}$/.test(wa)) throw new Galat('WA harus digit internasional tanpa +, atau kosong untuk disembunyikan.',400);
  const socials = (Array.isArray(input.socials) ? input.socials : []).slice(0,12).map(x => {
    const u = new URL(x.url); if (u.protocol !== 'https:') throw new Galat('URL sosial wajib HTTPS.',400);
    return { nama: clean(x.nama,40), url: u.href, handle: clean(x.handle,80), ikon: ['github','instagram','x','youtube','discord','linkedin','tiktok','telegram'].includes(x.ikon) ? x.ikon : 'github' };
  });
  const plans = (Array.isArray(input.plans) ? input.plans : []).map(x => ({ id: clean(x.id,30), name: clean(x.name,60), priceId: clean(x.priceId,30), priceEn: clean(x.priceEn,30) }));
  if (plans.length !== 3 || new Set(plans.map(x=>x.id)).size!==3 || plans.some(x=>!['starter','creator','studio'].includes(x.id)||!x.name||!x.priceId||!x.priceEn)) throw new Galat('Tiga paket wajib terisi: starter, creator, studio.',400);
  return { email, wa, socials, plans };
}
export function pasangPlatform(r) {
  r.jalan('GET','/api/team',async (_req,res)=> json(res,200,{ users:(await db.query('SELECT * FROM users ORDER BY role DESC,username')).map(db.publicUser) }));
  r.jalan('POST','/api/team',async(req,res)=>{
    const username=clean(req.body?.pengguna,40).toLowerCase(), name=clean(req.body?.nama,100);
    if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||!name) throw new Galat('Isi nama dan username 3–40 karakter (huruf, angka, _, . atau -).',400);
    if(await db.userByName(username)) throw new Galat('Username sudah digunakan.',409);
    const id=crypto.randomUUID(), password=crypto.randomBytes(18).toString('base64url'), hash=await bcrypt.hash(password,12);
    await db.query("INSERT INTO users(id,username,name,role,pass_hash) VALUES (?,?,?,'admin',?)",[id,username,name,hash]);
    await db.audit(actor(req),'team_created',id);
    json(res,201,{ok:true,id,password,peringatan:'Salin dan kirim secara pribadi. Password hanya tampil sekali; anggota wajib menggantinya saat login.'});
  });
  r.jalan('PATCH','/api/team/:id',async(req,res)=>{
    const u=await db.userById(req.params.id);
    if(!u) throw new Galat('Anggota tidak ditemukan.',404);
    if(u.role==='owner') throw new Galat('Akun owner tidak dapat diubah melalui manajemen anggota.',403);
    if(req.body?.reset===true){
      const password=crypto.randomBytes(18).toString('base64url');
      await db.query('UPDATE users SET pass_hash=?,version=version+1,must_change=1 WHERE id=?',[await bcrypt.hash(password,12),u.id]);
      await db.audit(actor(req),'team_password_reset',u.id);
      return json(res,200,{ok:true,password});
    }
    if(typeof req.body?.aktif!=='boolean') throw new Galat('Pilih aktif/nonaktif.',400);
    await db.query('UPDATE users SET enabled=?,version=version+1 WHERE id=?',[req.body.aktif?1:0,u.id]);
    await db.audit(actor(req),req.body.aktif?'team_enabled':'team_disabled',u.id);
    json(res,200,{ok:true});
  });
  r.jalan('GET','/api/inbox',async(req,res)=>{
    const offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
    const items=await db.query('SELECT * FROM inbox ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?',[offset]);
    const total=(await db.query('SELECT COUNT(*) AS n FROM inbox'))[0].n;
    const team=await db.query('SELECT id,name FROM users WHERE enabled=1');
    json(res,200,{items,total,offset,team});
  });
  r.jalan('PATCH','/api/inbox/:id',async(req,res)=>{
    const b=req.body||{};
    if(!['baru','diproses','menunggu','selesai','spam'].includes(b.status)) throw new Galat('Status tidak valid.',400);
    const assignee=clean(b.assignee,80);
    if(assignee && !(await db.userById(assignee))?.enabled) throw new Galat('Penanggung jawab tidak aktif.',400);
    const rows=await db.query('UPDATE inbox SET status=?,assignee=?,note=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? RETURNING id',[b.status,assignee,clean(b.note,5000),req.params.id,Number(b.version)]);
    if(!rows.length) throw new Galat('Pesan berubah atau sudah tidak ada. Muat ulang sebelum menyimpan.',409);
    await db.audit(actor(req),'inbox_updated',req.params.id);json(res,200,{ok:true});
  });
  r.jalan('GET','/api/audit',async(_req,res)=>json(res,200,{items:await db.query('SELECT * FROM audit ORDER BY id DESC LIMIT 100')}));
  r.jalan('GET','/api/settings',async(_req,res)=>{
    const raw=await gh.bacaIsi(gh.reposSitus(),settingsPath);json(res,200,{settings:JSON.parse(raw),revision:blobSha(raw)});
  });
  r.jalan('PUT','/api/settings',async(req,res)=>{
    if(!/^[a-f0-9]{40}$/.test(req.body?.revision||'')) throw new Galat('Muat pengaturan terbaru dahulu.',400);
    let settings;try{settings=validSettings(req.body?.settings||{});}catch(e){if(e.status)throw e;throw new Galat('Pengaturan tidak valid.',400);}
    const result=await gh.tulisBerkas(gh.reposSitus(),settingsPath,JSON.stringify(settings,null,2)+'\n',`Pengaturan situs oleh ${req.admin.pengguna}`,req.body.revision);
    await db.audit(actor(req),'settings_saved',result.commitSha);json(res,200,{ok:true,...result});
  });
  r.jalan('POST','/api/deploy',async(req,res)=>{
    const latest=await gh.commitTerakhir(gh.reposSitus());
    const result=await deployCommit(latest?.sha);
    if(!result.deploymentId)throw new Galat(result.deployWarning||'Konfigurasi deploy belum lengkap.',503);
    await db.audit(actor(req),'deploy_requested',latest.sha);
    json(res,200,{ok:true,...result});
  });
  r.jalan('GET','/api/deploy',async(_req,res)=>{
    if(!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_WEB_PROJECT) throw new Galat('Integrasi status Vercel belum disetel.',503);
    const u=new URL('https://api.vercel.com/v6/deployments');u.searchParams.set('projectId',process.env.VERCEL_WEB_PROJECT);u.searchParams.set('limit','8');u.searchParams.set('target','production');
    if(process.env.VERCEL_TEAM_ID)u.searchParams.set('teamId',process.env.VERCEL_TEAM_ID);
    const resp=await fetch(u,{headers:{authorization:`Bearer ${process.env.VERCEL_API_TOKEN}`},signal:AbortSignal.timeout(12000)});
    if(!resp.ok)throw new Galat('Tidak dapat membaca status Vercel.',502);
    const data=await resp.json();
    json(res,200,{items:(data.deployments||[]).map(x=>({id:x.uid,status:x.state||x.readyState,created:x.created,url:x.url,commit:x.meta?.githubCommitSha,message:x.meta?.githubCommitMessage})),site:process.env.VITE_SITE_URL||'https://www.xyverse.my.id'});
  });
}
