// Private D1 gateway: Vercel receives only this database's random access token,
// never an account-wide Cloudflare API token. No browser/client access.
export default {
  async fetch(request, env) {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/query') return send(404, { success: false });
    const provided = request.headers.get('authorization') || '';
    const expected = `Bearer ${env.ACCESS_TOKEN}`;
    const hash = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    const a=await hash(provided), b=await hash(expected); let diff=0;
    for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
    if(!env.ACCESS_TOKEN || diff) return send(401, { success: false });
    try {
      const raw=await request.text();if(raw.length>100000)return send(413,{success:false});
      const {sql,params=[]}=JSON.parse(raw);
      if(typeof sql!=='string'||!/^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql.trim())||!Array.isArray(params))return send(400,{success:false});
      const result=await env.DB.prepare(sql).bind(...params).all();
      return send(200,{success:true,result:[result]});
    } catch { return send(503,{success:false}); }
  }
};
