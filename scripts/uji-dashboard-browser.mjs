// UI interaction tests against built assets. All API requests are intercepted;
// no real member, customer, GitHub commit or email is created by this suite.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:4400';
const settings={email:'xycdigital@gmail.com',wa:'',socials:[],plans:[{id:'starter',name:'Starter',priceId:'149K',priceEn:'149K'},{id:'creator',name:'Creator',priceId:'499K',priceEn:'499K'},{id:'studio',name:'Studio',priceId:'1.2JT',priceEn:'1.2M'}]};
const browser=await chromium.launch();
let ownerPage;
try{
 for(const role of ['owner','admin','temporary']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  let members=[{id:'owner',pengguna:'kall',nama:'Owner',peran:'owner',aktif:true,wajibGanti:false}];
  let creates=0,saves=0;
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url()), p=u.pathname, method=route.request().method();let data={};
   if(p==='/api/auth/saya')data={masuk:true,pengguna:role==='owner'?'kall':'member',peran:role==='owner'?'owner':'admin',wajibGanti:role==='temporary'};
   else if(p==='/api/stats')data={blog:{label:'Blog',total:0,publik:0,draft:0,id:0,en:0}};
   else if(p==='/api/blog' && method==='GET')data=[];
   else if(p.startsWith('/api/blog/')&&method==='PUT'){saves++;data={ok:true,commitSha:'abcdef123456789'};}
   else if(p==='/api/team'&&method==='GET')data={users:members};
   else if(p==='/api/team'&&method==='POST'){creates++;const b=route.request().postDataJSON();members.push({id:'member-1',pengguna:b.pengguna,nama:b.nama,peran:'admin',aktif:true,wajibGanti:true});data={ok:true,password:'UI-test-temporary-only'};}
   else if(p==='/api/settings')data={settings,revision:'a'.repeat(40)};
   else if(p==='/api/inbox')data={items:[],total:0,team:[],offset:0};
   else if(p==='/api/deploy')data={items:[{id:'test',status:'READY',commit:'abcdef123',message:'Test deployment',url:'example.com'}]};
   else if(p==='/api/git/proyek')data=[];
   else if(p==='/api/git/status')data={};
   else if(p==='/api/media')data=[];
   else if(p==='/api/audit')data={items:[]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base);
  if(role==='temporary'){
   await page.getByRole('heading',{name:'Amankan akun xyteam'}).waitFor();assert.equal(await page.locator('.side').count(),0);console.log('OK mandatory password change blocks dashboard UI');
  } else {
   await page.getByRole('heading',{name:'Dasbor',exact:true}).waitFor();
   const team=page.locator('.side').getByRole('button',{name:'xyteam',exact:true});
   assert.equal(await team.count(),role==='owner'?1:0);
   assert.equal(await page.locator('.side').getByRole('button',{name:'Kunci API',exact:true}).count(),role==='owner'?1:0);
   if(role==='owner'){
    await team.click();await page.getByLabel('Nama anggota').fill('Operator UI Test');await page.getByLabel('Username',{exact:true}).fill('operator_test');await page.getByRole('button',{name:'Buat akun',exact:true}).click();await page.getByText('UI-test-temporary-only',{exact:true}).waitFor();assert.equal(creates,1);await page.getByRole('button',{name:'Sudah disalin, sembunyikan'}).click();assert.equal(await page.getByText('UI-test-temporary-only',{exact:true}).count(),0);
    await page.locator('.side').getByRole('button',{name:'Pengaturan situs'}).click();await page.getByRole('heading',{name:'Kontak publik'}).waitFor();assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'xycdigital@gmail.com');
   }
   await page.locator('.side').getByRole('button',{name:'Pesan & pesanan'}).click();await page.getByText('Belum ada permintaan.',{exact:false}).waitFor();
   await page.locator('.side').getByRole('button',{name:'Deploy',exact:true}).click();await page.getByText('TAYANG',{exact:true}).waitFor();
   await page.locator('.side').getByRole('button',{name:/^Blog\b/}).click();await page.getByRole('button',{name:'Buat baru',exact:true}).click();
   await page.locator('.ed .field input').first().fill('Draf pengujian');
   await page.locator('textarea.mono').fill('Tulisan ini harus pulih setelah pindah menu.');
   await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('xy-draft:')&&localStorage[k].includes('Tulisan ini harus pulih')));
   assert.equal(saves,0,'Autosave must not commit to GitHub');
   await page.locator('.side').getByRole('button',{name:'Dasbor',exact:true}).click();
   await page.locator('.side').getByRole('button',{name:/^Blog\b/}).click();await page.getByRole('button',{name:'Buat baru',exact:true}).click();await page.getByRole('button',{name:'Pulihkan draf',exact:true}).click();
   assert.equal(await page.locator('textarea.mono').inputValue(),'Tulisan ini harus pulih setelah pindah menu.');
   await page.getByRole('button',{name:'Simpan',exact:true}).click();await page.getByRole('heading',{name:'Blog',exact:true}).waitFor();assert.equal(saves,1);
   assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('xy-draft:')).length),0);
   console.log(`OK ${role}: role navigation, inbox, actual deployment state, autosave/recovery/no auto-commit`);
   if(role==='owner'){await page.locator('.side').getByRole('button',{name:'xyteam',exact:true}).click();await page.screenshot({path:'/home/user/xyteam-desktop-test.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/home/user/xyteam-mobile-test.png',fullPage:true});}
  }
  assert.deepEqual(errors,[],`${role} runtime errors`);await page.close();
 }
}finally{await browser.close();}
