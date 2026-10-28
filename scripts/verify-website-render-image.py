#!/usr/bin/env python3
"""Offline native-host acceptance. Fixture HTTP replies only; never activates worker."""
import base64, json, os, re, select, struct, subprocess, sys, time, uuid, zlib
image = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
    raise SystemExit('Supply an immutable local image digest')
metadata = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image]))[0]
host = subprocess.check_output(['docker', 'info', '--format', '{{.Architecture}}'], text=True).strip()
expected = {'x86_64':'amd64', 'aarch64':'arm64', 'amd64':'amd64', 'arm64':'arm64'}.get(host)
assert metadata['Architecture'] == expected, 'Native architecture required'
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 300, 200, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\xaa\xbb\xcc' * 300) * 200)) + chunk(b'IEND', b'')
text = 'Native sandbox brand description created by JavaScript, absent from the initial HTML. ' * 5
fixtures = {
 'https://brand.example/': ('text/html', b'<html><body><main id="brand"></main><script src="/app.js"></script></body></html>'),
 'https://brand.example/app.js': ('text/javascript', ('document.querySelector("#brand").textContent=' + json.dumps(text) + ';const i=document.createElement("img");i.src="/photo.png";document.body.append(i);').encode()),
 'https://brand.example/photo.png': ('image/png', png),
}
name = 'desvio-website-acceptance-' + uuid.uuid4().hex
args = ['docker','run','--rm','-i','--name',name,'--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--memory-swap','1g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=128m',image]
p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
seen = set(); buffer = b''; total = 0; result = None; inspected = False
try:
    p.stdin.write(b'{"url":"https://brand.example/"}\n');p.stdin.flush()
    deadline = time.monotonic() + 50
    while time.monotonic() < deadline and result is None:
        if not select.select([p.stdout], [], [], 1)[0]:
            if p.poll() is not None: break
            continue
        block = os.read(p.stdout.fileno(), 65536)
        if not block: break
        total += len(block);assert total <= 12 * 1024 * 1024
        buffer += block
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1); message = json.loads(line)
            assert isinstance(message, dict)
            if message.get('type') == 'result': result = message;break
            assert message.get('type') == 'request', 'Browser launch or capture failed'
            assert message['method'] == 'GET' and message['url'] in fixtures
            assert message['id'] not in seen and len(seen) < 80;seen.add(message['id'])
            if not inspected:
                c = json.loads(subprocess.check_output(['docker','inspect',name]))[0]
                assert c['HostConfig']['NetworkMode'] == 'none' and c['HostConfig']['ReadonlyRootfs']
                assert c['Config']['User'] == '65534:65534' and 'ALL' in c['HostConfig']['CapDrop']
                assert c['HostConfig']['Memory'] == 1073741824 and not c['HostConfig'].get('Binds')
                inspected = True
            mime, data = fixtures[message['url']]
            p.stdin.write((json.dumps({'id':message['id'],'status':200,'headers':{'content-type':mime},'body':base64.b64encode(data).decode()}) + '\n').encode());p.stdin.flush()
    assert result and inspected, 'No result before deadline'
    assert result['version'] == 'website-renderer-v1' and len(result['pages']) == 1
    page = result['pages'][0]
    assert page['url'] == 'https://brand.example/' and 'created by JavaScript' in page['text']
    assert any(i['url'] == 'https://brand.example/photo.png' for i in page['images'])
    screenshot = base64.b64decode(page['screenshot'], validate=True)
    assert screenshot.startswith(b'\xff\xd8') and screenshot.endswith(b'\xff\xd9') and len(screenshot) > 1000
    assert p.wait(timeout=5) == 0
    print(json.dumps({'passed':True,'image':image,'architecture':expected,'requests':len(seen),'screenshot_bytes':len(screenshot),'external_calls':0,'activated':False}))
finally:
    if p.poll() is None: p.kill()
    subprocess.run(['docker','rm','-f',name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
