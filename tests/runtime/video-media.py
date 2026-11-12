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

    def test_runway_hevc_10bit_sdr_normalizes_to_browser_h264_8bit(self):
        for transfer in ['bt709', 'smpte2084', 'arib-std-b67', 'unknown']:
            path = self.root/f'hevc-{transfer}.mp4'
            args = ['-v','error','-nostdin','-filter_threads','1','-f','lavfi','-i',
                    'testsrc2=size=180x320:rate=24:duration=3','-c:v','libx265',
                    '-threads','1','-preset','ultrafast','-x265-params',f"pools=1:frame-threads=1:log-level=error:colorprim=1:colormatrix=1:transfer={ {'bt709':1,'smpte2084':16,'arib-std-b67':18,'unknown':2}[transfer]}",
                    '-pix_fmt','yuv420p10le','-color_primaries','bt709','-colorspace','bt709','-color_trc',transfer,str(path)]
            media.command('ffmpeg',args,timeout=30)
            if transfer != 'bt709':
                with self.assertRaisesRegex(media.Invalid,'VIDEO_MEDIA_COLOR_UNSUPPORTED'):
                    media.run(self.request(path.read_bytes()))
                continue
            info = json.loads(media.command('ffprobe',['-v','error','-show_streams','-of','json',str(path)],capture=True))
            self.assertEqual(info['streams'][0].get('color_transfer'),transfer,info)
            self.assertEqual(info['streams'][0].get('pix_fmt'),'yuv420p10le',info)
            result = media.run(self.request(path.read_bytes()))
            self.assertEqual(result['metadata'], {'width':180,'height':320,'duration_ms':3000,'audio':False,'codec':'h264'})
            output = self.root/'converted-sdr.mp4'
            output.write_bytes(base64.b64decode(result['video']['base64']))
            info = json.loads(media.command('ffprobe',['-v','error','-show_streams','-of','json',str(output)],capture=True))
            self.assertEqual(info['streams'][0]['pix_fmt'],'yuv420p')
            self.assertEqual(info['streams'][0]['color_transfer'],'bt709')

    def test_exact_decoder_version_and_gpl_build_are_observed(self):
        version=media.command('ffmpeg',['-version'],capture=True).decode()
        self.assertTrue(version.startswith('ffmpeg version 7.1.5-0+deb13u1'))
        self.assertIn('--enable-gpl',version)
        self.assertIn('--enable-libx264',version)

    def test_timed_overlay_changes_real_pixels_only_within_its_time_window(self):
        source = self.root/'black.mp4'
        media.command('ffmpeg',['-v','error','-f','lavfi','-i','color=black:size=320x180:duration=3:rate=30','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',str(source)])
        value=self.request(source.read_bytes())
        value['overlays']=[{'text':"Book now: 50% off",'start_ms':1000,'end_ms':2000,'position':'bottom','foreground':'#ffffff','background':'#ff0000'}]
        result=media.run(value)
        self.assertEqual(result['overlays'],value['overlays'])
        clip=self.root/'overlay.mp4';clip.write_bytes(base64.b64decode(result['video']['base64']))
        for index,time in enumerate([0.5,1.5,2.5]):
            raw=self.root/f'pixels-{index}.rgb'
            media.command('ffmpeg',['-v','error','-ss',str(time),'-i',str(clip),'-frames:v','1','-vf','crop=320:60:0:120','-pix_fmt','rgb24','-f','rawvideo',str(raw)])
            pixels=raw.read_bytes();red=sum(pixels[i]>120 and pixels[i]>pixels[i+1]*2 and pixels[i]>pixels[i+2]*2 for i in range(0,len(pixels),3))
            if index==1:self.assertGreater(red,200)
            else:self.assertEqual(red,0)

    def test_overlay_text_is_literal_and_does_not_enter_filter_expressions(self):
        value=self.request()
        value['overlays']=[{'text':"%{metadata:secret}; ' [x] \\ test",'start_ms':0,'end_ms':3000,'position':'top','foreground':'#ffffff','background':'#000000'}]
        result=media.run(value)
        self.assertEqual(result['overlays'],value['overlays'])
        self.assertNotEqual(result['video']['sha256'],media.run(self.request())['video']['sha256'])

    def test_overlay_fields_colors_times_and_collisions_are_bounded(self):
        good={'text':'Buy now','start_ms':0,'end_ms':2000,'position':'bottom','foreground':'#ffffff','background':'#000000'}
        for change in [{'text':'x'*91},{'text':'bad\x00text'},{'start_ms':True},{'end_ms':4000},{'start_ms':1500},{'position':'file:///etc/passwd'},{'foreground':'red;movie=/etc/passwd'},{'textfile':'/etc/passwd'}]:
            with self.subTest(change=change),self.assertRaisesRegex(media.Invalid,'VIDEO_OVERLAY_INVALID'):
                media.validate_overlays([{**good,**change}],3)
        with self.assertRaisesRegex(media.Invalid,'VIDEO_OVERLAY_INVALID'):media.validate_overlays([good,good],3)
        with self.assertRaisesRegex(media.Invalid,'VIDEO_OVERLAY_INVALID'):media.validate_overlays([good]*4,3)

    def ssim(self, output, source):
        stats = self.root/f'ssim-{output.name}.log'
        media.command('ffmpeg',['-v','error','-nostdin','-i',str(output),'-i',str(source),'-lavfi',f'[0:v][1:v]ssim=stats_file={stats}','-f','null','-'],timeout=60)
        values=[float(line.split('All:')[1].split()[0]) for line in stats.read_text().splitlines() if 'All:' in line]
        return sum(values)/len(values), min(values)

    def stream(self, path):
        info=json.loads(media.command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',str(path)],capture=True))
        video=[s for s in info['streams'] if s['codec_type']=='video'][0]
        n,d=video['r_frame_rate'].split('/')
        return video, float(n)/float(d), int(info['format']['bit_rate'])

    def test_render_keeps_source_resolution_frame_rate_and_visual_quality(self):
        source = self.root/'detail.mp4'
        media.command('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=640x360:rate=25:duration=3','-c:v','libx264','-threads','2','-preset','veryfast','-crf','12','-pix_fmt','yuv420p',str(source)],timeout=60)
        result = media.run(self.request(source.read_bytes()))
        output = self.root/'detail-out.mp4';output.write_bytes(base64.b64decode(result['video']['base64']))
        video, fps, bitrate = self.stream(output)
        self.assertEqual((video['width'],video['height']),(640,360))
        self.assertAlmostEqual(fps,25,places=2)
        self.assertGreater(bitrate,1_000_000)
        average, worst = self.ssim(output, source)
        self.assertGreater(average,0.98)
        self.assertGreater(worst,0.96)

    def test_portrait_4_5_targets_render_at_exact_size(self):
        for width,height in [(1024,1280),(1080,1350)]:
            value=self.request();value['overlays']=[];value['target']={'width':width,'height':height}
            result=media.run(value)
            self.assertEqual((result['metadata']['width'],result['metadata']['height']),(width,height))
        value=self.request();value['overlays']=[];value['target']={'width':1000,'height':1250}
        with self.assertRaisesRegex(media.Invalid,'VIDEO_TARGET_INVALID'):media.run(value)

    def shot(self, name, color, seconds=3, size='720x1280', fps='24'):
        path=self.root/name
        media.command('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i',f'color={color}:size={size}:rate={fps}:duration={seconds}','-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p',str(path)],timeout=30)
        data=path.read_bytes()
        return {'input_base64':base64.b64encode(data).decode(),'input_sha256':hashlib.sha256(data).hexdigest(),'duration_seconds':seconds}

    def reel(self, **change):
        value={'version':2,'mode':'reel','clips':[self.shot('r.mp4','red'),self.shot('g.mp4','green'),self.shot('b.mp4','blue')],
               'target':{'width':1080,'height':1920},
               'captions':[{'text':'Fresh bread every morning','start_ms':0,'end_ms':3000},{'text':'Baked in small batches','start_ms':3000,'end_ms':6000}],
               'overlays':[{'text':'Groomday','start_ms':0,'end_ms':2000,'position':'top','foreground':'#ffffff','background':'#000000'}],
               'end_card':{'headline':'Groomday Bakery','cta':'Order today','foreground':'#ffffff','background':'#203040','duration_ms':2000},
               'style':{'font':'sans','caption_scale':100,'caption_foreground':'#ffffff','caption_background':'#000000','caption_opacity':70},
               'audio':{'bed':'silence'},'samples':[1500,4500,10000]}
        value.update(change)
        return value

    def pixel(self, clip, at, x, y):
        raw=self.root/'pixel.rgb'
        media.command('ffmpeg',['-y','-v','error','-ss',str(at),'-i',str(clip),'-frames:v','1','-vf',f'crop=8:8:{x}:{y}','-pix_fmt','rgb24','-f','rawvideo',str(raw)])
        data=raw.read_bytes();return tuple(data[i] for i in range(3))

    def test_reel_joins_shots_with_cuts_captions_end_card_and_silent_bed(self):
        result=media.run_reel(self.reel())
        self.assertEqual(result['metadata'],{'width':1080,'height':1920,'duration_ms':11000,'audio':True,'codec':'h264'})
        self.assertAlmostEqual(result['fps'],24,places=2)
        clip=self.root/'reel.mp4';clip.write_bytes(base64.b64decode(result['video']['base64']))
        video,fps,_=self.stream(clip)
        self.assertAlmostEqual(fps,24,places=2)
        for at,channel in [(1.5,0),(4.5,1),(7.5,2)]:
            rgb=self.pixel(clip,at,536,600)
            self.assertGreater(rgb[channel],100,(at,rgb));self.assertTrue(all(rgb[c]<90 for c in range(3) if c!=channel),(at,rgb))
        card=self.pixel(clip,10,40,600)
        self.assertTrue(all(abs(a-b)<24 for a,b in zip(card,(0x20,0x30,0x40))),card)
        # Captions are drawn in the lower third only while their beat is on screen.
        def bright(at):
            raw=self.root/'band.rgb'
            media.command('ffmpeg',['-y','-v','error','-ss',str(at),'-i',str(clip),'-frames:v','1','-vf','crop=1080:200:0:1282','-pix_fmt','rgb24','-f','rawvideo',str(raw)])
            data=raw.read_bytes();return sum(1 for i in range(0,len(data),3) if data[i]>200 and data[i+1]>200 and data[i+2]>200)
        self.assertGreater(bright(1.0),500);self.assertGreater(bright(4.0),500);self.assertEqual(bright(7.5),0)
        self.assertEqual([s['at_ms'] for s in result['samples']],[1500,4500,10000])
        for sample in result['samples']:
            data=base64.b64decode(sample['base64']);self.assertTrue(data.startswith(b'\x89PNG'));self.assertEqual(hashlib.sha256(data).hexdigest(),sample['sha256'])
        larger=media.run_reel(self.reel(style={'font':'serif','caption_scale':130,'caption_foreground':'#ffffff','caption_background':'#000000','caption_opacity':100}))
        self.assertNotEqual(larger['video']['sha256'],result['video']['sha256'])

    def test_reel_keeps_quality_of_each_shot(self):
        path=self.root/'detail-shot.mp4'
        media.command('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=1080x1920:rate=30:duration=3','-c:v','libx264','-threads','2','-preset','veryfast','-crf','12','-pix_fmt','yuv420p',str(path)],timeout=90)
        data=path.read_bytes();clip={'input_base64':base64.b64encode(data).decode(),'input_sha256':hashlib.sha256(data).hexdigest(),'duration_seconds':3}
        result=media.run_reel(self.reel(clips=[clip],captions=[],overlays=[],end_card=None,samples=[]))
        out=self.root/'detail-reel.mp4';out.write_bytes(base64.b64decode(result['video']['base64']))
        video,fps,bitrate=self.stream(out)
        self.assertEqual((video['width'],video['height']),(1080,1920));self.assertAlmostEqual(fps,30,places=2)
        average,worst=self.ssim(out,path)
        self.assertGreater(average,0.97);self.assertGreater(worst,0.95)

    def test_reel_fields_are_bounded(self):
        for change,code in [({'audio':{'bed':'https://music.invalid/a.mp3'}},'AUDIO'),({'captions':[{'text':'a','start_ms':0,'end_ms':500}]},'CAPTION'),
                            ({'captions':[{'text':'x','start_ms':0,'end_ms':2000},{'text':'y','start_ms':1000,'end_ms':3000}]},'CAPTION'),
                            ({'style':{'font':'/etc/passwd','caption_scale':100,'caption_foreground':'#ffffff','caption_background':'#000000','caption_opacity':70}},'STYLE'),
                            ({'end_card':{'headline':'x','cta':'','foreground':'#fff','background':'#000000','duration_ms':2000}},'END_CARD'),
                            ({'target':{'width':720,'height':1280}},'TARGET'),({'clips':[]},'REEL'),({'samples':[99999]},'REEL')]:
            with self.subTest(change=change),self.assertRaisesRegex(media.Invalid,'VIDEO_'+code):
                media.run_reel(self.reel(**change))

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
        self.assertEqual([name for _,name in socket.if_nameindex() if int(Path('/sys/class/net',name,'flags').read_text(),16) & 1],['lo'])
        self.assertFalse(any(key in os.environ for key in ['OPENAI_API_KEY','HIGGSFIELD_API_KEY','DATABASE_URL','AWS_SECRET_ACCESS_KEY']))
        with self.assertRaises(OSError):Path('/runtime/unwanted').write_text('denied')
        with self.assertRaises(OSError):Path('/opt/video-deps/unwanted').write_text('denied')
        with self.assertRaises(OSError):Path('/unwanted').write_text('denied')
        status=Path('/proc/self/status').read_text();self.assertIn('NoNewPrivs:\t1',status);self.assertIn('CapEff:\t0000000000000000',status)

if __name__ == '__main__':
    unittest.main(verbosity=2)
