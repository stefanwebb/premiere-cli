// Command: manage-proxies → ppb_manageProxies
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Three distinct, unrelated semantics per action (deliberately narrower
// than the reference tool this ports, leancoderkavy's premiere-pro-mcp
// manage_proxies, which also offers a "create" action — dropped here since
// it's just add-to-render-queue/encode-project-item aimed at a proxy
// preset with an extra manual "attach once AME finishes" step; compose
// those existing commands instead of duplicating the fire-and-forget
// caveat a third time):
//
//   - "attach": attaches an ALREADY-RENDERED proxy file to one project
//     item via item.attachProxy(path, isHiRes01) (PREMIERE_API_NOTES.md
//     line 285). Requires nodeId/name (item) + proxyPath. Verified via a
//     hasProxy()/getProxyPath() read-back where available.
//   - "enable": turns proxy playback ON project-wide via
//     app.project.setProxyEnabled(true). No item required.
//   - "disable": turns proxy playback OFF project-wide via
//     app.project.setProxyEnabled(false). No item required.

// Project-item addressing (nodeId or name) — duplicated per command file,
// same walk as get-item-metadata.jsx's ppbFindItemGetItemMetadata_*
// helpers, prefixed for this file.
function ppbFindItemManageProxies_walk(item, args, depth) {
  if (depth > 32) {
    return null;
  }
  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }
  var matched = false;
  if (args.nodeId !== null) {
    try { matched = item.nodeId === args.nodeId; } catch (e) { matched = false; }
  } else if (args.name !== null) {
    try { matched = item.name === args.name; } catch (e) { matched = false; }
  }
  if (matched) {
    return item;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbFindItemManageProxies_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemManageProxies_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemManageProxies_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_manageProxies(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.action || (args.action !== "attach" && args.action !== "enable" && args.action !== "disable")) {
      return JSON.stringify({ ok: false, error: "action must be one of \"attach\", \"enable\", \"disable\"" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    if (args.action === "enable" || args.action === "disable") {
      var enabled = args.action === "enable";
      try {
        app.project.setProxyEnabled(enabled);
      } catch (e) {
        return JSON.stringify({ ok: false, error: "app.project.setProxyEnabled(" + enabled + ") failed: " + e.toString() });
      }

      var readBack = null;
      try {
        readBack = app.project.isProxyEnabled();
      } catch (e) {
        readBack = null;
      }

      return JSON.stringify({
        ok: true,
        result: {
          action: args.action,
          requestedEnabled: enabled,
          proxiesEnabled: readBack,
          verified: readBack === null ? null : readBack === enabled
        }
      });
    }

    // action === "attach"
    var hasNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasName = typeof args.name === "string" && args.name.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to address the project item for \"attach\"" });
    }
    if (!args.proxyPath || typeof args.proxyPath !== "string") {
      return JSON.stringify({ ok: false, error: "proxyPath is required for \"attach\"" });
    }

    var proxyFile = new File(args.proxyPath);
    if (!proxyFile.exists) {
      return JSON.stringify({ ok: false, error: "proxy file not found: " + args.proxyPath });
    }

    var item = ppbFindItemManageProxies_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var isHiRes = args.isHiRes === true;

    var attachResult = null;
    try {
      attachResult = item.attachProxy(args.proxyPath, isHiRes ? 1 : 0);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "item.attachProxy() failed: " + e.toString() });
    }

    // attachProxy()'s own return value isn't necessarily trustworthy (same
    // lesson as exportFramePNG/createSubClip elsewhere in this panel) —
    // confirm via whatever read-back API exists on this build instead.
    var hasProxyAfter = null;
    try { hasProxyAfter = item.hasProxy(); } catch (e) { hasProxyAfter = null; }
    var proxyPathAfter = null;
    try { proxyPathAfter = item.getProxyPath(); } catch (e) { proxyPathAfter = null; }

    var verified = null;
    if (hasProxyAfter !== null) {
      verified = hasProxyAfter === true;
    } else if (proxyPathAfter !== null) {
      verified = proxyPathAfter === args.proxyPath;
    }

    return JSON.stringify({
      ok: true,
      result: {
        action: "attach",
        item: item.name || null,
        nodeId: item.nodeId || null,
        proxyPath: args.proxyPath,
        isHiRes: isHiRes,
        attachReturnValue: attachResult,
        hasProxyAfter: hasProxyAfter,
        proxyPathAfter: proxyPathAfter,
        verified: verified,
        note: verified === null
          ? "attachProxy() did not throw, but neither hasProxy() nor getProxyPath() is available on this build to confirm — treat as unconfirmed"
          : undefined
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
