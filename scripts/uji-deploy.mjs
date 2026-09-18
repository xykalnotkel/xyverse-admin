import assert from 'node:assert/strict';
import { deployCommit } from '../server/deploy.js';
Object.assign(process.env,{VERCEL_API_TOKEN:'test',VERCEL_WEB_PROJECT:'test',VERCEL_WEB_REPO_ID:'123'});
const sha='a'.repeat(40);let posts=0,mode='new';
globalThis.fetch=async(url,options={})=>{
 if(options.method==='POST'){posts++;if(mode==='fail')return new Response('{}',{status:503});const b=JSON.parse(options.body);assert.equal(b.gitSource.ref,sha);assert.equal(b.target,'production');return new Response(JSON.stringify({id:'created'}));}
 return new Response(JSON.stringify({deployments:mode==='exists'?[{uid:'already',state:'READY',meta:{githubCommitSha:sha}}]:[]}));
};
assert.equal((await deployCommit(sha)).deploymentId,'created');assert.equal(posts,1);
mode='exists';assert.equal((await deployCommit(sha)).deploymentId,'already');assert.equal(posts,1);
mode='fail';assert.ok((await deployCommit(sha)).deployWarning);assert.equal(posts,2);
assert.deepEqual(await deployCommit('invalid'),{});assert.equal(posts,2);
console.log('Deploy fallback: exact commit, deduplication, safe failure and invalid SHA checks passed.');
