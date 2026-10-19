#!/usr/bin/env bash
#
# build_nsp.sh — package RomMate as an installable homebrew NSP (rommate.nsp).
#
# Usage:
#   tools/build_nsp.sh
#
# Environment (all optional):
#   KEYSET    path to a prod.keys-format keyset (default: ~/Downloads/prod.keys)
#   DEVKITPRO devkitPro prefix (default: /opt/devkitpro)
#   TITLE_ID  app title id (default: 0x010012345678abcd)
#   SDK_VERSION  NCA SDK version, hex (default: 000C1100 = 0.12.16.0)
#   OUT       output NSP path (default: <project>/rommate.nsp)
#
# What it does:
#   1. NSP engine: clones dragonflylee/hacBrewPack into build/hacbrewpack
#      (once), applies tools/hbp_nsp0.patch, compiles with clang (cached).
#   2. Assembles NCA inputs under build/nsp_work:
#        exefs/main                     = aarch64 strip rommate.elf | elf2nso
#        exefs/main.npdm                = npdmtool tools/npdm.json
#        control/control.nacp           = rommate.nacp
#        control/icon_...English.dat    = romfs/img/demo_icon.jpg
#        (program RomFS = the project romfs/ directory, read in place)
#   3. Runs hacbrewpack: standard crypto — zero rights id, no ticket, keygen 1
#      (key area with key_area_key_application_00), content key 04...04,
#      self-signed NCA sig1 — and emits the NSP0 container.
#   4. Copies the result to <project>/rommate.nsp.
#
# Prerequisites: `make` has produced rommate.elf + rommate.nacp; git + clang.
#
# NOTE: the resulting NSP installs/launches only on an Atmosphere console with
# sigpatch enabled (homebrew signatures — see README).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DKP="${DEVKITPRO:-/opt/devkitpro}"
KEYSET="${KEYSET:-$HOME/Downloads/prod.keys}"
TITLE_ID="${TITLE_ID:-0x010012345678abcd}"
SDK_VERSION="${SDK_VERSION:-000C1100}"
OUT="${OUT:-$ROOT/rommate.nsp}"
BUILD="$ROOT/build"
HBP_DIR="$BUILD/hacbrewpack"
HBP_URL="https://github.com/dragonflylee/hacBrewPack.git"
HBP_REV="745b16ecfc9ce055743067d200572204cb2aac6c"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$ROOT/rommate.elf" ]  || die "rommate.elf not found — run 'make' first"
[ -f "$ROOT/rommate.nacp" ] || die "rommate.nacp not found — run 'make' first"
[ -f "$ROOT/romfs/img/demo_icon.jpg" ] || die "romfs/img/demo_icon.jpg missing (control icon source)"
[ -f "$KEYSET" ] || die "keyset not found: $KEYSET (set KEYSET=/path/to/prod.keys)"
[ -x "$DKP/devkitA64/bin/aarch64-none-elf-strip" ] || die "aarch64-none-elf-strip not found in $DKP/devkitA64/bin — run ./setup.sh"
[ -x "$DKP/tools/bin/elf2nso" ]  || die "elf2nso not found in $DKP/tools/bin — run ./setup.sh"
[ -x "$DKP/tools/bin/npdmtool" ] || die "npdmtool not found in $DKP/tools/bin — run ./setup.sh"
command -v git   >/dev/null 2>&1 || die "git is required"
command -v clang >/dev/null 2>&1 || die "clang is required"
case "$TITLE_ID" in 0x*|0X*) ;; *) die "TITLE_ID must be 0x-hex (got $TITLE_ID)";; esac

# --- 1. NSP engine -----------------------------------------------------------
mkdir -p "$BUILD"
if [ ! -f "$HBP_DIR/.rommate_rev" ] || [ "$(cat "$HBP_DIR/.rommate_rev")" != "$HBP_REV" ]; then
    echo "== Cloning hacBrewPack @ ${HBP_REV:0:7} ..."
    rm -rf "$HBP_DIR"
    git clone --quiet "$HBP_URL" "$HBP_DIR"
    git -C "$HBP_DIR" checkout --quiet "$HBP_REV"
    git -C "$HBP_DIR" apply --check "$ROOT/tools/hbp_nsp0.patch" \
        || die "tools/hbp_nsp0.patch does not apply to $HBP_REV"
    git -C "$HBP_DIR" apply "$ROOT/tools/hbp_nsp0.patch"
    echo "$HBP_REV" > "$HBP_DIR/.rommate_rev"
fi
if [ ! -x "$HBP_DIR/hacbrewpack" ]; then
    echo "== Building hacbrewpack (first time) ..."
    # NOTE 1: serial make on purpose — on macOS 27, `make -j` makes ar write a
    # long-name archive format the linker then rejects ("member '//' not a
    # mach-o file" / "not 8-byte aligned"). The engine is small; serial is fine.
    # NOTE 2: `env -u` strips the devkitPro tool variables (AR, RANLIB, CC, …)
    # that the parent `make nsp` exports into every recipe — they would make
    # the engine link against the *cross* ar, which writes archives the host
    # linker rejects. (CC/CFLAGS/LDFLAGS come from config.mk; the rest are
    # unused here but stripped for safety.)
    ( cd "$HBP_DIR" \
      && sed 's/^CC = .*/CC = clang/' config.mk.template > config.mk \
      && env -u CC -u CXX -u LD -u AS -u AR -u RANLIB -u NM -u OBJDUMP -u OBJCOPY -u STRIP \
             -u CFLAGS -u LDFLAGS -u CPPFLAGS -u DEFINES \
             make >/dev/null )
fi

# --- 2. NCA inputs -------------------------------------------------------------
WORK="$BUILD/nsp_work"
rm -rf "$WORK"
mkdir -p "$WORK/exefs" "$WORK/control"

echo "== exefs/main (strip + elf2nso) ..."
"$DKP/devkitA64/bin/aarch64-none-elf-strip" \
    --strip-unneeded --remove-section=.comment --remove-section=.note \
    "$ROOT/rommate.elf" -o "$WORK/main.elf"
"$DKP/tools/bin/elf2nso" "$WORK/main.elf" "$WORK/exefs/main"
rm -f "$WORK/main.elf"

echo "== exefs/main.npdm (npdmtool) ..."
"$DKP/tools/bin/npdmtool" "$ROOT/tools/npdm.json" "$WORK/exefs/main.npdm"

cp "$ROOT/rommate.nacp" "$WORK/control/control.nacp"
cp "$ROOT/romfs/img/demo_icon.jpg" "$WORK/control/icon_AmericanEnglish.dat"

# --- 3. hacbrewpack -------------------------------------------------------------
echo "== hacbrewpack: title $TITLE_ID, sdk $SDK_VERSION ..."
( cd "$WORK" \
  && "$HBP_DIR/hacbrewpack" \
       --keyset "$KEYSET" \
       --titleid "$TITLE_ID" \
       --sdkversion "$SDK_VERSION" \
       --nologo \
       --keepncadir \
       --nspdir "$WORK/hacbrewpack_nsp" \
       --ncadir "$WORK/hacbrewpack_nca" \
       --tempdir "$WORK/hacbrewpack_temp" \
       --backupdir "$WORK/hacbrewpack_backup" \
       --exefsdir "$WORK/exefs" \
       --romfsdir "$ROOT/romfs" \
       --controldir "$WORK/control" )

NSP_NAME="$(printf '%016x' "$TITLE_ID")"
[ -f "$WORK/hacbrewpack_nsp/$NSP_NAME.nsp" ] || die "hacbrewpack did not produce $NSP_NAME.nsp"
cp "$WORK/hacbrewpack_nsp/$NSP_NAME.nsp" "$OUT"
rm -rf "$WORK"

echo "OK: $OUT ($(wc -c < "$OUT") | tr -d ' ') bytes)"
echo "Installs only on an Atmosphere console with sigpatch enabled (see README)."
