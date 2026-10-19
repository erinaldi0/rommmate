#!/usr/bin/env bash
# =============================================================================
# setup.sh — install everything RomMate needs to build, in one go
#
#   1. devkitPro pacman client ("dkp-pacman")          [the package manager]
#   2. the "switch-dev" package group:
#        devkitA64 (aarch64 cross toolchain) · libnx · deko3d · uam · examples
#   3. portlibs: switch-curl (+switch-zlib) · switch-glm · switch-glfw ·
#                switch-mesa   (glm/glfw/mesa per the Borealis README)
#   4. the Borealis git submodule (lib/borealis)
#   5. optionally build the app (--build)
#
# Everything is installed under /opt/devkitpro (the devkitPro pacman default).
# The script is idempotent — components already present are skipped.
#
# Usage:
#   ./setup.sh             # interactive: install whatever is missing
#   ./setup.sh --yes       # unattended (no prompts)
#   ./setup.sh --build     # also run `make -j` at the end
#   ./setup.sh --check     # only verify what is installed; change nothing
#
# Requires: Linux x86_64/aarch64 (incl. WSL) or macOS x86_64, git, sudo.
#           Apple-Silicon macOS has no devkitPro host packages — use WSL.
# =============================================================================
set -euo pipefail

ASSUME_YES=0
DO_BUILD=0
DO_CHECK_ONLY=0
PREFIX="/opt/devkitpro"

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes)        ASSUME_YES=1 ;;
        --build)         DO_BUILD=1 ;;
        --check)         DO_CHECK_ONLY=1 ;;
        -h|--help)       usage; exit 0 ;;
        *)               echo "Unknown option: $1" >&2; usage; exit 2 ;;
    esac
    shift
done

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m  XX\033[0m %s\n' "$*" >&2; exit 1; }

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

confirm() {  # confirm <question> — returns 1 on 'no'
    [ "$ASSUME_YES" -eq 1 ] && return 0
    local ans
    read -r -p "  $1 [y/N] " ans
    case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

cpu_count() {
    nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4
}

run_dkp() {  # run_dkp <pacman args...> — via dkp-pacman or a configured pacman
    if command -v dkp-pacman >/dev/null 2>&1; then
        $SUDO dkp-pacman "$@"
    else
        $SUDO pacman -S "$@"   # Arch-style install with the dkp repos configured
    fi
}

# -----------------------------------------------------------------------------
# 1. OS / architecture
# -----------------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)
        case "$ARCH" in
            x86_64|aarch64) : ;;
            *) die "Unsupported architecture: $ARCH (need x86_64 or aarch64)" ;;
        esac
        # pacman on WSL needs /etc/mtab
        if grep -qi microsoft /proc/version 2>/dev/null && [ ! -e /etc/mtab ]; then
            $SUDO ln -s /proc/self/mounts /etc/mtab 2>/dev/null || true
        fi
        ;;
    Darwin)
        [ "$ARCH" = "x86_64" ] || die "Apple-Silicon macOS is not supported (no arm64 devkitPro host packages). Install WSL instead: 'wsl --install' from a Windows machine, or use a Linux box."
        warn "macOS: devkitPro ships x86_64 host packages, so this should work — but Linux/WSL is the better-supported path."
        ;;
    *)
        die "Unsupported OS: $OS (need Linux or macOS x86_64)" ;;
esac

info "Host: $OS/$ARCH — installing into $PREFIX"

# -----------------------------------------------------------------------------
# 2. Base tools (git, curl)
# -----------------------------------------------------------------------------
if [ "$DO_CHECK_ONLY" -eq 1 ]; then
    : # checks only
else
    missing=""
    command -v git  >/dev/null 2>&1 || missing="$missing git"
    command -v curl >/dev/null 2>&1 || missing="$missing curl"
    if [ -n "$missing" ]; then
        info "Installing missing base tools:$missing"
        if command -v apt-get >/dev/null 2>&1; then
            $SUDO apt-get update -qq && $SUDO apt-get install -y $missing
        elif command -v dnf >/dev/null 2>&1; then
            $SUDO dnf install -y $missing
        elif command -v pacman >/dev/null 2>&1; then
            $SUDO pacman -S --noconfirm $missing
        elif command -v brew >/dev/null 2>&1; then
            brew install $missing
        else
            die "Please install:$missing (manually), then re-run."
        fi
        ok "base tools ready"
    else
        ok "base tools (git, curl) present"
    fi
fi

# -----------------------------------------------------------------------------
# 3. Component checks
#    A "valid" prefix has libnx + the cross compiler. deko3d ships inside
#    $(LIBNX); the portlibs (curl, zlib, glm, ...) live in portlibs/aarch64.
# -----------------------------------------------------------------------------
find_existing_prefix() {
    local p
    for p in "${DEVKITPRO:-}" "$HOME/devkitPro" "/opt/devkitpro"; do
        [ -n "$p" ] || continue
        if [ -f "$p/libnx/switch_rules" ] && \
           { [ -x "$p/devkitA64/bin/aarch64-none-elf-gcc" ] || [ -x "$p/devkitA64/bin/aarch64-elf-gcc" ]; }; then
            echo "$p"
            return
        fi
    done
}

# Fresh prefix (what a from-scratch install produces)
PREFIX="$(find_existing_prefix || true)"
[ -n "$PREFIX" ] || PREFIX="/opt/devkitpro"

NEED_SWITCHDEV=0   # devkitA64 + libnx + deko3d + uam  (the switch-dev group)
NEED_CURL=0        # switch-curl (+ switch-zlib)
NEED_GLM=0         # switch-glm
NEED_GLFW=0        # switch-glfw
NEED_MESA=0        # switch-mesa

port() { echo "$PREFIX/portlibs/aarch64/$1"; }

[ -f "$PREFIX/libnx/switch_rules" ]                 || NEED_SWITCHDEV=1
[ -f "$PREFIX/libnx/lib/libnx.a" ]                  || NEED_SWITCHDEV=1
[ -f "$PREFIX/libnx/lib/libdeko3d.a" ]              || NEED_SWITCHDEV=1
ls "$PREFIX"/devkitA64/bin/uam "$PREFIX"/tools/bin/uam >/dev/null 2>&1 \
    || command -v uam >/dev/null 2>&1              || NEED_SWITCHDEV=1
[ -f "$(port lib/libcurl.a)" ]                      || NEED_CURL=1
[ -f "$(port lib/libz.a)" ]                         || NEED_CURL=1
[ -f "$(port include/glm/vec2.hpp)" ]               || NEED_GLM=1
[ -f "$(port include/GLFW/glfw3.h)" ]               || NEED_GLFW=1
[ -f "$(port include/GL/gl.h)" ]                    || NEED_MESA=1

print_status() {  # print_status <0|1> <label>
    if [ "$1" -eq 1 ]; then printf '  missing  %s\n' "$2"; else printf '  present  %s\n' "$2"; fi
}

info "Component status in $PREFIX:"
print_status $NEED_SWITCHDEV "switch-dev group (devkitA64 + libnx + deko3d + uam)"
print_status $NEED_CURL      "switch-curl (+ zlib)"
print_status $NEED_GLM       "switch-glm"
print_status $NEED_GLFW      "switch-glfw"
print_status $NEED_MESA      "switch-mesa"

if [ "$DO_CHECK_ONLY" -eq 1 ]; then
    if [ $NEED_SWITCHDEV -eq 0 ] && [ $NEED_CURL -eq 0 ] && [ $NEED_GLM -eq 0 ]; then
        ok "everything required is installed"
        [ $NEED_GLFW -eq 0 ] && [ $NEED_MESA -eq 0 ] || warn "optional (per Borealis README): switch-glfw / switch-mesa not found"
        exit 0
    fi
    warn "components missing (run ./setup.sh to install)"
    exit 1
fi

# -----------------------------------------------------------------------------
# 4. Install the devkitPro pacman client, if needed
# -----------------------------------------------------------------------------
ensure_dkp_client() {
    if command -v dkp-pacman >/dev/null 2>&1; then
        ok "dkp-pacman already installed"
        return
    fi
    if [ -f /etc/pacman.conf ] && grep -q 'dkp' /etc/pacman.conf 2>/dev/null; then
        ok "devkitPro pacman repos already configured"
        return
    fi

    info "Installing the devkitPro pacman client (dkp-pacman)"
    case "$OS" in
        Linux)
            if command -v apt-get >/dev/null 2>&1; then
                local tmp; tmp="$(mktemp -d)"
                curl -fsSL -A "dkp-apt" -o "$tmp/install-devkitpro-pacman" \
                    https://apt.devkitpro.org/install-devkitpro-pacman
                chmod +x "$tmp/install-devkitpro-pacman"
                $SUDO "$tmp/install-devkitpro-pacman"
                rm -rf "$tmp"
            elif command -v pacman >/dev/null 2>&1; then
                warn "Arch-based system: please configure devkitPro pacman manually,"
                warn "following https://devkitpro.org/wiki/devkitPro_pacman (keyring + repos),"
                warn "then re-run ./setup.sh"
                die "manual step required"
            else
                die "No supported package manager found (need apt, dnf, pacman or brew). See https://devkitpro.org/wiki/devkitPro_pacman"
            fi
            ;;
        Darwin)
            local tmp; tmp="$(mktemp -d)"
            curl -fL -o "$tmp/dkp-pacman.pkg" \
                https://github.com/devkitPro/pacman/releases/latest/download/devkitpro-pacman-installer.pkg
            $SUDO installer -pkg "$tmp/dkp-pacman.pkg" -target /
            rm -rf "$tmp"
            ;;
    esac
    command -v dkp-pacman >/dev/null 2>&1 || die "dkp-pacman install failed — see messages above (https://devkitpro.org/wiki/devkitPro_pacman)"
    ok "dkp-pacman ready"
}

# -----------------------------------------------------------------------------
# 5. Install missing packages
# -----------------------------------------------------------------------------
pkgs=""
[ $NEED_SWITCHDEV -eq 1 ] && pkgs="$pkgs switch-dev"
[ $NEED_CURL -eq 1 ]      && pkgs="$pkgs switch-curl"
[ $NEED_GLM -eq 1 ]       && pkgs="$pkgs switch-glm"
[ $NEED_GLFW -eq 1 ]      && pkgs="$pkgs switch-glfw"
[ $NEED_MESA -eq 1 ]      && pkgs="$pkgs switch-mesa"

if [ -n "$pkgs" ]; then
    info "Will install (into $PREFIX):$pkgs"
    if ! confirm "Proceed? (requires sudo, may download a few hundred MB)"; then
        die "Aborted by user."
    fi
    ensure_dkp_client
    run_dkp -Sy
    run_dkp -S $pkgs
    ok "package install finished"
else
    ok "all components already present — nothing to install"
fi

# Re-check the core pieces after installing
[ -f "$PREFIX/libnx/switch_rules" ] || die "libnx not found after install — check the pacman output above"
[ -f "$PREFIX/libnx/lib/libdeko3d.a" ] || die "deko3d not found after install — check the pacman output above"
[ -f "$PREFIX/portlibs/aarch64/lib/libcurl.a" ] || die "switch-curl not found after install — check the pacman output above"

# uam (the shader compiler) — normally part of the toolchain, but verify
if ! ls "$PREFIX"/devkitA64/bin/uam "$PREFIX"/tools/bin/uam >/dev/null 2>&1 \
   && ! command -v uam >/dev/null 2>&1; then
    warn "uam (shader compiler) not found — trying 'dkp-pacman -S uam'"
    ensure_dkp_client
    run_dkp -S uam || warn "could not install 'uam' as a package — if shader compilation fails later, build https://github.com/devkitPro/dekotools into $PREFIX/devkitA64"
fi

ok "toolchain ready: $PREFIX"

# -----------------------------------------------------------------------------
# 6. Borealis submodule
# -----------------------------------------------------------------------------
if [ -f .gitmodules ]; then
    info "Fetching the Borealis submodule (lib/borealis)"
    git submodule update --init
    ok "Borealis ready: $(git -C lib/borealis rev-parse --short HEAD 2>/dev/null || echo '?') (its dependencies are vendored inside)"
else
    warn "no .gitmodules — skipping submodule step"
fi

# -----------------------------------------------------------------------------
# 7. Environment
# -----------------------------------------------------------------------------
echo
info "Add these to your shell (or re-login — the package also ships an env file):"
printf '     %s\n' "export DEVKITPRO=$PREFIX"
printf '     %s\n' 'export PATH="$DEVKITPRO/devkitA64/bin:$DEVKITPRO/tools/bin:$PATH"'
echo

rc_file=""
case "${SHELL:-}" in
    *zsh)  rc_file="$HOME/.zshrc" ;;
    *)     rc_file="$HOME/.bashrc" ;;
esac
if [ -n "$rc_file" ]; then
    if ! grep -qs "DEVKITPRO=$PREFIX" "$rc_file" 2>/dev/null; then
        if confirm "Append the exports to $rc_file?"; then
            {
                echo ""
                echo "# devkitPro (added by RomMate setup.sh)"
                echo "export DEVKITPRO=$PREFIX"
                echo 'export PATH="$DEVKITPRO/devkitA64/bin:$DEVKITPRO/tools/bin:$PATH"'
            } >> "$rc_file"
            ok "appended to $rc_file"
        fi
    else
        ok "environment already in $rc_file"
    fi
fi

# -----------------------------------------------------------------------------
# 8. Optional build
# -----------------------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
    info "Building (make -j$(cpu_count))"
    export DEVKITPRO="$PREFIX"
    export PATH="$PREFIX/devkitA64/bin:$PREFIX/tools/bin:$PATH"
    make -j"$(cpu_count)"
    ok "build finished"
    ls -lh build/rommate.nro 2>/dev/null || warn "build/rommate.nro not produced — check the output above"
else
    echo
    info "Next steps:"
    echo "     export DEVKITPRO=$PREFIX"
    echo "     export PATH=\"\$DEVKITPRO/devkitA64/bin:\$DEVKITPRO/tools/bin:\$PATH\""
    echo "     make -j"
    echo
    echo "   Then copy build/rommate.nro to sdmc:/switch/rommate/ with a config.json"
    echo "   (see README.md → Run)."
fi

ok "done"
