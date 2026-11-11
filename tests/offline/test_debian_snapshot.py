import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from scripts.debian_snapshot import recover_archive

class SnapshotRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.payload = b'reviewed package archive'
        self.pin = dict(filename='example_1_all.deb', Package='example', Version='1:1+deb13u8', Architecture='all', sha256=hashlib.sha256(self.payload).hexdigest())

    def opener(self, payload):
        def open_response(url, timeout):
            self.assertGreater(timeout, 0)
            if '/mr/binary/' in url:
                self.assertIn('1%3A1%2Bdeb13u8', url)
                return io.BytesIO(json.dumps({'result': [{'architecture': 'arm64', 'hash': 'b'*40}, {'architecture':'all','hash':'a'*40}]}).encode())
            self.assertEqual(url, 'https://snapshot.debian.org/file/' + 'a'*40)
            return io.BytesIO(payload)
        return open_response

    def test_verified_archive_is_saved_and_cache_avoids_network(self):
        recover_archive(self.pin, self.directory, self.opener(self.payload))
        self.assertEqual((self.directory/self.pin['filename']).read_bytes(), self.payload)
        recover_archive(self.pin, self.directory, lambda *a, **kw: self.fail('cache must avoid network'))

    def test_wrong_bytes_never_promoted_or_left_behind(self):
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            recover_archive(self.pin, self.directory, self.opener(b'tampered'))
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_corrupt_existing_cache_fails_closed(self):
        (self.directory/self.pin['filename']).write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'Existing archive digest mismatch'):
            recover_archive(self.pin, self.directory)

    def test_path_traversal_rejected_before_network(self):
        self.pin['filename']='../escape.deb'
        with self.assertRaisesRegex(ValueError, 'filename'):
            recover_archive(self.pin, self.directory)

    def test_expired_deadline_stops_download(self):
        with self.assertRaises(TimeoutError):
            recover_archive(self.pin, self.directory, self.opener(self.payload), deadline=0)
        self.assertEqual(list(self.directory.iterdir()), [])
