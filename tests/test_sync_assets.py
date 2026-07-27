"""Tests for syncing assets/ on disk into the project's bin tree."""

import pytest

from premiere_cli.sync_assets import IMPORTABLE_EXTENSIONS, plan_sync, run


def make_tree(root, paths):
    for rel in paths:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\x00")
    return root


class TestPlanSync:
    def test_bin_path_mirrors_the_subdirectory(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4", "audio/main-mic.wav"])
        plan = plan_sync(tmp_path, existing={})
        by_name = {p["name"]: p for p in plan}
        assert by_name["main-camera.mp4"]["bin"] == "video"
        assert by_name["main-mic.wav"]["bin"] == "audio"

    def test_nested_subdirectories_become_nested_bins(self, tmp_path):
        make_tree(tmp_path, ["video/b-roll/desk.mov"])
        assert plan_sync(tmp_path, existing={})[0]["bin"] == "video/b-roll"

    def test_a_file_directly_under_assets_has_no_bin(self, tmp_path):
        make_tree(tmp_path, ["stray.mp4"])
        assert plan_sync(tmp_path, existing={})[0]["bin"] == ""

    def test_only_importable_extensions_are_included(self, tmp_path):
        make_tree(tmp_path, [
            "video/keep.mp4", "video/keep2.MOV", "audio/keep.wav", "images/keep.png",
            "video/skip.txt", "video/skip.json", "video/skip.md", "video/skip",
        ])
        names = sorted(p["name"] for p in plan_sync(tmp_path, existing={}))
        assert names == ["keep.mp4", "keep.png", "keep.wav", "keep2.MOV"]

    def test_appledouble_sidecars_are_skipped(self, tmp_path):
        # The exFAT external volume is littered with these and they sort first.
        make_tree(tmp_path, ["video/real.mov", "video/._real.mov"])
        assert [p["name"] for p in plan_sync(tmp_path, existing={})] == ["real.mov"]

    def test_hidden_files_are_skipped(self, tmp_path):
        make_tree(tmp_path, ["video/real.mov", "video/.DS_Store.mov"])
        assert [p["name"] for p in plan_sync(tmp_path, existing={})] == ["real.mov"]

    def test_an_item_already_pointing_at_the_file_is_up_to_date(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        existing = {"main-camera.mp4": {"nodeId": "n1",
                                       "mediaPath": str(tmp_path / "video/main-camera.mp4")}}
        [plan] = plan_sync(tmp_path, existing=existing)
        assert plan["action"] == "up-to-date"

    def test_an_item_pointing_elsewhere_is_relinked(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        existing = {"main-camera.mp4": {"nodeId": "n1", "mediaPath": "/old/somewhere.mp4"}}
        [plan] = plan_sync(tmp_path, existing=existing)
        assert plan["action"] == "relink"
        assert plan["nodeId"] == "n1"

    def test_a_missing_item_is_imported(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        [plan] = plan_sync(tmp_path, existing={})
        assert plan["action"] == "import"

    def test_plan_is_sorted_for_a_stable_report(self, tmp_path):
        make_tree(tmp_path, ["video/b.mp4", "audio/a.wav", "video/a.mp4"])
        plan = plan_sync(tmp_path, existing={})
        assert [(p["bin"], p["name"]) for p in plan] == [
            ("audio", "a.wav"), ("video", "a.mp4"), ("video", "b.mp4")]

    def test_no_assets_directory(self, tmp_path):
        assert plan_sync(tmp_path / "nope", existing={}) == []

    def test_the_extension_set_covers_the_obvious_media(self):
        for ext in (".mov", ".mp4", ".wav", ".png", ".jpg", ".mp3", ".aif", ".psd"):
            assert ext in IMPORTABLE_EXTENSIONS


class FakePanel:
    def __init__(self, items=None, fail=None):
        self.calls = []
        self.items = items or []
        self.fail = fail or set()

    def __call__(self, command, args):
        self.calls.append((command, args))
        if command in self.fail:
            return {"ok": False, "error": "boom"}
        if command == "list-project-items":
            return {"ok": True, "result": self.items}
        return {"ok": True, "result": {}}

    def of(self, command):
        return [a for c, a in self.calls if c == command]


class TestRun:
    def test_imports_a_new_file_into_its_bin(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        panel = FakePanel()
        res = run(panel, tmp_path, dry_run=False)
        assert res["ok"]
        assert panel.of("create-bin") == [{"binPath": "video"}]
        assert panel.of("import-media")[0]["targetBinPath"] == "video"
        assert res["result"]["imported"] == 1

    def test_relinks_rather_than_importing_a_duplicate_name(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        panel = FakePanel(items=[
            {"name": "main-camera.mp4", "nodeId": "n1", "type": "CLIP",
             "mediaPath": "/old/main-camera.mp4", "treePath": r"\proj\video\main-camera.mp4"}])
        res = run(panel, tmp_path, dry_run=False)
        assert panel.of("import-media") == []
        assert panel.of("relink-media") == [
            {"nodeId": "n1", "newPath": str(tmp_path / "video/main-camera.mp4")}]
        assert res["result"]["relinked"] == 1

    def test_leaves_an_up_to_date_item_alone(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        panel = FakePanel(items=[
            {"name": "main-camera.mp4", "nodeId": "n1", "type": "CLIP",
             "mediaPath": str(tmp_path / "video/main-camera.mp4"), "treePath": ""}])
        res = run(panel, tmp_path, dry_run=False)
        assert panel.of("import-media") == []
        assert panel.of("relink-media") == []
        assert res["result"]["upToDate"] == 1

    def test_dry_run_changes_nothing(self, tmp_path):
        make_tree(tmp_path, ["video/main-camera.mp4"])
        panel = FakePanel()
        res = run(panel, tmp_path, dry_run=True)
        assert panel.of("import-media") == []
        assert panel.of("create-bin") == []
        assert res["result"]["dryRun"] is True

    def test_a_bin_is_created_once_for_many_files(self, tmp_path):
        make_tree(tmp_path, ["video/a.mp4", "video/b.mp4", "video/c.mp4"])
        panel = FakePanel()
        run(panel, tmp_path, dry_run=False)
        assert panel.of("create-bin") == [{"binPath": "video"}]

    def test_a_failed_import_is_reported_without_stopping(self, tmp_path):
        make_tree(tmp_path, ["video/a.mp4", "video/b.mp4"])
        panel = FakePanel(fail={"import-media"})
        res = run(panel, tmp_path, dry_run=False)
        assert not res["ok"]
        assert res["result"]["failureCount"] == 2


class TestAlreadyReferencedUnderAnotherName:
    """A file already in the project counts as imported even if the item was
    renamed. Matching on name alone would add a second item pointing at the very
    same media — and this build cannot delete project items."""

    def test_a_renamed_item_pointing_at_the_file_is_up_to_date(self, tmp_path):
        make_tree(tmp_path, ["video/Elegant_White_Background.mp4"])
        existing = {"background.mp4": {"nodeId": "n1",
                                       "mediaPath": str(tmp_path / "video/Elegant_White_Background.mp4")}}
        [plan] = plan_sync(tmp_path, existing=existing)
        assert plan["action"] == "up-to-date"
        assert plan["matchedBy"] == "path"

    def test_a_name_match_still_wins_and_relinks(self, tmp_path):
        make_tree(tmp_path, ["video/cam.mp4"])
        existing = {"cam.mp4": {"nodeId": "n1", "mediaPath": "/elsewhere/cam.mp4"}}
        [plan] = plan_sync(tmp_path, existing=existing)
        assert plan["action"] == "relink"
        assert plan["matchedBy"] == "name"

    def test_run_does_not_import_a_file_already_referenced(self, tmp_path):
        make_tree(tmp_path, ["video/Elegant_White_Background.mp4"])
        panel = FakePanel(items=[
            {"name": "background.mp4", "nodeId": "n1", "type": "CLIP",
             "mediaPath": str(tmp_path / "video/Elegant_White_Background.mp4"), "treePath": ""}])
        res = run(panel, tmp_path, dry_run=False)
        assert panel.of("import-media") == []
        assert res["result"]["upToDate"] == 1
