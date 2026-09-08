import assert from 'node:assert/strict';
const origin=process.argv[2];
if (!origin||new URL(origin).pathname!=='/') throw new Error('Pass the deployment origin, without /game');
async function get(path:string) {return fetch(new URL(path,origin),{redirect:'manual'});}
for (const path of ['/game','/game/status','/game/api/health','/game/assets/packs/public/manifest.json']) {
  const response=await get(path);assert.equal(response.status,200,path);console.log('200 '+path);
  if (path==='/game') {
    const html=await response.text();assert.match(html,/not yet available to play/);
    const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]!);
    assert(assets.length>0);
    for (const asset of assets) {assert(asset.startsWith('/game/_next/'),asset);assert.equal((await get(asset)).status,200,asset);}
  }
  if (path.endsWith('/health')) {const body=await response.json();assert.equal(body.basePath,'/game');assert.equal(body.gameplayEnabled,false);assert.equal(body.cloudSavesEnabled,false);}
}
for (const path of ['/','/status','/api/health','/assets/packs/public/manifest.json','/game/dev','/game/research/private-assets/reference/test.png','/game/assets/packs/reference/test.png','/game/content/research/missions.json']) {
  assert.equal((await get(path)).status,404,path);console.log('404 '+path);
}
console.log('PASS: /game routing, prefixed resources, API, and private/debug path isolation.');
