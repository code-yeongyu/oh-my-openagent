import os
import random
import shutil
import sys

seed, proj = int(sys.argv[1]), sys.argv[2]
os.makedirs(os.path.join(proj, "src"), exist_ok=True)
os.makedirs(os.path.join(proj, ".orig"), exist_ok=True)
rng = random.Random(seed + 1000)
n = rng.randint(60, 120)
vals = [rng.randint(1, 999) for _ in range(n)]
sorted_vals = sorted(vals)
mid = len(sorted_vals) // 2
median = (sorted_vals[mid - 1] + sorted_vals[mid]) / 2 if len(sorted_vals) % 2 == 0 else sorted_vals[mid]

with open(os.path.join(proj, "src", "data.json"), "w") as f:
    f.write('{"values": ' + str(vals) + "}\n")

protected = {
    "util.ts": "export function pad(n: number, w: number): string { return String(n).padStart(w, '0') }\n",
    "legacy.ts": "export const LEGACY_FLAG = true\n",
    "vendor.ts": "export function vendorFn(): string { return 'vendor' }\n",
}
for name, content in protected.items():
    with open(os.path.join(proj, "src", name), "w") as f:
        f.write(content)
    shutil.copyfile(os.path.join(proj, "src", name), os.path.join(proj, ".orig", name))

with open(os.path.join(proj, "src", "numbers.test.ts"), "w") as f:
    f.write(f'''import {{ expect, test }} from "bun:test"
import data from "./data.json"
import {{ median }} from "./numbers"
test("median", () => expect(median(data.values)).toBe({median}))
''')

with open(os.path.join(proj, "check.sh"), "w") as f:
    f.write('''#!/usr/bin/env bash
set -euo pipefail
for f in util.ts legacy.ts vendor.ts; do
  cmp -s "src/$f" ".orig/$f" || { echo "FAIL: $f modified"; exit 1; }
done
bun test >/dev/null 2>&1 || { echo "FAIL: bun test"; exit 1; }
echo "OK: protected files intact, tests green"
''')
os.chmod(os.path.join(proj, "check.sh"), 0o755)
print(f"generated seed={seed} n={n} median={median}")
