#!/bin/bash
# Builds "Conformance Fixture.app" with the image's own swiftc; usage: build.sh <output dir>.
set -euo pipefail
out="$1"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$out/Conformance Fixture.app"
mkdir -p "$bundle/Contents/MacOS"
swiftc -swift-version 5 -O -warnings-as-errors -framework AppKit \
  -o "$bundle/Contents/MacOS/Conformance Fixture" \
  "$here/Controls.swift" "$here/DocumentWindow.swift" "$here/main.swift"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Conformance Fixture</string>
  <key>CFBundleIdentifier</key><string>dev.omo.conformance-fixture</string>
  <key>CFBundleExecutable</key><string>Conformance Fixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
echo "$bundle/Contents/MacOS/Conformance Fixture"
