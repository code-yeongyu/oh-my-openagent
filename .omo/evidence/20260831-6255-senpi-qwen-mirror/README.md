# Evidence pointer for PR #7519 / issue #6255

The P1 bot comment referenced this path. Canonical evidence lives at:

  .omo/evidence/omo-senpi-adapter/20260831-qwen-fallback-mirror/

That directory contains the full live QA record:
- drive.mjs --self-test: PASS
- drive.mjs live run: result=PASS, realSenpiUntouched=true, sandboxed
- bun run test:senpi: 2527 pass, 0 fail
- resolve-evidence-dir.test.mjs: 10 pass, 0 fail
- Isolation proof: sandboxAgentDir under /tmp, real ~/.senpi/agent unchanged

See .omo/evidence/omo-senpi-adapter/20260831-qwen-fallback-mirror/README.md for full details.
