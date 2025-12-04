#!/usr/bin/env bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Repository information
REPO="pleaseai/mcp-gateway"
BINARY_NAME="mcp-gateway"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Print colored message
print_message() {
    local color=$1
    shift
    echo -e "${color}$*${NC}"
}

print_error() {
    print_message "$RED" "ERROR: $*"
}

print_success() {
    print_message "$GREEN" "✓ $*"
}

print_info() {
    print_message "$YELLOW" "$*"
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)
            echo "darwin"
            ;;
        Linux*)
            echo "linux"
            ;;
        *)
            print_error "Unsupported operating system: $(uname -s)"
            print_info "Supported platforms: macOS (darwin), Linux"
            exit 1
            ;;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)
            echo "x64"
            ;;
        arm64|aarch64)
            echo "arm64"
            ;;
        *)
            print_error "Unsupported architecture: $(uname -m)"
            print_info "Supported architectures: x86_64, arm64"
            exit 1
            ;;
    esac
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main installation
main() {
    print_info "MCP Gateway Installer"
    print_info "====================="
    echo

    # Check dependencies
    if ! command_exists curl; then
        print_error "curl is required but not installed"
        print_info "Please install curl and try again"
        exit 1
    fi

    # Detect platform and architecture
    OS=$(detect_os)
    ARCH=$(detect_arch)

    print_info "Detected platform: $OS-$ARCH"
    echo

    # Construct download URL
    BINARY_FILE="${BINARY_NAME}-${OS}-${ARCH}"
    DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${BINARY_FILE}"

    print_info "Downloading from: $DOWNLOAD_URL"

    # Download binary to temporary location
    TEMP_FILE=$(mktemp)
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"; then
        print_error "Failed to download binary"
        print_info "Please check your internet connection and try again"
        rm -f "$TEMP_FILE"
        exit 1
    fi

    print_success "Binary downloaded successfully"

    # Make executable
    chmod +x "$TEMP_FILE"
    print_success "Made binary executable"

    # Install binary
    print_info "Installing to $INSTALL_DIR/$BINARY_NAME"

    # Check if we need sudo
    if [ -w "$INSTALL_DIR" ]; then
        if ! mv "$TEMP_FILE" "$INSTALL_DIR/$BINARY_NAME"; then
            print_error "Failed to install binary to $INSTALL_DIR"
            rm -f "$TEMP_FILE"
            exit 1
        fi
    else
        print_info "Administrator privileges required for installation"
        if ! sudo mv "$TEMP_FILE" "$INSTALL_DIR/$BINARY_NAME"; then
            print_error "Failed to install binary"
            rm -f "$TEMP_FILE"
            exit 1
        fi
    fi

    print_success "Binary installed successfully"
    echo

    # Verify installation
    if command_exists "$BINARY_NAME"; then
        VERSION=$("$BINARY_NAME" --version 2>/dev/null || echo "unknown")
        print_success "Installation complete!"
        print_info "Version: $VERSION"
        print_info "Location: $(command -v $BINARY_NAME)"
        echo
        print_info "Run '$BINARY_NAME --help' to get started"
    else
        print_error "Installation completed but $BINARY_NAME is not in PATH"
        print_info "Please add $INSTALL_DIR to your PATH"
        print_info "Or try running: export PATH=\"$INSTALL_DIR:\$PATH\""
    fi
}

# Run main installation
main "$@"
