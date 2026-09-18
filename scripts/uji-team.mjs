// Integration tests: real router, bcrypt, sessions, SQL schema and authorization.
// SQLite executes the same prepared statements used by the private D1 gateway.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import bcrypt from 'bcryptjs';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
const ownerPass='owner-test-unique-pass';sql.prepare("INSERT INTO users(id,username,name,role,pass_hash,must_change) VALUES ('owner','owner','Owner','owner',?,0)").run(bcrypt.hashSync(ownerPass,4));
Object.assign(process.env,{DB_GATEWAY_URL:'https://db.test/query',DB_GATEWAY_TOKEN:'test-only',SESSION_SECRET:'test-only-session-secret-that-is-long',TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'test',ADMIN_PASS_HASH:'unused',RESEND_API_KEY:'test-key',SURAT_TUJUAN:'test@example.com'});
const apiKey='xya_'+'1'.repeat(40), bootstrapKey='xya_'+'2'.repeat(40);
process.env.ADMIN_API_KEY=bootstrapKey;
Object.assign(process.env,{VERCEL_API_TOKEN:'fake',VERCEL_WEB_PROJECT:'fake',VERCEL_WEB_REPO_ID:'123'});
let notificationFails=false, rejectedQueries=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('/contents/.xyverse/api-keys.json'))return new Response(JSON.stringify([{id:'stored-ops',label:'Agent operations',cakupan:'penuh',hash:crypto.createHash('sha256').update(apiKey).digest('hex').slice(0,32)}]));
 if(String(url).startsWith('https://api.vercel.com/v6/deployments'))return new Response(JSON.stringify({deployments:[]}));
 if(String(url).startsWith('https://api.vercel.com/v13/deployments'))return new Response(JSON.stringify({id:'test-deploy'}));
 if(String(url).startsWith('https://api.github.com/')&&String(url).includes('/commits?'))return new Response(JSON.stringify([{sha:'a'.repeat(40)}]));
 if(String(url)==='https://db.test/query'){
  const {sql:q,params}=JSON.parse(options.body);
  try { const result=sql.prepare(q).all(...params);return new Response(JSON.stringify({success:true,result:[{success:true,results:result}]})); }
  catch {rejectedQueries++;return new Response(JSON.stringify({success:false}),{status:503});}
 }
 if(String(url).includes('challenges.cloudflare.com/turnstile/v0/siteverify'))return new Response(JSON.stringify({success:JSON.parse(options.body).response==='valid-test-token'}));
 if(String(url)==='https://api.resend.com/emails')return new Response(JSON.stringify(notificationFails?{}:{id:'test-mail-id'}),{status:notificationFails?500:200});
 if(String(url).startsWith('http://127.0.0.1:'))return nativeFetch(url,options);
 throw Error('Unexpected external fetch '+String(url));
};
const {tanganiApi}=await import('../server/core.js');
const server=http.createServer(tanganiApi);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let checks=0;
async function req(path,{method='GET',body,cookie,origin,key,status=200}={}){
 const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(key?{'authorization':'Bearer '+key}:{}),...(origin?{origin}: {})},body:body?JSON.stringify(body):undefined});
 const d=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(d)}`);checks++;return {data:d,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try {
 await req('/api/team',{status:401});
 await req('/api/auth/masuk',{method:'POST',body:{pengguna:'owner',sandi:ownerPass},status:400});
 const owner=await req('/api/auth/masuk',{method:'POST',body:{pengguna:'owner',sandi:ownerPass,turnstile:'valid-test-token'}});
 assert.equal(owner.data.peran,'owner');const cookie=owner.cookie;
 await req('/api/team',{method:'POST',cookie,origin:'https://evil.example',body:{pengguna:'member',nama:'Member'},status:403});
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM users').get().n,1,'Denied middleware must NOT execute later mutation');
 const created=await req('/api/team',{method:'POST',cookie,body:{pengguna:'member',nama:'Member',peran:'owner'},status:201});
 assert.equal(sql.prepare('SELECT role FROM users WHERE id=?').get(created.data.id).role,'admin');
 const rows=(await req('/api/team',{cookie})).data.users;assert.ok(rows.every(u=>!u.pass_hash && !u.password));
 const admin=await req('/api/auth/masuk',{method:'POST',body:{pengguna:'member',sandi:created.data.password,turnstile:'valid-test-token'}});
 assert.equal(admin.data.wajibGanti,true);
 await req('/api/inbox',{cookie:admin.cookie,status:403});
 await req('/api/auth/password',{method:'POST',cookie:admin.cookie,body:{lama:'wrong',baru:'new-unique-member-password'},status:400});
 await req('/api/auth/password',{method:'POST',cookie:admin.cookie,body:{lama:created.data.password,baru:'new-unique-member-password'}});
 await req('/api/auth/saya',{cookie:admin.cookie,status:401});
 const member=await req('/api/auth/masuk',{method:'POST',body:{pengguna:'member',sandi:'new-unique-member-password',turnstile:'valid-test-token'}});
 assert.equal(member.data.peran,'admin');assert.equal(member.data.wajibGanti,false);
 await req('/api/inbox',{cookie:member.cookie});
 for(const path of ['/api/team','/api/settings','/api/audit','/api/kunci'])await req(path,{cookie:member.cookie,status:403});
 await req('/api/team/owner',{cookie:member.cookie,method:'PATCH',body:{reset:true},status:403});
 await req('/api/team/owner',{cookie,method:'PATCH',body:{aktif:false},status:403});
 const message={nama:'Pelanggan Uji',email:'test@example.com',paket:'Creator',pesan:'Testing a genuine customer request in local SQL only.'};
 const contact=await req('/api/pesan',{method:'POST',body:message});
 assert.ok(sql.prepare('SELECT * FROM inbox WHERE id=?').get(contact.data.id));
 const inbox=(await req('/api/inbox',{cookie:member.cookie})).data.items[0];
 await req('/api/inbox/'+inbox.id,{cookie:member.cookie,method:'PATCH',body:{...inbox,status:'diproses',assignee:created.data.id,note:'Ditangani oleh xyteam'}});
 await req('/api/inbox/'+inbox.id,{cookie:member.cookie,method:'PATCH',body:{...inbox,status:'selesai'},status:409});
 const usersBeforeApi=sql.prepare('SELECT * FROM users ORDER BY id').all();
 // Both stored keys and bootstrap keys receive operational, not owner, access.
 for (const key of [apiKey,bootstrapKey]) {
   const list=await req('/api/inbox',{key});
   const entry=list.data.items.find(x=>x.id===inbox.id);
   await req('/api/inbox/'+entry.id,{key,method:'PATCH',body:{...entry,status:'menunggu',note:'Handled by operational API key'}});
   await req('/api/deploy',{key});
   await req('/api/deploy',{key,method:'POST',body:{}});
   for (const path of ['/api/team','/api/settings','/api/audit','/api/kunci'])await req(path,{key,status:403});
   await req('/api/team',{key,method:'POST',body:{pengguna:'intruder',nama:'Denied'},status:403});
   await req('/api/team/owner',{key,method:'PATCH',body:{reset:true},status:403});
   await req('/api/team/'+created.data.id,{key,method:'PATCH',body:{reset:true},status:403});
   await req('/api/team/'+created.data.id,{key,method:'PATCH',body:{aktif:false},status:403});
   await req('/api/settings',{key,method:'PUT',body:{},status:403});
   await req('/api/kunci',{key,method:'POST',body:{label:'Denied'},status:403});
   await req('/api/auth/password',{key,method:'POST',body:{lama:ownerPass,baru:'malicious-replacement-password'},status:403});
 }
 assert.deepEqual(sql.prepare('SELECT * FROM users ORDER BY id').all(),usersBeforeApi,'Denied API mutations must leave all accounts/passwords/versions untouched');
 assert.ok(sql.prepare("SELECT * FROM audit WHERE actor LIKE 'api:stored-ops%' AND action='inbox_updated'").get(),'API audit attribution is required');
 await req('/api/inbox',{status:401});
 await req('/api/inbox',{key:'xya_invalid',status:401});
 notificationFails=true;const retained=await req('/api/pesan',{method:'POST',body:message});
 assert.equal(sql.prepare('SELECT notification FROM inbox WHERE id=?').get(retained.data.id).notification,'failed');
 await req('/api/team/'+created.data.id,{cookie,method:'PATCH',body:{aktif:false}});
 await req('/api/inbox',{cookie:member.cookie,status:401});
 await req('/api/auth/masuk',{method:'POST',body:{pengguna:'member',sandi:'new-unique-member-password',turnstile:'valid-test-token'},status:401});
 await req('/api/team/'+created.data.id,{cookie,method:'PATCH',body:{aktif:true}});
 await req('/api/inbox',{cookie:member.cookie,status:401});
 const reset=await req('/api/team/'+created.data.id,{cookie,method:'PATCH',body:{reset:true}});assert.ok(reset.data.password);
 const audit=(await req('/api/audit',{cookie})).data.items;assert.ok(audit.some(x=>x.action==='inbox_updated'));assert.ok(audit.some(x=>x.action==='team_disabled'));
 assert.equal(rejectedQueries,0,'All prepared statements must be valid SQL');
 console.log(`${checks} HTTP checks + SQL/RBAC/session/inbox invariants passed.`);
} finally {await new Promise(r=>server.close(r));sql.close();}
