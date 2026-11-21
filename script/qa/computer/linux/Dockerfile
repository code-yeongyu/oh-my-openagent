# The Linux QA container image: every scenario session except `xorg` runs in a container
# of this image (the `xorg` session runs directly on the host it needs). Node 24 + Bun
# 1.4.4 match the repository's CI toolchain floor.
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4" \
 && bun --version

# Xvfb + xfwm4 + xcompmgr for the xvfb sessions, the private bus and the AT-SPI registry,
# the xwd/xdotool/xprop/xrdb oracles, and GTK3 for the fixture windows.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb \
      xfwm4 \
      xcompmgr \
      dbus \
      dbus-x11 \
      at-spi2-core \
      x11-utils \
      x11-apps \
      x11-xserver-utils \
      xdotool \
      xauth \
      python3 \
      python3-gi \
      python3-gi-cairo \
      gir1.2-gtk-3.0 \
 && rm -rf /var/lib/apt/lists/*

USER node
