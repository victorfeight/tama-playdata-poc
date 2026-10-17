"""Bounded Gen2 breeding-controller branches, NOT a complete breeding replay.
Synthetic controller RAM. UI, transport-result getter, result-code getter, SYNC
poll and state transitions intercepted. Native branch instructions execute.
"""
import argparse,sys,json,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--sdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
sys.path.insert(0,str(a.sdk/'src/AnimationLab'))
from native_contract import NativeContract
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_LR,UC_ARM_REG_PC
report={'scope':__doc__,'families':{}}
for family in ('Tropical','Glacier'):
 n=NativeContract(family,a.sdk/'private/fixtures/firmware'/f'{family}_clean.bin')
 rows=[];events=[];ctrl=0x18004000
 def hook(cpu,pc,size,_):
  if pc not in (0x60071984,0x6008c058,0x6008c40c,0x6007a56c,0x6007a53c,0x60071a28,0x600955f8,0x6009f6c8):return
  r0=cpu.reg_read(UC_ARM_REG_R0);r1=cpu.reg_read(UC_ARM_REG_R1);answer=0
  events.append({'pc':hex(pc),'r0':hex(r0),'r1':hex(r1)})
  if pc==0x60071984:n.put(r0,status,'H');answer=1
  if pc==0x6008c058:answer=code
  if pc==0x600955f8:answer=waiting
  if pc==0x6007a56c:n.put(r0+8,r1)
  if pc==0x6007a53c:n.put(r0,r1)
  if pc==0x60071a28:events[-1]['format']=n.read(r0,16).split(b'\0')[0].decode()
  cpu.reg_write(UC_ARM_REG_R0,answer);cpu.reg_write(UC_ARM_REG_PC,cpu.reg_read(UC_ARM_REG_LR))
 n.cpu.hook_add(UC_HOOK_CODE,hook)
 for substate,status,code,waiting,expected_mode,expected_sub in [(2005,0,4,0,4000,3000),(2005,0,0,0,5000,2005),(2005,1,4,0,9000,2005),(3002,0,4,0,4000,3003),(3003,0,4,1,4000,3003),(3003,0,4,0,5000,3003)]:
  n.clear();events.clear();n.put(0x18014214,ctrl);n.put(ctrl,4000);n.put(ctrl+8,substate)
  n.call(0x6009beec,trace=True)
  assert n.get(ctrl)==expected_mode and n.get(ctrl+8)==expected_sub
  rows.append({'substateBefore':substate,'transportStatus':status,'result':code,'syncPending':waiting,'modeAfter':n.get(ctrl),'substateAfter':n.get(ctrl+8),'calls':list(events),'trace':n.trace})
 report['families'][family]={'firmwareSha256':hashlib.sha256(n.raw).hexdigest(),'cases':rows}
a.output.write_text(json.dumps(report,indent=2)+'\n');print('12 native Gen2 breeding branches passed; no end-to-end breeding/save claim.')
