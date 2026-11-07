"""Build a Dolibarr module ZIP with portable, forward-slash entry names."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
module = root / 'dolibarr/qrrouter'
output = root / 'artifacts/module_qrrouter-3.1.0.zip'
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
