"""Create a fresh, empty Premiere Pro project from the bundled empty-project
template.

The template (``premiere_cli/templates/empty-project/``) ships inside this
package, so ``premiere-cli init-project`` works from any checkout/install
without needing access to a shared drive.
"""

import json
import os
import shutil
from importlib import resources


def _template_dir() -> str:
    """Filesystem path of the empty-project template bundled inside this package."""
    template = resources.files("premiere_cli") / "templates" / "empty-project"
    path = str(template)
    if not os.path.isdir(path):
        raise RuntimeError(
            f"bundled empty-project template not found at {path} — broken installation?"
        )
    return path


def create_project(project_name: str, dest_dir: str) -> str:
    """Copy the bundled empty-project template into dest_dir and rename its
    .prproj file to '<project_name>.prproj'. Returns dest_dir.

    Raises RuntimeError if dest_dir already exists or the template doesn't
    contain exactly one .prproj file.
    """
    template_dir = _template_dir()

    if os.path.exists(dest_dir):
        raise RuntimeError(f"destination already exists, refusing to overwrite: {dest_dir}")

    shutil.copytree(template_dir, dest_dir)

    # Copying across some filesystems (e.g. exFAT external drives) emits
    # AppleDouble sidecar files (e.g. "._Untitled.prproj") for xattrs/resource
    # forks. Strip them from the copy so they don't get mistaken for real files.
    for root, _dirs, files in os.walk(dest_dir):
        for f in files:
            if f.startswith("._"):
                os.remove(os.path.join(root, f))

    prproj_files = [f for f in os.listdir(dest_dir) if f.endswith(".prproj")]
    if len(prproj_files) != 1:
        raise RuntimeError(
            f"expected exactly one .prproj file in the template, found {len(prproj_files)}: {prproj_files}"
        )

    old_path = os.path.join(dest_dir, prproj_files[0])
    new_path = os.path.join(dest_dir, f"{project_name}.prproj")
    os.rename(old_path, new_path)

    return dest_dir


def init_project(project_name: str, series_name: str | None, base_dir: str) -> int:
    """CLI entry point: build the destination path and create the project,
    printing a JSON result. Returns the process exit code."""
    dest_dir = os.path.join(base_dir, series_name, project_name) if series_name else os.path.join(base_dir, project_name)

    try:
        create_project(project_name, dest_dir)
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    print(json.dumps({"ok": True, "projectDir": dest_dir}))
    return 0
