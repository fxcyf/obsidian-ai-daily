#!/bin/bash
# Setup GitHub Actions self-hosted runner for obsidian-ai-daily
# Usage: bash scripts/setup-runner.sh

set -e

REPO="fxcyf/obsidian-ai-daily"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.322.0"

# Detect platform
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [ "$OS" = "darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        PLATFORM="osx-arm64"
    else
        PLATFORM="osx-x64"
    fi
elif [ "$OS" = "linux" ]; then
    PLATFORM="linux-x64"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

TARBALL="actions-runner-${PLATFORM}-${RUNNER_VERSION}.tar.gz"
DOWNLOAD_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"

echo "=== GitHub Actions Self-Hosted Runner Setup ==="
echo "Repo:     $REPO"
echo "Platform: $PLATFORM"
echo "Dir:      $RUNNER_DIR"
echo ""

# Step 1: Create runner directory
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Step 2: Download runner
if [ ! -f "./config.sh" ]; then
    echo ">>> Downloading runner v${RUNNER_VERSION}..."
    curl -o "$TARBALL" -L "$DOWNLOAD_URL"
    tar xzf "$TARBALL"
    rm -f "$TARBALL"
    echo ">>> Download complete."
else
    echo ">>> Runner already downloaded, skipping."
fi

# Step 3: Get registration token
echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Get a registration token from GitHub:"
echo "   https://github.com/${REPO}/settings/actions/runners/new"
echo ""
echo "2. Run the config command (replace <TOKEN> with your token):"
echo ""
echo "   cd $RUNNER_DIR"
echo "   ./config.sh --url https://github.com/${REPO} --token <TOKEN>"
echo ""
echo "3. Start the runner:"
echo ""
echo "   # Foreground (for testing):"
echo "   ./run.sh"
echo ""
echo "   # Background as service (recommended):"
if [ "$OS" = "darwin" ]; then
    echo "   ./svc.sh install"
    echo "   ./svc.sh start"
    echo ""
    echo "   # Other service commands:"
    echo "   ./svc.sh status    # check status"
    echo "   ./svc.sh stop      # stop service"
    echo "   ./svc.sh uninstall # remove service"
elif [ "$OS" = "linux" ]; then
    echo "   sudo ./svc.sh install"
    echo "   sudo ./svc.sh start"
    echo ""
    echo "   # Other service commands:"
    echo "   sudo ./svc.sh status    # check status"
    echo "   sudo ./svc.sh stop      # stop service"
    echo "   sudo ./svc.sh uninstall # remove service"
fi
echo ""
echo "=== Done ==="
