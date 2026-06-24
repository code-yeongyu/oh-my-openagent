export const SCAFFOLD = `{
  // Shared OMO settings. Harness override blocks below are additive.
  "codegraph": {
    // "enabled": true,
    // "auto_provision": true,
    // "telemetry": false,
    // "install_dir": "~/.omo/codegraph"
  },

  "[codex]": {
    "codegraph": {
      // "enabled": true,
      // "auto_provision": true,
      // "install_dir": "~/.omo/codegraph",
      // "telemetry": false
    }
  },

  "[opencode]": {
    "codegraph": {
      // "enabled": true,
      // "auto_provision": true,
      // "install_dir": "~/.omo/codegraph",
      // "telemetry": false,
      // "watch_debounce_ms": 250
    }
  }
}
`;
