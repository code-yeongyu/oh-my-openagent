# Tasks: OpenCode V2 plugin entry compatibility

- [x] Read issue #8295, its full timeline, linked PR search, migration guide, and repository contribution rules.
- [x] Trace the default export through `index.ts` to `createPluginModule()` and record the V1/V2 boundary.
- [x] Add a typed V2 `setup` entrypoint without changing the V1 `server` implementation.
- [x] Add the minimum repository-required regression to the existing factory test.
- [x] Update the affected source documentation.
- [x] Run the focused regression and record the exact result.
- [x] Run repository typecheck, build, and root tests; record pass/failure honestly.
- [x] Run isolated real-OpenCode QA and record loader behavior plus DB-isolation evidence.
- [x] Commit only task files, implementation, regression, documentation, and new QA evidence.
- [x] Recheck ownership, exclusions, duplicate PRs, template, and current remote state under the public-action lock.
- [x] Push to Dante-dan's fork and create a draft PR.
- [x] Record the post-PR private-review question and tracker milestones without publicizing the private workflow.
