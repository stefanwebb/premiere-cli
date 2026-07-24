const http = require('http');

const PORT = 47823;

// Kept in lockstep with the premiere-cli Python package version —
// `premiere-cli doctor` compares the two and warns when the installed
// panel is stale relative to the CLI that ships it.
const PANEL_VERSION = '0.4.1';
const VALID_LEVELS = ['info', 'warn', 'error'];

// main.js is loaded via a plain <script src="js/main.js"> tag, not
// require() — in that context CEP's Node integration resolves __dirname
// to the extension's own root directory (where index.html lives), not to
// this file's actual containing folder as a required CommonJS module
// would see. ExtendScript's own $.fileName also doesn't resolve reliably
// for a .jsx loaded via the manifest's <ScriptPath>, so the plugin's root
// directory is computed here (confirmed live: __dirname IS the plugin
// root, no need to go up a level) and forwarded to ExtendScript as part
// of every command's args instead.
const PLUGIN_DIR = __dirname;

// Allowlist for the /command endpoint — unknown commands get a 400 without
// ever reaching ExtendScript. Each command's implementation lives in
// host/commands/<name>.jsx, loaded lazily by ppb_dispatch (host/index.jsx)
// on first use; adding a command means adding it there AND here.
const ALLOWED_COMMANDS = [
  'create-sequence',
  'extract-audio-track',
  'remove-track-intervals',
  'export-frame',
  'get-project-info',
  'list-project-items',
  'get-full-project-overview',
  'search-project-items',
  'get-active-sequence',
  'get-full-sequence-info',
  'get-full-clip-info',
  'get-timeline-summary',
  'debug-qe-inspect',
  'debug-qe-try-mutate',
  'get-premiere-state',
  'inspect-dom-object',
  'get-open-projects',
  'set-active-project',
  'move-playhead',
  'get-work-area',
  'set-work-area',
  'get-sequence-in-out',
  'set-sequence-in-out',
  'is-work-area-enabled',
  'get-export-file-extension',
  'get-workspaces',
  'set-workspace',
  'play-timeline',
  'stop-playback',
  'play-source-monitor',
  'get-source-monitor-position',
  'get-version-info',
  'get-bin-contents',
  'get-project-item-info',
  'get-timeline-gaps',
  'get-offline-media',
  'get-used-media-report',
  'get-all-project-paths',
  'get-unused-media',
  'get-duplicate-media',
  'get-clip-links',
  'get-insertion-bin',
  'get-project-panel-metadata',
  'list-available-effects',
  'list-available-audio-effects',
  'list-available-transitions',
  'list-available-audio-transitions',
  'list-markers',
  'get-clip-markers',
  'get-sequence-markers-by-type',
  'get-item-metadata',
  'get-color-label',
  'get-footage-interpretation',
  'get-xmp-metadata',
  'set-item-metadata',
  'set-color-label',
  'set-footage-interpretation',
  'set-xmp-metadata',
  'get-color-space',
  'get-render-queue-status',
  'get-clip-at-position',
  'get-clip-at-playhead',
  'get-next-edit-point',
  'get-sequence-count',
  'get-total-clip-count',
  'get-target-tracks',
  'get-track-info',
  'get-encoder-presets',
  'get-qe-clip-info',
  'get-source-monitor-info',
  'get-clip-adjustment-layer',
  'add-marker',
  'update-marker',
  'delete-marker',
  'add-marker-to-project-item',
  'redo',
  'undo',
  'move-playhead-to-edit',
  'set-poster-frame',
  'select-project-item',
  'select-clips-by-name',
  'select-all-clips',
  'deselect-all-clips',
  'select-clips-in-range',
  'select-clips-by-color',
  'invert-selection',
  'select-disabled-clips',
  'set-clip-selection',
  'add-track',
  'lock-track',
  'set-track-visibility',
  'set-track-mute',
  'rename-track',
  'set-target-track',
  'set-all-tracks-targeted',
  'set-clip-position',
  'set-clip-scale',
  'set-clip-rotation',
  'set-clip-anchor-point',
  'set-clip-opacity',
  'set-uniform-scale',
  'set-scale-width-height',
  'set-anti-alias-quality',
  'set-blend-mode',
  'set-clip-volume',
  'set-clip-pan',
  'adjust-audio-levels',
  'add-audio-keyframes',
  'rename-clip',
  'batch-rename-clips',
  'set-clip-enabled',
  'batch-set-clips-enabled',
  'set-frame-blend',
  'set-time-interpolation',
  'set-clip-properties',
  'apply-effect',
  'apply-audio-effect',
  'remove-effect',
  'remove-effect-by-name',
  'remove-all-effects',
  'color-correct',
  'apply-lut',
  'stabilize-clip',
  'copy-effects-between-clips',
  'copy-effect-values',
  'batch-apply-effect',
  'get-effect-properties',
  'set-effect-property',
  'get-keyframes',
  'add-keyframe',
  'remove-keyframe',
  'remove-keyframe-range',
  'set-keyframe-interpolation',
  'get-value-at-time',
  'set-color-value',
  'add-transition',
  'batch-add-transitions',
  'remove-transition',
  'add-to-timeline',
  'remove-from-timeline',
  'move-clip',
  'trim-clip',
  'split-clip',
  'duplicate-clip',
  'replace-clip',
  'set-clip-speed',
  'get-clip-speed',
  'ripple-delete-clip',
  'roll-edit',
  'slide-edit',
  'slip-edit',
  'move-clip-to-track',
  'reverse-clip',
  'link-selection',
  'unlink-selection',
  'overwrite-clip-at',
  'razor-all-tracks',
  'set-item-in-out',
  'clear-item-in-out',
  'clear-sequence-in-out',
  'remove-selected-clips',
  'lift-selection',
  'extract-selection',
  'nest-clips',
  'freeze-frame',
  'match-frame',
  'add-adjustment-layer',
  'unnest-sequence',
  'import-media',
  'import-folder',
  'import-image-sequence',
  'create-bin',
  'rename-bin',
  'move-items-to-bin',
  'relink-media',
  'refresh-media',
  'set-item-offline',
  'detach-proxy',
  'set-override-frame-rate',
  'set-override-pixel-aspect-ratio',
  'set-scale-to-frame-size',
  'set-item-start-time',
  'rename-project-item',
  'save-project',
  'save-project-as',
  'open-project',
  'set-active-sequence',
  'find-items-by-media-path',
  'create-smart-bin',
  'add-custom-metadata-field',
  'import-sequences-from-project',
  'import-fcp-xml',
  'import-ae-comps',
  'create-bars-and-tone',
  'set-transcode-on-ingest',
  'set-project-panel-metadata',
  'get-graphics-white-luminance',
  'set-graphics-white-luminance',
  'duplicate-sequence',
  'set-sequence-settings',
  'create-subsequence',
  'auto-reframe-sequence',
  'create-sequence-from-preset',
  'create-sequence-from-clips',
  'attach-custom-property',
  'close-sequence',
  'export-sequence-as-project',
  'scene-edit-detection',
  'export-sequence',
  'export-fcp-xml',
  'export-aaf',
  'export-omf',
  'add-to-render-queue',
  'create-subclip',
  'encode-project-item',
  'encode-file',
  'manage-proxies',
  'open-in-source',
  'close-source-monitor',
  'close-all-source-clips',
  'set-source-in-out',
  'insert-from-source',
  'overwrite-from-source',
  'add-text-overlay',
  'import-mogrt',
  'import-mogrt-from-library',
  'get-mogrt-component',
  'create-caption-track',
  'replace-clip-media'
];

const csInterface = new CSInterface();

const logView = document.getElementById('log-view');
const clearButton = document.getElementById('clear-button');

function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function appendLogLine(message, level, source) {
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const prefix = source ? `[${formatTimestamp()}] [${source}] ` : `[${formatTimestamp()}] `;
  line.textContent = prefix + message;
  logView.appendChild(line);
  logView.scrollTop = logView.scrollHeight;
}

function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      callback(new Error('invalid JSON'), null);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      callback(new Error('invalid JSON'), null);
      return;
    }
    callback(null, parsed);
  });
}

function handleLog(req, res) {
  readJsonBody(req, (err, parsed) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return;
    }

    if (!parsed.message || typeof parsed.message !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'message is required' }));
      return;
    }

    const level = parsed.level || 'info';
    if (!VALID_LEVELS.includes(level)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `level must be one of ${VALID_LEVELS.join(', ')}` }));
      return;
    }

    appendLogLine(parsed.message, level, parsed.source);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

function handleCommand(req, res) {
  readJsonBody(req, (err, parsed) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return;
    }

    if (!parsed.command || typeof parsed.command !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'command is required' }));
      return;
    }

    if (!ALLOWED_COMMANDS.includes(parsed.command)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `unknown command: ${parsed.command}` }));
      return;
    }

    const argsWithContext = Object.assign({}, parsed.args || {}, { pluginDir: PLUGIN_DIR });

    const argsJson = JSON.stringify(argsWithContext)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    csInterface.evalScript(`ppb_dispatch('${parsed.command}', '${argsJson}')`, (rawResult) => {
      let result;
      try {
        result = JSON.parse(rawResult);
      } catch (e) {
        result = { ok: false, error: `command returned an unparsable result: ${rawResult}` };
      }

      // Guard against successfully-parsed non-object values (e.g. null, primitives)
      if (typeof result !== 'object' || result === null) {
        result = { ok: false, error: `command returned a non-object result: ${rawResult}` };
      }

      if (result.ok) {
        appendLogLine(`Command: ${parsed.command} → ok`, 'info', 'panel');
      } else {
        appendLogLine(`Command: ${parsed.command} → failed: ${result.error}`, 'error', 'panel');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    handleLog(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/command') {
    handleCommand(req, res);
    return;
  }
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, panelVersion: PANEL_VERSION }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.on('error', (err) => {
  appendLogLine(`Failed to start bridge server on port ${PORT}: ${err.message}`, 'error', 'panel');
});

server.listen(PORT, '127.0.0.1', () => {
  appendLogLine(`Bridge server listening on port ${PORT}`, 'info', 'panel');
});

window.addEventListener('beforeunload', () => {
  server.close();
});

clearButton.addEventListener('click', () => {
  logView.innerHTML = '';
});
