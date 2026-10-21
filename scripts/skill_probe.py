"""M0 experiment: actual Deep Agents middleware, read-only per-run memory mount.

This is not authenticated application tenancy or a marketing execution engine.
"""
from deepagents.backends.protocol import BackendProtocol, FileDownloadResponse, LsResult
from deepagents.middleware.skills import SkillsMiddleware

from scripts.skill_audit import ROOT, inspect_archive

SELECTED = ("social", "product-marketing", "ad-creative", "image", "video")


class ReadOnlySkillMount(BackendProtocol):
    def __init__(self, files):
        self._files = dict(files)

    def ls(self, path):
        prefix = path.rstrip("/") + "/"
        folders = sorted({prefix + p[len(prefix):].split("/")[0] for p in self._files if p.startswith(prefix) and "/" in p[len(prefix):]})
        return LsResult(entries=[{"path": p, "is_dir": True} for p in folders])

    def download_files(self, paths):
        return [FileDownloadResponse(path=p, content=self._files.get(p), error=None if p in self._files else "permission_denied") for p in paths]


def make_mount(brand_context, selected=SELECTED):
    _, files = inspect_archive(ROOT / "inputs/marketingskills-main.zip")
    prefix = "marketingskills-main/"
    mounted = {"/" + p.removeprefix(prefix): b for p, b in files.items() if any(p.startswith(prefix + "skills/" + s + "/") for s in selected)}
    mounted["/.agents/product-marketing.md"] = brand_context.encode()
    return ReadOnlySkillMount(mounted)


def discover(mount):
    # Explicit tools=[]; imported helpers never become tools automatically.
    middleware = SkillsMiddleware(backend=mount, sources=["/skills/"], tools=[])
    return middleware.before_agent({}, None, {})
