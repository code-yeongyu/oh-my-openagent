# WHY IT IS ENOUGH

The two red tests reproduce the exact corruption mechanics reported in #6513
(whole-block reprint after a tool boundary; content dropped/spliced when the
diff offset is stale) at the unit level where event ordering is fully
controllable. The fix makes snapshot diffing per-part and prefix-based, which
removes the entire class of stale-offset slices: duplication, substitution,
mid-content splices, and dropped parts. The pre-existing 196 renderer tests
(delta/snapshot interplay, tool headers/outputs, completion meta, message
resets, integration flows) all still pass, pinning that normal growth prints
only suffixes and legacy id-less part shapes still dedup.

Remaining regression risk: a genuine provider-side replace of already-streamed
text now re-prints the replacement block in full (honest rendering of new
content) instead of attempting an in-place diff; this is intentional and cannot
produce mid-text splices.
