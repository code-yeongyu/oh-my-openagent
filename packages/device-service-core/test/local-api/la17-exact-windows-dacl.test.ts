import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { writeToken, type SecureFile } from "../../src/local-api/access.ts";
import {
  applyExactDacl,
  currentUserSid,
  DESCRIBE_DACL_SCRIPT,
  describeDacl,
  verifyExactDacl,
  windowsSecureFile,
  type PowerShellRunner,
  runPowerShell,
  userSidToken,
} from "../../src/local-api/dacl.ts";
import { LocalApiError } from "../../src/local-api/errors.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { cleanup, freshStateDir } from "./support.ts";
import { EVERYONE, icacls, readAs } from "./support-windows.ts";

afterEach(cleanup);

const windowsOnly = test.skipIf(process.platform !== "win32");
const SECOND_USER = "omoqa2";
const SLOW_MS = 120_000;

const secondUserPassword = (): string => {
  const password = process.env["OMOQA2_PASSWORD"];
  if (password === undefined || password === "")
    throw new Error("the Windows CI job creates omoqa2 and exports OMOQA2_PASSWORD");
  return password;
};

describe("LA17 exact protected DACL on Windows (second local user omoqa2)", () => {
  windowsOnly(
    "an explicit Everyone:(R) ACE and an inherited grant are replaced by exactly one ACE and the second user's read is refused",
    async () => {
      const password = secondUserPassword();
      const sid = await currentUserSid();
      const parent = freshStateDir();
      await icacls(parent, "/grant", `${SECOND_USER}:(OI)(CI)(R)`);
      const dir = join(parent, "device-service");
      mkdirSync(dir);
      const file = join(dir, "token");
      writeFileSync(file, "per-boot secret");
      await icacls(dir, "/grant", `${EVERYONE}:(OI)(CI)(R)`);
      await icacls(file, "/grant", `${EVERYONE}:(R)`);
      expect(await readAs(SECOND_USER, password, file)).toBe("read_ok");
      expect(await verifyExactDacl(dir, sid, "dir")).toBe(false);
      expect(await verifyExactDacl(file, sid, "file")).toBe(false);

      await applyExactDacl(dir, sid, "dir");
      await applyExactDacl(file, sid, "file");
      // The SDDL comparison comes first so a refusal prints the descriptor Windows actually wrote.
      const after = await describeDacl(file);
      const dirSddl = (await describeDacl(dir)).sddl;
      const alias = (await userSidToken(sid)) ?? sid;
      const mask = (sddl: string): string =>
        sddl.replaceAll(sid, "<user>").replace(new RegExp(`(?<=O:|;)${alias}(?=D:|\\))`, "g"), "<user>");
      expect(mask(dirSddl)).toBe("O:<user>D:PAI(A;OICI;FA;;;<user>)");
      expect(mask(after.sddl)).toBe("O:<user>D:PAI(A;;FA;;;<user>)");
      expect(await verifyExactDacl(dir, sid, "dir")).toBe(true);
      expect(await verifyExactDacl(file, sid, "file")).toBe(true);
      expect(after.aces.map((ace) => ace.sid)).toEqual([alias]);
      expect(await readAs(SECOND_USER, password, file)).toBe("read_denied");
    },
    SLOW_MS,
  );

  windowsOnly(
    "LA17b negative control: icacls /inheritance:r /grant:r alone leaves the Everyone ACE",
    async () => {
      const password = secondUserPassword();
      const sid = await currentUserSid();
      const file = join(freshStateDir(), "token");
      writeFileSync(file, "per-boot secret");
      await icacls(file, "/grant", `${EVERYONE}:(R)`);
      await icacls(file, "/inheritance:r", "/grant:r", `*${sid}:(F)`);
      const dacl = await describeDacl(file);
      expect(dacl.aces.some((ace) => ace.sid === "WD")).toBe(true);
      expect(await verifyExactDacl(file, sid, "file")).toBe(false);
      expect(await readAs(SECOND_USER, password, file)).toBe("read_ok");
    },
    SLOW_MS,
  );

  test(
    "LA17c an unverifiable DACL stops before the token exists",
    async () => {
      const dir = freshStateDir();
      const refusing: SecureFile = async () => {
        throw new LocalApiError("insecure_state_dir", "the DACL could not be verified");
      };
      expect(await rejectionOf(writeToken(dir, refusing))).toMatchObject({
        code: "insecure_state_dir",
      });
      expect(existsSync(join(dir, "token"))).toBe(false);

      // The fake answers the describe script itself (matched by identity, not by a substring of it) with an
      // unreadable result; on Windows every other script, the apply among them, runs for real.
      let describes = 0;
      const answers: PowerShellRunner = async (script, env) => {
        if (script === DESCRIBE_DACL_SCRIPT) {
          describes += 1;
          return { code: 0, out: "not json" };
        }
        return process.platform === "win32"
          ? runPowerShell(script, env)
          : { code: 0, out: "applied" };
      };
      const sid = process.platform === "win32" ? await currentUserSid() : "S-1-5-21-1-2-3-1001";
      const secondDir = freshStateDir();
      expect(
        await rejectionOf(writeToken(secondDir, windowsSecureFile(sid, answers))),
      ).toMatchObject({ code: "insecure_state_dir" });
      expect(describes).toBeGreaterThan(0);
      expect(existsSync(join(secondDir, "token"))).toBe(false);
    },
    SLOW_MS,
  );
});
