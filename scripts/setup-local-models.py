"""Download pinned upstream artifacts with checksums; extracts ONNX without paths."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'models/local'
DEST.mkdir(parents=True,exist_ok=True)
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

for item in json.loads((ROOT/'models/manifest.json').read_text())['models']:
    target=DEST/item['file']
    if not target.exists():
        part=target.with_suffix(target.suffix+'.part')
        subprocess.run(['curl','-fL','--retry','2','--connect-timeout','20','--max-time','300','-o',str(part),item['url']],check=True)
        if digest(part)!=item['sha256']:
            raise RuntimeError(f'Checksum mismatch: {part}')
        part.replace(target)
    if digest(target)!=item['sha256']:
        raise RuntimeError(f'Checksum mismatch: {target}')
    if item.get('extracted'):
        extracted=DEST/item['extracted']
        if not extracted.exists():
            with zipfile.ZipFile(target) as archive:
                names=[n for n in archive.namelist() if n.endswith('.onnx')]
                if len(names)!=1:raise RuntimeError('Expected one ONNX model')
                extracted.write_bytes(archive.read(names[0]))
        if digest(extracted)!=item['extracted_sha256']:raise RuntimeError(f'Checksum mismatch: {extracted}')
    print('Verified',item['file'])
