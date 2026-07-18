// Command: import-fcp-xml → ppb_importFcpXml
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts import_fcp_xml,
// which uses the legacy app.openFCPXML(path). PREMIERE_API_NOTES.md's
// Sequences table flags this as legacy and recommends
// app.project.importFiles([xmlPath], false, rootItem, false) instead
// [hetpatel] — so this command tries importFiles first (verified by a
// root-bin children-count increase, same pattern as create-smart-bin.jsx),
// falling back to app.openFCPXML() if importFiles isn't available or
// doesn't visibly add anything. DIALOG RISK: both paths can pop blocking
// dialogs on malformed/unsupported XML (same caveat as open-project.jsx
// and PREMIERE_API_NOTES.md's Import section) — a hang here likely means
// a dialog needs dismissing in Premiere itself.

function ppb_importFcpXml(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.xmlPath || typeof args.xmlPath !== "string") {
      return JSON.stringify({ ok: false, error: "xmlPath is required" });
    }

    var file = new File(args.xmlPath);
    if (!file.exists) {
      return JSON.stringify({ ok: false, error: "no file exists at xmlPath: " + args.xmlPath });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var countBefore = app.project.rootItem.children.numItems;
    var attempts = [];
    var method = null;

    if (typeof app.project.importFiles === "function") {
      try {
        app.project.importFiles([args.xmlPath], false, app.project.rootItem, false);
        var countAfterImportFiles = app.project.rootItem.children.numItems;
        var success1 = countAfterImportFiles > countBefore;
        attempts.push({ method: "importFiles", success: success1 });
        if (success1) {
          method = "importFiles";
        }
      } catch (e) {
        attempts.push({ method: "importFiles", success: false, error: e.toString() });
      }
    } else {
      attempts.push({ method: "importFiles", success: false, error: "app.project.importFiles is not a function on this Premiere build" });
    }

    if (method === null) {
      if (typeof app.openFCPXML === "function") {
        try {
          app.openFCPXML(args.xmlPath);
          var countAfterOpenFCPXML = app.project.rootItem.children.numItems;
          var success2 = countAfterOpenFCPXML > countBefore;
          attempts.push({ method: "openFCPXML", success: success2 });
          if (success2) {
            method = "openFCPXML";
          }
        } catch (e) {
          attempts.push({ method: "openFCPXML", success: false, error: e.toString() });
        }
      } else {
        attempts.push({ method: "openFCPXML", success: false, error: "app.openFCPXML is not a function on this Premiere build" });
      }
    }

    var countAfter = app.project.rootItem.children.numItems;

    if (method === null) {
      return JSON.stringify({
        ok: false,
        error: "could not import the FCP XML with any known method — see attempts",
        attempts: attempts,
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        imported: true,
        xmlPath: args.xmlPath,
        method: method,
        countBefore: countBefore,
        countAfter: countAfter,
        attempts: attempts
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
