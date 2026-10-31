import { spawn } from "node:child_process";

import type { SecureFile } from "./access.ts";
import { LocalApiError } from "./errors.ts";

// Windows: every state dir entry carries an EXACT protected DACL. A fresh DirectorySecurity/FileSecurity with
// inheritance disabled, the user SID as owner and exactly one FullControl ACE for it is applied with .NET's
// File/Directory.SetAccessControl (which replaces the DACL; icacls /grant:r keeps foreign explicit ACEs), then read
// back as the raw SDDL and judged here.
// Inputs travel in environment variables, never inside the script text.
export type PowerShellRunner = (
  script: string,
  env: { readonly [name: string]: string },
) => Promise<{ readonly code: number; readonly out: string; readonly err?: string }>;

export const runPowerShell: PowerShellRunner = async (script, env) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (exitCode) => resolve(exitCode ?? -1));
  });
  return {
    code,
    out: Buffer.concat(chunks).toString("utf8"),
    err: Buffer.concat(errChunks).toString("utf8"),
  };
};

// The first non-empty line of a failed script's stderr, bounded, so a refusal names the Windows error.
const firstErrorLine = (err: string | undefined): string => {
  const line =
    (err ?? "")
      .split(/\r?\n/)
      .find((text) => text.trim() !== "" && !text.startsWith("#< CLIXML"))
      ?.trim() ?? "";
  return line === "" ? "" : `: ${line.slice(0, 300)}`;
};

const APPLY = String.raw`
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
$sid = New-Object System.Security.Principal.SecurityIdentifier($env:LA_SID)
if ($env:LA_KIND -eq 'dir') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid,
  [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit,
  [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($sid)
$acl.AddAccessRule($rule)
if ($env:LA_KIND -eq 'dir') {
  [System.IO.Directory]::SetAccessControl($env:LA_PATH, $acl)
} else {
  [System.IO.File]::SetAccessControl($env:LA_PATH, $acl)
}
Write-Output 'applied'
`;

// The raw security descriptor, owner and DACL, as SDDL straight from Win32 (GetNamedSecurityInfoW, then
// ConvertSecurityDescriptorToStringSecurityDescriptorW). .NET's Get-Acl/.Access is not used: it can hide ACE kinds
// (conditional and callback ACEs among them) that would still grant access.
export const DESCRIBE_DACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class LaSddl {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfoW(string name, int type, int info, out IntPtr owner, out IntPtr group,
    out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, int revision, int info,
    out IntPtr text, out int length);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  public static string Read(string path) {
    IntPtr owner, group, dacl, sacl, sd;
    uint code = GetNamedSecurityInfoW(path, 1, 5, out owner, out group, out dacl, out sacl, out sd);
    if (code != 0) throw new Win32Exception((int)code);
    try {
      IntPtr text; int length;
      if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 5, out text, out length))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    } finally { LocalFree(sd); }
  }
}
'@
[LaSddl]::Read($env:LA_PATH)
`;

// SDDL names well-known accounts by alias (the machine's built-in Administrator, RID 500, reads "LA"), so the owner
// and ACE of an exact DACL may carry an alias instead of the user's SID. This prints the token SDDL uses for
// $env:LA_SID on this machine, so the verdict can accept exactly that alias and nothing else.
const SID_TOKEN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
(New-Object System.Security.AccessControl.RawSecurityDescriptor("O:$env:LA_SID")).GetSddlForm('Owner')
`;

// Prints the current user's SID (the S-1-... form, never an alias).
export const CURRENT_USER_SID_SCRIPT =
  "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value";

export type SddlAce = {
  readonly type: string;
  readonly flags: string;
  readonly rights: string;
  readonly objectGuid: string;
  readonly inheritObjectGuid: string;
  readonly sid: string;
  readonly extra: string | undefined;
};
export type DaclDescription = {
  readonly sddl: string;
  readonly owner: string;
  readonly protected: boolean;
  readonly flags: string;
  readonly aces: readonly SddlAce[];
};

// Every ACE type SDDL can name. A type outside this list is a parse failure; a listed type other than A is kept and
// refused by the verdict, never skipped.
const ACE_TYPES = new Set([
  "A",
  "D",
  "OA",
  "OD",
  "AU",
  "AL",
  "OU",
  "OL",
  "ML",
  "XA",
  "XD",
  "ZA",
  "XU",
  "SP",
  "RA",
  "SD",
  "CA",
]);
const DACL_FLAG = /^(?:P|AI|AR|NO_ACCESS_CONTROL)/;
const SID_TOKEN = /^(?:S-1-\d+(?:-\d+)+|[A-Z]{2})$/;

// One ACE from "(" to its balanced ")": a conditional or resource ACE carries a parenthesized seventh field, whose
// quoted strings may hold parentheses; those are skipped. A quote outside that field, or an unterminated one, is a
// parse failure, so no quote can carry text across an ACE boundary.
const aceEnd = (text: string, start: number): number | undefined => {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '"') {
      if (depth < 2) return undefined;
      const close = text.indexOf('"', i + 1);
      if (close === -1) return undefined;
      i = close;
    } else if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
};

// An ACE GUID field is empty or one canonical GUID, so no paren or quote can hide in it.
const GUID_FIELD =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?$/;

const parseAce = (body: string): SddlAce | undefined => {
  const parts = body.split(";");
  if (parts.length < 6) return undefined;
  const [type = "", flags = "", rights = "", objectGuid = "", inheritObjectGuid = "", sid = ""] =
    parts;
  const extra = parts.length > 6 ? parts.slice(6).join(";") : undefined;
  if (!ACE_TYPES.has(type) || !SID_TOKEN.test(sid)) return undefined;
  if (!/^[A-Z]*$/.test(flags) || !/^(?:[A-Z]+|0x[0-9a-fA-F]+)?$/.test(rights)) return undefined;
  if (extra === undefined && parts.length !== 6) return undefined;
  if (!GUID_FIELD.test(objectGuid) || !GUID_FIELD.test(inheritObjectGuid)) return undefined;
  return { type, flags, rights, objectGuid, inheritObjectGuid, sid, extra };
};

// Parses "O:<sid>D:<flags>(<ace>)..." and nothing else: a group or SACL section, an unknown flag or ACE type, and any
// text outside the ACEs are parse failures (undefined), which the callers treat as "not exact".
export const parseSddl = (sddl: string): DaclDescription | undefined => {
  const head = /^O:(S-1-\d+(?:-\d+)+|[A-Z]{2})D:/.exec(sddl);
  if (head === null) return undefined;
  const owner = head[1] ?? "";
  let rest = sddl.slice(head[0].length);
  const tokens: string[] = [];
  for (let flag = DACL_FLAG.exec(rest); flag !== null; flag = DACL_FLAG.exec(rest)) {
    tokens.push(flag[0]);
    rest = rest.slice(flag[0].length);
  }
  const aces: SddlAce[] = [];
  while (rest.length > 0) {
    if (!rest.startsWith("(")) return undefined;
    const close = aceEnd(rest, 0);
    if (close === undefined) return undefined;
    const ace = parseAce(rest.slice(1, close));
    if (ace === undefined) return undefined;
    aces.push(ace);
    rest = rest.slice(close + 1);
  }
  return { sddl, owner, protected: tokens.includes("P"), flags: tokens.join(""), aces };
};

// Exactly "D:PAI(A;OICI;FA;;;<sid>)" for a directory and "D:PAI(A;;FA;;;<sid>)" for a file, owned by <sid>.
export const exactDaclVerdict = (
  dacl: DaclDescription,
  userSid: string,
  kind: "dir" | "file",
  userAlias?: string,
): boolean => {
  const isUser = (token: string): boolean => token === userSid || (userAlias !== undefined && token === userAlias);
  const [ace, ...others] = dacl.aces;
  return (
    isUser(dacl.owner) &&
    dacl.flags === "PAI" &&
    ace !== undefined &&
    others.length === 0 &&
    ace.type === "A" &&
    ace.flags === (kind === "dir" ? "OICI" : "") &&
    ace.rights === "FA" &&
    ace.objectGuid === "" &&
    ace.inheritObjectGuid === "" &&
    isUser(ace.sid) &&
    ace.extra === undefined
  );
};

export const currentUserSid = async (run: PowerShellRunner = runPowerShell): Promise<string> => {
  const { code, out } = await run(CURRENT_USER_SID_SCRIPT, {});
  const sid = out.trim();
  if (code !== 0 || !/^S-1-[0-9-]+$/.test(sid))
    throw new LocalApiError("insecure_state_dir", "the user SID is unreadable");
  return sid;
};

// The SDDL token for userSid on this machine (an alias such as "LA", or the SID itself); undefined when it cannot be
// read, so the verdict then accepts the literal SID only.
export const userSidToken = async (
  userSid: string,
  run: PowerShellRunner = runPowerShell,
): Promise<string | undefined> => {
  const { code, out } = await run(SID_TOKEN_SCRIPT, { LA_SID: userSid });
  const match = code === 0 ? /^O:(S-1-\d+(?:-\d+)+|[A-Z]{2})$/.exec(out.trim()) : null;
  return match?.[1];
};

export const applyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<void> => {
  const { code, err } = await run(APPLY, { LA_PATH: path, LA_SID: userSid, LA_KIND: kind });
  if (code !== 0)
    throw new LocalApiError(
      "insecure_state_dir",
      `the exact DACL could not be applied${firstErrorLine(err)}`,
    );
};

export const describeDacl = async (
  path: string,
  run: PowerShellRunner = runPowerShell,
): Promise<DaclDescription> => {
  const { code, out } = await run(DESCRIBE_DACL_SCRIPT, { LA_PATH: path });
  const dacl = code === 0 ? parseSddl(out.trim()) : undefined;
  if (dacl === undefined)
    throw new LocalApiError("insecure_state_dir", "the DACL could not be read back");
  return dacl;
};

// Fails closed: a DACL that cannot be read back is not exact.
export const verifyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<boolean> => {
  let dacl: DaclDescription;
  try {
    dacl = await describeDacl(path, run);
  } catch (error) {
    if (error instanceof LocalApiError) return false;
    throw error;
  }
  return exactDaclVerdict(dacl, userSid, kind, await userSidToken(userSid, run));
};

export const windowsSecureFile =
  (userSid: string, run: PowerShellRunner = runPowerShell): SecureFile =>
  async (path, kind) => {
    const target = kind === "dir" ? "dir" : "file";
    await applyExactDacl(path, userSid, target, run);
    if (!(await verifyExactDacl(path, userSid, target, run)))
      throw new LocalApiError("insecure_state_dir", "the DACL is not exactly one ACE for the user");
  };
