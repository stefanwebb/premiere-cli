// Command: attach-custom-property → ppb_attachCustomProperty
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts
// attach_custom_property tool: `seq.attachCustomProperty(id, value)` per
// PREMIERE_API_NOTES.md's Sequences table. No confirmed getter/read-back
// API exists for custom sequence properties in ANY of the reference
// repos studied — this command can only confirm the setter call didn't
// throw, never that the value actually persisted or is retrievable
// later. value is coerced to a string (attachCustomProperty's own
// signature is key/value strings per the reference tool).
function ppb_attachCustomProperty(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (!args.propertyId || typeof args.propertyId !== "string") {
      return JSON.stringify({ ok: false, error: "propertyId is required" });
    }
    if (typeof args.value === "undefined" || args.value === null) {
      return JSON.stringify({ ok: false, error: "value is required" });
    }

    var seq;
    if (args.sequenceName && typeof args.sequenceName === "string") {
      seq = findSequenceByName(args.sequenceName);
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no sequence named \"" + args.sequenceName + "\" is open" });
      }
    } else {
      seq = app.project.activeSequence;
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no active sequence, and no sequenceName given" });
      }
    }

    var valueString = String(args.value);

    try {
      seq.attachCustomProperty(args.propertyId, valueString);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "seq.attachCustomProperty() failed: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        propertyId: args.propertyId,
        value: valueString,
        note: "no confirmed getter exists for custom sequence properties across any reference repo studied — this result confirms only that attachCustomProperty() did not throw, not that the value actually persisted or is retrievable"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
