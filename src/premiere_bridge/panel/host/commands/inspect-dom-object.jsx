// Command: inspect-dom-object → ppb_inspectDomObject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// Interactive DOM explorer for API discovery: evaluates a caller-supplied
// PROPERTY-PATH expression (rooted at app, qe, or $.global) and reflects on
// whatever it finds. This is related to, but more general than,
// debug-qe-inspect.jsx (which hardcodes a fixed set of QE sequence/track/
// clip candidate probes for one specific investigation) — inspect-dom-object
// takes an arbitrary path and a generalized describeValue() reflector, so it
// works on any object in either DOM, not just the QE sequence tree. Its own
// describeValue() is written fresh here rather than importing
// debug-qe-inspect's reflectQeObject, per that file's "not shared" note.
//
// Strictly read-only by construction: the expression is validated to be a
// bare property path with no parentheses, so it can never invoke a method
// (which could mutate the open project).

var PPB_INSPECT_COMMON_PROPERTIES = [
  "name", "numItems", "numTracks", "numSequences", "length", "path", "type",
  "mediaType", "seconds", "ticks", "sequenceID", "nodeId", "treePath", "guid"
];

// Generalized reflection on an arbitrary DOM value — not specific to any
// one object shape. Used by ppb_inspectDomObject only.
function describeValue(value) {
  var info = {
    typeofValue: typeof value,
    stringValue: null,
    isNull: value === null,
    isUndefined: typeof value === "undefined",
    reflectMethods: null,
    reflectProperties: null,
    forInKeys: null,
    commonProperties: {}
  };

  try {
    var s = String(value);
    if (s.length > 500) {
      s = s.substring(0, 500);
    }
    info.stringValue = s;
  } catch (e) {
    info.stringValue = null;
  }

  if (value === null || typeof value === "undefined") {
    return info;
  }

  if (typeof value !== "object" && typeof value !== "function") {
    return info;
  }

  // ExtendScript's built-in Reflection mechanism — authoritative when
  // present, unlike the for-in enumeration and candidate-property probing
  // below (same rationale as debug-qe-inspect.jsx's reflectQeObject).
  try {
    if (value.reflect) {
      if (value.reflect.methods) {
        info.reflectMethods = [];
        for (var m = 0; m < value.reflect.methods.length; m++) {
          info.reflectMethods.push(value.reflect.methods[m].name);
        }
      }
      if (value.reflect.properties) {
        info.reflectProperties = [];
        for (var p = 0; p < value.reflect.properties.length; p++) {
          info.reflectProperties.push(value.reflect.properties[p].name);
        }
      }
    }
  } catch (e) {
    // leave reflectMethods/reflectProperties as null
  }

  try {
    var keys = [];
    var count = 0;
    for (var key in value) {
      if (count >= 200) {
        info.forInTruncated = true;
        break;
      }
      keys.push(key);
      count++;
    }
    info.forInKeys = keys;
  } catch (e) {
    info.forInKeys = null;
    info.forInError = e.toString();
  }

  for (var c = 0; c < PPB_INSPECT_COMMON_PROPERTIES.length; c++) {
    var propName = PPB_INSPECT_COMMON_PROPERTIES[c];
    try {
      var propValue = value[propName];
      if (typeof propValue !== "undefined" && typeof propValue !== "function") {
        info.commonProperties[propName] = String(propValue);
      }
    } catch (e) {
      // skip properties that throw on access
    }
  }

  return info;
}

function ppb_inspectDomObject(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var expression = args.expression;
    // Property path only, rooted at app/qe/$.global — no "(" or ")" anywhere,
    // so this can never be turned into a method call (which could mutate
    // the open project). Every validation failure (missing, non-string,
    // empty, or a path shape that doesn't match) reports the same reason.
    var pathRe = /^(app|qe|\$\.global)([.\[][A-Za-z0-9_$".\[\]']*)?$/;
    var isValidExpression =
      typeof expression === "string" &&
      expression.length > 0 &&
      pathRe.test(expression) &&
      expression.indexOf("(") === -1 &&
      expression.indexOf(")") === -1;

    if (!isValidExpression) {
      return JSON.stringify({
        ok: false,
        error: "expression must be a property path rooted at app, qe, or $.global (no function calls)"
      });
    }

    if (expression.substring(0, 2) === "qe") {
      try {
        ensureQEEnabled();
      } catch (e) {
        return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
      }
    }

    var value;
    try {
      value = eval(expression);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "evaluation failed: " + e.toString() });
    }

    var result = describeValue(value);
    result.expression = expression;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
