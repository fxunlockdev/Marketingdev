"""Desvio's Agent Reach sandbox runner (agent-reach-runner-v1).

Reads one JSON task per line on stdin and prints one JSON line per result on stdout. Each task runs
the pinned `agent-reach <channel> <action>` CLI in its own process, at most four at a time. Only the
login-free actions below can run; anything else is refused without starting a process. The CLI's
home is an empty temporary directory: no cookies, browser profile, keys or saved settings exist.
"""

import json
import os
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

VERSION = "agent-reach-runner-v1"
ALLOWED = {("web", "search"), ("web", "read"), ("youtube", "search"), ("youtube", "read"), ("youtube", "subtitle")}
HOME = os.environ.get("HOME", "/tmp/home")
MAX_OUTPUT = 4 * 1024 * 1024
MAX_ITEMS = 10
MAX_TEXT = 20000
_lock = threading.Lock()
_URL = re.compile(r"^https?://[^\s\\]{1,2040}$")


def emit(payload):
    with _lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def refused(task_id, channel, action, code):
    emit({"type": "result", "id": task_id, "envelope": {"schema_version": 1, "ok": False, "channel": channel, "action": action,
          "backend": None, "items": [], "meta": {"attempts": []}, "error": {"code": code, "message": code}}})


def argv_for(channel, action, params, timeout):
    """The CLI arguments for one allowed task, or None when its parameters are not acceptable."""
    head = [sys.executable, "-m", "agent_reach.cli", channel, action, "--timeout", str(timeout)]
    if action == "search":
        query, limit = params.get("query"), params.get("limit", 3)
        if not isinstance(query, str) or not 0 < len(query.strip()) <= 200 or not isinstance(limit, int) or not 1 <= limit <= 5:
            return None
        return head + ["--limit", str(limit), "--", query.strip()]
    target = params.get("target")
    if not isinstance(target, str) or not _URL.match(target):
        return None
    return head + ["--", target]


def trim(envelope):
    """Keep the envelope small and plain: bounded items, no upstream raw data."""
    items = []
    for item in (envelope.get("items") or [])[:MAX_ITEMS]:
        if isinstance(item, dict):
            items.append({k: (item.get(k)[:MAX_TEXT] if isinstance(item.get(k), str) else None)
                          for k in ("title", "url", "author", "published_at", "text")})
    error = envelope.get("error") if isinstance(envelope.get("error"), dict) else None
    meta = envelope.get("meta") if isinstance(envelope.get("meta"), dict) else {}
    return {"schema_version": envelope.get("schema_version"), "ok": envelope.get("ok") is True, "channel": envelope.get("channel"),
            "action": envelope.get("action"), "backend": envelope.get("backend"), "items": items,
            "meta": {"attempts": [{"backend": str(a.get("backend"))[:60], "result": str(a.get("result"))[:60]}
                                  for a in (meta.get("attempts") or [])[:8] if isinstance(a, dict)]},
            "error": {"code": str(error.get("code"))[:40], "message": str(error.get("message") or "")[:300]} if error else None}


def run(task):
    task_id, channel, action = task["id"], task["channel"], task["action"]
    timeout = max(1, min(15, int(task.get("timeout") or 15)))
    argv = argv_for(channel, action, task.get("params") or {}, timeout)
    if argv is None:
        return refused(task_id, channel, action, "BAD_INPUT")
    env = {"HOME": HOME, "PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONPATH": "/opt/agent-reach", "PYTHONDONTWRITEBYTECODE": "1",
           "LANG": "C.UTF-8", "NO_COLOR": "1"}
    try:
        proc = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout + 5, env=env, cwd=HOME)
        lines = [ln for ln in proc.stdout[:MAX_OUTPUT].decode("utf-8", "replace").splitlines() if ln.strip()]
        envelope = json.loads(lines[-1]) if lines else None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        envelope = None
    if not isinstance(envelope, dict):
        return refused(task_id, channel, action, "UPSTREAM_BROKEN")
    emit({"type": "result", "id": task_id, "envelope": trim(envelope)})


def main():
    os.makedirs(HOME, mode=0o700, exist_ok=True)
    emit({"type": "ready", "version": VERSION})
    seen = set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for line in sys.stdin:
            try:
                task = json.loads(line)
            except ValueError:
                break
            if not isinstance(task, dict) or task.get("type") == "end":
                break
            task_id, channel, action = task.get("id"), task.get("channel"), task.get("action")
            if not isinstance(task_id, int) or not 1 <= task_id <= 64 or task_id in seen or len(seen) >= 64:
                break
            seen.add(task_id)
            if (channel, action) not in ALLOWED:
                refused(task_id, channel, action, "CHANNEL_NOT_ALLOWED")
                continue
            pool.submit(run, task)


if __name__ == "__main__":
    main()
