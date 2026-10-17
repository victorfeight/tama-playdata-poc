/* Ghidra pseudocode, NOT original source. */

void breeding_controller(void)

{
  int iVar1;
  undefined4 uVar2;
  
  iVar1 = *(int *)(iRam18014214 + 8);
  if (iVar1 == 0) {
    owner_stop_wrapper(*(undefined4 *)(iRam18014214 + 0x24));
    func_0x6001b084(*(undefined4 *)(iRam18014214 + 0x18));
    uVar2 = func_0x600401f8(*(undefined4 *)(iRam18014214 + 0x18),0,0,0x6f,1);
    *(undefined4 *)(iRam18014214 + 0x20) = uVar2;
    func_0x60040304(*(undefined4 *)(iRam18014214 + 0x20),1);
    func_0x60036c6c();
    func_0x60036cb4(1);
    func_0x6008c40c(0,0x20,0,4,0);
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 1) {
    iVar1 = func_0x60040270(*(undefined4 *)(iRam18014214 + 0x20),iRam18014214 + 0x2c);
    if ((iVar1 != 0) || (iVar1 = func_0x600137a0(0x3c,1), iVar1 != 0)) {
      func_0x6008c40c(0,0,1,4,0);
      if (*(short *)(iRam18014214 + 0x2c) == 0) {
        func_0x6007a56c(iRam18014214,1000);
      }
      else {
        if ((*(byte *)(iRam18014214 + 0x8e) & 1) == 0) {
          func_0x60071a28(&UNK_100a4bd5,0);
        }
        func_0x6007a56c(iRam18014214,2000);
      }
    }
  }
  else if (iVar1 == 1000) {
    func_0x6001b084(*(undefined4 *)(iRam18014214 + 0x18));
    uVar2 = func_0x600401f8(*(undefined4 *)(iRam18014214 + 0x18),0,0,0xea,1);
    *(undefined4 *)(iRam18014214 + 0x20) = uVar2;
    func_0x60040304(*(undefined4 *)(iRam18014214 + 0x20),1);
    func_0x60036c6c();
    func_0x60036cb4(1);
    func_0x6008c40c(0,0x20,0,4,0);
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 0x3e9) {
    iVar1 = func_0x60040270(*(undefined4 *)(iRam18014214 + 0x20),iRam18014214 + 0x2c);
    if ((iVar1 != 0) || (iVar1 = func_0x600137a0(0x3c,1), iVar1 != 0)) {
      func_0x6008c40c(0,0,1,4,0);
      if (*(short *)(iRam18014214 + 0x2c) == 0) {
        if ((*(byte *)(iRam18014214 + 0x8e) & 1) == 0) {
          func_0x60071a28(&UNK_100a4bd5,1);
        }
        func_0x6007a56c(iRam18014214,2000);
      }
      else {
        if ((*(byte *)(iRam18014214 + 0x8e) & 1) == 0) {
          func_0x60071a28(&UNK_100a4bd5,0);
        }
        func_0x6007a56c(iRam18014214,2000);
      }
    }
  }
  else if (iVar1 == 2000) {
    func_0x6001b084(*(undefined4 *)(iRam18014214 + 0x18));
    uVar2 = func_0x6001907c(*(undefined4 *)(iRam18014214 + 0x18),0,0x6d);
    *(undefined4 *)(iRam18014214 + 0x20) = uVar2;
    func_0x60036c6c();
    func_0x60036cb4();
    *(undefined1 *)(iRam18014214 + 0x40) = 4;
    func_0x6009f6c8(1);
    func_0x6008c40c(0,0x20,0,4,0);
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 0x7d1) {
    if (((*(byte *)(iRam18014214 + 0x8e) & 1) != 0) && ((*(byte *)(iRam18014214 + 0x5e) & 1) != 0))
    {
      if ((*(byte *)(iRam18014214 + 0x8e) >> 1 & 1) == 0) {
        return;
      }
      if ((*(short *)(iRam18014214 + 0x2c) == 0) && ((*(byte *)(iRam18014214 + 0x8e) >> 2 & 1) != 0)
         ) {
        *(undefined2 *)(iRam18014214 + 0x5c) = 4;
      }
    }
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 0x7d2) {
    func_0x60071a28(&UNK_100a4bcb,1);
    func_0x6009f6b4();
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 0x7d3) {
    iVar1 = func_0x600955f8(1);
    if (iVar1 == 0) {
      func_0x6009f6c8(0);
      func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
    }
  }
  else if (iVar1 == 0x7d4) {
    if ((*(byte *)(iRam18014214 + 0x8e) & 1) == 0) {
      iVar1 = func_0x600719c8();
      if (iVar1 == 0) {
        return;
      }
      func_0x600720bc();
    }
    else {
      iVar1 = func_0x60071c70(4);
      if (iVar1 == 0) {
        return;
      }
    }
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if (iVar1 == 0x7d5) {
    iVar1 = func_0x60071984(iRam18014214 + 0x42);
    if (iVar1 != 0) {
      func_0x6008c40c(0,0,1,4,0);
      *(undefined1 *)(iRam18014214 + 0x40) = 0;
      if (*(short *)(iRam18014214 + 0x42) == 0) {
        iVar1 = func_0x6008c058();
        if (iVar1 == 4) {
          func_0x6007a56c(iRam18014214,3000);
        }
        else {
          func_0x6007a53c(iRam18014214,5000);
        }
      }
      else {
        func_0x6007a53c(iRam18014214,9000);
      }
    }
  }
  else if (iVar1 == 3000) {
    func_0x6001b084(*(undefined4 *)(iRam18014214 + 0x18));
    if ((*(byte *)(iRam18014214 + 0x8e) & 1) == 0) {
      owner_slot_start(*(undefined4 *)(iRam18014214 + 0x24),0x8c8,0x40,0x40,0);
    }
    else {
      owner_slot_start(*(undefined4 *)(iRam18014214 + 0x24),0x8d1,0x40,0x40,0);
      owner_binding_set(*(undefined4 *)(iRam18014214 + 0x24),0,1,0xdb);
    }
    func_0x60036c6c();
    func_0x60036cb4(1);
    func_0x6008c40c(0,0x20,0,4,0);
    uVar2 = 0xbba;
    if ((*(byte *)(iRam18014214 + 0x8e) & 1) != 0) {
      uVar2 = 0xbb9;
    }
    func_0x6007a56c(iRam18014214,uVar2);
  }
  else if (iVar1 == 0xbb9) {
    iVar1 = func_0x60011584(*(undefined4 *)(iRam18014214 + 0x24));
    if (iVar1 != 0) {
      func_0x6009f6c8();
      func_0x6008c40c(0,0,1,4,0);
      func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
    }
  }
  else if (iVar1 == 0xbba) {
    func_0x60071a28(&UNK_100a4bcb,2);
    func_0x6007a56c(iRam18014214,(int)(short)((short)*(undefined4 *)(iRam18014214 + 8) + 1));
  }
  else if ((iVar1 == 0xbbb) && (iVar1 = func_0x600955f8(2), iVar1 == 0)) {
    func_0x6009f6c8(0);
    func_0x6007a53c(iRam18014214,5000);
  }
  return;
}

