import {readFileSync,writeFileSync,readdirSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const release=join(root,'miniapp/release/web');
const publicDir=join(root,'miniapp/public');
const site=join(root,'catalog-site');
const out=resolve(process.argv[2]||join(root,'..','deliverables'));
const index=readFileSync(join(release,'index.html'),'utf8').replace('<html lang="ru">','<html lang="ru" data-order-mode="copy">');
if(!index.includes('data-order-mode="copy"'))throw new Error('Standalone order mode must be explicit');
rmSync(site,{recursive:true,force:true});
mkdirSync(site,{recursive:true});
mkdirSync(join(site,'assets'),{recursive:true});
for(const [,asset] of index.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g))cpSync(join(release,asset),join(site,asset));
cpSync(publicDir,site,{recursive:true});
writeFileSync(join(site,'index.html'),index);
writeFileSync(join(site,'.nojekyll'),'');
writeFileSync(join(site,'publish-release.txt'),'catalog-v5-2026-09-28-public-2026-10-02\n');
writeFileSync(join(site,'release.json'),JSON.stringify({catalogVersion:'v5-2026-09-28',orderMode:'copy',families:9,variants:16,photos:13},null,2)+'\n');

// One file that opens locally without a server or module/CORS file requests.
let offline=index;
const photos={};
for(const file of readdirSync(join(publicDir,'products')).filter(f=>f.endsWith('.webp'))){
 const bytes=readFileSync(join(publicDir,'products',file));
 photos[file.replace('.webp','')]='data:image/webp;base64,'+bytes.toString('base64');
}
offline=offline.replace(/<link[^>]+rel="stylesheet"[^>]+href="([^\"]+)"[^>]*>/g,(_,path)=>'<style>'+readFileSync(join(release,path),'utf8')+'</style>');
offline=offline.replace(/<script[^>]+src="([^\"]+)"[^>]*><\/script>/g,(_,path)=>{
 let js=readFileSync(join(release,path),'utf8');
 const pattern=/["\x60]\.\/products\/["\x60]\+([a-zA-Z_$][\w$]*)\+["\x60]\.webp["\x60]/g;
 const matches=[...js.matchAll(pattern)];
 if(matches.length!==1)throw new Error('Verify the offline photo resolver before publishing');
 js=js.replace(pattern,(_,id)=>'globalThis.__DELI_BERRY_OFFLINE_PHOTOS__['+id+']');
 return '<script>globalThis.__DELI_BERRY_OFFLINE_PHOTOS__='+JSON.stringify(photos)+';</script><script type="module">'+js.replaceAll('</script','<\\/script')+'</script>';
});
offline=offline.replace('href="./favicon.svg"','href="data:image/svg+xml;base64,'+readFileSync(join(publicDir,'favicon.svg')).toString('base64')+'"');
if(/(?:src|href)="\.\/(?:assets|products)\//.test(offline))throw new Error('Offline file still depends on local assets');
mkdirSync(out,{recursive:true});
const file=join(out,'Deli_Berri_Catalog_v5_2026-10-02.html');
writeFileSync(file,offline);
console.log(JSON.stringify({site,file,bytes:Buffer.byteLength(offline),photos:Object.keys(photos).length,sha256:createHash('sha256').update(offline).digest('hex')}));
