/**
 * SDK v1→v2 compatibility wrapper.
 *
 * OpenCode v1.17.10 migrated the plugin system from SDK v1 to v2 exclusively.
 * The v2 client uses flattened parameters instead of nested { path, body, query } style.
 *
 * This wrapper intercepts v1-style calls and translates them to v2-style at runtime,
 * allowing OMO to work with both v1 and v2 clients without changing all 73 call sites.
 *
 * When the @opencode-ai/plugin package is updated to export v2 types, this wrapper
 * can be removed and all call sites can be updated to use v2-style directly.
 */

type V1Params = {
  path?: { id?: string; [key: string]: unknown };
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  [key: string]: unknown;
};

function flattenV1Params(params: V1Params): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (params.path?.id !== undefined) {
    result.sessionID = params.path.id;
  }

  if (params.body) {
    for (const [key, value] of Object.entries(params.body)) {
      result[key] = value;
    }
  }

  if (params.query) {
    for (const [key, value] of Object.entries(params.query)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (key !== 'path' && key !== 'body' && key !== 'query' && !(key in result)) {
      result[key] = value;
    }
  }

  return result;
}

function isV1Style(params: unknown): params is V1Params {
  if (typeof params !== 'object' || params === null) return false;
  const obj = params as Record<string, unknown>;
  return 'path' in obj || 'body' in obj || 'query' in obj;
}

export function wrapSessionForV2Compat(session: unknown): unknown {
  if (typeof session !== 'object' || session === null) return session;

  return new Proxy(session as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      return function (this: unknown, ...args: unknown[]) {
        if (args.length > 0 && isV1Style(args[0])) {
          args[0] = flattenV1Params(args[0]);
        }
        return value.apply(this, args);
      };
    },
  });
}

export function wrapClientForV2Compat(client: unknown): unknown {
  if (typeof client !== 'object' || client === null) return client;

  return new Proxy(client as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'session') {
        return wrapSessionForV2Compat(value);
      }

      return value;
    },
  });
}
