# SP-W probe image: KDE Plasma 6 (kwin_wayland --virtual) + xdg-desktop-portal-kde, Debian 13.
# Base pinned by digest; installed package versions are recorded in every ledger row's host build.
FROM debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      kwin-wayland kwin-common plasma-workspace xdg-desktop-portal xdg-desktop-portal-kde pipewire wireplumber dbus dbus-bin dbus-daemon \
      at-spi2-core gir1.2-atspi-2.0 python3 python3-gi gir1.2-glib-2.0 libglib2.0-bin libkf6service-bin \
      wev wayland-utils libei-dev gcc libc6-dev pkg-config libgl1-mesa-dri libegl-mesa0 procps \
      python3-pywayland plasma-wayland-protocols libcap2-bin qt6-wayland \
    && rm -rf /var/lib/apt/lists/*
# wayland.xml for the pywayland scanner (kde-pwm.py generates the plasma-window-management bindings from it)
RUN apt-get update && apt-get install -y --no-install-recommends libwayland-dev python3-cffi-backend && rm -rf /var/lib/apt/lists/*
# kwin_wayland ships with cap_sys_nice as a file capability; the container's bounding set lacks it, so exec fails
# with EPERM. Dropping it only loses realtime scheduling.
RUN setcap -r /usr/bin/kwin_wayland
COPY kde/applications.menu /etc/xdg/menus/applications.menu
COPY common/ei-probe.c /opt/spw/ei-probe.c
RUN gcc -O2 -o /opt/spw/ei-probe /opt/spw/ei-probe.c $(pkg-config --cflags --libs libei-1.0)
RUN useradd -m -u 1000 probe
USER probe
ENV XDG_RUNTIME_DIR=/tmp/xdg-run SPW_IMAGE=kde
WORKDIR /home/probe
