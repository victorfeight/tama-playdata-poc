"""Private capture analysis: ordinary boot/UART, then snapshot-based mode exploration."""
import ctypes as C,importlib.util,json,sys,hashlib,struct,zlib,subprocess,argparse
from pathlib import Path
parser=argparse.ArgumentParser(description="Run the pinned captured Tetris pair through a real room relay; private fixtures required.")
for name in ['sdk-root','driver','library','firmware','payload','output']:
 parser.add_argument('--'+name,type=Path,required=True)
parser.add_argument('--relay-url',required=True)
parser.add_argument('--node',default='node')
args=parser.parse_args()
ROOT=args.sdk_root.resolve();OUT=args.output.resolve();OUT.mkdir(parents=True,exist_ok=False)
if hashlib.sha256(args.payload.read_bytes()).hexdigest()!='657be002dab1a79bc5da688c36cf19f547f4c1b5984345425ba4b93cc289b37c':
 raise ValueError('State offsets apply only to the reviewed capture')
sys.path.insert(0,str(ROOT/'tools'))
from pdlo_capture import encode_type3_wire_for_test
spec=importlib.util.spec_from_file_location('driver',str(args.driver));driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
m=driver.Machine(args.library,args.firmware)
for n in ['machine_uart_receive','machine_uart_transmit']:m.bind(n,C.c_uint64,C.c_void_p,C.c_void_p,C.c_uint64)
def press(n,hold=80,release=150):
 m.machine_set_buttons(m.machine,{'a':1,'b':2,'c':4,'dial':8}[n]);m.advance(hold);m.machine_set_buttons(m.machine,0);m.advance(release)
def drain():
 data=C.create_string_buffer(65536);n=m.machine_uart_transmit(m.machine,data,len(data));return data.raw[:n]
def send(data):
 for i in range(0,len(data),64):
  part=data[i:i+64];assert m.machine_uart_receive(m.machine,C.create_string_buffer(part),len(part))==len(part);m.advance(2)
def ack():
 p=b''
 for _ in range(250):
  p+=drain()
  if b'\n' in p:assert p.strip()==b'ACK',p;return
  m.advance(10)
 raise TimeoutError('No ACK')
try:
 for line in (ROOT/'research/pearly-gates/evidence/glacier-download-navigation.jsonl').read_text().splitlines():
  cmd,*args=json.loads(line)['command']
  if cmd=='step':m.advance(float(args[0]))
  elif cmd=='press':press(args[0],float(args[1]) if len(args)>1 else 200,400)
  elif cmd=='rotate':m.rotate(int(args[0]))
 press('b',200,400);m.advance(300);drain()
 raw=args.payload.read_bytes()
 send(b'PKT '+str(len(raw)).encode()+b'\r\n');ack();wire=encode_type3_wire_for_test(raw);pos=0
 for offset in range(0,len(raw),4096):
  n=min(4096,len(raw)-offset)+16;send(wire[pos:pos+n]);pos+=n;ack()
 m.advance(2200);assert m.read(0x60e66000,len(raw))==raw
 snap=m.machine_snapshot_create(m.machine);m.snapshots['menu']=snap
 machines=[m]
 second=driver.Machine(args.library,args.firmware)
 for n in ['machine_uart_receive','machine_uart_transmit']:second.bind(n,C.c_uint64,C.c_void_p,C.c_void_p,C.c_uint64)
 assert second.machine_snapshot_restore(second.machine,snap)
 machines.append(second)
 def state(dev):
  raw=dev.read(0x1801f280,0x28c)
  values=struct.unpack('<'+str(len(raw)//4)+'I',raw)
  return {name:values[offset//4] for name,offset in [('state',0),('mode',4),('player',8),('count',12),('round',16),('seed',20),('wins',24),('alive',28),('pending_garbage',36),('start_deadline',44),('peer_nonce',48),('host',52),('session',0x1f4),('nonce',0x1f8),('last_received',0x21c)]}|{'ready':raw[0x279],'error':raw[0x27a],'pc':dev.status()['pc']}
 peer=subprocess.Popen([args.node,str(Path(__file__).with_name('game-relay-peer.mjs')),args.relay_url],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 assert json.loads(peer.stdout.readline())['ready']
 transcript=[];trace=[];streams=[bytearray(),bytearray()]
 for i,dev in enumerate(machines):
  m=dev;m.advance(37*i)
  for _ in range(3):press('a')
  press('b');dev.frame(OUT/f'{i}-lobby.png')
 for dev in machines:
  m=dev;drain()
 print('LOBBY',json.dumps([state(d) for d in machines]),flush=True)
 for tick in range(900):
  outgoing=[]
  for i,dev in enumerate(machines):
   m=dev;wire=drain();outgoing.append(wire.hex())
   if wire:transcript.append({'ms':tick*10,'from':i,'hex':wire.hex()});streams[i].extend(wire)
  peer.stdin.write(json.dumps({'out':outgoing})+'\n');peer.stdin.flush()
  incoming=json.loads(peer.stdout.readline())['in']
  for dev,wire_hex in zip(machines,incoming):
   wire=bytes.fromhex(wire_hex)
   if wire:assert dev.machine_uart_receive(dev.machine,C.create_string_buffer(wire),len(wire))==len(wire)
   dev.advance(10)
  if tick%100==0:
   row={'ms':tick*10,'states':[state(d) for d in machines]};trace.append(row);print(json.dumps(row),flush=True)
 for i,dev in enumerate(machines):
  dev.frame(OUT/f'{i}-playing.png');(OUT/f'{i}-tx.bin').write_bytes(streams[i])
 before=[state(d) for d in machines]
 # Deliberately stop forwarding packets to check bounded link failure.
 for dev in machines:dev.advance(6000)
 after=[state(d) for d in machines]
 for i,dev in enumerate(machines):dev.frame(OUT/f'{i}-link-lost.png')
 (OUT/'result.json').write_text(json.dumps({'firmware_sha256':m.digest.hex(),'library_sha256':hashlib.sha256(args.library.read_bytes()).hexdigest(),'payload_sha256':hashlib.sha256(raw).hexdigest(),'trace':trace,'playing':before,'disconnected':after,'transcript':transcript},indent=2)+'\n')
 assert all(d['state']==4 and d['error']==0 for d in before),before
 assert {d['player'] for d in before}=={0,1},before
 assert len({d['seed'] for d in before})==len({d['session'] for d in before})==1,before
 assert all(d['state']==8 for d in after),after
 print('DONE',json.dumps({'playing':before,'disconnected':after}),flush=True)
finally:
 if 'peer' in locals():
  peer.stdin.close();peer.wait(timeout=5)
 for dev in locals().get('machines',[m]):dev.close()
