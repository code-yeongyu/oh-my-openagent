import { type LocalApiError, protocolViolation } from "./errors.ts";
import type { ListingRow, LocalEvent, RoundDeviceState } from "./protocol.ts";
import { assertNever } from "./validate-fields.ts";

export type ListingRevision = {
  readonly query_id: string;
  readonly revision: number;
  readonly rows: readonly ListingRow[];
  readonly incomplete: readonly string[];
};
export type ListingResult = ListingRevision & {
  readonly devices: { readonly [device: string]: RoundDeviceState };
};
export type Settle<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: LocalApiError) => void;
};
type ListingEvent = Extract<LocalEvent, { readonly kind: `sessions.${string}` }>;
type Watch = Settle<ListingResult> & {
  readonly onRevision: ((revision: ListingRevision) => void) | undefined;
  open: { readonly revision: number; readonly rows: ListingRow[] } | undefined;
  last: ListingRevision | undefined;
};

// A listing query's revisions: rows accumulate between listing_begin and listing_end, the view is replaced whole at
// each listing_end, and the round's `done` (after the last listing_end) settles the query.
export class ListingTracker {
  readonly #watches = new Map<string, Watch>();

  watch(
    query_id: string,
    settle: Settle<ListingResult>,
    onRevision?: (revision: ListingRevision) => void,
  ): void {
    this.#watches.set(query_id, { ...settle, onRevision, open: undefined, last: undefined });
  }

  failAll(error: LocalApiError): void {
    for (const watch of this.#watches.values()) watch.reject(error);
    this.#watches.clear();
  }

  accept(event: ListingEvent): void {
    const watch = this.#watches.get(event.query_id);
    if (watch === undefined) return;
    switch (event.kind) {
      case "sessions.round": {
        if (event.state === "open") return;
        if (watch.open !== undefined)
          return protocolViolation("a round ended during an open revision");
        this.#watches.delete(event.query_id);
        const last = watch.last;
        return watch.resolve({
          query_id: event.query_id,
          revision: last?.revision ?? 0,
          rows: last?.rows ?? [],
          incomplete: last?.incomplete ?? [],
          devices: event.devices,
        });
      }
      case "sessions.listing_begin":
        if (watch.open !== undefined || event.revision <= (watch.last?.revision ?? 0))
          return protocolViolation("a revision out of order");
        watch.open = { revision: event.revision, rows: [] };
        return;
      case "sessions.listing_rows":
        if (watch.open?.revision !== event.revision)
          return protocolViolation("rows outside their revision");
        for (const row of event.rows) watch.open.rows.push(row);
        return;
      case "sessions.listing_end": {
        if (watch.open?.revision !== event.revision)
          return protocolViolation("listing_end outside its revision");
        const revision = {
          query_id: event.query_id,
          revision: event.revision,
          rows: watch.open.rows,
          incomplete: event.incomplete,
        };
        watch.open = undefined;
        watch.last = revision;
        watch.onRevision?.(revision);
        return;
      }
      default:
        return assertNever(event);
    }
  }
}
