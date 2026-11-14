### Fixed

- `thread_interrupt` also stops the background jobs the interrupted turn started (a bash command it ran in the background or that auto-detached), so the thread no longer wakes a minute later when that job ends and replies as if it had never been interrupted. The result names what was stopped as `background: { status: "stopped", stopped, failed }`; an engine that predates the stop answers `background: { status: "not_supported" }`. A thread on this device and a thread on another device run the same interrupt code and answer the same shape.

<!-- changes-log: packages/omo-senpi/changes.md -->
## 2026-11-14 - `thread_interrupt` stops the interrupted turn's background jobs

- `src/components/thread/control/interrupt.ts` (new): `interruptOver`, the one interrupt body of both legs. It sends the engine's `interrupt` record with `background: "stop"` and reads the reply into `{ interrupted, turn_id, background }`; a reply with no `background` (an engine before senpi's `interrupt { background }`) reads as `not_supported`.
- `src/components/thread/control/local-control.ts` and `control/relay-control.ts`: `interrupt` is `interruptOver` over this device's endpoint (`port.interrupt`) and over the device service (`sessionCommand`) respectively; neither builds its own record or parses its own reply any more.
- `src/components/thread/tools/ports.ts`, `live-surface.ts`, `lazy-live-surface.ts`: the endpoint port's `interrupt` takes the request fields and answers the engine's reply data.
- `src/components/thread/contracts/results.ts`, `control/operations.ts`, `control/port.ts`: the `thread_interrupt` result carries the typed `background` (`ThreadInterruptBackground`).
- Why: measured on a remote thread, the interrupted turn's auto-detached `sleep 60` kept running, its completion woke the thread about 60 s later and the thread replied anyway.
