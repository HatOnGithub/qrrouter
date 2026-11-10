"""Build a Dolibarr module ZIP with portable, forward-slash entry names."""
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
module = root / 'dolibarr/qrrouter'
version = json.loads((root / 'frontend/package.json').read_text(encoding='utf-8'))['version']
if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
    raise SystemExit('Project version must use major.minor.incremental.')
lock = json.loads((root / 'frontend/package-lock.json').read_text(encoding='utf-8'))
descriptor = (module / 'core/modules/modQrrouter.class.php').read_text(encoding='utf-8')
module_version = re.search(r"\$this->version\s*=\s*'([^']+)'", descriptor)
service = ET.parse(root / 'src/QrRouterApi/QrRouterApi.csproj')
if not module_version or any(value != version for value in [
    lock['version'],
    lock['packages']['']['version'],
    module_version.group(1),
    service.findtext('.//Version'),
]) or service.findtext('.//InformationalVersion') != 'v' + version:
    raise SystemExit('Frontend, lockfile, Dolibarr module and service versions must match.')
output = root / f'artifacts/module_qrrouter-v{version}.zip'
output.parent.mkdir(parents=True, exist_ok=True)
if not (module / 'spa/index.html').is_file():
    raise SystemExit('Build the Angular frontend first: python tools/build-frontend.py')
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for source in sorted(module.rglob('*')):
        if source.is_file():
            archive.write(source, (Path('qrrouter') / source.relative_to(module)).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'qrrouter/lib/qrrouter_service.lib.php' in archive.namelist()
    assert not any('\\' in name or name.endswith(('state.json', '.env')) for name in archive.namelist())
    print(f'Verified {output.name}: {len(archive.namelist())} entries, {output.stat().st_size} bytes')
