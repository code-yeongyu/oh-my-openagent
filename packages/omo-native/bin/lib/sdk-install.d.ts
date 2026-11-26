import type { CoreContext, NamespaceCore } from "../../../omo-senpi/src/components/omo-sdk/root/members.ts"

/** The install namespace's calls for one root; `overrides` replaces ports per call (the SDK's scenario drivers). */
export function installCore(
  context: CoreContext,
  overrides?: {
    readonly update?: Readonly<Record<string, unknown>>
    readonly setup?: Readonly<Record<string, unknown>>
    readonly version?: Readonly<Record<string, unknown>>
    readonly sdkRoot?: { packageDir: string; fs: { readFile: (path: string) => Promise<string> } }
  },
): Promise<NamespaceCore<"install">>

export function sdkRoot(
  input?: object,
  ports?: { packageDir: string; fs: { readFile: (path: string) => Promise<string> } },
): Promise<
  | { kind: "ok"; value: { path: string } }
  | {
      kind: "error"
      error: { code: "not_implemented"; message: string; next_action: string; details: { entry: string } }
    }
>
