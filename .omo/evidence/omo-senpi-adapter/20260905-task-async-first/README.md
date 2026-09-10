# 20260905-task-async-first - live gpt-6-astra backtest for the task tool's run_in_background text

WHAT WAS TESTED: the text the model reads about run_in_background (packages/senpi-task/src/tools/task/description.ts guideline + description line, params.ts schema description), rendered into senpi's real gpt-6-astra system prompt (resolvePreset, Tool Guidelines) with the task tool schema attached, sent with three fixed delegation-shaped requests to the real gpt-6-astra (ChatGPT codex backend, reasoning high), 3 samples each. The observable is the run_in_background value on every task function call in the first response.

WHAT WAS OBSERVED: see comparison.md. Old text: 6/6 single-dependent delegations spawned in the foreground (false or omitted). senpi #1381 preset alone: 2/3 background. New preset + this PR's text: r2 3/3 and r3 3/3 background. Runner and raw captures: /tmp/ulw-astra-async-20260905/backtest/run.ts and /tmp/ulw-astra-async-20260905/evidence/{red,green,g2}/ (request bodies with tokens redacted, SSE responses, summary.json per request).

WHY IT IS ENOUGH: the behavior under test is what the model does with the prompt text, so the faithful surface is the real model with the real rendered prompt; unit tests (description.test.ts, params.test.ts) pin the text itself. The rendered senpi-task description in omo-senpi is the same string the fixture carries (live-rendered copy of buildTaskToolDescription with the changed lines substituted verbatim). Not driven: a full omo-senpi session through packages/omo-senpi/scripts/qa drivers (the runtime default of the flag is unchanged; only prompt text moved).

WHAT WAS OMITTED: the ChatGPT OAuth access token was copied into an isolated sandbox file and redacted from every saved request; the real ~/.codex/auth.json and ~/.omo/agent/auth.json hashes were equal before and after each run:
BEFORE codex d133d30a7b903c1d0c85082971dcdf34fecc8c1bedeeea22472b1f4eb8d669c9
BEFORE omo 2c532ed977e06f908225b9cc6fbc595721c5eaa30d3dc3818354ddc3ec77feab
AFTER codex d133d30a7b903c1d0c85082971dcdf34fecc8c1bedeeea22472b1f4eb8d669c9
AFTER omo 2c532ed977e06f908225b9cc6fbc595721c5eaa30d3dc3818354ddc3ec77feab

