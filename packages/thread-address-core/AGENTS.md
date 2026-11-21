# thread-address-core

The thread and device address rules every omo surface shares (#14305): the address grammar, the device resolver, the one name comparison, row identity and naming, the per-device listing state, and the typed refusals as plain data. omo-senpi's thread tools and remote client import it as a workspace dependency; the omo desktop app vendors these files byte-for-byte at its omo runtime pin and loads them in its web client.

## Rules

- Zero runtime dependencies: no package import, no `node:` built-in, no Node or Bun global. `src/self-contained.test.ts` fails when a source file imports anything but a sibling file (`./name`); `tsconfig.json` (`"types": []`, tests excluded) fails the typecheck on a Node or Bun global in a source file. Tests typecheck under `tsconfig.test.json` with `bun-types`.
- Plain data in, plain data out. No messages that name omo tools: a refusal is `{ code, reason, details }`, and the caller words it (omo-senpi: `thread/address/refusals.ts` `toolRefusal`).
- `parse.ts` imports nothing at all: `components/remote/seams.ts` (the published omo-ai/remote types) reaches it, and `remote/types-closure.test.ts` allows it only as a leaf.

## Anatomy

| File | Owns |
|------|------|
| `parse.ts` | `parseAddress` (`self`, a bare address, or `<device>/<thread>` split on its single `/` unless the text is a path), `formatAddress`, the thread id / session id / id prefix shapes, `DEVICE_PREFIX_MIN`, `HERE` |
| `name.ts` | `normalizeName`: NFKC, trim, lowercase, collapsed whitespace; `thread/addressing.ts` `normalizeThreadName` is this function |
| `device.ts` | `resolveDevice`: exact id > `here` > name (online twins count) > unique 6+ id prefix; `DeviceRef` |
| `listing.ts` | `deviceListing`: `listed / incomplete / offline` from one round and the roster |
| `row.ts` | `rowKey`, `rowAddress`, `rowName` (only a real name is an address; a fallback is `unnamed`), `mergeRows` |
| `refusals.ts` | refusal codes, the plain refusal union and its builders, the device candidate shape, `deviceLabel` (`name (id)`) |

The stateful half (account reads, `resolveAddress`) lives in `packages/omo-senpi/src/components/thread/address/`.
