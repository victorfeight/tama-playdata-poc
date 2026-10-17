// Make a self-contained browser entry from the same maintained game-room UI.
// Takes an already verified package; no server deployment or serial writes.
import { readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from '../web-client/node_modules/vite/dist/node/index.js';
const [directory,relay]=process.argv.slice(2);
if(!directory || !relay || new URL(relay).protocol!=='https:')throw new Error('Usage: package-local-game-room.mjs staged-folder https://relay-host');
const root=fileURLToPath(new URL('../web-client',import.meta.url));
const manifests={};
for(const name of ['payload.json','payload-pocket-puzzle.json']){
 const m=JSON.parse(await readFile(path.join(directory,'games',name),'utf8'));
 if(!/^(blocks|pocket-puzzle)\.[a-f0-9]{12}\.pdlo\.bin$/.test(m.file))throw new Error('Invalid payload filename');
 const raw=await readFile(path.join(directory,'games',m.file));
 if(createHash('sha256').update(raw).digest('hex')!==m.sha256)throw new Error('Staged payload changed');
 manifests[name]=m;
}
const temporary=await mkdtemp(path.join(tmpdir(),'tama-local-game-room-'));
await build({configFile:false,root,define:{'import.meta.env.VITE_RELAY_URL':JSON.stringify(relay)},
 build:{outDir:temporary,emptyOutDir:true,cssCodeSplit:false,
  rollupOptions:{input:path.join(root,'games/index.html'),output:{inlineDynamicImports:true}}}});
let html=await readFile(path.join(temporary,'games/index.html'),'utf8');
const assets=await readdir(path.join(temporary,'assets'));
if(assets.filter(n=>n.endsWith('.js')).length!==1)throw new Error('Expected one self-contained entry');
const js=assets.find(n=>n.endsWith('.js')),css=assets.find(n=>n.endsWith('.css'));
html=html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/,
 ()=>'__LOCAL_ENTRY__');
const entry='<script type="module">'+(await readFile(path.join(temporary,'assets',js),'utf8')).replace(/<\/script/gi,'<\\/script')+'</script>';
html=html.replace('__LOCAL_ENTRY__',()=>entry);
const style=await readFile(path.join(temporary,'assets',css),'utf8');
html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/,
 ()=>'<style>'+style+'</style>');
html=html.replace('<body>','<body data-default-game="pocket-puzzle"><script id="local-payloads" type="application/json">'+JSON.stringify(manifests)+'</script>');
html=html.replace('href="/"','href="'+relay+'/"');
if(html.includes('src="/assets/') || html.includes('href="/assets/'))throw new Error('External asset remained');
await writeFile(path.join(directory,'games/PLAY-ONLINE.html'),html);
await writeFile(path.join(directory,'local-game-room.json'),JSON.stringify({relay,
 sha256:createHash('sha256').update(html).digest('hex'),scope:'Standalone private page; existing relay; not deployed'},null,2)+'\n');
console.log('Created games/PLAY-ONLINE.html using the shared UI and '+relay);
