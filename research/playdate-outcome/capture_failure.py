"""Full native Tropical: unanswered start and pre-transfer C. No host RAM writes.
SDK fixture's prepared adult provenance is retained in relay-readiness.
"""
import argparse,ctypes as C,hashlib,json,shlex,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--sdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--case',choices=['unanswered-request','pre-transfer-cancel','lost-chunk-ack']);a=p.parse_args()
sys.path.insert(0,str(a.sdk/'src/AnimationLab'))
from native_replay import load_driver
from ghost_research.playdate_native import transport_state
fw=a.sdk/'private/artifacts/playdate-families/tropical-gameplay.bin';lib=a.sdk/'toolchains/emulator-release/libparadise_native.so';driver=a.sdk/'vendor/tamasuite/fields_native_probe.py';startup=a.sdk/'src/AnimationLab/evidence/relay-readiness/tropical-ready-inputs.txt'
a.output.mkdir(parents=True,exist_ok=False)
m=load_driver(driver)(lib,fw.read_bytes());snap=None
report={'scope':__doc__,'faultInjection':'lost-chunk-ack sends one valid request ACK then stops; not a complete native peer','hashes':{str(x.relative_to(a.sdk)):hashlib.sha256(x.read_bytes()).hexdigest() for x in (fw,lib,driver,startup)},'cases':[]}
try:
 for name in ('machine_uart_transmit','machine_uart_receive'):m.bind(name,C.c_uint64,C.c_void_p,C.c_void_p,C.c_uint64)
 m.bind('machine_uart_clear_host_lines',None,C.c_void_p)
 for line in startup.read_text().splitlines():
  w=shlex.split(line,comments=True)
  if not w:continue
  if w[0]=='step':m.advance(float(w[1]))
  elif w[0]=='press':
   m.machine_set_buttons(m.machine,{'a':1,'b':2,'c':4}[w[1]]);m.advance(100);m.machine_set_buttons(m.machine,0);m.advance(400)
  else:raise ValueError(line)
 snap=m.machine_snapshot_create(m.machine);assert snap
 for label,button in [('unanswered-request',2),('pre-transfer-cancel',4),('lost-chunk-ack',2)]:
  if a.case and label!=a.case:continue
  assert m.machine_snapshot_restore(m.machine,snap);m.machine_uart_clear_host_lines(m.machine)
  events=[];wire=bytearray();states=[];last=None;ack_sent=False
  for t in range(0,16000,20):
   m.machine_set_buttons(m.machine,button if t<100 else 0);m.advance(20)
   buf=C.create_string_buffer(8192);n=m.machine_uart_transmit(m.machine,buf,len(buf))
   if n:events.append({'atMs':t+20,'sender':0,'offset':len(wire),'bytes':n});wire.extend(buf.raw[:n])
   if label=='lost-chunk-ack' and not ack_sent and wire.endswith(b'PKT 2\r\n'):
    data=b'ACK\r\n';assert m.machine_uart_receive(m.machine,C.create_string_buffer(data),len(data))==len(data);ack_sent=True
    events.append({'atMs':t+20,'sender':1,'hex':data.hex(),'bytes':len(data)})
   ram=m.read(0x18000000,0x20000)
   import struct
   ptr=struct.unpack_from('<I',ram,0x1407c)[0];ctrl=struct.unpack_from('<I',ram,0x14214)[0]
   state={'transport':transport_state(ram,'Tropical') if ptr else None,'controller':hex(ctrl)}
   if 0x18000000<=ctrl<0x1801ff00:state.update(mode=struct.unpack_from('<I',ram,ctrl-0x18000000)[0],substate=struct.unpack_from('<I',ram,ctrl-0x18000000+8)[0])
   if state!=last:states.append({'atMs':t+20,**state});last=state
   assert not m.status()['error'],m.status()
  (a.output/f'{label}.wire').write_bytes(wire);m.frame(a.output/f'{label}.png')
  report['cases'].append({'label':label,'wireHex':wire.hex(),'wireSha256':hashlib.sha256(wire).hexdigest(),'wireEvents':events,'states':states,'finalMachine':m.status()})
  print(label,repr(bytes(wire)),last,flush=True)
finally:
 if snap:m.machine_snapshot_destroy(snap)
 m.close();(a.output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
