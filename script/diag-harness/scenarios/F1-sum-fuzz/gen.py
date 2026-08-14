import os
import random
import sys

seed, proj = int(sys.argv[1]), sys.argv[2]
os.makedirs(os.path.join(proj, "src"), exist_ok=True)
rng = random.Random(seed)
n = rng.randint(12, 22)
values = [rng.randint(1, 50) for _ in range(n)]
needle = values[rng.randrange(n)]
for _ in range(rng.randint(2, 8)):
    values[rng.randrange(n)] = needle
total = sum(values)
modal = max(set(values), key=values.count)
modal_count = values.count(modal)

for i, v in enumerate(values, 1):
    with open(os.path.join(proj, "src", f"a{i:02d}.ts"), "w") as f:
        f.write(f"export const V: number = {v}\n")

with open(os.path.join(proj, "src", "sum.test.ts"), "w") as f:
    f.write(f'''import {{ expect, test }} from "bun:test"
import {{ total, modalCount }} from "./sum"
test("total", () => expect(total).toBe({total}))
test("modalCount", () => expect(modalCount).toBe({modal_count}))
''')

with open(os.path.join(proj, "check.sh"), "w") as f:
    f.write(f'''#!/usr/bin/env bash
set -euo pipefail
bun test >/dev/null 2>&1 || {{ echo "FAIL: bun test"; exit 1; }}
echo "OK: total={total} modal={modal} count={modal_count}"
''')
os.chmod(os.path.join(proj, "check.sh"), 0o755)
print(f"generated seed={seed} n={n} total={total} modal={modal} modalCount={modal_count}")
