# ATTRIBUTION / NOTICE

This skill (`browser`, part of `@oh-my-opencode/shared-skills`) is project-original documentation
plus a staged copy of one library it drives.

## omowright — bundled

Both engines this skill documents are provided by **omowright**.

- Upstream: the `omowright` repository on GitHub, pinned by commit in the root `package.json`
  devDependency.
- License: MIT
- What ships here: `runtime/omowright/index.js` (the library bundled into one ESM file, including
  its `ws` and `zod` dependencies) and `runtime/omowright/page-bundle.js` (the in-page snapshot
  script it reads at import time), staged at build time by
  `packages/shared-skills/stage-omowright-runtime.mjs` from the pinned root devDependency, with a
  `manifest.json` recording the version and file digests. The repository holds no copy; the
  staged files are gitignored and packed through the sibling `.npmignore`.
- omowright's own license notice is preserved inside the bundled file.

## BrowserSkill — driven, not vendored

The attached engine reaches the user's browser through **BrowserSkill** by Tencent.

- Upstream: https://github.com/Tencent/BrowserSkill
- License: MIT
- What ships here: nothing of upstream's. omowright speaks the daemon's IPC protocol; the user
  installs the `bsk` CLI from upstream's own installer (run by `scripts/browser-install.mjs`) and
  the extension from the Chrome Web Store / Edge Add-ons listings (registered by the same script
  through Chrome's external-extension mechanism). This package never bundles a browser binary or
  an extension payload.

## Owned-engine references

`references/owned-engine/` summarizes omowright's own skill and presets (escalation ladder,
network-first reading, frames, dialogs, human handoff) as routing text; the library's repository
is the authoritative treatment.
