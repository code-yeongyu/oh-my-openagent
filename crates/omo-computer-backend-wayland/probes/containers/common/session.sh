#!/usr/bin/env bash
# SP-W session helper. Runs INSIDE a probe container as the unprivileged user.
#   session.sh start   <gnome|kde|sway>   start D-Bus, PipeWire, the compositor and wait for its socket
#   session.sh stop                       stop every process of the session (the "logout")
#   session.sh restart <gnome|kde|sway>   stop then start: a new session over the same $HOME
#   session.sh run <gnome|kde|sway> -- <cmd...>   start, run <cmd> inside the session, stop
# Home data (permission store, dconf) survives stop/start, as it survives a real logout.
set -euo pipefail

: "${XDG_RUNTIME_DIR:=/tmp/xdg-run}"
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
# No system services run in the container; gnome-shell still needs a system bus to connect to, so a private
# bus stands in for it (nothing owns logind, colord or rtkit names there, so those calls fail fast).
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/system_bus"
export WAYLAND_DISPLAY_NAME="wayland-spw"
LOG_DIR="${SPW_LOG_DIR:-/tmp/spw-logs}"
PIDS="$XDG_RUNTIME_DIR/spw-pids"

wait_for() { # <seconds> <test...>
  local t=$(( $1 * 10 )); shift
  while (( t-- > 0 )); do "$@" && return 0; sleep 0.1; done
  return 1
}

bg() { # <name> <cmd...>
  local name=$1; shift
  "$@" >>"$LOG_DIR/$name.log" 2>&1 &
  echo "$! $name" >>"$PIDS"
}

start() {
  local c=$1
  mkdir -p "$XDG_RUNTIME_DIR" "$LOG_DIR"; chmod 0700 "$XDG_RUNTIME_DIR"; : >"$PIDS"
  case $c in
    gnome) export XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_DESKTOP=gnome ;;
    kde) export XDG_CURRENT_DESKTOP=KDE XDG_SESSION_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 QT_QPA_PLATFORM=wayland
         # the portal dialog is driven over AT-SPI for the first grant only; Qt exposes it when this is set
         export QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 ;;
    sway) export XDG_CURRENT_DESKTOP=sway XDG_SESSION_DESKTOP=sway ;;
    *) echo "session.sh: unknown compositor $c" >&2; exit 2 ;;
  esac
  export XDG_SESSION_TYPE=wayland LANG=C.UTF-8
  bg dbus dbus-daemon --session --nofork --nopidfile --address="$DBUS_SESSION_BUS_ADDRESS"
  bg sysbus dbus-daemon --session --nofork --nopidfile --address="$DBUS_SYSTEM_BUS_ADDRESS"
  wait_for 10 test -S "$XDG_RUNTIME_DIR/bus" || { echo "session.sh: session bus did not start" >&2; exit 3; }
  bg pipewire pipewire
  bg wireplumber wireplumber
  case $c in
    gnome)
      bg compositor gnome-shell --headless --wayland --no-x11 --wayland-display "$WAYLAND_DISPLAY_NAME" \
        --virtual-monitor 1280x800 --virtual-monitor 1024x768 ;;
    kde)
      # KWin grants restricted protocols (zkde_screencast, fake input, plasma window management) to a client whose
      # executable a desktop file names, looked up through the service cache: build it before KWin starts
      XDG_CURRENT_DESKTOP=KDE kbuildsycoca6 >>"$LOG_DIR/sycoca.log" 2>&1 || true
      # kwin_wayland 6.3 segfaults at startup in this container when the KDE session variables are all set
      # (they only select desktop integration); it starts without them, and the portals still get them below
      bg compositor env -u XDG_CURRENT_DESKTOP -u KDE_FULL_SESSION -u KDE_SESSION_VERSION -u QT_LINUX_ACCESSIBILITY_ALWAYS_ON \
        -u QT_QPA_PLATFORM kwin_wayland --virtual --no-lockscreen --socket "$WAYLAND_DISPLAY_NAME" \
        --width 1280 --height 800 --output-count 2 ;;
    sway)
      WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman WLR_HEADLESS_OUTPUTS=2 \
        WAYLAND_DISPLAY= bg compositor sway -c /probes/containers/sway/config ;;
  esac
  # sway picks its own socket name (wayland-N); gnome and kde take ours
  wait_for 40 bash -c 'for s in "$XDG_RUNTIME_DIR"/wayland-*; do [[ $s != *.lock && -S $s ]] && exit 0; done; exit 1' \
    || { echo "session.sh: compositor $c did not open a wayland socket" >&2; tail -20 "$LOG_DIR/compositor.log" >&2; exit 3; }
  for s in "$XDG_RUNTIME_DIR"/wayland-*; do [[ $s != *.lock && -S $s ]] && WAYLAND_DISPLAY_NAME=$(basename "$s") && break; done
  echo "$WAYLAND_DISPLAY_NAME" >"$XDG_RUNTIME_DIR/spw-display"
  export WAYLAND_DISPLAY="$WAYLAND_DISPLAY_NAME"
  dbus-update-activation-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE XDG_SESSION_DESKTOP \
    XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS ${KDE_FULL_SESSION:+KDE_FULL_SESSION KDE_SESSION_VERSION QT_QPA_PLATFORM QT_LINUX_ACCESSIBILITY_ALWAYS_ON} >/dev/null
  # sway: start the wlr portal backend ourselves (same binary D-Bus would activate) so its INFO log is kept
  [[ $c == sway ]] && bg xdpw /usr/libexec/xdg-desktop-portal-wlr -l INFO
  if [[ $c == gnome ]]; then
    # gnome-shell owns org.gnome.Shell once its startup finished
    wait_for 40 gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
      --method org.freedesktop.DBus.GetNameOwner org.gnome.Shell >/dev/null 2>&1 \
      || { echo "session.sh: org.gnome.Shell never appeared" >&2; exit 3; }
  fi
  sleep 2
  # a compositor that crashed after opening its socket (gnome-shell does this without a system bus) is no session
  local cpid; cpid=$(awk '$2=="compositor"{print $1}' "$PIDS")
  kill -0 "$cpid" 2>/dev/null || { echo "session.sh: compositor $c exited after start" >&2; tail -20 "$LOG_DIR/compositor.log" >&2; exit 3; }
}

stop() {
  if [[ -f $PIDS ]]; then
    tac "$PIDS" | while read -r pid name; do kill -TERM "$pid" 2>/dev/null || true; done
  fi
  # D-Bus activated services (portals, at-spi, dconf, gsd-*) are not tracked: end them by process name, never by
  # command line (a command-line match would also hit this script, whose arguments name the compositor)
  local names='^(wev|wtype|xdg-|at-spi|dconf-service|gnome-shell|gsd-|ibus|gvfs|goa-|evolution|kwin_wayland|kded|ksecretd|kwalletd|kglobalacc|sway|swaybg|Xwayland|pipewire|wireplumber|dbus-daemon)'
  pkill -TERM -u "$(id -u)" "$names" 2>/dev/null || true
  wait_for 10 bash -c "! pgrep -u $(id -u) '$names' >/dev/null" || pkill -KILL -u "$(id -u)" "$names" 2>/dev/null || true
  wait_for 5 bash -c "! pgrep -u $(id -u) '$names' >/dev/null" || true
  rm -f "$XDG_RUNTIME_DIR/bus" "$XDG_RUNTIME_DIR/system_bus" "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR/spw-display" "$PIDS"
}

cmd=${1:-}; shift || true
case $cmd in
  start) start "$1" ;;
  stop) stop ;;
  restart) stop; start "$1" ;;
  run)
    c=$1; shift; [[ ${1:-} == -- ]] && shift
    start "$c"
    export WAYLAND_DISPLAY="$(cat "$XDG_RUNTIME_DIR/spw-display")" SPW_COMPOSITOR="$c"
    set +e; "$@"; rc=$?; set -e
    stop
    exit $rc ;;
  *) echo "usage: session.sh start|stop|restart|run <compositor> [-- cmd]" >&2; exit 2 ;;
esac
