"""Test-only JSON UART adapter to SDK native firmware, with real menu inputs.

No simulated protocol replies, flash injection, or app-state writes. The host
uses the production TypeScript installer. Private firmware never leaves disk.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

os.environ['PARADISE_NATIVE_ACCELERATORS'] = '0'
os.environ['PARADISE_NATIVE_IDMA_START_ACCELERATOR'] = '0'
p = argparse.ArgumentParser(description=__doc__)
for name in ('sdk', 'firmware', 'library', 'bundle', 'game', 'game-elf', 'nm', 'output'):
    p.add_argument('--' + name, type=Path, required=True)
a = p.parse_args()
sys.path[:0] = [str(a.sdk / 'sdk/paradise/tools')]
from native_uart_probe import Machine
from pack_profiled_pcmd import decrypt_pram
from send_stream_launch import records

sha = lambda b: hashlib.sha256(b).hexdigest()
a.output.mkdir(parents=True, exist_ok=True)
raw = a.firmware.read_bytes()
bundle = a.bundle.read_bytes()
game = a.game.read_bytes()
target = bytearray(b'\xff' * 0x100000)
for _, record in records(bundle):
    offset = struct.unpack_from('<I', record, 8)[0] - 0xf00000
    assert 0 <= offset <= 0xff000
    target[offset:offset + 4096] = record[36:]
symbols = {row.split()[-1]: int(row.split()[0], 16) for row in
           subprocess.check_output([str(a.nm), '--defined-only', str(a.game_elf)], text=True).splitlines()
           if len(row.split()) >= 3}
m = Machine(a.library, raw)
baseline = None
report = dict(passed=False, firmware_sha256=sha(raw), bundle_sha256=sha(bundle),
              game_sha256=sha(game), native_library_sha256=sha(a.library.read_bytes()),
              scope='Actual TypeScript sender and native retail Download/media/game; no physical adapter')


def press(mask, hold=200, release=400):
    m.set_buttons(mask); m.advance(hold); m.set_buttons(0); m.advance(release)


def download_menu():
    for line in (a.sdk / 'research/pearly-gates/evidence/glacier-download-navigation.jsonl').read_text().splitlines():
        command, *values = json.loads(line)['command']
        if command == 'step': m.advance(float(values[0]))
        elif command == 'press': press({'a': 1, 'b': 2, 'c': 4, 'dial': 8}[values[0]], float(values[1]) if len(values) > 1 else 200)
        elif command == 'rotate': m.rotate(int(values[0]))
    press(2); m.advance(300); m.uart_transmit()


def word(name):
    return int.from_bytes(m.read(symbols[name], 4), 'little')


try:
    for line in sys.stdin:
        request = json.loads(line)
        op = request['op']
        try:
            if op == 'open':
                download_menu(); m.frame(a.output / 'download.png'); result = dict(ready=True, status=m.status())
            elif op == 'read':
                m.advance(10)
                result = dict(data=base64.b64encode(m.uart_transmit()).decode())
            elif op == 'write':
                data = base64.b64decode(request['data'])
                if data.startswith(b'TPFWPK01'):
                    baseline = m.flash_snapshot()
                for offset in range(0, len(data), 64):
                    part = data[offset:offset + 64]
                    assert m.uart_receive(part) == len(part)
                    m.advance(2)
                result = dict(ok=True)
            elif op == 'music-complete':
                final = m.flash_snapshot()
                assert baseline is not None and final[:0xf00000] == baseline[:0xf00000]
                assert final[0xf00000:] == target
                report['music'] = dict(protected_sha256=sha(final[:0xf00000]), bank_sha256=sha(final[0xf00000:]))
                m.frame(a.output / 'music-ready.png')
                press(4, 150, 2000)
                stock = decrypt_pram(raw)
                assert m.read(0x9700, 0xf880 - 0x9700) == stock[0x9700:0xf880]
                control = Machine(a.library, final)
                try:
                    control.advance(2150)
                    assert m.flash_snapshot() == control.flash_snapshot(), 'C return differs from ordinary boot'
                finally: control.close()
                report['stock_return_matches_ordinary_boot'] = True
                m.frame(a.output / 'returned-home.png')
                download_menu(); m.frame(a.output / 'download-again.png')
                result = dict(ready=True)
            elif op == 'game-complete':
                m.advance(5000)
                assert m.read(0x60e66000, len(game)) == game
                assert word('clock_ok') == 1 and word('view') == 0
                audio = {key: word(key) for key in ('pocket_audio_ready', 'pocket_audio_failed',
                         'pocket_audio_samples', 'underruns', 'empty_ticks', 'active', 'current_track')}
                assert audio['pocket_audio_ready'] == audio['active'] == 1 and audio['pocket_audio_failed'] == 0, audio
                assert audio['pocket_audio_samples'] > 11025 and audio['underruns'] == audio['empty_ticks'] == 0, audio
                assert m.flash_snapshot()[0xf00000:] == target
                m.frame(a.output / 'game-with-music.png')
                report.update(passed=True, audio=audio)
                result = report
            elif op == 'exit': break
            else: raise ValueError('Unknown test operation: ' + op)
            print(json.dumps(dict(id=request['id'], **result)), flush=True)
        except Exception as error:
            m.frame(a.output / 'failure.png')
            print(json.dumps(dict(id=request['id'], error=str(error), status=m.status())), flush=True)
            raise
finally:
    (a.output / 'native.json').write_text(json.dumps(report, indent=2) + '\n')
    m.close()
