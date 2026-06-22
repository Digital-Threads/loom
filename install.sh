#!/bin/sh
# Loom one-line installer — downloads the self-contained binary (no Node needed).
#
#   curl -fsSL https://raw.githubusercontent.com/Digital-Threads/loom/master/loom-host/install.sh | sh
#
# It fetches the latest release binary for your platform, unpacks it into
# ~/.loom (with the web UI bundle beside it), and drops a `loom` launcher on
# your PATH. Override the locations with LOOM_HOME / LOOM_BIN.
set -eu

REPO="Digital-Threads/loom"
INSTALL_DIR="${LOOM_HOME:-$HOME/.loom}"
BIN_DIR="${LOOM_BIN:-$HOME/.local/bin}"

# Map this machine to a published release asset. CI builds linux-x64 and
# darwin-arm64 (Apple Silicon); anything else falls back to the npm install.
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  plat_os="linux" ;;
  Darwin) plat_os="darwin" ;;
  *)
    echo "No binary for $os. On Windows download it from" >&2
    echo "  https://github.com/$REPO/releases/latest" >&2
    echo "or install with Node: npm i -g @digital-threads/loom" >&2
    exit 1 ;;
esac
case "$arch" in
  x86_64|amd64)  plat_arch="x64" ;;
  arm64|aarch64) plat_arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="loom-${plat_os}-${plat_arch}.tar.gz"
url="https://github.com/$REPO/releases/latest/download/$asset"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $asset ..."
if ! curl -fSL "$url" -o "$tmp/loom.tar.gz"; then
  echo "" >&2
  echo "No prebuilt binary for ${plat_os}-${plat_arch}." >&2
  echo "Install with Node instead: npm i -g @digital-threads/loom" >&2
  exit 1
fi

echo "Installing into $INSTALL_DIR ..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$tmp/loom.tar.gz" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/loom"

# A launcher (not a symlink) so the binary always runs from $INSTALL_DIR and
# finds web/dist beside it, whatever the PATH entry looks like.
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/loom" <<EOF
#!/bin/sh
exec "$INSTALL_DIR/loom" "\$@"
EOF
chmod +x "$BIN_DIR/loom"

echo ""
echo "Loom installed: $BIN_DIR/loom"
case ":$PATH:" in
  *":$BIN_DIR:"*) echo "Run it with:  loom" ;;
  *)
    echo "$BIN_DIR is not on your PATH yet. Add it:"
    echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile && . ~/.profile"
    echo "then run:  loom" ;;
esac
