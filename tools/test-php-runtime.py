"""Fetch a checksum-verified, portable PHP 8.3 test runtime into ignored artifacts.

No installation or system configuration changes. Only used when PHP is unavailable.
"""
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
import zipfile

base = 'https://downloads.php.net/~windows/releases/'
with urlopen(base + 'releases.json', timeout=30) as response:
    release = json.load(response)['8.3']['nts-vs16-x64']['zip']
with urlopen(base + release['path'], timeout=60) as response:
    content = response.read()
if hashlib.sha256(content).hexdigest() != release['sha256']:
    raise SystemExit('PHP checksum verification failed')
target = Path(__file__).resolve().parents[1] / 'artifacts/php-runtime'
target.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(content)) as archive:
    archive.extractall(target)
print(f"Verified and extracted {release['path']} to {target}")
