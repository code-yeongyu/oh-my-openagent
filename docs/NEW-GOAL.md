Run verification from the correct repo roots and respect each repo's instructions.

Use these repo roots:
- Oh My OpenAgent: /home/supreme/oh-my-openagent
- Oh My Pi: /home/supreme/pr-work/oh-my-pi
- Pi: /home/supreme/pi-mono

Use these installed runtime roots only for runtime probes and final dogfood:
- Oh My Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent
- Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent

Oh My OpenAgent:
- Read package.json scripts first.
- Run focused tests for touched code if available.
- Run bun run typecheck.
- Run bun test.
- Run bun run build if packaging or entrypoints changed.

Oh My Pi:
- From /home/supreme/pr-work/oh-my-pi, run bun run check.
- Run targeted tests for touched extension-loader/tool/hook/resource paths if available.
- Run bun run ci:test:smoke only if it is appropriate for the touched source and does not violate repo instructions.

Pi:
- From /home/supreme/pi-mono, run npm run check.
- Do not run npm run dev.
- Do not run npm run build.
- Do not run npm test.
- If you modify or create a test file, run that exact test from the relevant package root with:
  npx tsx ../../node_modules/vitest/dist/cli.js --run path/to/test-file.test.ts

For every command:
- report pass/fail
- include important failure lines
- separate pre-existing failures from failures caused by this port
- update CONTEXT.md with the command, result, important output, and any follow-up fix

Perform a code-review pass on the completed port.

Use the live repo/runtime split:
- Source extension repo: /home/supreme/oh-my-openagent
- Oh My Pi source repo: /home/supreme/pr-work/oh-my-pi
- Oh My Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent
- Pi source repo: /home/supreme/pi-mono
- Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent

Focus on:
- missing feature matrix rows
- target harness API mismatches
- OpenCode assumptions that leaked into Oh My Pi or Pi adapters
- package/import name mismatches between @oh-my-pi, @mariozechner, and @earendil-works installed/runtime packages
- event ordering bugs
- tool schema incompatibilities
- command registration collisions
- resource/skill discovery bugs
- runtime-only patches that were not copied into durable source
- dogfood gaps
- claims of full support without evidence

Report findings first with file/line references.
If there are issues, fix them and re-run the relevant checks.
If there are no issues, say what residual risk remains.
Update CONTEXT.md with the review findings, fixes, and residual risk.


Produce final certification for the Oh My OpenAgent full port.

Do not claim full support unless the evidence proves it.

Use this path contract in the final report:
- Source extension repo: /home/supreme/oh-my-openagent
- Oh My Pi source repo: /home/supreme/pr-work/oh-my-pi
- Oh My Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent
- Oh My Pi extension root: /home/supreme/.omp/agent/extensions
- Pi source repo: /home/supreme/pi-mono
- Pi installed runtime: /home/supreme/.bun/install/global/node_modules/@earendil-works/pi-coding-agent
- Pi extension root: /home/supreme/.pi/agent/extensions
- PRD path: /home/supreme/oh-my-openagent/docs/porting/oh-my-openagent-full-omp-pi-port.md
- CONTEXT.md path: /home/supreme/oh-my-openagent/docs/porting/CONTEXT.md

Include:
1. Final changed files by repo.
2. Feature matrix with status for both Oh My Pi and Pi.
3. Source verification commands and results.
4. Installed runtime dogfood commands and results.
5. Runtime patches applied, if any, and matching durable source patches.
6. CONTEXT.md final state summary.
7. Features fully supported.
8. Features partially supported, with exact reason and next patch needed.
9. Features unsupported, with exact missing target seam.
10. Instructions for using the extension in:
   - /home/supreme/.omp/agent/extensions
   - /home/supreme/.pi/agent/extensions
11. Whether it is safe to call the port complete.

Be blunt. If anything important is not dogfooded in both harnesses, say the port is not fully complete yet.
DO REAL TESTING VIA HEADLESS EXEC i think so 

USE IT AND TEST ALL FULL ABSOLUTE FEATURES OF  OMO AS A REAL USER OKAY  

IF ITSNOT COMPLETE FULLY, THEN WORK UNTIL FULL  OMO PARITY IN BOTH HARNESS OMP AND PI  AS IT PROVIDES OPENCODE 



AFTER UR WORK  PROVID FULL GUIDE IN UR LAST MESSAGE ABOUT  A STEP BY STEP GUIDE SO I CAN DO MTEST ALL OMO FEATURESFULL  ONBOTH HARNESS, MISS NOTHING 

DONT GIVE FINAL RESPONSE  OKAY WORK UNTIL EVERYTHING I SAID IS DONE A SINGLE FINAL RESPONSE AFTER FULL WORK IS DONE 
