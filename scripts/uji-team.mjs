// Integration tests: real router, bcrypt, sessions, SQL schema and authorization.
// SQLite executes the same prepared statements used by the private D1 gateway.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import bcrypt from 'bcryptjs';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
const ownerPass='owner-test-unique-pass';sql.prepare("INSERT INTO users(id,username,name,role,pass_hash,must_change) VALUES ('owner','owner','Owner','owner',?,0)").run(bcrypt.hashSync(ownerPass,4));
Object.assign(process.env,{DB_GATEWAY_URL:'https://db.test/query',DB_GATEWAY_TOKEN:'test-only',SESSION_SECRET:'test-only-session-secret-that-is-long',TURNSTILE_SITE_KEY:'test',TURNSTILE_SECRET_KEY:'test',ADMIN_PASS_HASH:'unused',RESEND_API_KEY:'test-key',SURAT_TUJUAN:'test@example.com'});
let notificationFails=false, rejectedQueries=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
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
async function req(path,{method='GET',body,cookie,origin,status=200}={}){
 const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(origin?{origin}: {})},body:body?JSON.stringify(body):undefined});
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
