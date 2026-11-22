# SP-W probe image: GNOME 46 (gnome-shell --headless) + xdg-desktop-portal-gnome, Ubuntu 24.04.
# Base pinned by digest; installed package versions are recorded in every ledger row's host build.
FROM ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      gnome-shell mutter xdg-desktop-portal xdg-desktop-portal-gnome pipewire wireplumber dbus dbus-user-session \
      dconf-service dconf-gsettings-backend gsettings-desktop-schemas at-spi2-core gir1.2-atspi-2.0 \
      python3 python3-gi gir1.2-glib-2.0 libglib2.0-bin gedit python3-pyqt6 qt6-wayland \
      wev wayland-utils libei-dev gcc libc6-dev pkg-config libgl1-mesa-dri libegl-mesa0 procps \
      curl unzip ca-certificates libnss3 libatk-bridge2.0-0t64 libgbm1 libxkbcommon0 libasound2t64 libcups2t64 \
      libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 libdrm2 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
# Chromium: an upstream snapshot build pinned by revision (the Ubuntu package is a snap, which cannot run here).
ARG CHROMIUM_REV=1741767
RUN curl -fsSL -o /tmp/c.zip "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/${CHROMIUM_REV}/chrome-linux.zip" \
    && sha256sum /tmp/c.zip | tee /tmp/c.sha && unzip -q /tmp/c.zip -d /opt && mv /opt/chrome-linux /opt/chromium \
    && echo "rev=${CHROMIUM_REV} zip_sha256=$(cut -d' ' -f1 /tmp/c.sha)" > /opt/chromium/SPW_PIN && rm /tmp/c.zip /tmp/c.sha \
    && ! ldd /opt/chromium/chrome | grep 'not found'
# Package scripts leave /run/systemd/seats behind; with no logind on a system bus gnome-shell must take its
# no-systemd login manager, which it chooses only when that directory is absent.
RUN rm -rf /run/systemd/seats /run/systemd/sessions
COPY common/ei-probe.c /opt/spw/ei-probe.c
RUN gcc -O2 -o /opt/spw/ei-probe /opt/spw/ei-probe.c $(pkg-config --cflags --libs libei-1.0)
RUN useradd -m -u 1001 probe || useradd -m probe
USER probe
ENV XDG_RUNTIME_DIR=/tmp/xdg-run SPW_IMAGE=gnome
WORKDIR /home/probe
