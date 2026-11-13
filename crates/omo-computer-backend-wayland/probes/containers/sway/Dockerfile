# SP-W probe image: sway (wlroots) headless + xdg-desktop-portal-wlr.
# Base pinned by digest; installed package versions are recorded in every ledger row's host build.
FROM debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      sway xdg-desktop-portal xdg-desktop-portal-wlr pipewire wireplumber dbus dbus-bin dbus-daemon \
      python3 python3-gi gir1.2-glib-2.0 libglib2.0-bin wayland-utils wev wtype procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 probe
USER probe
ENV XDG_RUNTIME_DIR=/tmp/xdg-run HOME=/home/probe SPW_IMAGE=sway
WORKDIR /home/probe
