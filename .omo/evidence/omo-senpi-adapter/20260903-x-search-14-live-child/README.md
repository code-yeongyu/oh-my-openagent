# Live child x-search evidence

These S3 live runs use the worktree peer-dependency binary `node_modules/.bin/senpi`, version 2026.9.2-4, and the rebuilt `packages/omo-senpi/plugin/extensions/*.js` bundle. The driver now maps `explore` and `librarian` to direct curated `subagent_type` targets; `quick` remains category-routed. Reports record the task result's observed child agent type.

The earlier files in this evidence directory were mislabeled legacy runs: their explore and librarian root turns both used `{ category: "quick" }`, so they actually exercised quick children. The rebuilt rerun fixes that: explore is the curated child and its x_search call is denied with zero result headers; librarian is the curated child and produces one result header; quick produces one result header.

`librarian-attempts.json` preserves the selected passing attempt. All transcripts are scrubbed, sandbox auth copies are shredded, sandbox roots are removed, and the real credential store is unchanged.
