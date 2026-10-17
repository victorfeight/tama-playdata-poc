/** Replay retained native UART through the same observer used by the room. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PlaydateOutcomeObserver } from '../../tama-protocol/src/playdate-outcome';
const [sdk, output] = process.argv.slice(2);
if (!sdk || !output) throw Error('SDK_ROOT OUTPUT_JSON required');
const hash = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const rows: object[] = [];
const folder = path.join(sdk, 'private/artifacts/relay-readiness/tropical-glacier-lifecycle/one-presses-direct');
const traceFile = path.join(folder, 'trace.json');
const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
const wires = [0,1].map(i => fs.readFileSync(path.join(folder, `endpoint-${i}.wire`)));
for (const fragment of [false,true]) {
 let atMs = 0; const changes: object[] = [];
 const observer = new PlaydateOutcomeObserver(state => changes.push({atMs,state}));
 for (const e of trace.wireEvents) {
  atMs=e.atMs;
  const b=wires[e.sender]!.subarray(e.offset,e.offset+e.bytes);
  if(fragment) for(let i=0;i<b.length;i+=7) observer.push(e.sender,b.subarray(i,i+7));
  else observer.push(e.sender,b);
  await observer.settled();
 }
 assert.equal(observer.state,'result-observed');
 rows.push({case:'Tropical–Glacier native success',fragmentBytes:fragment?7:'original',changes,
  finalState:observer.state,traceSha256:hash(traceFile),wireSha256:wires.map(w=>createHash('sha256').update(w).digest('hex')),
  limit:'Prior native history/save inspectors qualify persistence; observer does not.'});
}
const failureFile=path.join(sdk,'private/artifacts/playdate-outcome-20261017/receipt.json');
const failures=JSON.parse(fs.readFileSync(failureFile,'utf8'));
for(const c of failures.cases){
 let atMs=0;const changes:object[]=[];const observer=new PlaydateOutcomeObserver(state=>changes.push({atMs,state}));
 const bytes=Buffer.from(c.wireHex,'hex');
 for(const e of c.wireEvents){atMs=e.atMs;observer.push(0,bytes.subarray(e.offset,e.offset+e.bytes));await observer.settled();}
 assert.equal(observer.state,c.label==='unanswered-request'?'interrupted':'exchanging');
 rows.push({case:c.label,changes,finalState:observer.state,wireSha256:c.wireSha256,
  finalNativeState:c.states.at(-1),limit:c.label==='pre-transfer-cancel'?'Cancellation emits no wire signal; cannot auto-detect.':'Does not distinguish manual cancel from transport failure.'});
}
const silentFile=path.join(sdk,'private/artifacts/playdate-outcome-chunk-20261017/receipt.json');
const silent=JSON.parse(fs.readFileSync(silentFile,'utf8')).cases[0];
{
 const changes: string[]=[];const observer=new PlaydateOutcomeObserver(s=>changes.push(s));
 const bytes=Buffer.from(silent.wireHex,'hex');
 for(const e of silent.wireEvents){observer.push(e.sender,e.hex?Buffer.from(e.hex,'hex'):bytes.subarray(e.offset,e.offset+e.bytes));await observer.settled();}
 assert.equal(observer.state,'exchanging');
 rows.push({case:silent.label,changes,finalState:observer.state,wireSha256:silent.wireSha256,
  finalNativeState:silent.states.at(-1),limit:'Native timeout without CAN; UART-only observer correctly leaves outcome unknown.'});
}
fs.writeFileSync(output,JSON.stringify({rows},null,2)+'\n');console.log(JSON.stringify(rows));
