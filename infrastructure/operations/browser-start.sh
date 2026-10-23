#!/bin/sh
set -eu
umask 077
mkdir -p /profile/chromium /profile/Downloads /profile/.config/openbox
python3 /usr/local/bin/configure-language.py
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!
trap 'kill "$XVFB_PID" 2>/dev/null || true' EXIT
until xdpyinfo -display :99 >/dev/null 2>&1; do sleep 0.2; done
openbox --sm-disable &
x11vnc -display :99 -rfbport 5900 -forever -alwaysshared -nopw -noxdamage -wait 25 -defer 15 -nap -quiet &
x11vnc -display :99 -rfbport 5902 -forever -alwaysshared -viewonly -nopw -noxdamage -wait 40 -defer 20 -nap -nosetclipboard -nosetprimary -quiet &
# The container has no capabilities, a read-only root, no host/project mounts,
# and only a deny-private-address egress proxy. Chromium's rootless sandbox is
# retained when the host supports user namespaces; fallback is NOT automatic.
exec python3 /usr/local/bin/browser-control.py
