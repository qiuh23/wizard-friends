"""Exercise extraction guards without requiring a Linux host or root."""
import base64, hashlib, io, json, pathlib, subprocess, sys, tarfile, tempfile, unittest, zipfile

SCRIPT = pathlib.Path(__file__).with_name('unpack.py').resolve()
SHA = 'a' * 40
REQUEST = base64.b64encode(json.dumps({'commit': SHA, 'runId': 10}).encode()).decode()

class Extraction(unittest.TestCase):
    def unpack(self, name='server/index.js', kind=None, revision=SHA, extra_zip=None):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            payload = io.BytesIO()
            with tarfile.open(fileobj=payload, mode='w:gz') as archive:
                files = {
                    'release.json': json.dumps({'schema': 1, 'repository': 'qiuh23/wizard-friends', 'commit': SHA, 'runId': 10, 'platform': 'linux', 'arch': 'x64', 'nodeMajor': 24, 'stateSchema': 1}).encode(),
                    'dist/build-info.json': json.dumps({'revision': revision}).encode(),
                    name: b'// application code',
                }
                for path, body in files.items():
                    entry = tarfile.TarInfo(path)
                    if path == name and kind:
                        entry.type = kind
                        entry.linkname = '/etc/shadow'
                        archive.addfile(entry)
                    else:
                        entry.size = len(body)
                        archive.addfile(entry, io.BytesIO(body))
            data = payload.getvalue()
            archive_path = root / 'artifact.zip'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                archive.writestr('wizard.tar.gz', data)
                archive.writestr('wizard.tar.gz.sha256', hashlib.sha256(data).hexdigest() + '  wizard.tar.gz\n')
                if extra_zip: archive.writestr(extra_zip, b'bad')
            return subprocess.run([sys.executable, str(SCRIPT), str(archive_path), str(root), REQUEST], capture_output=True).returncode

    def test_checked_regular_release(self):
        self.assertEqual(self.unpack(), 0)

    def test_escaping_and_foreign_paths(self):
        for path in ('../escape', '/tmp/escape', 'src/../../escape', 'etc/shadow'):
            with self.subTest(path=path): self.assertNotEqual(self.unpack(name=path), 0)

    def test_links_and_special_files(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind): self.assertNotEqual(self.unpack(kind=kind), 0)

    def test_frontend_identity_and_zip_members(self):
        self.assertNotEqual(self.unpack(revision='b' * 40), 0)
        self.assertNotEqual(self.unpack(extra_zip='../escape'), 0)

if __name__ == '__main__': unittest.main()
