export const XORG_CONF = `Section "ServerFlags"
  Option "AutoAddDevices" "true"
  Option "AutoEnableDevices" "true"
  Option "DontVTSwitch" "true"
EndSection
Section "Device"
  Identifier "omo-qa-dummy"
  Driver "dummy"
  VideoRam 256000
EndSection
Section "Monitor"
  Identifier "omo-qa-monitor"
  HorizSync 28.0-80.0
  VertRefresh 48.0-75.0
  Modeline "1280x800" 83.50 1280 1352 1480 1680 800 803 809 831 -hsync +vsync
EndSection
Section "Screen"
  Identifier "omo-qa-screen"
  Device "omo-qa-dummy"
  Monitor "omo-qa-monitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "1280x800"
  EndSubSection
EndSection
`
