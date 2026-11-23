// Vendored from sisyphuslabs/omo-relay-daemon@88e58154bb592d781446a62a3d8d912769675079 packages/local-api/src/secure-windows.ts
import type { SecureFile } from "./access.ts";
import {
  applyExactDacl,
  DESCRIBE_DACL_SCRIPT,
  exactDaclVerdict,
  parseSddl,
  runPowerShell,
  verifyExactDacl,
  type DaclDescription,
  type PowerShellRunner,
} from "./dacl.ts";
import { LocalApiError, type InsecureStateCause } from "./errors.ts";

export const REPARSE_POINT = 0x400;
// The SDDL reader is dacl.ts's own; only its last line (one path) is replaced.
const READ_ONE = "[LaSddl]::Read($env:LA_PATH)";
// One level read in ONE invocation: the attributes of the entry itself first, and the raw SDDL only when it is not a
// reparse point, so GetNamedSecurityInfoW never follows a junction.
export const LEVEL_READ = String.raw`$attributes = [int](Get-Item -LiteralPath $env:OMO_LEVEL_PATH -Force).Attributes
$sddl = ''
if (($attributes -band ${REPARSE_POINT}) -eq 0) { $sddl = [LaSddl]::Read($env:OMO_LEVEL_PATH) }
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ attributes = $attributes; sddl = $sddl })`;
export const sddlReaderWith = (body: string): string => {
  if (!DESCRIBE_DACL_SCRIPT.includes(READ_ONE))
    throw new Error("the DACL reader script changed shape");
  return DESCRIBE_DACL_SCRIPT.replace(READ_ONE, body);
};

// A level as one read saw it; `dacl` is undefined for a reparse point or a descriptor that did not parse.
type Level = Readonly<{ reparse: boolean; dacl: DaclDescription | undefined }>;
// The read is the script's last line: an apply before it prints its own line first.
export const levelOf = (code: number, out: string): Level | undefined => {
  if (code !== 0) return undefined;
  let row: unknown;
  try {
    row = JSON.parse(out.trim().split("\n").at(-1) ?? "");
  } catch {
    return undefined;
  }
  if (typeof row !== "object" || row === null) return undefined;
  const attributes: unknown = Reflect.get(row, "attributes");
  const sddl: unknown = Reflect.get(row, "sddl");
  if (typeof attributes !== "number" || !Number.isInteger(attributes)) return undefined;
  if (typeof sddl !== "string") return undefined;
  const reparse = (attributes & REPARSE_POINT) !== 0;
  return { reparse, dacl: reparse ? undefined : parseSddl(sddl) };
};

// BUILTIN\Administrators as SDDL writes it (the alias) or as a SID: the default owner of what an elevated token creates.
const ADMINISTRATORS = new Set(["BA", "S-1-5-32-544"]);
type LevelCause = Extract<
  InsecureStateCause,
  "owner_administrators" | "owner_other" | "reparse" | "unreadable"
>;
const REFUSED: Readonly<Record<LevelCause, string>> = {
  owner_administrators: "is owned by BUILTIN\\Administrators (written by an elevated run)",
  owner_other: "is owned by another account",
  reparse: "is a reparse point",
  unreadable: "is unreadable",
};

const refusalOf = (level: Level | undefined, userSid: string): LevelCause | undefined => {
  if (level === undefined) return "unreadable";
  if (level.reparse) return "reparse";
  if (level.dacl === undefined) return "unreadable";
  if (level.dacl.owner === userSid) return undefined;
  // Any other owner alias or SID is another account.
  return ADMINISTRATORS.has(level.dacl.owner) ? "owner_administrators" : "owner_other";
};

// The apply makes the user the owner of whatever it is given, so an entry this call did not create (one another
// account may have planted, keeping WRITE_OWNER) must already be plain and the user's: re-owning it would adopt it.
export const windowsSecureFile =
  (userSid: string, run: PowerShellRunner = runPowerShell): SecureFile =>
  async (path, kind, origin) => {
    const target = kind === "dir" ? "dir" : "file";
    if (origin === "existing") {
      const { code, out } = await run(sddlReaderWith(LEVEL_READ), { OMO_LEVEL_PATH: path });
      const level = levelOf(code, out);
      const cause = refusalOf(level, userSid);
      if (cause !== undefined)
        throw new LocalApiError("insecure_state_dir", `the ${target} ${REFUSED[cause]}`, {
          insecure_cause: cause,
        });
      // #1452: an entry that already carries the exact DACL is accepted as it is, never rewritten.
      if (level?.dacl !== undefined && exactDaclVerdict(level.dacl, userSid, target)) return;
    }
    await applyExactDacl(path, userSid, target, run);
    if (!(await verifyExactDacl(path, userSid, target, run)))
      throw new LocalApiError(
        "insecure_state_dir",
        "the DACL is not exactly one ACE for the user",
        {
          insecure_cause: "dacl_not_exact",
        },
      );
  };
