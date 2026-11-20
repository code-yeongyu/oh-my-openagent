#!/bin/bash
# Builds the WKWebView fixture app bundle with the image's own swiftc; usage: build.sh <output dir>.
set -euo pipefail
out="$1"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$out/Conformance Fixture Web.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
swiftc -swift-version 5 -O -warnings-as-errors -framework AppKit -framework WebKit \
  -o "$bundle/Contents/MacOS/Conformance Fixture" "$here/main.swift" "$here/webkit-temp-cleanup.swift"
cp "$here/../web/index.html" "$here/../web/page.js" "$bundle/Contents/Resources/"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Conformance Fixture</string>
  <key>CFBundleIdentifier</key><string>dev.omo.conformance-fixture.webview</string>
  <key>CFBundleExecutable</key><string>Conformance Fixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
echo "$bundle/Contents/MacOS/Conformance Fixture"
