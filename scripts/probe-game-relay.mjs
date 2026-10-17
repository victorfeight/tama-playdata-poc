// Real two-peer room admission and bidirectional binary transport. No tokens
// are logged or saved. This does not substitute for physical UART/WAN gameplay.
import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base,output]=process.argv.slice(2),app='tamahome-pocket-puzzle-v2';
if(!base || !output)throw new Error('Usage: probe-game-relay.mjs URL receipt.json');
const response=await fetch(new URL('/sessions',base),{method:'POST',headers:{'x-app-name':app},signal:AbortSignal.timeout(10000)});
assert(response.ok,'Room creation failed');const room=await response.json();
const join=await fetch(new URL(`/sessions/${room.code}/join`,base),{method:'POST',headers:{'x-app-name':app},signal:AbortSignal.timeout(10000)});
assert(join.ok,'Room admission failed');const joined=await join.json();
assert.equal(joined.app,app);assert.equal(joined.token,room.token);
const sockets=[];
try{
 for(const role of ['a','b']){
  const url=new URL(`/ws/${room.code}`,base.replace(/^http/,'ws'));url.searchParams.set('role',role);
  const ws=new WebSocket(url,room.token);sockets.push(ws);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Open timeout')),10000);
   ws.once('open',()=>{clearTimeout(timer);resolve();});ws.once('error',e=>{clearTimeout(timer);reject(e);});});
 }
 async function exchange(from,to,bytes){
  const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Binary timeout')),10000);
   const listener=(data,binary)=>{if(binary){clearTimeout(timer);to.off('message',listener);resolve(Buffer.from(data));}};to.on('message',listener);});
  from.send(bytes);assert.deepEqual(await received,bytes);
 }
 await exchange(sockets[0],sockets[1],Buffer.from([0x54,0x45,0x54,0x33,0,255,1,2]));
 await exchange(sockets[1],sockets[0],Buffer.from([0,127,128,255,0x50,0x50]));
 const receipt={passed:true,relay:base,app,room_app_verified:true,binary_both_directions:true,
  scope:'Live relay room/transport check; not physical device gameplay',checked_at:new Date().toISOString()};
 await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{for(const ws of sockets)ws.close();}
