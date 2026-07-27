"""Bring every media file under an ``assets/`` tree into the project's bins.

The bin structure mirrors the directory structure: ``assets/video/cam.mp4``
lands in the ``video`` bin as ``cam.mp4``, ``assets/video/b-roll/desk.mov`` in
``video/b-roll``.

An item already in the project under the same name is **relinked** to the file
on disk rather than imported again — Premiere is happy to hold two items with
the same name, and this build exposes no way to delete a project item, so
importing a duplicate would leave the operator to clean it up by hand. Relinking
achieves what "overwrite the existing one" means in practice: after a sync, that
name points at the file that is on disk now.

Composed from existing panel commands (``list-project-items``, ``create-bin``,
``import-media``, ``relink-media``), so it needs no panel reload.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

#: Extensions Premiere will import as media. Anything else under assets/ — a
#: README, a .json sidecar, a stray .DS_Store — is left alone.
IMPORTABLE_EXTENSIONS = frozenset({
    # video
    ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mxf", ".mts", ".m2ts", ".webm",
    ".mpg", ".mpeg", ".wmv", ".r3d", ".braw", ".dv", ".ts",
    # audio
    ".wav", ".aif", ".aiff", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".wma",
    # stills and layered art
    ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".psd", ".ai", ".eps", ".gif",
    ".bmp", ".dpx", ".exr", ".tga", ".webp", ".svg",
})


def _is_importable(path: Path) -> bool:
    name = path.name
    if name.startswith(".") or name.startswith("._"):
        return False  # hidden files, and the AppleDouble sidecars on exFAT
    return path.suffix.lower() in IMPORTABLE_EXTENSIONS


def plan_sync(assets_dir: Path, existing: dict) -> list[dict]:
    """Decide, per file, whether to import, relink, or leave alone.

    `existing` maps a project item's name to ``{"nodeId", "mediaPath"}``.

    A same-NAME item is relinked to the file on disk. Failing that, a file some
    item already references — under whatever name someone has since given it —
    counts as imported: matching on name alone would add a second item pointing
    at the same media, and there is no way to delete the duplicate.
    """
    assets_dir = Path(assets_dir)
    if not assets_dir.is_dir():
        return []

    by_path = {
        os.path.normpath(item.get("mediaPath") or ""): (name, item)
        for name, item in existing.items() if item.get("mediaPath")
    }

    plan = []
    for path in sorted(assets_dir.rglob("*")):
        if not path.is_file() or not _is_importable(path):
            continue
        relative = path.relative_to(assets_dir).parent
        bin_path = "" if str(relative) == "." else str(relative)
        item = existing.get(path.name)
        if item is not None:
            node_id = item.get("nodeId")
            on_disk = os.path.normpath(item.get("mediaPath") or "")
            action = "up-to-date" if on_disk == os.path.normpath(str(path)) else "relink"
            matched = "name"
        else:
            referenced = by_path.get(os.path.normpath(str(path)))
            if referenced is not None:
                action, node_id, matched = "up-to-date", referenced[1].get("nodeId"), "path"
            else:
                action, node_id, matched = "import", None, None
        plan.append({"name": path.name, "bin": bin_path, "path": str(path),
                     "action": action, "nodeId": node_id, "matchedBy": matched})
    plan.sort(key=lambda p: (p["bin"], p["name"]))
    return plan


def _existing_items(submit) -> tuple[dict, Optional[str]]:
    response = submit("list-project-items", {})
    if not response.get("ok"):
        return {}, str(response.get("error"))
    result = response.get("result")
    items = result if isinstance(result, list) else (result or {}).get("items") or []
    found = {}
    for item in items:
        if not isinstance(item, dict) or item.get("type") == "BIN":
            continue
        name = item.get("name")
        if name and name not in found:
            found[name] = {"nodeId": item.get("nodeId"), "mediaPath": item.get("mediaPath")}
    return found, None


def run(submit, assets_dir, dry_run: bool = False) -> dict:
    """Sync `assets_dir` into the project. `submit` is the panel client."""
    assets_dir = Path(assets_dir)
    if not assets_dir.is_dir():
        return {"ok": False, "error": f"no such directory: {assets_dir}"}

    existing, error = _existing_items(submit)
    if error is not None:
        return {"ok": False, "error": f"could not read the project's items: {error}"}

    plan = plan_sync(assets_dir, existing)
    counts = {"imported": 0, "relinked": 0, "upToDate": 0}
    summary = {
        "assetsDir": str(assets_dir),
        "files": len(plan),
        "toImport": sum(1 for p in plan if p["action"] == "import"),
        "toRelink": sum(1 for p in plan if p["action"] == "relink"),
        "alreadyCurrent": sum(1 for p in plan if p["action"] == "up-to-date"),
    }
    if dry_run:
        return {"ok": True, "result": {**summary, "dryRun": True, "plan": plan}}

    failures = []
    made_bins = set()
    for entry in plan:
        if entry["action"] == "up-to-date":
            counts["upToDate"] += 1
            continue
        if entry["action"] == "relink":
            response = submit("relink-media",
                              {"nodeId": entry["nodeId"], "newPath": entry["path"]})
            if response.get("ok"):
                counts["relinked"] += 1
            else:
                failures.append({**entry, "stage": "relink-media", "error": response.get("error")})
            continue
        if entry["bin"] and entry["bin"] not in made_bins:
            bin_response = submit("create-bin", {"binPath": entry["bin"]})
            if not bin_response.get("ok"):
                failures.append({**entry, "stage": "create-bin", "error": bin_response.get("error")})
                continue
            made_bins.add(entry["bin"])
        args = {"filePath": entry["path"]}
        if entry["bin"]:
            args["targetBinPath"] = entry["bin"]
        response = submit("import-media", args)
        if response.get("ok"):
            counts["imported"] += 1
        else:
            failures.append({**entry, "stage": "import-media", "error": response.get("error")})

    return {
        "ok": not failures,
        "result": {**summary, **counts, "failureCount": len(failures), "failures": failures[:10]},
    }
