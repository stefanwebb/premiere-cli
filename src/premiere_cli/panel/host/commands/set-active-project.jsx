// Command: set-active-project → ppb_setActiveProject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Switches which currently-OPEN project (app.projects) is the active one
// (app.project). DESIGNED BUT NOT YET LIVE-VERIFIED: no reference repo we
// studied (see PREMIERE_API_NOTES.md) has a multi-open-project activation
// tool to copy — none of hetpatel/leancoderkavy/ayushozha's code touches
// app.projects at all, only the single app.project. The activation
// mechanism on this Premiere build is therefore genuinely uncertain: three
// candidate methods are tried in order, and success is verified AFTER each
// one by checking that app.project.path actually changed to the target's
// path — never by trusting a method's return value (same distrust pattern
// as export-frame.jsx's exportFramePNG guesses).
//
// Mutation caveats:
//   - app.openDocument() is documented (PREMIERE_API_NOTES.md) as an
//     "open project" call; its behavior when the target is ALREADY open is
//     unconfirmed — it may simply foreground the existing project, or it
//     may pop a dialog, or (worst case) re-open a second instance. This is
//     a fallback guess, not a verified-safe operation.
//   - The direct-assignment attempt (`app.project = target`) is a bare
//     guess with no supporting reference anywhere in the three MCP repos
//     studied — kept last, after the two better-attested attempts.
//   - Live-test this against a real multi-project-open Premiere session
//     before relying on it in an unattended workflow.

function ppb_setActiveProject(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasName = !!(args.name && typeof args.name === "string");
    var hasPath = !!(args.path && typeof args.path === "string");
    if (!hasName && !hasPath) {
      return JSON.stringify({ ok: false, error: "at least one of name or path is required" });
    }

    if (!app.projects || app.projects.numProjects === 0) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var byPath = null;
    var byName = null;
    var availableProjects = [];

    for (var i = 0; i < app.projects.numProjects; i++) {
      var p = app.projects[i];
      var pName = null;
      var pPath = null;
      try { pName = p.name; } catch (e) { pName = null; }
      try { pPath = p.path; } catch (e) { pPath = null; }

      if (pName !== null) {
        availableProjects.push(pName);
      }
      if (hasPath && pPath !== null && pPath === args.path) {
        byPath = p;
      }
      if (hasName && pName !== null && pName === args.name) {
        byName = p;
      }
    }

    var target = null;
    if (hasName && hasPath) {
      if (!byPath || !byName || byPath !== byName) {
        return JSON.stringify({
          ok: false,
          error: "name and path did not resolve to the same open project",
          availableProjects: availableProjects
        });
      }
      target = byPath;
    } else if (hasPath) {
      target = byPath;
    } else {
      target = byName;
    }

    if (!target) {
      var missingDesc = "";
      if (hasName) { missingDesc += " name \"" + args.name + "\""; }
      if (hasPath) { missingDesc += " path \"" + args.path + "\""; }
      return JSON.stringify({
        ok: false,
        error: "no open project matched" + missingDesc,
        availableProjects: availableProjects
      });
    }

    var targetName = null;
    var targetPath = null;
    try { targetName = target.name; } catch (e) { targetName = null; }
    try { targetPath = target.path; } catch (e) { targetPath = null; }

    var currentPath = null;
    try { currentPath = app.project ? app.project.path : null; } catch (e) { currentPath = null; }

    if (targetPath !== null && currentPath !== null && targetPath === currentPath) {
      return JSON.stringify({
        ok: true,
        result: { activated: { name: targetName, path: targetPath }, alreadyActive: true }
      });
    }

    function isNowActive() {
      var curPath = null;
      try { curPath = app.project ? app.project.path : null; } catch (e) { curPath = null; }
      return targetPath !== null && curPath === targetPath;
    }

    var attempts = [];

    // --- Attempt 1: targetProject.activate(), if this build exposes it.
    if (typeof target.activate === "function") {
      try {
        target.activate();
        var success1 = isNowActive();
        attempts.push({ method: "activate", success: success1 });
        if (success1) {
          return JSON.stringify({
            ok: true,
            result: { activated: { name: targetName, path: targetPath }, attempts: attempts }
          });
        }
      } catch (e) {
        attempts.push({ method: "activate", success: false, error: e.toString() });
      }
    } else {
      attempts.push({ method: "activate", success: false, error: "target.activate is not a function on this Premiere build" });
    }

    // --- Attempt 2: app.openDocument(targetPath) — documented to open/
    // foreground a project; on an already-open project its behavior is an
    // unconfirmed fallback guess (see header comment).
    if (targetPath !== null) {
      try {
        app.openDocument(targetPath);
        var success2 = isNowActive();
        attempts.push({ method: "openDocument", success: success2 });
        if (success2) {
          return JSON.stringify({
            ok: true,
            result: { activated: { name: targetName, path: targetPath }, attempts: attempts }
          });
        }
      } catch (e) {
        attempts.push({ method: "openDocument", success: false, error: e.toString() });
      }
    } else {
      attempts.push({ method: "openDocument", success: false, error: "target project has no readable path" });
    }

    // --- Attempt 3: direct property assignment — a bare guess with no
    // supporting reference in any studied repo, tried last.
    try {
      app.project = target;
      var success3 = isNowActive();
      attempts.push({ method: "directAssign", success: success3 });
      if (success3) {
        return JSON.stringify({
          ok: true,
          result: { activated: { name: targetName, path: targetPath }, attempts: attempts }
        });
      }
    } catch (e) {
      attempts.push({ method: "directAssign", success: false, error: e.toString() });
    }

    return JSON.stringify({
      ok: false,
      error: "could not activate project \"" + (targetName || targetPath) + "\" with any known method",
      attempts: attempts
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
