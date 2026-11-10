import { MobiusError, requireValue, shape, object, event, eventContracts, methodContracts } from "./validation.mjs";
import { location, load, locked, save, ignoreGenerated, hasCode } from "./storage.mjs";
import { statusResult } from "./status.mjs";
import { apply } from "./records.mjs";

/** @template T @param {string} operation @param {() => Promise<T>} action @returns {Promise<import('./contracts.d.mts').Envelope<T>>} */
async function envelope(operation, action) {
  try {
    const result = await action();
    const nextActions = result !== null && typeof result === "object" && "nextActions" in result && Array.isArray(result.nextActions)
      ? result.nextActions.filter(item => typeof item === "string") : [];
    return { ok: true, operation, result, nextActions };
  } catch (error) {
    if (error instanceof MobiusError) return { ok: false, operation, error: { code: error.code, message: error.message } };
    if (error instanceof Error) {
      const code = hasCode(error, "ENOENT") ? "NOT_FOUND" : hasCode(error, "ELOOP") ? "UNSAFE_PATH" : "IO_ERROR";
      return { ok: false, operation, error: { code, message: error.message } };
    }
    throw error;
  }
}

/** @param {{cwd: string, slug: string}} config @returns {import('./contracts.d.mts').Mobius} */
export function createMobius(config) {
  return {
    start(input) {
      return envelope("start", async () => {
        const capturedInput = structuredClone(input);
        shape(capturedInput, methodContracts.start);
        const { title, focus = "discover" } = capturedInput;
        return locked(config, true, async store => {
          const existing = await load(store);
          if (existing) return statusResult(existing);
          /** @type {import('./contracts.d.mts').Snapshot} */
          const snapshot = { schemaVersion: 1, slug: store.slug, title,
            initialFocus: focus, revision: 0, events: [] };
          await ignoreGenerated(store);
          await save(store, snapshot);
          return statusResult(snapshot);
        });
      });
    },
    status() {
      return envelope("status", async () => {
        const store = await location(config, false);
        const snapshot = await load(store);
        requireValue(snapshot, "Initiative has not been started", "NOT_FOUND");
        return statusResult(snapshot);
      });
    },
    record(input) {
      return envelope("record", async () => {
        object(input);
        requireValue(Object.keys(input).length === 2, "record requires expectedRevision and event");
        shape({ expectedRevision: input.expectedRevision }, { expectedRevision: "revision" });
        const { expectedRevision } = input;
        const recordedEvent = structuredClone(input.event);
        event(recordedEvent);
        return locked(config, false, async store => {
          const snapshot = await load(store);
          requireValue(snapshot, "Initiative has not been started", "NOT_FOUND");
          requireValue(expectedRevision === snapshot.revision,
            `Expected revision ${expectedRevision}, current revision is ${snapshot.revision}`, "REVISION_CONFLICT");
          const { records } = statusResult(snapshot);
          apply(snapshot, records, recordedEvent);
          snapshot.revision += 1;
          snapshot.events.push({ revision: snapshot.revision, at: new Date().toISOString(), event: recordedEvent });
          await save(store, snapshot);
          return statusResult(snapshot);
        });
      });
    },
    learning(input) {
      return envelope("learning", async () => {
        shape(input, methodContracts.learning);
        const store = await location(config, false);
        const snapshot = await load(store);
        requireValue(snapshot, "Initiative has not been started", "NOT_FOUND");
        const { records } = statusResult(snapshot);
        const experiment = records.experiments.find(item => item.id === input.experimentId);
        const assessment = records.assessments.findLast(item => item.experimentId === input.experimentId);
        requireValue(experiment && assessment, "Learning requires a recorded experiment assessment", "INVALID_TRANSITION");
        return {
          description: `Mobius ${snapshot.title}: experiment ${experiment.id}`,
          body: JSON.stringify({ initiative: snapshot.slug, revision: snapshot.revision, experiment, assessment,
            evidence: records.evidence.filter(item => item.experimentId === experiment.id) }, null, 2),
        };
      });
    },
    help() {
      return envelope("help", async () => ({
        moduleUrl: import.meta.url,
        methods: structuredClone(methodContracts),
        events: Object.fromEntries(Object.entries(structuredClone(eventContracts)).map(([type, fields]) => [type, { type, ...fields }])),
      }));
    },
  };
}
