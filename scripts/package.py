#!/usr/bin/env python3
"""Build reproducible, credential-free IINA plugin packages."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = ['Info.json', 'main.js', 'media.js', 'client.js', 'tracker.js', 'transport.js',
         'sidebar.html', 'preferences.html', 'README.md', 'LICENSE']

def build():
    info = json.loads((ROOT / 'Info.json').read_text())
    assert not info['preferenceDefaults']['api_token']
    assert not info['preferenceDefaults']['server_url']
    target = ROOT / 'dist'
    target.mkdir(exist_ok=True)
    for extension in ['iinaplgz', 'zip']:
        output = target / f'iina-crosswatch-{info["version"]}-macos-universal.{extension}'
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in FILES:
                entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, (ROOT / name).read_bytes())
        with zipfile.ZipFile(output) as archive:
            assert archive.testzip() is None
            assert archive.namelist() == FILES
        print(hashlib.sha256(output.read_bytes()).hexdigest(), output)

if __name__ == '__main__':
    build()
