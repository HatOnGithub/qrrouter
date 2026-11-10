"""Build Angular and copy its production output into the deployable Dolibarr module."""
import os
import argparse
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
frontend = root / 'frontend'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--skip-build', action='store_true', help='Deploy bundles already built with npm run build')
args = parser.parse_args()
if not args.skip_build:
    subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'build'], cwd=frontend, check=True)
source = frontend / 'dist/qrrouter/browser'
if not (source / 'index.html').is_file():
    raise SystemExit('Angular output is missing. Run npm run build first.')
target = root / 'dolibarr/qrrouter/spa'
target.mkdir(parents=True, exist_ok=True)
for old in target.iterdir():
    if old.is_file() and old.suffix in {'.js', '.css', '.html', '.txt', '.json', '.map'}:
        old.unlink()
shutil.copytree(source, target, dirs_exist_ok=True)
licenses = frontend / 'dist/qrrouter/3rdpartylicenses.txt'
if licenses.is_file():
    shutil.copyfile(licenses, target / licenses.name)
print('Deployed Angular production bundles into dolibarr/qrrouter/spa')
