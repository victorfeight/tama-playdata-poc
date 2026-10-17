"""Execute stock CAN/NAK/ENQ dispatch and transport_finish across all six editions.
Synthetic transport RAM. Native string comparisons, request predicate and finish
execute. Only callback, clock and chunk retransmit I/O are intercepted.
Run using SDK toolchains/python/bin/python, --sdk /path/to/paradise-scene-sdk.
"""
import argparse, hashlib, json, sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--sdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
sys.path.insert(0,str(a.sdk/'src/AnimationLab'))
# Avoid this script shadowing SDK's native_contract module.
sys.path=[x for x in sys.path if x!=str(Path(__file__).parent)]
from native_contract import NativeContract
from ghost_research.playdate_native import PROFILES
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_LR,UC_ARM_REG_PC
from capstone import Cs,CS_ARCH_ARM,CS_MODE_THUMB
result={'scope':__doc__,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'families':{}}
for family,profile in PROFILES.items():
 n=NativeContract(family,a.sdk/'private/fixtures/firmware'/f'{family}_clean.bin',a.sdk/'toolchains/emulator-release/libparadise_native.so')
 finish,callback,clock,resend=(0x6008a2b8,0x60089be8,0x60029e2c,0x60094164) if family in ('Tropical','Glacier') else (0x6007d468,0x6007ce2c,0x6008e902,0x60084a1c) if family=='Jade' else (0x60079dd8,0x6007979c,0x6008a3ea,0x600809a8)
 calls=[]
 def hook(cpu,pc,size,_):
  if pc not in (callback,clock,resend):return
  r0=cpu.reg_read(UC_ARM_REG_R0);r1=cpu.reg_read(UC_ARM_REG_R1)
  calls.append({'pc':hex(pc),'event':r0,'status':n.get(r1,'H') if pc==callback and r0==0 else None})
  cpu.reg_write(UC_ARM_REG_R0,123 if pc==clock else 0);cpu.reg_write(UC_ARM_REG_PC,cpu.reg_read(UC_ARM_REG_LR))
 n.cpu.hook_add(UC_HOOK_CODE,hook)
 rows=[];obj=0x18004000;flags=obj+profile.flags_offset
 for cmd in ('CAN','NAK','ENQ 0'):
  for f in (0,0x20,0x40,0xa0):
   n.clear();calls.clear();n.put(profile.transport_global,obj);n.put(flags,f,'B');n.put(flags-2,1,'H');n.put(flags-4,0,'H')
   words=cmd.split();args=0x18002000
   for i,w in enumerate(words):n.write(args+0x100+i*16,w.encode()+b'\0');n.put(args+4*i,args+0x100+i*16)
   try: n.call(profile.command_dispatch,len(words),args,trace=True)
   except Exception:
    print(family,cmd,f,n.trace[-12:]);raise
   statuses=[c['status'] for c in calls if c['pc']==hex(callback) and c['event']==0]
   assert statuses==([2] if cmd=='CAN' and f else []),(family,cmd,f,calls)
   assert n.get(flags,'B')==(f&~0xe0 if cmd=='CAN' and f else f)
   rows.append(dict(command=cmd,flagsBefore=f,flagsAfter=n.get(flags,'B'),callbacks=list(calls),trace=n.trace))
 cs=Cs(CS_ARCH_ARM,CS_MODE_THUMB)
 result['families'][family]={'firmwareSha256':hashlib.sha256(n.raw).hexdigest(),'dispatch':hex(profile.command_dispatch),'finish':hex(finish),'cases':rows,'finishDisassembly':[f'{i.address:08x} {i.mnemonic} {i.op_str}' for i in cs.disasm(n.read(finish,0x160),finish)]}
a.output.write_text(json.dumps(result,indent=2)+'\n');print('72 native command cases passed; callbacks/clock/retransmit intercepted; no save proof.')
