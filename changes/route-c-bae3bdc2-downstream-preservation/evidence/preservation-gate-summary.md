# Preservation Gate Summary (Task 6)

- Timestamp (UTC): `2026-02-27T19:00:11Z`
- Scope: Route C dual-gate consolidation audit preservation checks

## Command Set Used

1. `bun -e 'const fs=require("fs");const base="changes/route-c-bae3bdc2-downstream-preservation";const load=(name)=>fs.readFileSync(base+"/"+name,"utf8");const parseRows=(md)=>md.split(/\r?\n/).filter((l)=>l.startsWith("|")&&!l.includes("---")).map((l)=>l.split("|").slice(1,-1).map((c)=>c.trim()));const primary=(md)=>md.split(/(?:\r?\n)## Wave A Execution Outcome/)[0];const patchRows=parseRows(primary(load("required-patches.md"))).filter((r)=>/^RP-\d+/.test(r[0]));const pathRows=parseRows(primary(load("required-paths.md"))).filter((r)=>/^PATH-\d+/.test(r[0]));const exceptionRows=parseRows(load("approved-exceptions.md")).filter((r)=>/^EX-\d+/.test(r[0]));const normalize=(s)=>s.split(String.fromCharCode(96)).join("");const requiredPatchRows=patchRows.filter((r)=>["PRESERVE","EQUIVALENT_REWRITE"].includes(normalize(r[3])));const requiredPathRows=pathRows.filter((r)=>["PRESERVE","EQUIVALENT_REWRITE"].includes(normalize(r[3])));const patchIdSet=new Set(requiredPatchRows.map((r)=>normalize(r[0])));const sourcePatchIdSet=new Set(requiredPathRows.map((r)=>normalize(r[4])));const missingPatchIds=[...patchIdSet].filter((id)=>!sourcePatchIdSet.has(id)).sort();const missingRequiredPaths=requiredPathRows.filter((r)=>!fs.existsSync(normalize(r[1]))).map((r)=>normalize(r[1])).sort();const approvedExceptionPaths=new Set(exceptionRows.map((r)=>normalize(r[1])));const unapprovedRequiredPathLoss=missingRequiredPaths.filter((p)=>!approvedExceptionPaths.has(p)).sort();console.log("REQUIRED_PATCHES_TOTAL="+requiredPatchRows.length);console.log("REQUIRED_PATHS_TOTAL="+requiredPathRows.length);console.log("APPROVED_EXCEPTIONS_TOTAL="+approvedExceptionPaths.size);console.log("REQUIRED_PATCHES_MISSING="+missingPatchIds.length);console.log("UNAPPROVED_REQUIRED_PATH_LOSS="+unapprovedRequiredPathLoss.length);console.log("MISSING_REQUIRED_PATCH_IDS="+(missingPatchIds.length?missingPatchIds.join(","):"<none>"));console.log("MISSING_REQUIRED_PATHS="+(missingRequiredPaths.length?missingRequiredPaths.join(","):"<none>"));console.log("UNAPPROVED_LOSS_PATHS="+(unapprovedRequiredPathLoss.length?unapprovedRequiredPathLoss.join(","):"<none>"));'`

## Metrics

| Metric | Value |
|---|---:|
| `REQUIRED_PATCHES_TOTAL` | `78` |
| `REQUIRED_PATHS_TOTAL` | `78` |
| `APPROVED_EXCEPTIONS_TOTAL` | `28` |
| `REQUIRED_PATCHES_MISSING` | `0` |
| `UNAPPROVED_REQUIRED_PATH_LOSS` | `0` |
| `MISSING_REQUIRED_PATCH_IDS` | `<none>` |
| `MISSING_REQUIRED_PATHS` | `<none>` |
| `UNAPPROVED_LOSS_PATHS` | `<none>` |

## Command Transcript Snippet

```text
REQUIRED_PATCHES_TOTAL=78
REQUIRED_PATHS_TOTAL=78
APPROVED_EXCEPTIONS_TOTAL=28
REQUIRED_PATCHES_MISSING=0
UNAPPROVED_REQUIRED_PATH_LOSS=0
MISSING_REQUIRED_PATCH_IDS=<none>
MISSING_REQUIRED_PATHS=<none>
UNAPPROVED_LOSS_PATHS=<none>
```

## Preservation Gate Verdict

`PRESERVATION_GATE_RESULT=PASS`
