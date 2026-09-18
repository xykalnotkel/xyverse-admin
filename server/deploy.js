// Explicit deploy fallback for dashboard commits: don't assume a Git webhook ran.
// A saved GitHub commit remains a success even if the deployment request fails.
export async function deployCommit(sha) {
  if(!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_WEB_PROJECT || !process.env.VERCEL_WEB_REPO_ID) return {};
  if(!/^[a-f0-9]{40}$/.test(sha||'')) return {};
  try {
    const query=new URLSearchParams({projectId:process.env.VERCEL_WEB_PROJECT,target:'production',limit:'8'});
    if(process.env.VERCEL_TEAM_ID)query.set('teamId',process.env.VERCEL_TEAM_ID);
    const headers={authorization:`Bearer ${process.env.VERCEL_API_TOKEN}`,'content-type':'application/json'};
    const list=await fetch('https://api.vercel.com/v6/deployments?'+query,{headers,signal:AbortSignal.timeout(10000)});
    if(list.ok){const data=await list.json();const existing=data.deployments?.find(x=>x.meta?.githubCommitSha===sha&&!['ERROR','CANCELED'].includes(x.state));if(existing)return {deploymentId:existing.uid};}
    const team=process.env.VERCEL_TEAM_ID?'?teamId='+encodeURIComponent(process.env.VERCEL_TEAM_ID):'';
    const r=await fetch('https://api.vercel.com/v13/deployments'+team,{method:'POST',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({name:'xyverse-web',project:process.env.VERCEL_WEB_PROJECT,target:'production',gitSource:{type:'github',repoId:Number(process.env.VERCEL_WEB_REPO_ID),ref:sha}})});
    if(!r.ok)throw new Error('deploy');const d=await r.json();return {deploymentId:d.id};
  } catch { return {deployWarning:'Commit tersimpan, tetapi permintaan deploy gagal. Buka Deploy untuk periksa atau coba terbitkan ulang.'}; }
}
