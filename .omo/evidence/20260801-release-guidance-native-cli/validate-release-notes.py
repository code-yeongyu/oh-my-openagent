from pathlib import Path
import re
import sys

for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    text = path.read_text()
    assert re.search(
        r"(?im)^#{1,3}\s+.*LAST RELEASE BEFORE.*OMO NATIVE CLI PUBLIC RELEASE",
        text,
    ), f"{path}: missing dedicated Native CLI transition heading"
    assert not re.search(
        r"senpi|omo-senpi|senpi-task|pi-goal|pi-webfetch",
        text,
        re.IGNORECASE,
    ), f"{path}: contains an excluded internal adapter reference"
    print(f"PASS {path}")
