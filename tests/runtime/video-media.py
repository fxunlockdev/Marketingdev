"""Actual FFmpeg fixtures and decoder tests, entirely inside the sandbox."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
sys.path.insert(0, '/runtime')
import runtime as media

class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.fixture('source.mp4', audio=True, tags=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def fixture(cls, name, audio=False, tags=False, size='320x180', fps='24', multiple=False):
        path = cls.root/name
        args = ['-v','error','-nostdin','-filter_threads','1','-f','lavfi','-i',f'testsrc2=size={size}:rate={fps}:duration=3']
        if audio:
            args += ['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3']
        args += ['-map','0:v:0']
        if multiple:
            args += ['-map','0:v:0']
        if audio:
            args += ['-map','1:a:0','-c:a','aac','-ac','2']
        if tags:
            args += ['-metadata','comment=PRIVATE_FIXTURE_METADATA','-metadata','title=PRIVATE_FIXTURE_TITLE']
        args += ['-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',str(path)]
        media.command('ffmpeg', args, timeout=30)
        return path.read_bytes()

    def request(self, data=None, duration=3):
        data = self.source if data is None else data
        return {'version':1,'input_base64':base64.b64encode(data).decode(),'input_sha256':hashlib.sha256(data).hexdigest(),'expected_duration_seconds':duration}

    def test_real_complete_decode_canonical_h264_aac_poster_and_metadata_removal(self):
        self.assertIn(b'PRIVATE_FIXTURE_METADATA', self.source)
        result = media.run(self.request())
        self.assertEqual(result['version'], media.VERSION)
        self.assertEqual(result['input_sha256'], hashlib.sha256(self.source).hexdigest())
        self.assertEqual(result['metadata'], {'width':320,'height':180,'duration_ms':3000,'audio':True,'codec':'h264'})
        for key in ['video','poster']:
            data = base64.b64decode(result[key]['base64'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), result[key]['sha256'])
            self.assertNotIn(b'PRIVATE_FIXTURE', data)
        self.assertTrue(base64.b64decode(result['poster']['base64']).startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertNotEqual(result['video']['sha256'], result['input_sha256'])

    def test_silent_video_remains_silent_and_preserves_portrait_dimensions(self):
        data = self.fixture('portrait.mp4', size='180x320')
        result = media.run(self.request(data))
        self.assertEqual(result['metadata']['audio'], False)
        self.assertEqual((result['metadata']['width'],result['metadata']['height']),(180,320))

    def test_malformed_truncated_and_corrupted_video_never_returns_an_asset(self):
        damaged = bytearray(self.source)
        mdat = damaged.find(b'mdat')
        self.assertGreater(mdat,0)
        damaged[mdat+4:mdat+1500] = b'\xff'*1496
        for data in [self.source[:100], self.source[:-5000], bytes(damaged), b'\0\0\0\x18ftyp'+b'\0'*100]:
            with self.subTest(size=len(data)), self.assertRaises(media.Invalid):
                media.run(self.request(data))

    def test_manifest_html_network_locations_and_hash_mismatch_are_rejected(self):
        for data in [b'#EXTM3U\nhttps://127.0.0.1/private.mp4\n', b'<html>not a provider video</html>', b'file:///etc/passwd' + b' '*30]:
            with self.subTest(data=data), self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_CONTAINER_INVALID'):
                media.run(self.request(data))
        value = self.request();value['input_sha256']='a'*64
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_INPUT_INVALID'):media.run(value)
        value = self.request();value['input_url']='https://example.invalid'
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_INPUT_INVALID'):media.run(value)

    def test_declared_duration_frame_rate_dimensions_and_extra_tracks_are_enforced(self):
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_DURATION_MISMATCH'):media.run(self.request(duration=4))
        for name,kwargs,code in [('fast.mp4',{'fps':'120'},'FRAME_RATE'),('wide.mp4',{'size':'5000x64'},'DIMENSIONS_OR_CODEC'),('multi.mp4',{'multiple':True},'STREAMS')]:
            with self.subTest(name=name), self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_'+code+'_INVALID'):
                media.run(self.request(self.fixture(name,**kwargs)))

    def test_rotated_video_is_rejected_until_orientation_is_explicitly_supported(self):
        path = self.root/'rotate.mp4'
        media.command('ffmpeg',['-v','error','-nostdin','-display_rotation','90','-i',str(self.root/'source.mp4'),'-c','copy',str(path)])
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_ORIENTATION_INVALID'):media.run(self.request(path.read_bytes()))

    def test_hdr_tagged_media_is_refused_without_an_unverified_tone_map(self):
        path = self.root/'hdr.mp4'
        media.command('ffmpeg',['-v','error','-nostdin','-i',str(self.root/'source.mp4'),'-c:v','libx264','-threads','2','-preset','ultrafast','-c:a','copy','-vf','setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc','-color_trc','smpte2084',str(path)])
        info=json.loads(media.command('ffprobe',['-v','error','-show_streams','-of','json',str(path)],capture=True))
        self.assertEqual(info['streams'][0].get('color_transfer'),'smpte2084',info)
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_COLOR_UNSUPPORTED'):media.run(self.request(path.read_bytes()))

    def test_exact_decoder_version_and_gpl_build_are_observed(self):
        version=media.command('ffmpeg',['-version'],capture=True).decode()
        self.assertTrue(version.startswith('ffmpeg version 7.1.5-0+deb13u1'))
        self.assertIn('--enable-gpl',version)
        self.assertIn('--enable-libx264',version)

    def test_decoder_timeout_fails_closed(self):
        with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_TIMEOUT'):
            media.command('ffmpeg',['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=100','-f','null','-'],timeout=0.001)

    def test_stdio_protocol_returns_hashed_bytes_and_sanitized_failure(self):
        process = subprocess.run([sys.executable,'/runtime/runtime.py'],input=json.dumps(self.request()).encode()+b'\n',capture_output=True,timeout=30)
        self.assertEqual(process.returncode,0)
        result = json.loads(process.stdout)
        self.assertEqual(result['type'],'result')
        self.assertEqual(result['metadata']['duration_ms'],3000)
        self.assertEqual(process.stderr,b'')
        bad = subprocess.run([sys.executable,'/runtime/runtime.py'],input=b'{"private":"secret"}\n',capture_output=True,timeout=10)
        self.assertEqual(bad.returncode,1)
        self.assertEqual(json.loads(bad.stdout),{'type':'error','code':'VIDEO_MEDIA_INPUT_INVALID'})
        self.assertNotIn(b'secret',bad.stdout+bad.stderr)

    def test_sandbox_has_no_network_secret_mounts_or_writable_application(self):
        import os,socket
        self.assertEqual(os.getuid(),65534)
        self.assertEqual([name for _,name in socket.if_nameindex()],['lo'])
        self.assertFalse(any(key in os.environ for key in ['OPENAI_API_KEY','HIGGSFIELD_API_KEY','DATABASE_URL','AWS_SECRET_ACCESS_KEY']))
        with self.assertRaises(OSError):Path('/runtime/unwanted').write_text('denied')
        with self.assertRaises(OSError):Path('/opt/video-deps/unwanted').write_text('denied')
        with self.assertRaises(OSError):Path('/unwanted').write_text('denied')
        status=Path('/proc/self/status').read_text();self.assertIn('NoNewPrivs:\t1',status);self.assertIn('CapEff:\t0000000000000000',status)

if __name__ == '__main__':
    unittest.main(verbosity=2)
