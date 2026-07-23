"""Send a command to the Premiere Bridge CEP panel and print its JSON response."""

import argparse
import json
import platform
import re
import sys
import urllib.error
import urllib.request

DEFAULT_PORT = 47823


def _validate_response(parsed_json) -> dict:
    """Ensure parsed JSON is a dict with an 'ok' key, or return an error dict.

    This guards against panels returning valid JSON that isn't a properly-
    structured response (e.g. the literal 42, a string, an array, or a dict
    missing the required 'ok' key).
    """
    if not isinstance(parsed_json, dict):
        return {"ok": False, "error": f"panel returned an unexpected response: {repr(parsed_json)}"}
    if "ok" not in parsed_json:
        return {"ok": False, "error": f"panel returned an unexpected response: {repr(parsed_json)}"}
    return parsed_json


_INTERVAL_LINE_RE = re.compile(r"^(\d{2,3}:\d{2}:\d{2})\s*-\s*(\d{2,3}:\d{2}:\d{2})$")


def _parse_intervals_file(path: str) -> list:
    """Parse a remove_pauses.py-style cuts file ("MM:SS:FF - MM:SS:FF" per
    line, blank lines ignored) into [{"start": ..., "end": ...}, ...].

    Raises ValueError on a line that doesn't match that format.
    """
    intervals = []
    with open(path, "r", encoding="utf-8") as fh:
        for line_num, raw_line in enumerate(fh, start=1):
            line = raw_line.strip()
            if not line:
                continue
            match = _INTERVAL_LINE_RE.match(line)
            if not match:
                raise ValueError(f"{path}:{line_num}: not a valid line ({raw_line!r})")
            intervals.append({"start": match.group(1), "end": match.group(2)})
    return intervals


def submit_command(command: str, args: dict | None = None, port: int = DEFAULT_PORT) -> dict:
    """POST a command to the Premiere Bridge panel's /command endpoint.

    Always returns a dict with an "ok" key. Never raises — connection
    failures, timeouts, and malformed responses are folded into
    {"ok": False, "error": "..."} so the caller always gets well-formed JSON.
    """
    payload = {"command": command, "args": args or {}}
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            parsed = json.loads(response.read().decode("utf-8"))
            return _validate_response(parsed)
    except urllib.error.HTTPError as exc:
        try:
            parsed = json.loads(exc.read().decode("utf-8"))
            return _validate_response(parsed)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {"ok": False, "error": f"panel returned HTTP {exc.code} with an unreadable body"}
    except OSError as exc:
        return {
            "ok": False,
            "error": (
                f"could not reach the Premiere Bridge panel on port {port} "
                f"(is the panel open in Premiere Pro?): {exc}"
            ),
        }
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"panel returned a malformed response: {exc}"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a command to the Premiere Bridge CEP panel.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Bridge panel port (default: {DEFAULT_PORT})")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    install_panel_parser = subparsers.add_parser(
        "install-panel",
        help="Install the bundled Premiere Bridge CEP panel into Adobe's extensions directory and enable PlayerDebugMode",
    )
    install_panel_parser.add_argument(
        "--symlink",
        action="store_true",
        help="Symlink the installed package's own panel directory instead of copying (development use; breaks if the package is uninstalled/moved)",
    )

    subparsers.add_parser(
        "doctor",
        help="Diagnose the CLI -> panel -> Premiere chain: panel installed, panel reachable, versions matching, Premiere responding",
    )

    init_project_parser = subparsers.add_parser(
        "init-project",
        help="Create a fresh, empty Premiere Pro project from the bundled empty-project template",
    )
    init_project_parser.add_argument("project_name", help="Name of the new project, e.g. project0002")
    init_project_parser.add_argument(
        "--series", default=None,
        help="Optional series name; the project is nested under <base-dir>/<series>/<project_name>",
    )
    init_project_parser.add_argument(
        "--base-dir", required=True,
        help="Directory the project (or series) is created under",
    )

    desktop_set_input_lut_parser = subparsers.add_parser(
        "desktop-set-input-lut",
        help="Set the selected clip's Lumetri Input LUT by driving the native UI "
             "(macOS only; ExtendScript can't write this property on this build — see apply-lut)",
    )
    desktop_set_input_lut_parser.add_argument("path", help="Path to a .cube LUT file")

    create_sequence_parser = subparsers.add_parser("create-sequence", help="Create a new sequence")
    create_sequence_parser.add_argument("--name", required=True, help="Name of the new sequence")
    create_sequence_parser.add_argument(
        "--bin", required=True,
        help="'/'-separated bin path to create the sequence in, e.g. 'B-Roll/Interviews' (created if missing)",
    )
    create_sequence_parser.add_argument(
        "--fps", type=float, default=25.0, help="Frame rate, e.g. 25 or 23.976 (default: 25 — matches the bundled preset)"
    )
    create_sequence_parser.add_argument(
        "--width", type=int, default=3840, help="Frame width in pixels (default: 3840 — matches the bundled preset)"
    )
    create_sequence_parser.add_argument(
        "--height", type=int, default=2160, help="Frame height in pixels (default: 2160 — matches the bundled preset)"
    )

    extract_audio_parser = subparsers.add_parser(
        "extract-audio-track", help="Extract part or all of one audio track to a local audio file"
    )
    extract_audio_parser.add_argument("--output", required=True, help="Absolute path to write the extracted audio file to")
    extract_audio_parser.add_argument(
        "--audio-track-index", type=int, required=True, help="0-based index of the audio track to extract (e.g. 0 for Audio 1)"
    )
    extract_audio_parser.add_argument(
        "--sequence-name", help="Name of the sequence to extract from (default: the currently active sequence)"
    )
    extract_audio_parser.add_argument(
        "--start-seconds", type=float, help="Start of the range to extract, in seconds (default: entire sequence)"
    )
    extract_audio_parser.add_argument(
        "--end-seconds", type=float, help="End of the range to extract, in seconds (required if --start-seconds is given)"
    )
    extract_audio_parser.add_argument(
        "--format", choices=["wav", "mp3", "aac"], default=None,
        help="Output format, using a preset bundled inside Premiere Pro itself (default: wav). Ignored if --preset-path is given.",
    )
    extract_audio_parser.add_argument(
        "--preset-path",
        help="Absolute path to a .epr export preset, overriding --format (default: auto-detect a bundled preset for --format)",
    )

    remove_intervals_parser = subparsers.add_parser(
        "remove-track-intervals",
        help="Ripple-delete a list of time intervals from an audio track (and, optionally, linked video track(s))",
    )
    remove_intervals_parser.add_argument(
        "--sequence-name",
        help="Name of the sequence to edit (default: the currently active sequence; made active if it isn't)",
    )
    remove_intervals_parser.add_argument(
        "--audio-track-index", type=int, required=True,
        help="0-based index of the audio track to remove intervals from",
    )
    remove_intervals_parser.add_argument(
        "--video-track-index", type=int, action="append", default=None,
        help="0-based index of a video track to apply the same cuts to (repeatable; omit if none)",
    )
    remove_intervals_parser.add_argument(
        "--intervals-file", required=True,
        help="Path to a remove_pauses.py-style cuts file (one 'MM:SS:FF - MM:SS:FF' line per interval)",
    )

    export_frame_parser = subparsers.add_parser(
        "export-frame", help="Export a single frame at a given timecode to a PNG file"
    )
    export_frame_parser.add_argument("--output", required=True, help="Absolute path to write the exported PNG to")
    export_frame_parser.add_argument(
        "--timecode", required=True, help="Timecode to export, as 'MM:SS:FF' (e.g. '00:12:05')"
    )
    export_frame_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export from (default: the currently active sequence)"
    )

    move_playhead_parser = subparsers.add_parser(
        "move-playhead", help="Move a sequence's playhead to a target time"
    )
    move_playhead_parser.add_argument(
        "--timecode", help='Target time as "MM:SS:FF" (exactly one of --timecode/--seconds is required)'
    )
    move_playhead_parser.add_argument(
        "--seconds", type=float, help="Target time in seconds (exactly one of --timecode/--seconds is required)"
    )
    move_playhead_parser.add_argument(
        "--sequence-name", help="Name of the sequence to move (default: the currently active sequence)"
    )

    subparsers.add_parser(
        "get-project-info", help="Snapshot of the currently active project (name, path, sequences, root item count)"
    )

    subparsers.add_parser(
        "list-project-items", help="Recursively list every item in the active project's bin tree"
    )

    subparsers.add_parser(
        "get-full-project-overview",
        help="Comprehensive snapshot of the active project: nested bin tree, sequences, and media-type counts",
    )

    search_items_parser = subparsers.add_parser(
        "search-project-items", help="Search project items by name substring, extension, offline status, and/or color label"
    )
    search_items_parser.add_argument("--name-contains", help="Case-insensitive substring to match against item names")
    search_items_parser.add_argument("--extension", help="File extension to match against each item's media path (with or without a leading dot)")
    search_items_parser.add_argument("--offline-only", action="store_true", help="Only match items that are offline")
    search_items_parser.add_argument("--color-label", type=int, help="Match items with this color label (0-15)")

    subparsers.add_parser(
        "get-active-sequence", help="Read the active sequence's full structure (tracks, clips)"
    )

    full_sequence_info_parser = subparsers.add_parser(
        "get-full-sequence-info", help="Read a sequence's full structure, including clip effects and markers"
    )
    full_sequence_info_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    full_clip_info_parser = subparsers.add_parser(
        "get-full-clip-info", help="Read one clip's full detail, including effect components and properties"
    )
    full_clip_info_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read from (default: the currently active sequence)"
    )
    full_clip_info_parser.add_argument(
        "--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on"
    )
    full_clip_info_parser.add_argument(
        "--track-index", type=int, required=True, help="0-based index of the track"
    )
    full_clip_info_parser.add_argument(
        "--clip-index", type=int, required=True, help="0-based index of the clip on that track"
    )

    timeline_summary_parser = subparsers.add_parser(
        "get-timeline-summary", help="Read a compact per-track summary of a sequence"
    )
    timeline_summary_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    subparsers.add_parser(
        "debug-qe-inspect",
        help="TEMPORARY: reflect on the QE DOM's active-sequence/track/clip objects for API discovery",
    )

    debug_mutate_parser = subparsers.add_parser(
        "debug-qe-try-mutate",
        help="TEMPORARY: try QE clip remove()/moveToTrack() calls on the active sequence (safety-guarded by name)",
    )
    debug_mutate_parser.add_argument(
        "--sequence-name", required=True,
        help="Must exactly match the active sequence's name in Premiere — refuses to run otherwise. "
             "Point this at a duplicate/throwaway sequence, never real project media.",
    )
    debug_mutate_parser.add_argument(
        "--skip-remove-test", action="store_true",
        help="Skip the remove() test and only try moveToTrack() (use once remove() is already confirmed working)",
    )

    subparsers.add_parser(
        "get-premiere-state",
        help="Full point-in-time snapshot: app version, open project, active sequence, playhead, selection",
    )

    inspect_dom_parser = subparsers.add_parser(
        "inspect-dom-object",
        help="Evaluate a property-path expression (app/qe/$.global) and reflect on the result — API discovery/debug tool",
    )
    inspect_dom_parser.add_argument(
        "--expression", required=True,
        help='Property path to evaluate, e.g. "app.project.activeSequence" (no function calls — read-only)',
    )

    subparsers.add_parser(
        "get-open-projects",
        help="Lightweight list of every currently open project (name, path, isActive)",
    )

    set_active_project_parser = subparsers.add_parser(
        "set-active-project", help="Switch which open project is active (NOT yet live-verified — see docs)"
    )
    set_active_project_parser.add_argument("--name", help="Exact name of the open project to activate")
    set_active_project_parser.add_argument("--path", help="Exact path of the open project to activate")

    get_work_area_parser = subparsers.add_parser(
        "get-work-area", help="Get the work area bar's in/out points, in seconds"
    )
    get_work_area_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    set_work_area_parser = subparsers.add_parser(
        "set-work-area", help="Set the work area bar's in/out points, in seconds"
    )
    set_work_area_parser.add_argument("--start-seconds", type=float, required=True, help="Work area start, in seconds")
    set_work_area_parser.add_argument("--end-seconds", type=float, required=True, help="Work area end, in seconds")
    set_work_area_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    get_sequence_in_out_parser = subparsers.add_parser(
        "get-sequence-in-out", help="Get the sequence's in/out points, in seconds"
    )
    get_sequence_in_out_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    set_sequence_in_out_parser = subparsers.add_parser(
        "set-sequence-in-out", help="Set the sequence's in/out points, in seconds (e.g. for export range)"
    )
    set_sequence_in_out_parser.add_argument("--in-seconds", type=float, required=True, help="In-point, in seconds")
    set_sequence_in_out_parser.add_argument("--out-seconds", type=float, required=True, help="Out-point, in seconds")
    set_sequence_in_out_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    is_work_area_enabled_parser = subparsers.add_parser(
        "is-work-area-enabled", help="Check whether the work area bar is enabled on a sequence"
    )
    is_work_area_enabled_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    get_export_file_extension_parser = subparsers.add_parser(
        "get-export-file-extension", help="Get the file extension a given export preset would produce"
    )
    get_export_file_extension_parser.add_argument(
        "--preset-path", required=True, help="Absolute path to the export preset (.epr) file"
    )
    get_export_file_extension_parser.add_argument(
        "--sequence-name", help="Name of the sequence to check against (default: the currently active sequence)"
    )

    subparsers.add_parser("get-workspaces", help="List all available workspace layouts")

    set_workspace_parser = subparsers.add_parser("set-workspace", help="Switch to a specific workspace layout")
    set_workspace_parser.add_argument(
        "--name", required=True, help="Name of the workspace to activate (e.g. 'Editing', 'Color', 'Audio')"
    )

    subparsers.add_parser(
        "play-timeline", help="Start playback of the active sequence timeline (QE DOM, active sequence only)"
    )

    subparsers.add_parser(
        "stop-playback", help="Stop playback of the active sequence timeline (QE DOM, active sequence only)"
    )

    play_source_monitor_parser = subparsers.add_parser(
        "play-source-monitor", help="Start playback of the clip currently open in the Source Monitor"
    )
    play_source_monitor_parser.add_argument(
        "--speed", type=float, help="Playback speed (1.0 = normal, 2.0 = 2x, -1.0 = reverse; default: 1.0)"
    )

    subparsers.add_parser(
        "get-source-monitor-position", help="Get the current time indicator position in the Source Monitor"
    )

    subparsers.add_parser("get-version-info", help="Get Premiere Pro version and build information")
    bin_contents_parser = subparsers.add_parser(
        "get-bin-contents", help="Recursively list the contents of one bin, addressed by a '/'-separated path"
    )
    bin_contents_parser.add_argument(
        "--bin-path", required=True, help="'/'-separated bin path, e.g. 'B-Roll/Interviews' (same convention as create-sequence's --bin)"
    )

    project_item_info_parser = subparsers.add_parser(
        "get-project-item-info", help="Full detail on one project item, identified by node ID or tree path"
    )
    project_item_info_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--tree-path is required)")
    project_item_info_parser.add_argument("--tree-path", help="Tree path of the project item (one of --node-id/--tree-path is required)")

    timeline_gaps_parser = subparsers.add_parser(
        "get-timeline-gaps", help="Find gaps (empty spaces) between clips on a sequence's tracks"
    )
    timeline_gaps_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )
    timeline_gaps_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Which track type to analyze (default: both)"
    )
    timeline_gaps_parser.add_argument(
        "--min-gap-seconds", type=float, help="Minimum gap duration in seconds to report (default: 0.04)"
    )

    subparsers.add_parser(
        "get-offline-media", help="Find all offline/missing media in the project"
    )

    used_media_parser = subparsers.add_parser(
        "get-used-media-report", help="Report which source media a sequence uses, and how many times"
    )
    used_media_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    subparsers.add_parser(
        "get-all-project-paths", help="Get every unique media file path used in the project"
    )

    subparsers.add_parser(
        "get-unused-media", help="Find project items not used in any sequence"
    )

    subparsers.add_parser(
        "get-duplicate-media", help="Find project items that reference the same source media file"
    )

    clip_links_parser = subparsers.add_parser(
        "get-clip-links", help="Find clips linked to a given clip (same source and start time)"
    )
    clip_links_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read from (default: the currently active sequence)"
    )
    clip_links_parser.add_argument(
        "--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on"
    )
    clip_links_parser.add_argument(
        "--track-index", type=int, required=True, help="0-based index of the track"
    )
    clip_links_parser.add_argument(
        "--clip-index", type=int, required=True, help="0-based index of the clip on that track"
    )

    subparsers.add_parser(
        "get-insertion-bin", help="Get the bin currently focused in the Project panel (where new imports land)"
    )

    subparsers.add_parser(
        "get-project-panel-metadata", help="Get the Project panel's column/metadata configuration as XML"
    )

    subparsers.add_parser(
        "list-available-effects", help="List all video effects available in this Premiere Pro install (QE DOM)"
    )

    subparsers.add_parser(
        "list-available-audio-effects", help="List all audio effects available in this Premiere Pro install (QE DOM)"
    )

    subparsers.add_parser(
        "list-available-transitions",
        help="List all video transitions available in this Premiere Pro install (QE DOM; may be empty on PPro 2026)",
    )

    subparsers.add_parser(
        "list-available-audio-transitions", help="List all audio transitions available in this Premiere Pro install (QE DOM)"
    )

    list_markers_parser = subparsers.add_parser(
        "list-markers", help="List all markers on a sequence"
    )
    list_markers_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    clip_markers_parser = subparsers.add_parser(
        "get-clip-markers", help="List all markers on a specific timeline clip"
    )
    clip_markers_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read from (default: the currently active sequence)"
    )
    clip_markers_parser.add_argument(
        "--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on"
    )
    clip_markers_parser.add_argument(
        "--track-index", type=int, required=True, help="0-based index of the track"
    )
    clip_markers_parser.add_argument(
        "--clip-index", type=int, required=True, help="0-based index of the clip on that track"
    )

    markers_by_type_parser = subparsers.add_parser(
        "get-sequence-markers-by-type", help="List all sequence markers matching a specific marker type"
    )
    markers_by_type_parser.add_argument(
        "--type", required=True,
        choices=["Comment", "Chapter", "Segmentation", "WebLink", "FlashCuePoint"],
        help="Marker type to filter by",
    )
    markers_by_type_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    item_metadata_parser = subparsers.add_parser(
        "get-item-metadata", help="Get project metadata for a project item"
    )
    item_metadata_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    item_metadata_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")

    color_label_parser = subparsers.add_parser(
        "get-color-label", help="Get the color label of a project item"
    )
    color_label_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    color_label_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")

    footage_interp_parser = subparsers.add_parser(
        "get-footage-interpretation", help="Get footage interpretation settings for a project item"
    )
    footage_interp_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    footage_interp_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")

    xmp_metadata_parser = subparsers.add_parser(
        "get-xmp-metadata", help="Get the raw XMP metadata for a project item (truncated to 100KB)"
    )
    xmp_metadata_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    xmp_metadata_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")

    color_space_parser = subparsers.add_parser(
        "get-color-space", help="Get color space information for a project item"
    )
    color_space_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    color_space_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")

    subparsers.add_parser(
        "get-render-queue-status", help="Get the current status of the Adobe Media Encoder render queue"
    )

    clip_at_position_parser = subparsers.add_parser(
        "get-clip-at-position", help="Find the clip(s) covering a given time position"
    )
    clip_at_position_parser.add_argument("--seconds", type=float, required=True, help="Time position in seconds")
    clip_at_position_parser.add_argument("--track-type", choices=["video", "audio"], help="Restrict to this track type")
    clip_at_position_parser.add_argument(
        "--track-index", type=int, help="Restrict to this 0-based track index (requires --track-type)"
    )
    clip_at_position_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    clip_at_playhead_parser = subparsers.add_parser(
        "get-clip-at-playhead", help="Find all clips at the current playhead position across tracks"
    )
    clip_at_playhead_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Track type to check (default: both)"
    )
    clip_at_playhead_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    next_edit_point_parser = subparsers.add_parser(
        "get-next-edit-point", help="Find the next or previous edit point (clip boundary) from the playhead"
    )
    next_edit_point_parser.add_argument(
        "--direction", choices=["next", "previous"], help="Direction to search (default: next)"
    )
    next_edit_point_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Track type to check (default: both)"
    )
    next_edit_point_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    subparsers.add_parser("get-sequence-count", help="Get the total number of sequences in the project")

    total_clip_count_parser = subparsers.add_parser(
        "get-total-clip-count", help="Get the total number of clips across all tracks in a sequence"
    )
    total_clip_count_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    target_tracks_parser = subparsers.add_parser(
        "get-target-tracks", help="Get which tracks are currently targeted for editing"
    )
    target_tracks_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    track_info_parser = subparsers.add_parser(
        "get-track-info", help="Get detailed info about a specific track (clips, mute/lock/target state)"
    )
    track_info_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    track_info_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    track_info_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    encoder_presets_parser = subparsers.add_parser(
        "get-encoder-presets", help="List Adobe Media Encoder export presets discoverable via app.encoder"
    )
    encoder_presets_parser.add_argument(
        "--format", help="Filter to presets whose name matches this substring (e.g. 'H.264', 'ProRes')"
    )

    qe_clip_info_parser = subparsers.add_parser(
        "get-qe-clip-info", help="Read QE-DOM clip info not available through the standard API"
    )
    qe_clip_info_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    qe_clip_info_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    qe_clip_info_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    qe_clip_info_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read from (default: the currently active sequence)"
    )

    subparsers.add_parser(
        "get-source-monitor-info", help="Get info about the clip currently loaded in the Source Monitor"
    )

    adjustment_layer_parser = subparsers.add_parser(
        "get-clip-adjustment-layer", help="Check whether an addressed clip is an adjustment layer"
    )
    adjustment_layer_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    adjustment_layer_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    adjustment_layer_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    adjustment_layer_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read from (default: the currently active sequence)"
    )

    add_marker_parser = subparsers.add_parser(
        "add-marker", help="Add a marker to a sequence"
    )
    add_marker_parser.add_argument("--seconds", type=float, required=True, help="Time position for the marker, in seconds")
    add_marker_parser.add_argument("--name", help="Marker name/label")
    add_marker_parser.add_argument("--comments", help="Marker comments")
    add_marker_parser.add_argument(
        "--type", choices=["Comment", "Chapter", "Segmentation", "WebLink"], help="Marker type (default: Comment)"
    )
    add_marker_parser.add_argument("--duration-seconds", type=float, help="Duration of the marker in seconds (default: point marker)")
    add_marker_parser.add_argument("--color-index", type=int, help="Marker color index (0-7)")
    add_marker_parser.add_argument(
        "--sequence-name", help="Name of the sequence to add the marker to (default: the currently active sequence)"
    )

    update_marker_parser = subparsers.add_parser(
        "update-marker", help="Update an existing sequence marker's properties, identified by guid"
    )
    update_marker_parser.add_argument("--guid", required=True, help="guid of the marker to update (from list-markers/add-marker)")
    update_marker_parser.add_argument("--name", help="New marker name")
    update_marker_parser.add_argument("--comments", help="New marker comments")
    update_marker_parser.add_argument(
        "--type", choices=["Comment", "Chapter", "Segmentation", "WebLink"], help="New marker type"
    )
    update_marker_parser.add_argument("--color-index", type=int, help="New marker color index (0-7)")
    update_marker_parser.add_argument("--duration-seconds", type=float, help="New duration in seconds, relative to the marker's existing start")
    update_marker_parser.add_argument("--end-seconds", type=float, help="New absolute end time in seconds (ignored if --duration-seconds is also given)")
    update_marker_parser.add_argument(
        "--sequence-name", help="Name of the sequence the marker is on (default: the currently active sequence)"
    )

    delete_marker_parser = subparsers.add_parser(
        "delete-marker", help="Delete a sequence or project-item marker, identified by guid"
    )
    delete_marker_parser.add_argument("--guid", help="guid of the marker to delete (one of --guid/--marker-name is required)")
    delete_marker_parser.add_argument("--marker-name", help="Exact marker name to delete (errors if ambiguous; one of --guid/--marker-name is required)")
    delete_marker_parser.add_argument(
        "--sequence-name", help="Name of the sequence the marker is on (default: the currently active sequence)"
    )
    delete_marker_parser.add_argument(
        "--node-id", help="Node ID of a PROJECT ITEM to delete the marker from instead of a sequence"
    )
    delete_marker_parser.add_argument(
        "--item-name", help="Exact name of a PROJECT ITEM to delete the marker from instead of a sequence"
    )

    add_marker_to_item_parser = subparsers.add_parser(
        "add-marker-to-project-item", help="Add a source marker to a project item"
    )
    add_marker_to_item_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    add_marker_to_item_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    add_marker_to_item_parser.add_argument("--seconds", type=float, required=True, help="Time position for the marker, in seconds")
    add_marker_to_item_parser.add_argument("--marker-name", help="Marker name/label (separate from --name, which addresses the project item)")
    add_marker_to_item_parser.add_argument("--comments", help="Marker comments")
    add_marker_to_item_parser.add_argument(
        "--type", choices=["Comment", "Chapter", "Segmentation", "WebLink"], help="Marker type (default: Comment)"
    )
    add_marker_to_item_parser.add_argument("--duration-seconds", type=float, help="Duration of the marker in seconds (default: point marker)")
    add_marker_to_item_parser.add_argument("--color-index", type=int, help="Marker color index (0-7)")

    subparsers.add_parser("redo", help="Redo the last undone action")

    undo_parser = subparsers.add_parser(
        "undo", help="Undo the last action (or --count actions), merging the reference project's undo/multiple_undo pair into one command"
    )
    undo_parser.add_argument("--count", type=int, help="Number of actions to undo (default: 1, capped at 50)")

    move_to_edit_parser = subparsers.add_parser(
        "move-playhead-to-edit", help="Move the playhead to the next or previous edit point (clip boundary)"
    )
    move_to_edit_parser.add_argument(
        "--direction", choices=["next", "previous"], help="Direction to move (default: next)"
    )
    move_to_edit_parser.add_argument(
        "--sequence-name", help="Name of the sequence to move (default: the currently active sequence)"
    )

    set_poster_frame_parser = subparsers.add_parser(
        "set-poster-frame", help="Set a project item's poster frame (thumbnail) at a given time (API uncertain — see docs)"
    )
    set_poster_frame_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_poster_frame_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    set_poster_frame_parser.add_argument("--seconds", type=float, required=True, help="Time position for the poster frame, in seconds")

    select_item_parser = subparsers.add_parser(
        "select-project-item", help="Select a project item in the Project panel"
    )
    select_item_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    select_item_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")

    select_by_name_parser = subparsers.add_parser(
        "select-clips-by-name", help="Select all clips whose name contains a substring (case-insensitive)"
    )
    select_by_name_parser.add_argument("--name-contains", required=True, help="Case-insensitive substring to match against clip names")
    select_by_name_parser.add_argument(
        "--add-to-selection", action="store_true", help="Add matches to the existing selection instead of replacing it"
    )
    select_by_name_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    select_all_parser = subparsers.add_parser(
        "select-all-clips", help="Select all clips in a sequence, or all clips on one track type"
    )
    select_all_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Track type to select (default: both)"
    )
    select_all_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    deselect_all_parser = subparsers.add_parser(
        "deselect-all-clips", help="Deselect every clip in a sequence"
    )
    deselect_all_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    select_in_range_parser = subparsers.add_parser(
        "select-clips-in-range", help="Select all clips that overlap a time range"
    )
    select_in_range_parser.add_argument("--start-seconds", type=float, required=True, help="Start of the range, in seconds")
    select_in_range_parser.add_argument("--end-seconds", type=float, required=True, help="End of the range, in seconds")
    select_in_range_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    select_by_color_parser = subparsers.add_parser(
        "select-clips-by-color", help="Select all clips whose source project item has a given color label"
    )
    select_by_color_parser.add_argument("--color-label", type=int, required=True, help="Color label to match (0-15)")
    select_by_color_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    invert_selection_parser = subparsers.add_parser(
        "invert-selection", help="Invert the current clip selection (selected become deselected and vice versa)"
    )
    invert_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    select_disabled_parser = subparsers.add_parser(
        "select-disabled-clips", help="Select all disabled clips in a sequence"
    )
    select_disabled_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_clip_selection_parser = subparsers.add_parser(
        "set-clip-selection", help="Select or deselect a single clip, addressed by track/clip index"
    )
    set_clip_selection_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_selection_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_selection_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_selection_group = set_clip_selection_parser.add_mutually_exclusive_group(required=True)
    set_clip_selection_group.add_argument("--select", dest="selected", action="store_true", help="Select the clip")
    set_clip_selection_group.add_argument("--deselect", dest="selected", action="store_false", help="Deselect the clip")
    set_clip_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    add_track_parser = subparsers.add_parser(
        "add-track", help="Add one or more video or audio tracks to a sequence (one underlying call per track)"
    )
    add_track_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Type of track to add")
    add_track_parser.add_argument("--index", type=int, help="Insertion position (0-based; default: append at the end)")
    add_track_parser.add_argument("--count", type=int, help="Number of tracks to add (default: 1, capped at 8)")
    add_track_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    lock_track_parser = subparsers.add_parser("lock-track", help="Lock or unlock a video or audio track")
    lock_track_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    lock_track_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    lock_track_parser.add_argument(
        "--locked", required=True, choices=["true", "false"], help="Whether the track should be locked"
    )
    lock_track_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    track_visibility_parser = subparsers.add_parser(
        "set-track-visibility", help="Show or hide a video track (implemented via its mute flag — see docs)"
    )
    track_visibility_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the video track")
    track_visibility_parser.add_argument(
        "--visible", required=True, choices=["true", "false"], help="Whether the track should be visible"
    )
    track_visibility_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    track_mute_parser = subparsers.add_parser("set-track-mute", help="Mute or unmute a video or audio track")
    track_mute_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    track_mute_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    track_mute_parser.add_argument(
        "--muted", required=True, choices=["true", "false"], help="Whether the track should be muted"
    )
    track_mute_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    rename_track_parser = subparsers.add_parser("rename-track", help="Rename a video or audio track")
    rename_track_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    rename_track_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    rename_track_parser.add_argument("--name", required=True, help="New track name")
    rename_track_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_target_track_parser = subparsers.add_parser(
        "set-target-track", help="Target or untarget a track for insert/overwrite edits"
    )
    set_target_track_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    set_target_track_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_target_track_parser.add_argument(
        "--targeted", required=True, choices=["true", "false"], help="Whether the track should be targeted"
    )
    set_target_track_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_all_targeted_parser = subparsers.add_parser(
        "set-all-tracks-targeted", help="Target or untarget every track (optionally filtered to one track type)"
    )
    set_all_targeted_parser.add_argument(
        "--targeted", required=True, choices=["true", "false"], help="Whether tracks should be targeted"
    )
    set_all_targeted_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Restrict to this track type (default: both)"
    )
    set_all_targeted_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    def _add_clip_addressing_args(p):
        p.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
        p.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
        p.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
        p.add_argument(
            "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
        )

    set_clip_position_parser = subparsers.add_parser(
        "set-clip-position", help="Set the Position property (pixels) on a clip's Motion component"
    )
    _add_clip_addressing_args(set_clip_position_parser)
    set_clip_position_parser.add_argument("--x", type=float, required=True, help="X position in pixels")
    set_clip_position_parser.add_argument("--y", type=float, required=True, help="Y position in pixels")

    set_clip_scale_parser = subparsers.add_parser(
        "set-clip-scale", help="Set the Scale property on a clip's Motion component (100 = original size)"
    )
    _add_clip_addressing_args(set_clip_scale_parser)
    set_clip_scale_parser.add_argument("--scale", type=float, required=True, help="Scale value (100 = original size)")

    set_clip_rotation_parser = subparsers.add_parser(
        "set-clip-rotation", help="Set the Rotation property (degrees) on a clip's Motion component"
    )
    _add_clip_addressing_args(set_clip_rotation_parser)
    set_clip_rotation_parser.add_argument("--degrees", type=float, required=True, help="Rotation in degrees")

    set_clip_anchor_point_parser = subparsers.add_parser(
        "set-clip-anchor-point", help="Set the Anchor Point property (pixels) on a clip's Motion component"
    )
    _add_clip_addressing_args(set_clip_anchor_point_parser)
    set_clip_anchor_point_parser.add_argument("--x", type=float, required=True, help="Anchor point X in pixels")
    set_clip_anchor_point_parser.add_argument("--y", type=float, required=True, help="Anchor point Y in pixels")

    set_clip_opacity_parser = subparsers.add_parser(
        "set-clip-opacity", help="Set the Opacity property (0-100) on a clip's Opacity component"
    )
    _add_clip_addressing_args(set_clip_opacity_parser)
    set_clip_opacity_parser.add_argument("--opacity", type=float, required=True, help="Opacity value (0-100)")

    set_uniform_scale_parser = subparsers.add_parser(
        "set-uniform-scale", help="Toggle Uniform Scale on a clip's Motion component"
    )
    _add_clip_addressing_args(set_uniform_scale_parser)
    set_uniform_scale_parser.add_argument(
        "--uniform", required=True, choices=["true", "false"], help="Whether Scale Width/Height should be linked"
    )

    set_scale_width_height_parser = subparsers.add_parser(
        "set-scale-width-height",
        help="Set Scale Width and/or Scale Height independently (requires Uniform Scale to be off)",
    )
    _add_clip_addressing_args(set_scale_width_height_parser)
    set_scale_width_height_parser.add_argument("--scale-width", type=float, help="Scale width percentage")
    set_scale_width_height_parser.add_argument("--scale-height", type=float, help="Scale height percentage")

    set_anti_alias_quality_parser = subparsers.add_parser(
        "set-anti-alias-quality",
        help="Set an anti-alias-quality-like property on a clip's Motion component (API uncertain — probed defensively)",
    )
    _add_clip_addressing_args(set_anti_alias_quality_parser)
    set_anti_alias_quality_parser.add_argument("--amount", type=float, required=True, help="Anti-flicker filter amount, 0..1 (targets Motion's Anti-flicker Filter property)")

    set_blend_mode_parser = subparsers.add_parser(
        "set-blend-mode", help="Set the Blend Mode property (raw int enum, version-dependent) on a clip's Opacity component"
    )
    _add_clip_addressing_args(set_blend_mode_parser)
    set_blend_mode_parser.add_argument(
        "--blend-mode", type=int, required=True, help="Blend Mode enum value (int; mapping is version-dependent — see docs)"
    )

    set_clip_volume_parser = subparsers.add_parser(
        "set-clip-volume", help="Set an audio clip's volume in dB (converted to linear amplitude — calibration uncertain, see docs)"
    )
    set_clip_volume_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_volume_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_volume_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_volume_parser.add_argument("--db", type=float, required=True, help="Volume in dB (0 = unity, negative = quieter, positive = louder)")
    set_clip_volume_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_clip_pan_parser = subparsers.add_parser(
        "set-clip-pan", help="Set an audio clip's pan/balance"
    )
    set_clip_pan_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_pan_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_pan_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_pan_parser.add_argument("--pan", type=float, required=True, help="Pan value (-100 = full left, 0 = center, 100 = full right)")
    set_clip_pan_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    adjust_audio_levels_parser = subparsers.add_parser(
        "adjust-audio-levels", help="Adjust an audio clip's level by a dB DELTA relative to its current level (calibration uncertain, see docs)"
    )
    adjust_audio_levels_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    adjust_audio_levels_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    adjust_audio_levels_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    adjust_audio_levels_parser.add_argument("--db", type=float, required=True, help="dB delta to apply relative to the clip's current level")
    adjust_audio_levels_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    add_audio_keyframes_parser = subparsers.add_parser(
        "add-audio-keyframes", help="Add audio level keyframes to an audio clip (fades/level changes)"
    )
    add_audio_keyframes_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    add_audio_keyframes_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    add_audio_keyframes_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    add_audio_keyframes_parser.add_argument(
        "--keyframes", required=True,
        help='JSON string of [{"seconds": <clip-relative seconds>, "db": <level in dB>}, ...]',
    )
    add_audio_keyframes_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    rename_clip_parser = subparsers.add_parser(
        "rename-clip", help="Rename a timeline clip"
    )
    rename_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    rename_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    rename_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    rename_clip_parser.add_argument("--name", required=True, help="New clip name")
    rename_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    batch_rename_clips_parser = subparsers.add_parser(
        "batch-rename-clips", help="Rename multiple clips on a track using a {n}/{name} template (capped at 200)"
    )
    batch_rename_clips_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type")
    batch_rename_clips_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    batch_rename_clips_parser.add_argument(
        "--new-name-template", required=True,
        help="Name template — use {n} for a sequential counter, {name} for the clip's existing name",
    )
    batch_rename_clips_parser.add_argument("--name-contains", help="Only rename clips whose current name contains this substring (case-insensitive)")
    batch_rename_clips_parser.add_argument("--start-number", type=int, help="Starting number for {n} (default: 1)")
    batch_rename_clips_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_clip_enabled_parser = subparsers.add_parser(
        "set-clip-enabled", help="Enable or disable a timeline clip"
    )
    set_clip_enabled_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_enabled_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_enabled_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_enabled_parser.add_argument(
        "--enabled", required=True, choices=["true", "false"], help="Whether the clip should be enabled"
    )
    set_clip_enabled_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    batch_set_clips_enabled_parser = subparsers.add_parser(
        "batch-set-clips-enabled", help="Enable or disable multiple clips at once, optionally filtered (capped at 200)"
    )
    batch_set_clips_enabled_parser.add_argument(
        "--enabled", required=True, choices=["true", "false"], help="Whether the matched clips should be enabled"
    )
    batch_set_clips_enabled_parser.add_argument("--name-contains", help="Only affect clips whose name contains this substring (case-insensitive)")
    batch_set_clips_enabled_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Restrict to this track type (default: both)"
    )
    batch_set_clips_enabled_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_frame_blend_parser = subparsers.add_parser(
        "set-frame-blend", help="Enable or disable frame blending on a clip (QE DOM)"
    )
    set_frame_blend_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_frame_blend_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_frame_blend_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_frame_blend_parser.add_argument(
        "--enabled", required=True, choices=["true", "false"], help="Whether frame blending should be enabled"
    )
    set_frame_blend_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_time_interpolation_parser = subparsers.add_parser(
        "set-time-interpolation", help="Set a clip's time interpolation type (QE DOM)"
    )
    set_time_interpolation_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_time_interpolation_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_time_interpolation_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_time_interpolation_parser.add_argument(
        "--type", type=int, required=True, choices=[0, 1, 2], help="0 = sampling, 1 = blending, 2 = optical flow"
    )
    set_time_interpolation_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_clip_properties_parser = subparsers.add_parser(
        "set-clip-properties", help="Set multiple properties on a clip in one call (opacity, speed, scale, position, rotation)"
    )
    set_clip_properties_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_properties_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_properties_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_properties_parser.add_argument("--opacity", type=float, help="Opacity value (0-100)")
    set_clip_properties_parser.add_argument("--speed", type=float, help="Playback speed multiplier (1.0 = normal, 2.0 = double speed)")
    set_clip_properties_parser.add_argument("--scale", type=float, help="Scale percentage (100 = original size)")
    set_clip_properties_parser.add_argument("--position-x", type=float, help="Horizontal Motion position in pixels")
    set_clip_properties_parser.add_argument("--position-y", type=float, help="Vertical Motion position in pixels")
    set_clip_properties_parser.add_argument("--rotation", type=float, help="Rotation in degrees")
    set_clip_properties_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_item_metadata_parser = subparsers.add_parser(
        "set-item-metadata", help="Set a single project metadata field on a project item"
    )
    set_item_metadata_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    set_item_metadata_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")
    set_item_metadata_parser.add_argument(
        "--field-path", required=True, help="Metadata field path, e.g. 'Column.Intrinsic.Description'"
    )
    set_item_metadata_parser.add_argument("--value", required=True, help="Value to set at that field path")

    set_color_label_parser = subparsers.add_parser(
        "set-color-label", help="Set the color label on a project item"
    )
    set_color_label_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    set_color_label_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")
    set_color_label_parser.add_argument(
        "--color-label", type=int, required=True, choices=range(16), metavar="0-15", help="Label color index (0=Violet ... 15=Yellow)"
    )

    set_footage_interp_parser = subparsers.add_parser(
        "set-footage-interpretation", help="Set footage interpretation settings for a project item (at least one field required)"
    )
    set_footage_interp_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    set_footage_interp_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")
    set_footage_interp_parser.add_argument("--frame-rate", type=float, help="Override frame rate")
    set_footage_interp_parser.add_argument("--pixel-aspect-ratio", type=float, help="Pixel aspect ratio (1.0 = square pixels)")
    set_footage_interp_parser.add_argument("--field-type", type=int, help="Field type enum value (API uncertain — probe get-footage-interpretation first)")
    set_footage_interp_parser.add_argument("--alpha-usage", type=int, help="Alpha usage enum value (API uncertain — probe get-footage-interpretation first)")

    set_xmp_metadata_parser = subparsers.add_parser(
        "set-xmp-metadata",
        help=(
            "REPLACE a project item's entire XMP metadata block (get-xmp-metadata first, "
            "modify, then pass the full result back here)"
        ),
    )
    set_xmp_metadata_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    set_xmp_metadata_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")
    set_xmp_metadata_parser.add_argument("--xmp", help="Complete XMP metadata XML string (one of --xmp/--xmp-file is required)")
    set_xmp_metadata_parser.add_argument(
        "--xmp-file", help="Path to a local file containing the complete XMP metadata XML (read here, not on the command line; one of --xmp/--xmp-file is required)"
    )

    apply_effect_parser = subparsers.add_parser(
        "apply-effect", help="Apply a video effect to a clip via the QE effect catalog"
    )
    _add_clip_addressing_args(apply_effect_parser)
    apply_effect_parser.add_argument("--effect-name", required=True, help="Effect name, e.g. 'Gaussian Blur' (see list-available-effects)")

    apply_audio_effect_parser = subparsers.add_parser(
        "apply-audio-effect", help="Apply an audio effect to a clip via the QE effect catalog"
    )
    _add_clip_addressing_args(apply_audio_effect_parser)
    apply_audio_effect_parser.add_argument("--effect-name", required=True, help="Audio effect name (see list-available-audio-effects)")

    remove_effect_parser = subparsers.add_parser(
        "remove-effect", help="Remove one component from a clip by its index into clip.components (Motion/Opacity refused)"
    )
    _add_clip_addressing_args(remove_effect_parser)
    remove_effect_parser.add_argument("--component-index", type=int, required=True, help="0-based index into the clip's components collection")

    remove_effect_by_name_parser = subparsers.add_parser(
        "remove-effect-by-name", help="Remove every component on a clip matching a displayName/matchName (Motion/Opacity refused)"
    )
    _add_clip_addressing_args(remove_effect_by_name_parser)
    remove_effect_by_name_parser.add_argument("--effect-name", required=True, help="Component displayName or matchName to remove")

    remove_all_effects_parser = subparsers.add_parser(
        "remove-all-effects", help="Strip all applied (non-built-in) effects from a clip via QE removeEffects()"
    )
    _add_clip_addressing_args(remove_all_effects_parser)

    color_correct_parser = subparsers.add_parser(
        "color-correct", help="Apply/adjust Lumetri Color on a clip (at least one of the flat props required)"
    )
    _add_clip_addressing_args(color_correct_parser)
    color_correct_parser.add_argument("--exposure", type=float, help="Exposure adjustment")
    color_correct_parser.add_argument("--contrast", type=float, help="Contrast adjustment (-100 to 100)")
    color_correct_parser.add_argument("--saturation", type=float, help="Saturation (0-200, 100 = normal)")
    color_correct_parser.add_argument("--temperature", type=float, help="Color temperature adjustment")
    color_correct_parser.add_argument("--tint", type=float, help="Tint adjustment")

    apply_lut_parser = subparsers.add_parser(
        "apply-lut", help="Apply a LUT file to a clip via Lumetri Color's Input LUT property"
    )
    _add_clip_addressing_args(apply_lut_parser)
    apply_lut_parser.add_argument("--lut-path", required=True, help="Absolute path to a .cube/.3dl LUT file")

    stabilize_clip_parser = subparsers.add_parser(
        "stabilize-clip", help="Apply Warp Stabilizer to a video clip (analysis runs asynchronously in Premiere afterward)"
    )
    _add_clip_addressing_args(stabilize_clip_parser)
    stabilize_clip_parser.add_argument("--smoothness", type=float, help="Stabilization smoothness percentage")
    stabilize_clip_parser.add_argument(
        "--method", choices=["Subspace Warp", "Position", "Position, Scale, Rotation"], help="Stabilization method"
    )

    def _add_source_target_addressing_args(p):
        p.add_argument("--source-sequence-name", help="Name of the source sequence (default: the currently active sequence)")
        p.add_argument("--source-track-type", required=True, choices=["video", "audio"], help="Track type the source clip is on")
        p.add_argument("--source-track-index", type=int, required=True, help="0-based index of the source track")
        p.add_argument("--source-clip-index", type=int, required=True, help="0-based index of the source clip on that track")
        p.add_argument("--target-sequence-name", help="Name of the target sequence (default: the currently active sequence)")
        p.add_argument("--target-track-type", required=True, choices=["video", "audio"], help="Track type the target clip is on")
        p.add_argument("--target-track-index", type=int, required=True, help="0-based index of the target track")
        p.add_argument("--target-clip-index", type=int, required=True, help="0-based index of the target clip on that track")

    copy_effects_parser = subparsers.add_parser(
        "copy-effects-between-clips", help="Re-apply and copy property values for every (or one) effect from a source clip to a target clip"
    )
    _add_source_target_addressing_args(copy_effects_parser)
    copy_effects_parser.add_argument(
        "--effect-name", help="Copy only this effect (displayName); omit to copy all non-intrinsic effects (Motion/Opacity/Time Remapping/Volume/Channel Volume/Panner are always skipped)"
    )

    copy_effect_values_parser = subparsers.add_parser(
        "copy-effect-values", help="Copy one effect's property values from a source clip to a target clip (effect must already exist on both)"
    )
    _add_source_target_addressing_args(copy_effect_values_parser)
    copy_effect_values_parser.add_argument("--effect-name", required=True, help="Effect displayName; must already be applied on both clips")

    batch_apply_effect_parser = subparsers.add_parser(
        "batch-apply-effect", help="Apply an effect to multiple clips at once, optionally filtered (capped at 100)"
    )
    batch_apply_effect_parser.add_argument("--effect-name", required=True, help="Effect name to apply (video or audio catalog, chosen per matched clip's track type)")
    batch_apply_effect_parser.add_argument("--name-contains", help="Only affect clips whose name contains this substring (case-insensitive)")
    batch_apply_effect_parser.add_argument(
        "--track-type", choices=["video", "audio", "both"], help="Restrict to this track type (default: both)"
    )
    batch_apply_effect_parser.add_argument(
        "--track-index", type=int, help="Restrict to this 0-based track index (requires --track-type to be video or audio, not both)"
    )
    batch_apply_effect_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    def _add_component_property_args(p):
        _add_clip_addressing_args(p)
        p.add_argument("--component-name", required=True, help="Component display name or matchName (e.g. 'Motion', 'AE.ADBE Opacity', 'Lumetri Color')")
        p.add_argument("--property-name", required=True, help="Property display name (e.g. 'Scale', 'Opacity', 'Tint')")

    get_effect_properties_parser = subparsers.add_parser(
        "get-effect-properties", help="List all properties of one named component on a clip (values, isTimeVarying, keyCount)"
    )
    _add_clip_addressing_args(get_effect_properties_parser)
    get_effect_properties_parser.add_argument("--component-name", required=True, help="Component display name or matchName (e.g. 'Motion', 'AE.ADBE Opacity', 'Lumetri Color')")

    set_effect_property_parser = subparsers.add_parser(
        "set-effect-property", help="Set the value of one property on a named component (number/string/boolean)"
    )
    _add_component_property_args(set_effect_property_parser)
    set_effect_property_parser.add_argument("--value", required=True, help="Value to set — interpreted per --value-type")
    set_effect_property_parser.add_argument(
        "--value-type", required=True, choices=["number", "string", "boolean"], help="How to interpret --value"
    )

    get_keyframes_parser = subparsers.add_parser(
        "get-keyframes", help="List every keyframe (time + value) on a named component property"
    )
    _add_component_property_args(get_keyframes_parser)

    add_keyframe_parser = subparsers.add_parser(
        "add-keyframe", help="Add a keyframe to a component property at a clip-relative time"
    )
    _add_component_property_args(add_keyframe_parser)
    add_keyframe_parser.add_argument("--seconds", type=float, required=True, help="Clip-relative time for the new keyframe, in seconds")
    add_keyframe_parser.add_argument("--value", type=float, required=True, help="Value at the keyframe")

    remove_keyframe_parser = subparsers.add_parser(
        "remove-keyframe", help="Remove a keyframe near a clip-relative time (tolerance: half a frame)"
    )
    _add_component_property_args(remove_keyframe_parser)
    remove_keyframe_parser.add_argument("--seconds", type=float, required=True, help="Clip-relative time of the keyframe to remove, in seconds")

    remove_keyframe_range_parser = subparsers.add_parser(
        "remove-keyframe-range", help="Remove all keyframes within a clip-relative time range"
    )
    _add_component_property_args(remove_keyframe_range_parser)
    remove_keyframe_range_parser.add_argument("--start-seconds", type=float, required=True, help="Start of the range, clip-relative seconds")
    remove_keyframe_range_parser.add_argument("--end-seconds", type=float, required=True, help="End of the range, clip-relative seconds")

    set_keyframe_interpolation_parser = subparsers.add_parser(
        "set-keyframe-interpolation",
        help="Set a keyframe's interpolation type (raw int — enum meaning is version-dependent, see docs)",
    )
    _add_component_property_args(set_keyframe_interpolation_parser)
    set_keyframe_interpolation_parser.add_argument("--seconds", type=float, required=True, help="Clip-relative time of the keyframe, in seconds")
    set_keyframe_interpolation_parser.add_argument(
        "--interpolation-type", type=int, required=True,
        help="Raw interpolation enum int (0=Linear/4=Hold/5=Bezier per one reference repo, 0/1/2 per another — disputed, see docs)",
    )

    get_value_at_time_parser = subparsers.add_parser(
        "get-value-at-time", help="Get a component property's interpolated value at a clip-relative time"
    )
    _add_component_property_args(get_value_at_time_parser)
    get_value_at_time_parser.add_argument("--seconds", type=float, required=True, help="Clip-relative time to query, in seconds")

    set_color_value_parser = subparsers.add_parser(
        "set-color-value", help="Set a color-typed property (e.g. a Lumetri tint or title fill color)"
    )
    _add_component_property_args(set_color_value_parser)
    set_color_value_parser.add_argument("--alpha", type=float, required=True, help="Alpha channel, 0-255")
    set_color_value_parser.add_argument("--red", type=float, required=True, help="Red channel, 0-255")
    set_color_value_parser.add_argument("--green", type=float, required=True, help="Green channel, 0-255")
    set_color_value_parser.add_argument("--blue", type=float, required=True, help="Blue channel, 0-255")

    add_transition_parser = subparsers.add_parser(
        "add-transition", help="Add a video transition to a clip's start or end (QE DOM, disputed signature)"
    )
    add_transition_parser.add_argument("--track-type", required=True, choices=["video"], help="Track type the clip is on (video only)")
    add_transition_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the video track")
    add_transition_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    add_transition_parser.add_argument("--at-end", required=True, choices=["true", "false"], help="true = apply at the clip's end, false = at its start")
    add_transition_parser.add_argument("--transition-name", help="Transition name, e.g. 'Cross Dissolve' (omit for the default transition)")
    add_transition_parser.add_argument("--duration-seconds", type=float, help="Transition duration in seconds (default: 1.0)")
    add_transition_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    batch_add_transitions_parser = subparsers.add_parser(
        "batch-add-transitions", help="Add the same transition to every clip on one video track (capped at 100)"
    )
    batch_add_transitions_parser.add_argument("--track-type", choices=["video"], help="Track type (video only, default: video)")
    batch_add_transitions_parser.add_argument("--track-index", type=int, help="0-based index of the video track (default: 0)")
    batch_add_transitions_parser.add_argument("--at-end", choices=["true", "false"], help="true = apply at each clip's end (default), false = at its start")
    batch_add_transitions_parser.add_argument("--transition-name", help="Transition name, e.g. 'Cross Dissolve' (omit for the default transition)")
    batch_add_transitions_parser.add_argument("--duration-seconds", type=float, help="Transition duration in seconds (default: 1.0)")
    batch_add_transitions_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    remove_transition_parser = subparsers.add_parser(
        "remove-transition", help="Remove a transition from a track (standard DOM, disputed remove() arity); lists transitions if the index is out of range"
    )
    remove_transition_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the transition is on")
    remove_transition_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    remove_transition_parser.add_argument("--transition-index", type=int, required=True, help="0-based index into the track's transitions collection")
    remove_transition_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    add_to_timeline_parser = subparsers.add_parser(
        "add-to-timeline", help="Add a project item to the timeline (insert/overwrite)"
    )
    add_to_timeline_parser.add_argument("--node-id", help="Node ID of the project item to place (either this or --name is required)")
    add_to_timeline_parser.add_argument("--name", help="Exact name of the project item to place (either this or --node-id is required)")
    add_to_timeline_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type to place the clip on")
    add_to_timeline_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    add_to_timeline_parser.add_argument("--start-seconds", type=float, required=True, help="Start time on the timeline, in seconds")
    add_to_timeline_parser.add_argument("--mode", required=True, choices=["insert", "overwrite"], help="insert = ripple, overwrite = overwrite in place")
    add_to_timeline_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    remove_from_timeline_parser = subparsers.add_parser(
        "remove-from-timeline", help="Destructive: permanently remove a clip from the timeline"
    )
    remove_from_timeline_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    remove_from_timeline_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    remove_from_timeline_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    remove_from_timeline_parser.add_argument(
        "--ripple", required=True, choices=["true", "false"], help="true = ripple delete (close the gap), false = lift in place"
    )
    remove_from_timeline_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    move_clip_parser = subparsers.add_parser(
        "move-clip", help="Move a clip to a new absolute start time on the same track"
    )
    move_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    move_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    move_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    move_clip_parser.add_argument("--start-seconds", type=float, required=True, help="New absolute start time, in seconds")
    move_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    trim_clip_parser = subparsers.add_parser(
        "trim-clip", help="Trim a clip's in and/or out point (source-media-relative seconds)"
    )
    trim_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    trim_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    trim_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    trim_clip_parser.add_argument("--in-point-seconds", type=float, help="New in-point, source-media-relative seconds")
    trim_clip_parser.add_argument("--out-point-seconds", type=float, help="New out-point, source-media-relative seconds")
    trim_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    split_clip_parser = subparsers.add_parser(
        "split-clip", help="Split (razor) whichever clip covers a sequence-time position on one track (QE DOM)"
    )
    split_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type to razor")
    split_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    split_clip_parser.add_argument("--seconds", type=float, required=True, help="Sequence-time position to split at, in seconds")
    split_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    duplicate_clip_parser = subparsers.add_parser(
        "duplicate-clip", help="Insert a new instance of a clip's own project item onto the same track"
    )
    duplicate_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    duplicate_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    duplicate_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    duplicate_clip_parser.add_argument(
        "--target-start-seconds", type=float, help="Start time for the duplicate (default: right after the original clip's own end)"
    )
    duplicate_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    replace_clip_parser = subparsers.add_parser(
        "replace-clip", help="Destructive: remove a clip and reinsert a different project item at the same start time"
    )
    replace_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    replace_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    replace_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    replace_clip_parser.add_argument("--replacement-node-id", help="Node ID of the replacement project item (either this or --replacement-name is required)")
    replace_clip_parser.add_argument("--replacement-name", help="Exact name of the replacement project item (either this or --replacement-node-id is required)")
    replace_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_clip_speed_parser = subparsers.add_parser(
        "set-clip-speed", help="Set a clip's playback speed (QE DOM, disputed setSpeed arity)"
    )
    set_clip_speed_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    set_clip_speed_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    set_clip_speed_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    set_clip_speed_parser.add_argument(
        "--speed-percent", type=float, required=True, help="Speed as percentage (100 = normal, 200 = double, negative = reversed)"
    )
    # --ripple / --maintain-audio kept for backward compatibility but IGNORED:
    # the calibrated setSpeed signature on this build (2026-07-17) has no such
    # knobs — see plugin/README.md's set-clip-speed entry.
    set_clip_speed_parser.add_argument("--ripple", choices=["true", "false"], help="IGNORED (kept for compatibility): the working setSpeed signature has no ripple knob")
    set_clip_speed_parser.add_argument("--maintain-audio", choices=["true", "false"], help="IGNORED (kept for compatibility): the working setSpeed signature has no audio-pitch knob")
    set_clip_speed_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    get_clip_speed_parser = subparsers.add_parser(
        "get-clip-speed", help="Get a clip's playback speed and reversed state"
    )
    get_clip_speed_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    get_clip_speed_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    get_clip_speed_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    get_clip_speed_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    ripple_delete_clip_parser = subparsers.add_parser(
        "ripple-delete-clip", help="Ripple-delete one clip, closing the gap (QE DOM). Destructive."
    )
    ripple_delete_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    ripple_delete_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    ripple_delete_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    ripple_delete_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    roll_edit_parser = subparsers.add_parser(
        "roll-edit", help="Roll the edit point between a clip and its neighbor (QE DOM, signature unconfirmed)"
    )
    roll_edit_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    roll_edit_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    roll_edit_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    roll_edit_parser.add_argument("--offset-seconds", type=float, required=True, help="Positive rolls the edit point later, negative rolls it earlier")
    roll_edit_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    slide_edit_parser = subparsers.add_parser(
        "slide-edit", help="Slide a clip earlier/later without changing its own duration (QE DOM, signature unconfirmed)"
    )
    slide_edit_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    slide_edit_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    slide_edit_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    slide_edit_parser.add_argument("--offset-seconds", type=float, required=True, help="Positive slides later, negative slides earlier")
    slide_edit_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    slip_edit_parser = subparsers.add_parser(
        "slip-edit", help="Slip a clip's source in/out points without moving it on the timeline (QE DOM, signature unconfirmed)"
    )
    slip_edit_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    slip_edit_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    slip_edit_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    slip_edit_parser.add_argument("--offset-seconds", type=float, required=True, help="Positive slips forward in the source, negative slips backward")
    slip_edit_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    move_clip_to_track_parser = subparsers.add_parser(
        "move-clip-to-track", help="Move a clip to a different track of the same media type (lossy remove+re-add; effects/keyframes/speed/trims are NOT preserved)"
    )
    move_clip_to_track_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    move_clip_to_track_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the source track")
    move_clip_to_track_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    move_clip_to_track_parser.add_argument("--target-track-index", type=int, required=True, help="0-based index of the destination track (same trackType)")
    move_clip_to_track_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    reverse_clip_parser = subparsers.add_parser(
        "reverse-clip", help="Reverse (or un-reverse) a clip's playback direction (QE DOM)"
    )
    reverse_clip_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    reverse_clip_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    reverse_clip_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    reverse_clip_parser.add_argument("--reverse", choices=["true", "false"], help="true to reverse, false for normal (default: true)")
    reverse_clip_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    link_selection_parser = subparsers.add_parser(
        "link-selection", help="Link the currently-selected video/audio clips in a sequence (standard DOM)"
    )
    link_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    unlink_selection_parser = subparsers.add_parser(
        "unlink-selection", help="Unlink the currently-selected linked clip(s) in a sequence (standard DOM)"
    )
    unlink_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    overwrite_clip_at_parser = subparsers.add_parser(
        "overwrite-clip-at", help="Overwrite a bin project item onto the timeline at a track/time. Destructive."
    )
    overwrite_clip_at_group = overwrite_clip_at_parser.add_mutually_exclusive_group(required=True)
    overwrite_clip_at_group.add_argument("--item-node-id", help="Node ID of the project item to place")
    overwrite_clip_at_group.add_argument("--item-name", help="Name of the project item to place (first match)")
    overwrite_clip_at_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type to place the clip on")
    overwrite_clip_at_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    overwrite_clip_at_parser.add_argument("--start-seconds", type=float, required=True, help="Start time in seconds on the timeline")
    overwrite_clip_at_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    razor_all_tracks_parser = subparsers.add_parser(
        "razor-all-tracks", help="Razor (split) every video+audio track at a given time (destructive-ish; QE only)"
    )
    razor_all_tracks_parser.add_argument("--seconds", type=float, help="Time to razor at (default: the sequence's own playhead position)")
    razor_all_tracks_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    set_item_in_out_parser = subparsers.add_parser(
        "set-item-in-out", help="Set in/out points on a PROJECT item (not a timeline clip)"
    )
    set_item_in_out_parser.add_argument("--node-id", help="Node ID of the project item")
    set_item_in_out_parser.add_argument("--name", help="Name of the project item (used if --node-id is omitted)")
    set_item_in_out_parser.add_argument("--in-seconds", type=float, help="In point in seconds")
    set_item_in_out_parser.add_argument("--out-seconds", type=float, help="Out point in seconds")
    set_item_in_out_parser.add_argument("--media-type", type=int, choices=[1, 2, 4], help="1=video, 2=audio, 4=all (default: 4)")

    clear_item_in_out_parser = subparsers.add_parser(
        "clear-item-in-out", help="Clear in/out points on a PROJECT item (reset to full source duration)"
    )
    clear_item_in_out_parser.add_argument("--node-id", help="Node ID of the project item")
    clear_item_in_out_parser.add_argument("--name", help="Name of the project item (used if --node-id is omitted)")
    clear_item_in_out_parser.add_argument("--clear-in", choices=["true", "false"], help="Clear the in point (default: true)")
    clear_item_in_out_parser.add_argument("--clear-out", choices=["true", "false"], help="Clear the out point (default: true)")

    clear_sequence_in_out_parser = subparsers.add_parser(
        "clear-sequence-in-out", help="Clear the active (or named) sequence's in/out points back to Premiere's unset sentinel"
    )
    clear_sequence_in_out_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    remove_selected_clips_parser = subparsers.add_parser(
        "remove-selected-clips", help="Remove every currently-selected clip from the timeline (destructive)"
    )
    remove_selected_clips_parser.add_argument("--ripple", choices=["true", "false"], help="true = close the gap after removing (default: false)")
    remove_selected_clips_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    lift_selection_parser = subparsers.add_parser(
        "lift-selection", help="Lift (remove without closing the gap) content between the sequence's in/out points (destructive; QE only)"
    )
    lift_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    extract_selection_parser = subparsers.add_parser(
        "extract-selection", help="Extract (remove and close the gap) content between the sequence's in/out points (destructive; QE only)"
    )
    extract_selection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    nest_clips_parser = subparsers.add_parser(
        "nest-clips", help="Nest the currently-selected clips into a new nested sequence (select clips first)"
    )
    nest_clips_parser.add_argument("--name", required=True, help="Name for the new nested sequence")
    nest_clips_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    freeze_frame_parser = subparsers.add_parser(
        "freeze-frame", help="Export a still from a clip and import it as a project item (mirrors the reference tool; does not place a frozen clip on the timeline)"
    )
    freeze_frame_parser.add_argument("--track-type", choices=["video", "audio"], help="Track type the clip is on (default: video)")
    freeze_frame_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    freeze_frame_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    freeze_frame_parser.add_argument("--at-seconds", type=float, help="Sequence-time position to freeze (default: the clip's own start time)")
    freeze_frame_parser.add_argument("--output-path", required=True, help="Full path for the exported still frame")
    freeze_frame_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    match_frame_parser = subparsers.add_parser(
        "match-frame", help="Find the source clip/time at a sequence position and open it in the Source Monitor"
    )
    match_frame_parser.add_argument("--track-type", choices=["video", "audio"], help="Track type to search (default: video)")
    match_frame_parser.add_argument("--track-index", type=int, help="0-based index of the track (default: 0)")
    match_frame_parser.add_argument("--seconds", type=float, help="Sequence-time position to match (default: the sequence's own playhead)")
    match_frame_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    add_adjustment_layer_parser = subparsers.add_parser(
        "add-adjustment-layer", help="Create an adjustment layer project item (QE) and place it on a video track"
    )
    add_adjustment_layer_parser.add_argument("--track-index", type=int, help="0-based index of the video track (default: 0)")
    add_adjustment_layer_parser.add_argument("--start-seconds", type=float, help="Timeline position to place the layer at (default: 0)")
    add_adjustment_layer_parser.add_argument("--duration-seconds", type=float, help="Requested duration in seconds (not currently applied — see command docs)")
    add_adjustment_layer_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    unnest_sequence_parser = subparsers.add_parser(
        "unnest-sequence", help="Replace a nested-sequence clip on the timeline with copies of its own clips"
    )
    unnest_sequence_parser.add_argument("--node-id", required=True, help="Node ID of the nested-sequence clip on the timeline")
    unnest_sequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    import_media_parser = subparsers.add_parser(
        "import-media", help="Import one or more media files into the project (safe-extension allowlist only)"
    )
    import_media_group = import_media_parser.add_mutually_exclusive_group(required=True)
    import_media_group.add_argument("--file-path", help="Single file path to import")
    import_media_group.add_argument("--file-paths", help="JSON array string of file paths to import")
    import_media_parser.add_argument(
        "--target-bin-path", help="'/'-separated bin path to import into (must already exist; default: project root)"
    )

    import_folder_parser = subparsers.add_parser(
        "import-folder", help="Import every safe-extension file in a folder into the project"
    )
    import_folder_parser.add_argument("--folder-path", required=True, help="Path to the folder to import")
    import_folder_parser.add_argument(
        "--target-bin-path", help="'/'-separated bin path to import into (must already exist; default: project root)"
    )

    import_image_sequence_parser = subparsers.add_parser(
        "import-image-sequence", help="Import a numbered image sequence as a single clip"
    )
    import_image_sequence_parser.add_argument(
        "--first-frame-path", required=True, help="Path to the first image in the sequence (e.g. /path/to/frame_001.png)"
    )
    import_image_sequence_parser.add_argument(
        "--target-bin-path", help="'/'-separated bin path to import into (must already exist; default: project root)"
    )

    create_bin_parser = subparsers.add_parser(
        "create-bin", help="Create a bin (and any missing parent bins) at a '/'-separated path"
    )
    create_bin_parser.add_argument("--bin-path", required=True, help="'/'-separated bin path, e.g. 'B-Roll/Interviews'")

    rename_bin_parser = subparsers.add_parser("rename-bin", help="Rename an existing bin")
    rename_bin_parser.add_argument("--bin-path", required=True, help="'/'-separated path to the existing bin")
    rename_bin_parser.add_argument("--new-name", required=True, help="New name for the bin")

    move_items_to_bin_parser = subparsers.add_parser(
        "move-items-to-bin", help="Move one or more project items to a target bin (merges the reference project's single/multi-item move tools)"
    )
    move_items_to_bin_id_group = move_items_to_bin_parser.add_mutually_exclusive_group(required=True)
    move_items_to_bin_id_group.add_argument("--node-ids", help="JSON array string of node IDs to move")
    move_items_to_bin_id_group.add_argument("--node-id", help="Single node ID to move")
    move_items_to_bin_id_group.add_argument("--name", help="Single exact item name to move")
    move_items_to_bin_parser.add_argument(
        "--target-bin-path", required=True, help="'/'-separated bin path to move into (must already exist — call create-bin first)"
    )

    relink_media_parser = subparsers.add_parser("relink-media", help="Relink an offline (or online) media item to a new file path")
    relink_media_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    relink_media_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    relink_media_parser.add_argument("--new-path", required=True, help="New file path for the media")

    refresh_media_parser = subparsers.add_parser("refresh-media", help="Refresh a project item to pick up changes to its source file")
    refresh_media_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    refresh_media_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")

    set_item_offline_parser = subparsers.add_parser(
        "set-item-offline", help="Destructive-ish: set a project item to offline status (unlinks its media)"
    )
    set_item_offline_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_item_offline_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")

    detach_proxy_parser = subparsers.add_parser("detach-proxy", help="Detach the proxy attached to a project item")
    detach_proxy_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    detach_proxy_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")

    set_override_frame_rate_parser = subparsers.add_parser(
        "set-override-frame-rate", help="Override a project item's interpreted frame rate"
    )
    set_override_frame_rate_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_override_frame_rate_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    set_override_frame_rate_parser.add_argument("--fps", type=float, required=True, help="Frame rate to set, e.g. 23.976, 24, 29.97, 30, 60")

    set_override_par_parser = subparsers.add_parser(
        "set-override-pixel-aspect-ratio", help="Override a project item's interpreted pixel aspect ratio"
    )
    set_override_par_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_override_par_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    set_override_par_parser.add_argument("--numerator", type=float, required=True, help="PAR numerator (e.g. 1 for square pixels)")
    set_override_par_parser.add_argument("--denominator", type=float, required=True, help="PAR denominator (e.g. 1 for square pixels)")

    set_scale_to_frame_size_parser = subparsers.add_parser(
        "set-scale-to-frame-size", help="Enable 'Scale to Frame Size' on a project item"
    )
    set_scale_to_frame_size_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_scale_to_frame_size_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")

    set_item_start_time_parser = subparsers.add_parser(
        "set-item-start-time", help="Set a project item's start time (source-media timecode offset)"
    )
    set_item_start_time_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    set_item_start_time_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    set_item_start_time_parser.add_argument("--seconds", type=float, required=True, help="Start time in seconds")

    rename_project_item_parser = subparsers.add_parser("rename-project-item", help="Rename a project item")
    rename_project_item_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    rename_project_item_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    rename_project_item_parser.add_argument("--new-name", required=True, help="New name for the item")

    subparsers.add_parser("save-project", help="Save the currently open project (not yet live-tested)")

    save_project_as_parser = subparsers.add_parser(
        "save-project-as",
        help="Save the currently open project to a new path — switches the open project to that new file (not yet live-tested)",
    )
    save_project_as_parser.add_argument("--path", required=True, help="Absolute path to save the project to")

    open_project_parser = subparsers.add_parser(
        "open-project", help="Open a Premiere Pro project file (WARNING: may pop dialogs; not yet live-tested)"
    )
    open_project_parser.add_argument("--path", required=True, help="Absolute path to the .prproj file to open")

    set_active_sequence_parser = subparsers.add_parser(
        "set-active-sequence", help="Make a specific sequence the active one (not yet live-tested)"
    )
    set_active_sequence_parser.add_argument("--sequence-name", required=True, help="Exact name of the sequence to activate")

    find_items_by_media_path_parser = subparsers.add_parser(
        "find-items-by-media-path", help="Find project items whose media path contains a given substring"
    )
    find_items_by_media_path_parser.add_argument(
        "--path-contains", required=True, help="Case-insensitive substring to match against each item's media path"
    )

    create_smart_bin_parser = subparsers.add_parser(
        "create-smart-bin", help="Create a smart (search) bin in the project panel (not yet live-tested)"
    )
    create_smart_bin_parser.add_argument("--name", required=True, help="Name for the smart bin")
    create_smart_bin_parser.add_argument("--query", required=True, help="Search query for the smart bin (Premiere's own search-bin query syntax)")

    add_custom_metadata_field_parser = subparsers.add_parser(
        "add-custom-metadata-field",
        help="Add a project-wide custom metadata field to the schema (NOT removable from script; not yet live-tested)",
    )
    add_custom_metadata_field_parser.add_argument("--name", required=True, help="Internal name for the metadata field")
    add_custom_metadata_field_parser.add_argument("--label", help="Display label for the field (default: same as --name)")
    add_custom_metadata_field_parser.add_argument(
        "--type", type=int, choices=[0, 1, 2, 3], default=2,
        help="Field type: 0 = Integer, 1 = Real, 2 = String (default), 3 = Boolean",
    )

    import_sequences_parser = subparsers.add_parser(
        "import-sequences-from-project", help="Import sequences from another Premiere Pro project file (not yet live-tested)"
    )
    import_sequences_parser.add_argument("--project-path", required=True, help="Absolute path to the source .prproj file")
    import_sequences_parser.add_argument(
        "--sequence-ids", help='JSON array of sequence IDs to import, e.g. \'["id1","id2"]\' (default: all sequences)'
    )

    import_fcp_xml_parser = subparsers.add_parser(
        "import-fcp-xml", help="Import a Final Cut Pro XML file into the project (WARNING: may pop dialogs; not yet live-tested)"
    )
    import_fcp_xml_parser.add_argument("--xml-path", required=True, help="Absolute path to the FCP XML file")

    import_ae_comps_parser = subparsers.add_parser(
        "import-ae-comps", help="Import After Effects compositions from an .aep file (WARNING: may pop dialogs; not yet live-tested)"
    )
    import_ae_comps_parser.add_argument("--aep-path", required=True, help="Absolute path to the .aep file")
    import_ae_comps_parser.add_argument(
        "--comp-names", help='JSON array of composition names to import, e.g. \'["Comp 1","Comp 2"]\' (default: all comps)'
    )
    import_ae_comps_parser.add_argument(
        "--target-bin-path", help="'/'-separated bin path to import into (must already exist; default: project root)"
    )

    create_bars_and_tone_parser = subparsers.add_parser(
        "create-bars-and-tone", help="Create a Bars and Tone synthetic media item (not yet live-tested)"
    )
    create_bars_and_tone_parser.add_argument("--width", type=int, help="Frame width in pixels (default: 1920)")
    create_bars_and_tone_parser.add_argument("--height", type=int, help="Frame height in pixels (default: 1080)")
    create_bars_and_tone_parser.add_argument("--name", help="Name for the item (default: 'Bars and Tone')")

    set_transcode_on_ingest_parser = subparsers.add_parser(
        "set-transcode-on-ingest",
        help="Enable or disable transcode-on-ingest for the project (API presence unconfirmed; not yet live-tested)",
    )
    set_transcode_on_ingest_parser.add_argument(
        "--enabled", required=True, choices=["true", "false"], help="Whether transcode-on-ingest should be enabled"
    )

    set_project_panel_metadata_parser = subparsers.add_parser(
        "set-project-panel-metadata",
        help="REPLACE the Project panel's column/metadata configuration from XML (not a merge; not yet live-tested)",
    )
    set_project_panel_metadata_parser.add_argument(
        "--metadata", required=True, help="Complete Project panel metadata configuration as an XML string"
    )

    subparsers.add_parser(
        "get-graphics-white-luminance", help="Get the project's HDR graphics white luminance value, in nits"
    )

    set_graphics_white_luminance_parser = subparsers.add_parser(
        "set-graphics-white-luminance", help="Set the project's HDR graphics white luminance value, in nits (not yet live-tested)"
    )
    set_graphics_white_luminance_parser.add_argument("--value", type=float, required=True, help="White luminance value in nits")

    duplicate_sequence_parser = subparsers.add_parser(
        "duplicate-sequence", help="Duplicate a sequence via seq.clone(), then rename the copy"
    )
    duplicate_sequence_parser.add_argument("--new-name", required=True, help="Name for the duplicated sequence")
    duplicate_sequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to duplicate (default: the currently active sequence)"
    )

    set_sequence_settings_parser = subparsers.add_parser(
        "set-sequence-settings",
        help="Set one or more sequence settings (frame rate, resolution, audio sample rate, pixel aspect ratio, field type, display format) — merges 7 reference tools into one command",
    )
    set_sequence_settings_parser.add_argument("--frame-rate", type=float, help="New frame rate in fps (e.g. 25, 23.976)")
    set_sequence_settings_parser.add_argument("--width", type=int, help="New frame width in pixels")
    set_sequence_settings_parser.add_argument("--height", type=int, help="New frame height in pixels")
    set_sequence_settings_parser.add_argument("--audio-sample-rate", type=int, help="New audio sample rate (e.g. 48000)")
    set_sequence_settings_parser.add_argument("--par-numerator", type=float, help="Pixel aspect ratio numerator (requires --par-denominator)")
    set_sequence_settings_parser.add_argument("--par-denominator", type=float, help="Pixel aspect ratio denominator (requires --par-numerator)")
    set_sequence_settings_parser.add_argument("--field-type", type=int, help="Field order: 0=Progressive, 1=Upper Field First, 2=Lower Field First")
    set_sequence_settings_parser.add_argument("--display-format", type=int, help="Video timecode display format (raw int — see reference docs)")
    set_sequence_settings_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    create_subsequence_parser = subparsers.add_parser(
        "create-subsequence", help="Create a subsequence via seq.createSubsequence() (does not enforce or rename — see nest-clips for that)"
    )
    create_subsequence_parser.add_argument(
        "--ignore-track-targeting", required=True, choices=["true", "false"], help="Whether to ignore track targeting when nesting"
    )
    create_subsequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to nest (default: the currently active sequence)"
    )

    auto_reframe_sequence_parser = subparsers.add_parser(
        "auto-reframe-sequence", help="Auto-reframe a sequence to a new aspect ratio via seq.autoReframeSequence()"
    )
    auto_reframe_sequence_parser.add_argument("--numerator", type=float, required=True, help="Target aspect ratio numerator")
    auto_reframe_sequence_parser.add_argument("--denominator", type=float, required=True, help="Target aspect ratio denominator")
    auto_reframe_sequence_parser.add_argument(
        "--motion-preset", required=True, choices=["slower", "default", "faster"], help="Auto-reframe motion preset"
    )
    auto_reframe_sequence_parser.add_argument("--new-name", required=True, help="Name for the new reframed sequence")
    auto_reframe_sequence_parser.add_argument(
        "--nest", required=True, choices=["true", "false"], help="Whether to nest the original sequence inside the new one"
    )
    auto_reframe_sequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to reframe (default: the currently active sequence)"
    )

    create_sequence_from_preset_parser = subparsers.add_parser(
        "create-sequence-from-preset", help="Create a new sequence from a caller-supplied .sqpreset file (QE, no dialog)"
    )
    create_sequence_from_preset_parser.add_argument("--name", required=True, help="Name for the new sequence")
    create_sequence_from_preset_parser.add_argument("--preset-path", required=True, help="Full path to the .sqpreset file")

    create_sequence_from_clips_parser = subparsers.add_parser(
        "create-sequence-from-clips", help="Create a new sequence by placing project items in order"
    )
    create_sequence_from_clips_parser.add_argument("--name", required=True, help="Name for the new sequence")
    create_sequence_from_clips_parser.add_argument(
        "--node-ids", required=True, help="JSON array of project item nodeIds to include, in order, e.g. '[\"1\",\"2\"]'"
    )
    create_sequence_from_clips_parser.add_argument(
        "--target-bin-path", help="'/'-separated bin path to place the new sequence in (must already exist — not auto-created)"
    )

    attach_custom_property_parser = subparsers.add_parser(
        "attach-custom-property", help="Attach a custom key/value property to a sequence (no confirmed read-back API)"
    )
    attach_custom_property_parser.add_argument("--property-id", required=True, help="Unique identifier for the custom property")
    attach_custom_property_parser.add_argument("--value", required=True, help="Value for the custom property")
    attach_custom_property_parser.add_argument(
        "--sequence-name", help="Name of the sequence to attach to (default: the currently active sequence)"
    )

    close_sequence_parser = subparsers.add_parser(
        "close-sequence", help="Close a sequence's UI tab via seq.close() (does not delete the sequence from the project)"
    )
    close_sequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to close (default: the currently active sequence)"
    )

    export_sequence_as_project_parser = subparsers.add_parser(
        "export-sequence-as-project", help="Export a sequence as a standalone .prproj file via seq.exportAsProject()"
    )
    export_sequence_as_project_parser.add_argument("--output-path", required=True, help="Full path for the exported .prproj file")
    export_sequence_as_project_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export (default: the currently active sequence)"
    )

    scene_edit_detection_parser = subparsers.add_parser(
        "scene-edit-detection", help="Run scene edit detection on the current SELECTION via seq.performSceneEditDetectionOnSelection()"
    )
    scene_edit_detection_parser.add_argument("--mode", required=True, choices=["ApplyCuts", "CreateMarkers"], help="What to do with detected scene changes")
    scene_edit_detection_parser.add_argument(
        "--apply-to-linked-audio", required=True, choices=["true", "false"], help="Whether to also apply to linked audio"
    )
    scene_edit_detection_parser.add_argument("--sensitivity", required=True, choices=["Low", "Medium", "High"], help="Detection sensitivity")
    scene_edit_detection_parser.add_argument(
        "--sequence-name", help="Name of the sequence to run detection on (default: the currently active sequence)"
    )

    # --- Export & encoding (wave 6) ---

    export_sequence_parser = subparsers.add_parser(
        "export-sequence", help="Export a sequence to a local file via a blocking exportAsMediaDirect() call"
    )
    export_sequence_parser.add_argument("--output", required=True, help="Absolute path to write the exported file to")
    export_sequence_parser.add_argument("--preset-path", required=True, help="Absolute path to an export preset (.epr)")
    export_sequence_parser.add_argument(
        "--range", choices=["entire", "in-to-out", "work-area"], default=None,
        help="Export range (default: entire)",
    )
    export_sequence_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export (default: the currently active sequence)"
    )

    export_fcp_xml_parser = subparsers.add_parser(
        "export-fcp-xml", help="Export a sequence as a Final Cut Pro XML file"
    )
    export_fcp_xml_parser.add_argument("--output", required=True, help="Absolute path to write the exported XML to")
    export_fcp_xml_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export (default: the currently active sequence)"
    )

    export_aaf_parser = subparsers.add_parser(
        "export-aaf", help="Export a sequence as an AAF file (for Pro Tools, etc.)"
    )
    export_aaf_parser.add_argument("--output", required=True, help="Absolute path to write the exported AAF to")
    export_aaf_parser.add_argument(
        "--mixdown", choices=["true", "false"], default=None, help="Mix down video to a single track (default: true)"
    )
    export_aaf_parser.add_argument(
        "--mono", choices=["true", "false"], default=None, help="Explode multichannel audio to mono (default: false)"
    )
    export_aaf_parser.add_argument("--rate", type=int, help="Audio sample rate (default: 48000)")
    export_aaf_parser.add_argument("--bits", type=int, help="Audio bit depth (default: 16)")
    export_aaf_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export (default: the currently active sequence)"
    )

    export_omf_parser = subparsers.add_parser(
        "export-omf", help="Export a sequence as an OMF file (Open Media Framework, for audio post-production)"
    )
    export_omf_parser.add_argument("--output", required=True, help="Absolute path to write the exported OMF to")
    export_omf_parser.add_argument("--title", help="OMF title (default: 'OMFTitle')")
    export_omf_parser.add_argument("--rate", type=int, help="Audio sample rate (default: 48000)")
    export_omf_parser.add_argument("--bits", type=int, help="Audio bit depth (default: 16)")
    export_omf_parser.add_argument(
        "--audio-encapsulated", choices=["true", "false"], default=None,
        help="Embed audio in the OMF (true) or reference external files (false) (default: true)",
    )
    export_omf_parser.add_argument(
        "--audio-file-format", type=int, help="Audio format: 0=AIFF, 1=WAV (default: 1)"
    )
    export_omf_parser.add_argument(
        "--trim-audio-files", choices=["true", "false"], default=None,
        help="Trim audio to the used range plus handles (default: true)",
    )
    export_omf_parser.add_argument("--handle-frames", type=int, help="Handle length in frames when trimming (default: 1000)")
    export_omf_parser.add_argument(
        "--sequence-name", help="Name of the sequence to export (default: the currently active sequence)"
    )

    add_to_render_queue_parser = subparsers.add_parser(
        "add-to-render-queue",
        help="Queue a sequence for export in Adobe Media Encoder (fire-and-forget, no progress API)",
    )
    add_to_render_queue_parser.add_argument("--output", required=True, help="Absolute path for the rendered output file")
    add_to_render_queue_parser.add_argument("--preset-path", required=True, help="Absolute path to an export preset (.epr)")
    add_to_render_queue_parser.add_argument(
        "--range", choices=["entire", "in-to-out", "work-area"], default=None,
        help="Export range (default: entire)",
    )
    add_to_render_queue_parser.add_argument(
        "--sequence-name", help="Name of the sequence to queue (default: the currently active sequence)"
    )
    add_to_render_queue_parser.add_argument(
        "--start-batch", choices=["true", "false"], default=None,
        help="Start the Adobe Media Encoder batch immediately (default: false — queues only)",
    )

    create_subclip_parser = subparsers.add_parser(
        "create-subclip", help="Create a subclip project item from a source item's in/out range"
    )
    create_subclip_parser.add_argument("--node-id", help="Node ID of the source project item (one of --node-id/--item-name is required)")
    create_subclip_parser.add_argument("--item-name", help="Exact name of the source project item (one of --node-id/--item-name is required)")
    create_subclip_parser.add_argument("--subclip-name", required=True, help="Name for the new subclip")
    create_subclip_parser.add_argument("--in-seconds", type=float, required=True, help="In-point in seconds")
    create_subclip_parser.add_argument("--out-seconds", type=float, required=True, help="Out-point in seconds")
    create_subclip_parser.add_argument(
        "--take-video", choices=["true", "false"], default=None, help="Include video in the subclip (default: true)"
    )
    create_subclip_parser.add_argument(
        "--take-audio", choices=["true", "false"], default=None, help="Include audio in the subclip (default: true)"
    )

    encode_project_item_parser = subparsers.add_parser(
        "encode-project-item",
        help="Queue a project item (not a sequence) for export in Adobe Media Encoder (fire-and-forget)",
    )
    encode_project_item_parser.add_argument("--node-id", help="Node ID of the project item (one of --node-id/--name is required)")
    encode_project_item_parser.add_argument("--name", help="Exact name of the project item (one of --node-id/--name is required)")
    encode_project_item_parser.add_argument("--output", required=True, help="Absolute path for the rendered output file")
    encode_project_item_parser.add_argument("--preset-path", required=True, help="Absolute path to an export preset (.epr)")
    encode_project_item_parser.add_argument(
        "--start-batch", choices=["true", "false"], default=None,
        help="Start the Adobe Media Encoder batch immediately (default: false — queues only)",
    )

    encode_file_parser = subparsers.add_parser(
        "encode-file", help="Queue an external file (not in the project) for export in Adobe Media Encoder (fire-and-forget)"
    )
    encode_file_parser.add_argument("--input", required=True, help="Absolute path to the input file")
    encode_file_parser.add_argument("--output", required=True, help="Absolute path for the rendered output file")
    encode_file_parser.add_argument("--preset-path", required=True, help="Absolute path to an export preset (.epr)")
    encode_file_parser.add_argument(
        "--start-batch", choices=["true", "false"], default=None,
        help="Start the Adobe Media Encoder batch immediately (default: false — queues only)",
    )

    manage_proxies_parser = subparsers.add_parser(
        "manage-proxies", help="Attach a proxy file to a project item, or enable/disable proxy playback project-wide"
    )
    manage_proxies_parser.add_argument("--action", required=True, choices=["attach", "enable", "disable"], help="Action to perform")
    manage_proxies_parser.add_argument("--node-id", help="Node ID of the project item (attach only; one of --node-id/--name required)")
    manage_proxies_parser.add_argument("--name", help="Exact name of the project item (attach only; one of --node-id/--name required)")
    manage_proxies_parser.add_argument("--proxy-path", help="Path to an existing, already-rendered proxy file (required for attach)")
    manage_proxies_parser.add_argument(
        "--is-hi-res", choices=["true", "false"], default=None, help="Whether the proxy is a hi-res proxy (default: false)"
    )

    open_in_source_parser = subparsers.add_parser(
        "open-in-source", help="Open a project item in the Source Monitor"
    )
    open_in_source_parser.add_argument("--node-id", help="Node ID of the project item to open (either this or --name is required)")
    open_in_source_parser.add_argument("--name", help="Exact name of the project item to open (either this or --node-id is required)")

    close_source_monitor_parser = subparsers.add_parser(
        "close-source-monitor", help="Close the clip currently open in the Source Monitor"
    )

    close_all_source_clips_parser = subparsers.add_parser(
        "close-all-source-clips", help="Close all clips open in the Source Monitor"
    )

    set_source_in_out_parser = subparsers.add_parser(
        "set-source-in-out", help="Set in/out points on the clip open in the Source Monitor"
    )
    set_source_in_out_parser.add_argument("--in-seconds", type=float, help="New in point, in seconds")
    set_source_in_out_parser.add_argument("--out-seconds", type=float, help="New out point, in seconds")

    insert_from_source_parser = subparsers.add_parser(
        "insert-from-source", help="Insert the Source Monitor's clip at the playhead (ripple)"
    )
    insert_from_source_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Target track type")
    insert_from_source_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the target track")
    insert_from_source_parser.add_argument("--at-seconds", type=float, help="Sequence position to insert at (default: the sequence's own playhead)")
    insert_from_source_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    overwrite_from_source_parser = subparsers.add_parser(
        "overwrite-from-source", help="Overwrite the Source Monitor's clip at the playhead (destructive)"
    )
    overwrite_from_source_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Target track type")
    overwrite_from_source_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the target track")
    overwrite_from_source_parser.add_argument("--at-seconds", type=float, help="Sequence position to overwrite at (default: the sequence's own playhead)")
    overwrite_from_source_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    add_text_overlay_parser = subparsers.add_parser(
        "add-text-overlay", help="Add a subtitle-style text overlay via the Captions API (no title-creation API exists)"
    )
    add_text_overlay_parser.add_argument("--text", required=True, help="Text content to display")
    add_text_overlay_parser.add_argument("--start-seconds", type=float, help="Start time in seconds (default: 0)")
    add_text_overlay_parser.add_argument("--duration-seconds", type=float, help="Duration in seconds (default: 5)")
    add_text_overlay_parser.add_argument(
        "--caption-format", choices=["subtitle", "608", "708", "teletext"], help="Caption format (default: subtitle)"
    )

    import_mogrt_parser = subparsers.add_parser(
        "import-mogrt", help="Import a .mogrt file directly onto the timeline"
    )
    import_mogrt_parser.add_argument("--mogrt-path", required=True, help="Full path to the .mogrt file")
    import_mogrt_parser.add_argument("--start-seconds", type=float, required=True, help="Start time on the timeline, in seconds")
    import_mogrt_parser.add_argument("--video-track-index", type=int, required=True, help="0-based video track index")
    import_mogrt_parser.add_argument("--audio-track-index", type=int, required=True, help="0-based audio track index")
    import_mogrt_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    import_mogrt_from_library_parser = subparsers.add_parser(
        "import-mogrt-from-library", help="Import a MOGRT from an Adobe Library by name"
    )
    import_mogrt_from_library_parser.add_argument("--library-name", required=True, help="Name of the Adobe Library containing the MOGRT")
    import_mogrt_from_library_parser.add_argument("--mogrt-name", required=True, help="Name of the MOGRT within the library")
    import_mogrt_from_library_parser.add_argument("--start-seconds", type=float, required=True, help="Start time on the timeline, in seconds")
    import_mogrt_from_library_parser.add_argument("--video-track-index", type=int, required=True, help="0-based video track index")
    import_mogrt_from_library_parser.add_argument("--audio-track-index", type=int, required=True, help="0-based audio track index")
    import_mogrt_from_library_parser.add_argument(
        "--sequence-name", help="Name of the sequence to edit (default: the currently active sequence)"
    )

    get_mogrt_component_parser = subparsers.add_parser(
        "get-mogrt-component", help="Read a MOGRT clip's component parameters"
    )
    get_mogrt_component_parser.add_argument("--track-type", required=True, choices=["video", "audio"], help="Track type the clip is on")
    get_mogrt_component_parser.add_argument("--track-index", type=int, required=True, help="0-based index of the track")
    get_mogrt_component_parser.add_argument("--clip-index", type=int, required=True, help="0-based index of the clip on that track")
    get_mogrt_component_parser.add_argument(
        "--sequence-name", help="Name of the sequence to read (default: the currently active sequence)"
    )

    create_caption_track_parser = subparsers.add_parser(
        "create-caption-track", help="Create a caption/subtitle track from an imported caption project item (e.g. .srt)"
    )
    create_caption_track_parser.add_argument("--node-id", help="Node ID of the caption project item (either this or --name is required)")
    create_caption_track_parser.add_argument("--name", help="Exact name of the caption project item (either this or --node-id is required)")
    create_caption_track_parser.add_argument("--start-seconds", type=float, required=True, help="Offset in seconds from the start of the sequence")
    create_caption_track_parser.add_argument(
        "--format", choices=["subtitle", "608", "708", "teletext", "ebu", "op42", "op47"], help="Caption format (default: subtitle)"
    )

    replace_clip_media_parser = subparsers.add_parser(
        "replace-clip-media", help="Destructive-ish: swap a project item's underlying media file"
    )
    replace_clip_media_parser.add_argument("--node-id", help="Node ID of the project item (either this or --name is required)")
    replace_clip_media_parser.add_argument("--name", help="Exact name of the project item (either this or --node-id is required)")
    replace_clip_media_parser.add_argument("--new-media-path", required=True, help="Full path to the replacement media file")

    args = parser.parse_args()

    # Local setup subcommands — handled entirely in Python, never sent to the
    # panel's /command endpoint.
    if args.subcommand == "install-panel":
        from premiere_cli import panel_install

        sys.exit(panel_install.install_panel(symlink=args.symlink))
    if args.subcommand == "doctor":
        from premiere_cli import panel_install

        sys.exit(panel_install.doctor(port=args.port))
    if args.subcommand == "init-project":
        from premiere_cli import init_project

        sys.exit(init_project.init_project(args.project_name, args.series, args.base_dir))
    if args.subcommand == "desktop-set-input-lut":
        if platform.system() != "Darwin":
            print(
                json.dumps({"ok": False, "error": "desktop-set-input-lut is macOS only (drives the native Accessibility API)"}),
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            from premiere_cli import desktop_driver
        except ImportError as exc:
            print(
                json.dumps({
                    "ok": False,
                    "error": f"missing the macOS desktop-driver extra ({exc}) — install with: "
                             "pip install 'premiere-cli[macos-desktop]'",
                }),
                file=sys.stderr,
            )
            sys.exit(1)
        sys.exit(desktop_driver.set_input_lut(args.path, port=args.port))

    if args.subcommand == "create-sequence":
        command_args = {"name": args.name, "bin": args.bin, "fps": args.fps, "width": args.width, "height": args.height}
    elif args.subcommand == "extract-audio-track":
        if (args.start_seconds is None) != (args.end_seconds is None):
            parser.error("--start-seconds and --end-seconds must be given together, or not at all")
        command_args = {
            "outputPath": args.output,
            "audioTrackIndex": args.audio_track_index,
            "sequenceName": args.sequence_name,
            "startSeconds": args.start_seconds,
            "endSeconds": args.end_seconds,
            "format": args.format,
            "presetPath": args.preset_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-track-intervals":
        try:
            intervals = _parse_intervals_file(args.intervals_file)
        except (OSError, ValueError) as exc:
            parser.error(str(exc))
        if not intervals:
            parser.error(f"no intervals found in {args.intervals_file}")
        command_args = {
            "sequenceName": args.sequence_name,
            "audioTrackIndex": args.audio_track_index,
            "videoTrackIndices": args.video_track_index or [],
            "intervals": intervals,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-frame":
        command_args = {
            "outputPath": args.output,
            "timecode": args.timecode,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "move-playhead":
        if (args.timecode is None) == (args.seconds is None):
            parser.error("exactly one of --timecode or --seconds is required")
        command_args = {
            "timecode": args.timecode,
            "seconds": args.seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "search-project-items":
        if not any([args.name_contains, args.extension, args.offline_only, args.color_label is not None]):
            parser.error("at least one of --name-contains, --extension, --offline-only, --color-label is required")
        command_args = {
            "nameContains": args.name_contains,
            "extension": args.extension,
            "colorLabel": args.color_label,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
        if args.offline_only:
            command_args["offlineOnly"] = True
    elif args.subcommand == "get-full-sequence-info":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-full-clip-info":
        command_args = {
            "sequenceName": args.sequence_name,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-timeline-summary":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "debug-qe-try-mutate":
        command_args = {"sequenceName": args.sequence_name, "skipRemoveTest": args.skip_remove_test}
    elif args.subcommand == "inspect-dom-object":
        command_args = {"expression": args.expression}
    elif args.subcommand == "set-active-project":
        if not args.name and not args.path:
            parser.error("at least one of --name, --path is required")
        command_args = {"name": args.name, "path": args.path}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-work-area":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-work-area":
        command_args = {
            "startSeconds": args.start_seconds,
            "endSeconds": args.end_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-sequence-in-out":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-sequence-in-out":
        command_args = {
            "inSeconds": args.in_seconds,
            "outSeconds": args.out_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "is-work-area-enabled":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-export-file-extension":
        command_args = {"presetPath": args.preset_path, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-workspace":
        command_args = {"name": args.name}
    elif args.subcommand == "play-source-monitor":
        command_args = {"speed": args.speed}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-bin-contents":
        command_args = {"binPath": args.bin_path}
    elif args.subcommand == "get-project-item-info":
        if not args.node_id and not args.tree_path:
            parser.error("at least one of --node-id, --tree-path is required")
        command_args = {"nodeId": args.node_id, "treePath": args.tree_path}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-timeline-gaps":
        command_args = {
            "sequenceName": args.sequence_name,
            "trackType": args.track_type,
            "minGapSeconds": args.min_gap_seconds,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-used-media-report":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-links":
        command_args = {
            "sequenceName": args.sequence_name,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "list-markers":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-markers":
        command_args = {
            "sequenceName": args.sequence_name,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-sequence-markers-by-type":
        command_args = {"type": args.type, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand in (
        "get-item-metadata",
        "get-color-label",
        "get-footage-interpretation",
        "get-xmp-metadata",
        "get-color-space",
    ):
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-at-position":
        if args.track_index is not None and args.track_type is None:
            parser.error("--track-index requires --track-type")
        command_args = {
            "seconds": args.seconds,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-at-playhead":
        command_args = {"trackType": args.track_type, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-next-edit-point":
        command_args = {
            "direction": args.direction,
            "trackType": args.track_type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-total-clip-count":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-target-tracks":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-track-info":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-encoder-presets":
        command_args = {"format": args.format}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-qe-clip-info":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-adjustment-layer":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-marker":
        command_args = {
            "seconds": args.seconds,
            "name": args.name,
            "comments": args.comments,
            "type": args.type,
            "durationSeconds": args.duration_seconds,
            "colorIndex": args.color_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "update-marker":
        command_args = {
            "guid": args.guid,
            "name": args.name,
            "comments": args.comments,
            "type": args.type,
            "colorIndex": args.color_index,
            "durationSeconds": args.duration_seconds,
            "endSeconds": args.end_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "delete-marker":
        if not args.guid and not args.marker_name:
            parser.error("one of --guid, --marker-name is required")
        command_args = {
            "guid": args.guid,
            "markerName": args.marker_name,
            "sequenceName": args.sequence_name,
            "nodeId": args.node_id,
            "itemName": args.item_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-marker-to-project-item":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "seconds": args.seconds,
            "markerName": args.marker_name,
            "comments": args.comments,
            "type": args.type,
            "durationSeconds": args.duration_seconds,
            "colorIndex": args.color_index,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "undo":
        command_args = {"count": args.count}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "move-playhead-to-edit":
        command_args = {"direction": args.direction, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-poster-frame":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name, "seconds": args.seconds}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-project-item":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-clips-by-name":
        command_args = {
            "nameContains": args.name_contains,
            "addToSelection": args.add_to_selection,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-all-clips":
        command_args = {"trackType": args.track_type, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "deselect-all-clips":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-clips-in-range":
        command_args = {
            "startSeconds": args.start_seconds,
            "endSeconds": args.end_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-clips-by-color":
        command_args = {"colorLabel": args.color_label, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "invert-selection":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "select-disabled-clips":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-selection":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "selected": args.selected,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-track":
        command_args = {
            "trackType": args.track_type,
            "index": args.index,
            "count": args.count,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "lock-track":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "locked": args.locked == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-track-visibility":
        command_args = {
            "trackType": "video",
            "trackIndex": args.track_index,
            "visible": args.visible == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-track-mute":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "muted": args.muted == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "rename-track":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "name": args.name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-target-track":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "targeted": args.targeted == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-all-tracks-targeted":
        command_args = {
            "targeted": args.targeted == "true",
            "trackType": args.track_type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-position":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "x": args.x,
            "y": args.y,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-scale":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "scale": args.scale,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-rotation":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "degrees": args.degrees,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-anchor-point":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "x": args.x,
            "y": args.y,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-opacity":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "opacity": args.opacity,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-uniform-scale":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "uniform": args.uniform == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-scale-width-height":
        if args.scale_width is None and args.scale_height is None:
            parser.error("at least one of --scale-width or --scale-height is required")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "scaleWidth": args.scale_width,
            "scaleHeight": args.scale_height,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-anti-alias-quality":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "amount": args.amount,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-blend-mode":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "blendMode": args.blend_mode,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-volume":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "db": args.db,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-pan":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "pan": args.pan,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "adjust-audio-levels":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "db": args.db,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-audio-keyframes":
        try:
            json.loads(args.keyframes)
        except json.JSONDecodeError as exc:
            parser.error(f"--keyframes is not valid JSON: {exc}")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "keyframes": args.keyframes,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "rename-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "name": args.name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "batch-rename-clips":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "newNameTemplate": args.new_name_template,
            "nameContains": args.name_contains,
            "startNumber": args.start_number,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-enabled":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "enabled": args.enabled == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "batch-set-clips-enabled":
        command_args = {
            "enabled": args.enabled == "true",
            "nameContains": args.name_contains,
            "trackType": args.track_type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-frame-blend":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "enabled": args.enabled == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-time-interpolation":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "type": args.type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-properties":
        if not any([
            args.opacity is not None, args.speed is not None, args.scale is not None,
            args.position_x is not None, args.position_y is not None, args.rotation is not None,
        ]):
            parser.error("at least one of --opacity, --speed, --scale, --position-x, --position-y, --rotation is required")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "opacity": args.opacity,
            "speed": args.speed,
            "scale": args.scale,
            "positionX": args.position_x,
            "positionY": args.position_y,
            "rotation": args.rotation,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-item-metadata":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "fieldPath": args.field_path,
            "value": args.value,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-color-label":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "colorLabel": args.color_label,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-footage-interpretation":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        if (
            args.frame_rate is None
            and args.pixel_aspect_ratio is None
            and args.field_type is None
            and args.alpha_usage is None
        ):
            parser.error("at least one of --frame-rate, --pixel-aspect-ratio, --field-type, --alpha-usage is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "frameRate": args.frame_rate,
            "pixelAspectRatio": args.pixel_aspect_ratio,
            "fieldType": args.field_type,
            "alphaUsage": args.alpha_usage,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-xmp-metadata":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        if not args.xmp and not args.xmp_file:
            parser.error("one of --xmp, --xmp-file is required")
        if args.xmp and args.xmp_file:
            parser.error("only one of --xmp, --xmp-file may be given")
        xmp_value = args.xmp
        if args.xmp_file:
            try:
                with open(args.xmp_file, "r", encoding="utf-8") as fh:
                    xmp_value = fh.read()
            except OSError as exc:
                parser.error(f"could not read --xmp-file {args.xmp_file}: {exc}")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "xmp": xmp_value,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "apply-effect":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "effectName": args.effect_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "apply-audio-effect":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "effectName": args.effect_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-effect":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentIndex": args.component_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-effect-by-name":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "effectName": args.effect_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-all-effects":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "color-correct":
        if not any([
            args.exposure is not None, args.contrast is not None, args.saturation is not None,
            args.temperature is not None, args.tint is not None,
        ]):
            parser.error("at least one of --exposure, --contrast, --saturation, --temperature, --tint is required")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "exposure": args.exposure,
            "contrast": args.contrast,
            "saturation": args.saturation,
            "temperature": args.temperature,
            "tint": args.tint,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "apply-lut":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "lutPath": args.lut_path,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "stabilize-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "smoothness": args.smoothness,
            "method": args.method,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand in ("copy-effects-between-clips", "copy-effect-values"):
        command_args = {
            "sourceSequenceName": args.source_sequence_name,
            "sourceTrackType": args.source_track_type,
            "sourceTrackIndex": args.source_track_index,
            "sourceClipIndex": args.source_clip_index,
            "targetSequenceName": args.target_sequence_name,
            "targetTrackType": args.target_track_type,
            "targetTrackIndex": args.target_track_index,
            "targetClipIndex": args.target_clip_index,
            "effectName": args.effect_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "batch-apply-effect":
        command_args = {
            "effectName": args.effect_name,
            "nameContains": args.name_contains,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-effect-properties":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-effect-property":
        if args.value_type == "number":
            try:
                coerced_value = float(args.value)
            except ValueError:
                parser.error(f"--value {args.value!r} is not a valid number for --value-type number")
        elif args.value_type == "boolean":
            lowered = args.value.strip().lower()
            if lowered not in ("true", "false"):
                parser.error(f"--value {args.value!r} must be 'true' or 'false' for --value-type boolean")
            coerced_value = lowered == "true"
        else:
            coerced_value = args.value
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "value": coerced_value,
            "valueType": args.value_type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-keyframes":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-keyframe":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "seconds": args.seconds,
            "value": args.value,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-keyframe":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "seconds": args.seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-keyframe-range":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "startSeconds": args.start_seconds,
            "endSeconds": args.end_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-keyframe-interpolation":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "seconds": args.seconds,
            "interpolationType": args.interpolation_type,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-value-at-time":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "seconds": args.seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-color-value":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "componentName": args.component_name,
            "propertyName": args.property_name,
            "alpha": args.alpha,
            "red": args.red,
            "green": args.green,
            "blue": args.blue,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-transition":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "atEnd": args.at_end == "true",
            "transitionName": args.transition_name,
            "durationSeconds": args.duration_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "batch-add-transitions":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "atEnd": args.at_end == "true" if args.at_end is not None else None,
            "transitionName": args.transition_name,
            "durationSeconds": args.duration_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-transition":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "transitionIndex": args.transition_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-to-timeline":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "startSeconds": args.start_seconds,
            "mode": args.mode,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-from-timeline":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "ripple": args.ripple == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "move-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "startSeconds": args.start_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "trim-clip":
        if args.in_point_seconds is None and args.out_point_seconds is None:
            parser.error("at least one of --in-point-seconds or --out-point-seconds is required")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "inPointSeconds": args.in_point_seconds,
            "outPointSeconds": args.out_point_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "split-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "seconds": args.seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "duplicate-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "targetStartSeconds": args.target_start_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "replace-clip":
        if not args.replacement_node_id and not args.replacement_name:
            parser.error("either --replacement-node-id or --replacement-name is required")
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "replacementNodeId": args.replacement_node_id,
            "replacementName": args.replacement_name,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-clip-speed":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "speedPercent": args.speed_percent,
            "ripple": args.ripple == "true" if args.ripple is not None else None,
            "maintainAudio": args.maintain_audio == "true" if args.maintain_audio is not None else None,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-clip-speed":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "ripple-delete-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "roll-edit":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "offsetSeconds": args.offset_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "slide-edit":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "offsetSeconds": args.offset_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "slip-edit":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "offsetSeconds": args.offset_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "move-clip-to-track":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "targetTrackIndex": args.target_track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "reverse-clip":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "reverse": (args.reverse == "true") if args.reverse is not None else None,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "link-selection":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "unlink-selection":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "overwrite-clip-at":
        command_args = {
            "itemNodeId": args.item_node_id,
            "itemName": args.item_name,
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "startSeconds": args.start_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "razor-all-tracks":
        command_args = {"seconds": args.seconds, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-item-in-out":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        if args.in_seconds is None and args.out_seconds is None:
            parser.error("at least one of --in-seconds/--out-seconds is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "inSeconds": args.in_seconds,
            "outSeconds": args.out_seconds,
            "mediaType": args.media_type,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "clear-item-in-out":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "clearIn": args.clear_in == "true" if args.clear_in is not None else None,
            "clearOut": args.clear_out == "true" if args.clear_out is not None else None,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "clear-sequence-in-out":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "remove-selected-clips":
        command_args = {
            "ripple": args.ripple == "true" if args.ripple is not None else None,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "lift-selection":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "extract-selection":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "nest-clips":
        command_args = {"name": args.name, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "freeze-frame":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "atSeconds": args.at_seconds,
            "outputPath": args.output_path,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "match-frame":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "seconds": args.seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-adjustment-layer":
        command_args = {
            "trackIndex": args.track_index,
            "startSeconds": args.start_seconds,
            "durationSeconds": args.duration_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "unnest-sequence":
        command_args = {"nodeId": args.node_id, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-media":
        command_args = {
            "filePath": args.file_path,
            "filePaths": args.file_paths,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-folder":
        command_args = {
            "folderPath": args.folder_path,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-image-sequence":
        command_args = {
            "firstFramePath": args.first_frame_path,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-bin":
        command_args = {"binPath": args.bin_path}
    elif args.subcommand == "rename-bin":
        command_args = {"binPath": args.bin_path, "newName": args.new_name}
    elif args.subcommand == "move-items-to-bin":
        command_args = {
            "nodeIds": args.node_ids,
            "nodeId": args.node_id,
            "name": args.name,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "relink-media":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name, "newPath": args.new_path}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "refresh-media":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-item-offline":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "detach-proxy":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-override-frame-rate":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name, "fps": args.fps}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-override-pixel-aspect-ratio":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "numerator": args.numerator,
            "denominator": args.denominator,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-scale-to-frame-size":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-item-start-time":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name, "seconds": args.seconds}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "rename-project-item":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name, "newName": args.new_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "save-project":
        command_args = {}
    elif args.subcommand == "save-project-as":
        command_args = {"path": args.path}
    elif args.subcommand == "open-project":
        command_args = {"path": args.path}
    elif args.subcommand == "set-active-sequence":
        command_args = {"sequenceName": args.sequence_name}
    elif args.subcommand == "find-items-by-media-path":
        command_args = {"pathContains": args.path_contains}
    elif args.subcommand == "create-smart-bin":
        command_args = {"name": args.name, "query": args.query}
    elif args.subcommand == "add-custom-metadata-field":
        command_args = {"name": args.name, "label": args.label, "type": args.type}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-sequences-from-project":
        sequence_ids = None
        if args.sequence_ids is not None:
            try:
                sequence_ids = json.loads(args.sequence_ids)
            except json.JSONDecodeError as exc:
                parser.error(f"--sequence-ids is not valid JSON: {exc}")
            if not isinstance(sequence_ids, list):
                parser.error("--sequence-ids must be a JSON array")
        command_args = {"projectPath": args.project_path, "sequenceIds": sequence_ids}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-fcp-xml":
        command_args = {"xmlPath": args.xml_path}
    elif args.subcommand == "import-ae-comps":
        comp_names = None
        if args.comp_names is not None:
            try:
                comp_names = json.loads(args.comp_names)
            except json.JSONDecodeError as exc:
                parser.error(f"--comp-names is not valid JSON: {exc}")
            if not isinstance(comp_names, list):
                parser.error("--comp-names must be a JSON array")
        command_args = {
            "aepPath": args.aep_path,
            "compNames": comp_names,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-bars-and-tone":
        command_args = {"width": args.width, "height": args.height, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-transcode-on-ingest":
        command_args = {"enabled": args.enabled == "true"}
    elif args.subcommand == "set-project-panel-metadata":
        command_args = {"metadata": args.metadata}
    elif args.subcommand == "get-graphics-white-luminance":
        command_args = {}
    elif args.subcommand == "set-graphics-white-luminance":
        command_args = {"value": args.value}
    elif args.subcommand == "duplicate-sequence":
        command_args = {"newName": args.new_name, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "set-sequence-settings":
        if (args.par_numerator is None) != (args.par_denominator is None):
            parser.error("--par-numerator and --par-denominator must be given together")
        if not any([
            args.frame_rate is not None,
            args.width is not None,
            args.height is not None,
            args.audio_sample_rate is not None,
            args.par_numerator is not None,
            args.field_type is not None,
            args.display_format is not None,
        ]):
            parser.error(
                "at least one of --frame-rate, --width, --height, --audio-sample-rate, "
                "--par-numerator+--par-denominator, --field-type, --display-format is required"
            )
        command_args = {
            "frameRate": args.frame_rate,
            "width": args.width,
            "height": args.height,
            "audioSampleRate": args.audio_sample_rate,
            "parNumerator": args.par_numerator,
            "parDenominator": args.par_denominator,
            "fieldType": args.field_type,
            "displayFormat": args.display_format,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-subsequence":
        command_args = {
            "ignoreTrackTargeting": args.ignore_track_targeting == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "auto-reframe-sequence":
        command_args = {
            "numerator": args.numerator,
            "denominator": args.denominator,
            "motionPreset": args.motion_preset,
            "newName": args.new_name,
            "nest": args.nest == "true",
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-sequence-from-preset":
        command_args = {"name": args.name, "presetPath": args.preset_path}
    elif args.subcommand == "create-sequence-from-clips":
        try:
            node_ids = json.loads(args.node_ids)
        except json.JSONDecodeError as exc:
            parser.error(f"--node-ids is not valid JSON: {exc}")
        if not isinstance(node_ids, list) or not node_ids:
            parser.error("--node-ids must be a non-empty JSON array")
        command_args = {
            "name": args.name,
            "nodeIds": node_ids,
            "targetBinPath": args.target_bin_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "attach-custom-property":
        command_args = {
            "propertyId": args.property_id,
            "value": args.value,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "close-sequence":
        command_args = {"sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-sequence-as-project":
        command_args = {"outputPath": args.output_path, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "scene-edit-detection":
        command_args = {
            "mode": args.mode,
            "applyToLinkedAudio": args.apply_to_linked_audio == "true",
            "sensitivity": args.sensitivity,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-sequence":
        command_args = {
            "outputPath": args.output,
            "presetPath": args.preset_path,
            "range": args.range,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-fcp-xml":
        command_args = {"outputPath": args.output, "sequenceName": args.sequence_name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-aaf":
        command_args = {
            "outputPath": args.output,
            "mixdown": None if args.mixdown is None else args.mixdown == "true",
            "mono": None if args.mono is None else args.mono == "true",
            "rate": args.rate,
            "bits": args.bits,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "export-omf":
        command_args = {
            "outputPath": args.output,
            "title": args.title,
            "rate": args.rate,
            "bits": args.bits,
            "audioEncapsulated": None if args.audio_encapsulated is None else args.audio_encapsulated == "true",
            "audioFileFormat": args.audio_file_format,
            "trimAudioFiles": None if args.trim_audio_files is None else args.trim_audio_files == "true",
            "handleFrames": args.handle_frames,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-to-render-queue":
        command_args = {
            "outputPath": args.output,
            "presetPath": args.preset_path,
            "range": args.range,
            "sequenceName": args.sequence_name,
            "startBatch": None if args.start_batch is None else args.start_batch == "true",
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-subclip":
        if not args.node_id and not args.item_name:
            parser.error("at least one of --node-id, --item-name is required")
        command_args = {
            "nodeId": args.node_id,
            "itemName": args.item_name,
            "subclipName": args.subclip_name,
            "inSeconds": args.in_seconds,
            "outSeconds": args.out_seconds,
            "takeVideo": None if args.take_video is None else args.take_video == "true",
            "takeAudio": None if args.take_audio is None else args.take_audio == "true",
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "encode-project-item":
        if not args.node_id and not args.name:
            parser.error("at least one of --node-id, --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "outputPath": args.output,
            "presetPath": args.preset_path,
            "startBatch": None if args.start_batch is None else args.start_batch == "true",
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "encode-file":
        command_args = {
            "inputPath": args.input,
            "outputPath": args.output,
            "presetPath": args.preset_path,
            "startBatch": None if args.start_batch is None else args.start_batch == "true",
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "manage-proxies":
        if args.action == "attach" and not args.node_id and not args.name:
            parser.error("--action attach requires at least one of --node-id, --name")
        if args.action == "attach" and not args.proxy_path:
            parser.error("--action attach requires --proxy-path")
        command_args = {
            "action": args.action,
            "nodeId": args.node_id,
            "name": args.name,
            "proxyPath": args.proxy_path,
            "isHiRes": None if args.is_hi_res is None else args.is_hi_res == "true",
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "open-in-source":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {"nodeId": args.node_id, "name": args.name}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "close-source-monitor":
        command_args = {}
    elif args.subcommand == "close-all-source-clips":
        command_args = {}
    elif args.subcommand == "set-source-in-out":
        if args.in_seconds is None and args.out_seconds is None:
            parser.error("at least one of --in-seconds/--out-seconds is required")
        command_args = {"inSeconds": args.in_seconds, "outSeconds": args.out_seconds}
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "insert-from-source":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "atSeconds": args.at_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "overwrite-from-source":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "atSeconds": args.at_seconds,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "add-text-overlay":
        command_args = {
            "text": args.text,
            "startSeconds": args.start_seconds,
            "durationSeconds": args.duration_seconds,
            "captionFormat": args.caption_format,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-mogrt":
        command_args = {
            "mogrtPath": args.mogrt_path,
            "startSeconds": args.start_seconds,
            "videoTrackIndex": args.video_track_index,
            "audioTrackIndex": args.audio_track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "import-mogrt-from-library":
        command_args = {
            "libraryName": args.library_name,
            "mogrtName": args.mogrt_name,
            "startSeconds": args.start_seconds,
            "videoTrackIndex": args.video_track_index,
            "audioTrackIndex": args.audio_track_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "get-mogrt-component":
        command_args = {
            "trackType": args.track_type,
            "trackIndex": args.track_index,
            "clipIndex": args.clip_index,
            "sequenceName": args.sequence_name,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "create-caption-track":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "startSeconds": args.start_seconds,
            "format": args.format,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    elif args.subcommand == "replace-clip-media":
        if not args.node_id and not args.name:
            parser.error("either --node-id or --name is required")
        command_args = {
            "nodeId": args.node_id,
            "name": args.name,
            "newMediaPath": args.new_media_path,
        }
        command_args = {k: v for k, v in command_args.items() if v is not None}
    else:
        command_args = {}

    result = submit_command(args.subcommand, args=command_args, port=args.port)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
