"""Rendered Crawl4AI evidence. Browser has no network; broker fulfils bounded GETs.

JSON-lines protocol on stdio. Never pass database/provider credentials here.
"""
import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import os
import resource
import signal
import sys

OUTPUT = sys.stdout
pending = {}


def emit(value):
    OUTPUT.write(json.dumps(value, ensure_ascii=True) + "\n")
    OUTPUT.flush()


async def replies():
    reader = asyncio.StreamReader(limit=12 * 1024 * 1024)
    await asyncio.get_running_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer)
    while True:
        line = await reader.readline()
        if not line:
            return
        value = json.loads(line)
        future = pending.pop(value.get("id"), None)
        if future and not future.done():
            future.set_result(value)


OBSERVE = r"""() => {
 const elements=[document.body,...Array.from(document.querySelectorAll('body *'))].slice(0,6000);
 const visible=elements.filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'});
 const colors=new Map(),fonts=new Map();
 for(const el of visible){const s=getComputedStyle(el);for(const key of ['color','backgroundColor','borderColor']){const v=s[key];if(v&&v!=='rgba(0, 0, 0, 0)')colors.set(v,(colors.get(v)||0)+1)}
  if(el.textContent.trim()&&el.children.length<3){const key=JSON.stringify({family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight});fonts.set(key,(fonts.get(key)||0)+1)}}
 const box=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+scrollX),y:Math.round(r.y+scrollY),width:Math.round(r.width),height:Math.round(r.height)}};
 const images=Array.from(document.images).slice(0,100).map(el=>({url:el.currentSrc||el.src,alt:el.alt.slice(0,300),width:el.naturalWidth,height:el.naturalHeight,loaded:el.complete&&el.naturalWidth>0,box:box(el),role:(/logo/i.test(el.alt+' '+el.className)||!!el.closest('header,nav'))?'logo_candidate':'image_candidate'}));
 const backgrounds=visible.filter(el=>getComputedStyle(el).backgroundImage!=='none').slice(0,30).map(el=>({value:getComputedStyle(el).backgroundImage.slice(0,2048),box:box(el)}));
 const inlineMarks=Array.from(document.querySelectorAll('header svg,nav svg')).slice(0,20).map(el=>({label:(el.getAttribute('aria-label')||el.querySelector('title')?.textContent||'Unconfirmed inline mark').slice(0,300),box:box(el)}));
 const structuredData=[];for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,6)){try{if(script.textContent.length>200000)continue;const data=JSON.parse(script.textContent);const items=Array.isArray(data)?data:(Array.isArray(data['@graph'])?data['@graph']:[data]);for(const item of items.slice(0,20)){if(!item||typeof item!=='object')continue;const record={};for(const key of ['@type','name','description','image','logo','url']){if(typeof item[key]==='string')record[key]=item[key].slice(0,2000)}if(Object.keys(record).length)structuredData.push(record)}}catch{}}
 const sections=Array.from(document.querySelectorAll('header,main,section,footer,h1,h2,h3,button,a[role="button"]')).slice(0,80).map(el=>({tag:el.tagName,text:(el.innerText||'').slice(0,500),box:box(el)}));
 return {title:document.title.slice(0,500),description:document.querySelector('meta[name="description"]')?.content?.slice(0,2000)||'',text:document.body.innerText.slice(0,60000),colors:[...colors].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([value,count])=>({value,count})),typography:[...fonts].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([value,count])=>({...JSON.parse(value),count})),images,inlineMarks,structuredData:structuredData.slice(0,20),backgrounds,sections,links:Array.from(document.querySelectorAll('a[href]')).map(el=>el.href).slice(0,100),height:document.documentElement.scrollHeight,fontStatus:document.fonts.status};
}"""


async def render(initial):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    root = initial["url"]
    snapshots = []
    request_count = 0
    failures = []
    async def setup(page, context, **kwargs):
        async def route_request(route):
            nonlocal request_count
            request = route.request
            if request.method != "GET" or request.resource_type in ["media", "websocket", "eventsource", "manifest"]:
                failures.append({"url": request.url[:2048], "reason": "unsupported_request"})
                await route.abort()
                return
            if request.is_navigation_request():
                if request.url == root and request.frame == page.main_frame:
                    await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=initial["html"])
                else:
                    failures.append({"url": request.url[:2048], "reason": "navigation_blocked"})
                    await route.abort()
                return
            request_count += 1
            if request_count > 120:
                failures.append({"url": request.url[:2048], "reason": "request_limit"})
                await route.abort()
                return
            key = str(request_count)
            future = asyncio.get_running_loop().create_future()
            pending[key] = future
            emit({"type": "fetch", "id": key, "url": request.url, "resourceType": request.resource_type})
            try:
                reply = await asyncio.wait_for(future, 20)
                if reply.get("error"):
                    raise ValueError(reply["error"])
                await route.fulfill(status=reply["status"], headers=reply["headers"], body=base64.b64decode(reply["body"]))
            except Exception:
                failures.append({"url": request.url[:2048], "reason": "resource_unavailable"})
                await route.abort()
            finally:
                pending.pop(key, None)
        await context.route("**/*", route_request)
        # Service workers and unhandled transports have no kernel network access.
        await context.add_init_script("navigator.serviceWorker?.register && (navigator.serviceWorker.register=()=>Promise.reject(new Error('Unavailable during capture')))")
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))
        return page
    async def capture(page, **kwargs):
        for viewport in [{"width": 1440, "height": 1000}, {"width": 390, "height": 844}]:
            await page.set_viewport_size(viewport)
            for step in range(26):
                # Overlapping scrolls trigger lazy images through the full capture
                # height on mobile as well as desktop; stop at the bounded end.
                y = min(round(step * viewport["height"] * 0.8), 16000)
                await page.evaluate("y=>window.scrollTo(0,y)", y)
                await page.wait_for_timeout(120)
                end = await page.evaluate("Math.min(document.documentElement.scrollHeight,16000)")
                if y + viewport["height"] >= end:
                    break
            try:
                await page.wait_for_function("Array.from(document.images).every(i=>i.complete)", timeout=5000)
            except Exception:
                pass
            try:
                await page.wait_for_function("document.fonts.status==='loaded'", timeout=3000)
            except Exception:
                pass
            await page.evaluate("window.scrollTo(0,0)")
            await page.wait_for_timeout(500)
            evidence = await page.evaluate(OBSERVE)
            evidence["renderedFonts"] = []
            try:
                cdp = await page.context.new_cdp_session(page)
                await cdp.send("DOM.enable")
                await cdp.send("CSS.enable")
                root_node = (await cdp.send("DOM.getDocument"))["root"]["nodeId"]
                for selector in ["h1", "p", "button"]:
                    node = await cdp.send("DOM.querySelector", {"nodeId": root_node, "selector": selector})
                    if node.get("nodeId"):
                        fonts = await cdp.send("CSS.getPlatformFontsForNode", {"nodeId": node["nodeId"]})
                        evidence["renderedFonts"].append({"selector": selector, "fonts": fonts.get("fonts", [])[:10]})
                await cdp.detach()
            except Exception:
                pass
            height = min(max(evidence["height"], viewport["height"]), 16000)
            shot = await page.screenshot(type="jpeg", quality=80, animations="disabled", full_page=True, clip={"x": 0, "y": 0, "width": viewport["width"], "height": height}, timeout=15000)
            if len(shot) > 6*1024*1024:
                raise ValueError("screenshot size limit")
            snapshots.append({"viewport": viewport, "height": height, "truncated": evidence["height"]>height,
                "sha256": hashlib.sha256(shot).hexdigest(), "screenshot": base64.b64encode(shot).decode(), "observations": evidence})
        return page
    config = BrowserConfig(headless=True, browser_mode="dedicated", viewport_width=1440, viewport_height=1000, verbose=False,
        ignore_https_errors=False, accept_downloads=False, extra_args=["--disable-dev-shm-usage", "--disable-background-networking"])
    async with AsyncWebCrawler(config=config) as crawler:
        crawler.crawler_strategy.set_hook("on_page_context_created", setup)
        crawler.crawler_strategy.set_hook("before_return_html", capture)
        result = await crawler.arun(root, config=CrawlerRunConfig(cache_mode=CacheMode.DISABLED, wait_until="domcontentloaded", page_timeout=30000,
            delay_before_return_html=1.0, word_count_threshold=1, verbose=False))
        if not result.success or len(snapshots)!=2:
            raise ValueError("render failed")
    emit({"type": "result", "version": "crawl4ai-0.9.5/chromium-1248/desvio-visual-v2", "url": root,
        "snapshots": snapshots, "requests": request_count, "failures": failures[:120], "coverage": "rendered_desktop_mobile"})


async def main():
    initial = json.loads(sys.stdin.buffer.readline(3*1024*1024))
    reader = asyncio.create_task(replies())
    try:
        await render(initial)
    finally:
        reader.cancel()


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CPU, (100, 101))
    signal.alarm(115)
    logging.disable(logging.CRITICAL)
    try:
        with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            asyncio.run(main())
    except BaseException:
        emit({"type": "error", "code": "WEBSITE_VISUAL_CAPTURE_FAILED"})
        os._exit(2)
    # No waiting for a blocked stdin reader thread during executor shutdown.
    os._exit(0)
