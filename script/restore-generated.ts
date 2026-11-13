#!/usr/bin/env bun
// Restores every tracked output on script/generated-bundles.json from HEAD, so a built worktree can merge or switch
// branches again (#9903). Untracked new outputs are left alone. Run as `bun script/restore-generated.ts`.
import { fileURLToPath } from "node:url"

import { git, isGeneratedBundlePath, loadGeneratedBundlePatterns, nulSeparated } from "./generated-bundles.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const patterns = loadGeneratedBundlePatterns()
const listed = nulSeparated(git(root, ["ls-files", "-z"])).filter((path) => isGeneratedBundlePath(path, patterns))
if (listed.length > 0) git(root, ["checkout", "HEAD", "--", ...listed])
console.log(`restore-generated: restored ${listed.length} generated output(s) from HEAD`)
