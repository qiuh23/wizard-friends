"""Validate both archive layers before extracting only unprivileged app files."""
import base64, hashlib, json, pathlib, re, sys, tarfile, zipfile

source, destination, encoded = sys.argv[1:]
request = json.loads(base64.b64decode(encoded))
destination = pathlib.Path(destination)
with zipfile.ZipFile(source) as archive:
    entries = archive.infolist()
    if len(entries) != 2 or {e.filename for e in entries} != {'wizard.tar.gz', 'wizard.tar.gz.sha256'}:
        raise ValueError('Unexpected artifact ZIP contents')
    if sum(e.file_size for e in entries) > 300 * 1024 * 1024 or archive.getinfo('wizard.tar.gz.sha256').file_size > 256:
        raise ValueError('Oversized artifact')
    for entry in entries:
        with archive.open(entry) as reader, (destination / entry.filename).open('wb') as writer:
            while chunk := reader.read(1024 * 1024): writer.write(chunk)
sidecar = (destination / 'wizard.tar.gz.sha256').read_text()
match = re.fullmatch(r'([a-f0-9]{64}) [ *]wizard\.tar\.gz\n?', sidecar)
with (destination / 'wizard.tar.gz').open('rb') as reader:
    if not match or hashlib.file_digest(reader, 'sha256').hexdigest() != match[1]: raise ValueError('Bundle digest mismatch')
target = destination / 'release'
target.mkdir()
with tarfile.open(destination / 'wizard.tar.gz') as archive:
    entries = archive.getmembers()
    if len(entries) > 50000 or sum(e.size for e in entries) > 700 * 1024 * 1024: raise ValueError('Oversized release')
    for entry in entries:
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in {'dist', 'src', 'worker', 'server', 'node_modules', 'package.json', 'package-lock.json', 'release.json'}:
            raise ValueError('Unsafe release path')
        if not (entry.isfile() or entry.isdir()): raise ValueError('Links and special files are not allowed')
    meta = json.load(archive.extractfile('release.json'))
    frontend = json.load(archive.extractfile('dist/build-info.json'))
    if any(meta.get(k) != request[k] for k in ('commit', 'runId')) or meta.get('repository') != 'qiuh23/wizard-friends' or meta.get('schema') != 1 or meta.get('stateSchema') != 1 or meta.get('nodeMajor') != 24 or meta.get('platform') != 'linux' or meta.get('arch') != 'x64' or frontend.get('revision') != request['commit']:
        raise ValueError('Release identity or compatibility mismatch')
    archive.extractall(target, filter='data')
