export declare const SDK_ENTRY_DIR: string

export type SdkInstallPorts = { readonly entryDir: string }

export declare function sdkRoot(
  input?: object,
  ports?: SdkInstallPorts,
): Promise<{ readonly kind: "ok"; readonly value: { readonly path: string } }>

export declare function installCore(): {
  readonly sdkRoot: (input?: object) => ReturnType<typeof sdkRoot>
}
