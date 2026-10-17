"""Verify a packaged full web release and publish entry points last.

Run on the deployment host after qualifying the matching backend commit.
Existing hashed assets are retained for browsers already using the old page.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile


def verify(source):
    manifest = json.loads((source / 'manifest.json').read_text())
    if not manifest.get('fullWeb') or manifest.get('dirty'):
        raise ValueError('Expected a clean, full web release')
    files = manifest['files']
    for required in ('index.html', 'games/index.html', 'games/payload.json', 'games/payload-pocket-puzzle.json'):
        if required not in files:
            raise ValueError(f'Missing release entry: {required}')
    for name, expected in files.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts:
            raise ValueError('Unsafe release path')
        path = source / relative
        if not path.resolve().is_relative_to(source.resolve()) or path.is_symlink():
            raise ValueError('Release file escapes package')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Release hash mismatch: {name}')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--live', type=Path)
    parser.add_argument('--backup', type=Path)
    args = parser.parse_args()
    manifest = verify(args.source)
    if args.live is None and args.backup is None:
        print('Verified', manifest['sourceCommit'], len(manifest['files']), 'files')
        return
    if args.live is None or args.backup is None:
        raise ValueError('Publishing requires both --live and --backup')
    # Exclusive backup; an existing release/rollback must never be overwritten.
    shutil.copytree(args.live, args.backup)
    entries = {'index.html', 'games/index.html'}
    names = sorted(manifest['files'], key=lambda name: (name in entries, name.endswith('.json'), name))
    for name in names:
        target = args.live / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.parent.resolve().is_relative_to(args.live.resolve()):
            raise ValueError('Live destination escapes web root')
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temp:
            temporary = Path(temp.name)
            temp.write((args.source / name).read_bytes())
        temporary.chmod(0o644)
        temporary.replace(target)
    shutil.copy2(args.source / 'manifest.json', args.live / 'release-manifest.json')
    print('Published', manifest['sourceCommit'], 'backup:', args.backup)


if __name__ == '__main__':
    main()
