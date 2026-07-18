"""Install the bundled Premiere Bridge CEP panel and diagnose the setup.

The CEP extension ships inside this package (``premiere_cli/panel/``).
``premiere-cli install-panel`` copies it into Adobe's user-level CEP
extensions directory and enables PlayerDebugMode (required for unsigned
extensions); ``premiere-cli doctor`` checks each link in the chain and
reports what, if anything, is broken.
"""

import json
import os
import platform
import shutil
import subprocess
import urllib.error
import urllib.request
from importlib import resources

EXTENSION_ID = "com.stefanwebb.premierecli"
DEFAULT_PORT = 47823

# CSXS major versions to enable PlayerDebugMode for. Premiere 2020-2022 use
# 9-11, 2023+ use 11-12; writing the flag for a version that isn't installed
# is harmless, so cover the plausible range rather than detecting.
CSXS_VERSIONS = ("10", "11", "12")


def _package_panel_dir() -> str:
    """Filesystem path of the panel directory bundled inside this package."""
    panel = resources.files("premiere_cli") / "panel"
    path = str(panel)
    if not os.path.isdir(path):
        raise RuntimeError(
            f"bundled panel directory not found at {path} — broken installation?"
        )
    return path


def _extensions_dir() -> str:
    system = platform.system()
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/Adobe/CEP/extensions")
    if system == "Windows":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise RuntimeError("APPDATA is not set — cannot locate the CEP extensions directory")
        return os.path.join(appdata, "Adobe", "CEP", "extensions")
    raise RuntimeError(f"unsupported platform for CEP extensions: {system} (CEP exists only on macOS and Windows)")


def _enable_player_debug_mode() -> list:
    """Enable PlayerDebugMode for each CSXS version. Returns notes."""
    notes = []
    system = platform.system()
    if system == "Darwin":
        for v in CSXS_VERSIONS:
            try:
                subprocess.run(
                    ["defaults", "write", f"com.adobe.CSXS.{v}", "PlayerDebugMode", "1"],
                    check=True,
                    capture_output=True,
                )
                notes.append(f"PlayerDebugMode enabled for CSXS.{v}")
            except subprocess.CalledProcessError as exc:
                notes.append(f"could not enable PlayerDebugMode for CSXS.{v}: {exc}")
    elif system == "Windows":
        try:
            import winreg  # noqa: PLC0415 — Windows-only stdlib module

            for v in CSXS_VERSIONS:
                key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Adobe\CSXS.{v}")
                winreg.SetValueEx(key, "PlayerDebugMode", 0, winreg.REG_SZ, "1")
                winreg.CloseKey(key)
                notes.append(f"PlayerDebugMode enabled for CSXS.{v}")
        except OSError as exc:
            notes.append(f"could not write PlayerDebugMode registry keys: {exc}")
    return notes


def install_panel(symlink: bool = False) -> int:
    """Copy (or symlink) the bundled CEP panel into Adobe's extensions dir.

    A copy is the default: it survives package upgrades/uninstalls until the
    next explicit ``install-panel``. ``--symlink`` links the installed
    package's own panel directory instead — useful for development, but the
    link breaks if the package is uninstalled or its version directory moves.
    """
    result: dict = {"ok": False}
    try:
        source = _package_panel_dir()
        ext_dir = _extensions_dir()
    except RuntimeError as exc:
        result["error"] = str(exc)
        print(json.dumps(result))
        return 1

    target = os.path.join(ext_dir, EXTENSION_ID)
    os.makedirs(ext_dir, exist_ok=True)

    if os.path.islink(target) or os.path.exists(target):
        try:
            if os.path.islink(target) or os.path.isfile(target):
                os.remove(target)
            else:
                shutil.rmtree(target)
        except OSError as exc:
            result["error"] = f"could not remove the existing extension at {target}: {exc}"
            print(json.dumps(result))
            return 1

    try:
        if symlink:
            os.symlink(source, target)
        else:
            shutil.copytree(source, target)
    except OSError as exc:
        result["error"] = f"could not install the panel to {target}: {exc}"
        print(json.dumps(result))
        return 1

    result.update(
        {
            "ok": True,
            "installedTo": target,
            "mode": "symlink" if symlink else "copy",
            "source": source,
            "playerDebugMode": _enable_player_debug_mode(),
            "nextSteps": (
                "Restart Premiere Pro, then open the panel via "
                "Window > Extensions > Premiere Bridge. Verify with: premiere-cli doctor"
            ),
        }
    )
    print(json.dumps(result))
    return 0


def _package_version() -> str:
    try:
        from premiere_cli import __version__

        return __version__
    except Exception:
        return "unknown"


def doctor(port: int = DEFAULT_PORT) -> int:
    """Diagnose the CLI → panel → Premiere chain and print a JSON report."""
    report: dict = {"ok": True, "packageVersion": _package_version(), "checks": []}

    def check(name, ok, detail):
        report["checks"].append({"check": name, "ok": ok, "detail": detail})
        if not ok:
            report["ok"] = False

    # 1. panel installed on disk?
    try:
        target = os.path.join(_extensions_dir(), EXTENSION_ID)
        installed = os.path.isdir(target) or os.path.islink(target)
        check(
            "panel-installed",
            installed,
            target if installed else f"nothing at {target} — run: premiere-cli install-panel",
        )
    except RuntimeError as exc:
        check("panel-installed", False, str(exc))

    # 2. panel reachable + version handshake? A 404 from /ping means a panel
    # IS listening but predates the /ping endpoint — reachable, version stale.
    panel_version = None
    panel_reachable = False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/ping", timeout=3) as resp:
            ping = json.loads(resp.read().decode("utf-8"))
        panel_version = ping.get("panelVersion")
        panel_reachable = True
        check("panel-reachable", True, f"port {port}, panelVersion {panel_version}")
    except urllib.error.HTTPError:
        panel_reachable = True
        panel_version = "pre-0.2.0 (no /ping endpoint)"
        check("panel-reachable", True, f"port {port} — an older panel without /ping is running")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        check(
            "panel-reachable",
            False,
            f"no panel answering on port {port} ({exc}) — is Premiere running with the "
            "Premiere Bridge panel open?",
        )

    if panel_version is not None:
        pkg = _package_version()
        check(
            "version-match",
            panel_version == pkg,
            f"panel {panel_version} vs package {pkg}"
            + ("" if panel_version == pkg else " — reinstall with: premiere-cli install-panel, then restart Premiere"),
        )

    # 3. Premiere answering commands?
    if panel_reachable:
        try:
            payload = json.dumps({"command": "get-version-info", "args": {}}).encode("utf-8")
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/command",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                info = json.loads(resp.read().decode("utf-8"))
            if info.get("ok"):
                v = info.get("result", {})
                check("premiere-responding", True, f"Premiere Pro {v.get('version')} (build {v.get('buildNumber')})")
            else:
                check("premiere-responding", False, info.get("error", "command failed"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            check("premiere-responding", False, str(exc))

    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1
