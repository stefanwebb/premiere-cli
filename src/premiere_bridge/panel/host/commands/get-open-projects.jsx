// Command: get-open-projects → ppb_getOpenProjects
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Lightweight list of every currently OPEN project (app.projects), unlike
// get-project-info (single active project, full sequence detail) or
// get-full-project-overview (single active project, bin tree + media
// counts) — this command deliberately reports name/path/isActive only, no
// per-project sequence data. This replaces the multi-project-listing role
// previously covered by get-project-metadata (removed in a parallel task);
// use get-project-info / get-full-project-overview for sequence/bin detail
// on whichever project is currently active.

function ppb_getOpenProjects(argsJson) {
  try {
    if (!app.projects || app.projects.numProjects === 0) {
      return JSON.stringify({ ok: true, result: { projects: [], count: 0 } });
    }

    var activePath = null;
    try {
      activePath = app.project ? app.project.path : null;
    } catch (e) {
      activePath = null;
    }

    var projects = [];
    for (var i = 0; i < app.projects.numProjects; i++) {
      var proj = app.projects[i];
      var name = null;
      var path = null;
      var isActive = null;

      try { name = proj.name; } catch (e) { name = null; }
      try { path = proj.path; } catch (e) { path = null; }
      try {
        isActive = (path !== null && activePath !== null) ? (path === activePath) : null;
      } catch (e) {
        isActive = null;
      }

      projects.push({ name: name, path: path, isActive: isActive });
    }

    return JSON.stringify({ ok: true, result: { projects: projects, count: projects.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
