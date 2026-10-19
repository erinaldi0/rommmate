#!/usr/bin/env bash
#
# verify_nsp.sh — verify rommate.nsp with SciresM/hactool (the community's
# trusted NCA/NSP reader): decrypts every section with the keyset, checks all
# IVFC/PFS0 hashes, and round-trips the extracted files against the sources.
#
# Usage:
#   tools/verify_nsp.sh
#
# Environment (all optional):
#   KEYSET    keyset path (default: ~/Downloads/prod.keys)
#   NSP       NSP to verify (default: <project>/rommate.nsp)
#   DEVKITPRO devkitPro prefix (default: /opt/devkitpro)
#
# Checks (all must pass):
#   1. hactool --verify on every NCA: section decrypt + all IVFC levels +
#      PFS0 superblock/hash-table hashes. The only tolerated failure is the
#      fixed-key signature (sig0 is zero by design — homebrew, sigpatch).
#   2. Program: extracted RomFS == project romfs/ (byte-for-byte),
#      exefs main == rommate.nso, exefs main.npdm == npdmtool(tools/npdm.json).
#   3. Control: NACP == rommate.nacp, icon == romfs/img/demo_icon.jpg.
#
# Clones + builds hactool into build/hactool once (needs git + clang).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DKP="${DEVKITPRO:-/opt/devkitpro}"
KEYSET="${KEYSET:-$HOME/Downloads/prod.keys}"
NSP="${NSP:-$ROOT/rommate.nsp}"
BUILD="$ROOT/build"
HACTOOL_DIR="$BUILD/hactool"
HACTOOL_URL="https://github.com/SciresM/hactool.git"
HACTOOL_REV="1d64a83450e025622f3468c28fc4164dad2c5ef6"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$NSP" ] || die "NSP not found: $NSP — run 'make nsp' first"
[ -f "$KEYSET" ] || die "keyset not found: $KEYSET (set KEYSET=/path/to/prod.keys)"
command -v git   >/dev/null 2>&1 || die "git is required"
command -v clang >/dev/null 2>&1 || die "clang is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required (NSP unpacking)"

hactool_ready=0
[ -x "$HACTOOL_DIR/hactool" ] && [ -f "$HACTOOL_DIR/.rommate_rev" ] \
    && [ "$(cat "$HACTOOL_DIR/.rommate_rev")" = "$HACTOOL_REV" ] && hactool_ready=1
if [ "$hactool_ready" -eq 0 ]; then
    echo "== Cloning/building hactool @ ${HACTOOL_REV:0:7} ..."
    rm -rf "$HACTOOL_DIR"
    git clone --quiet "$HACTOOL_URL" "$HACTOOL_DIR"
    git -C "$HACTOOL_DIR" checkout --quiet "$HACTOOL_REV"
    # Serial make + env -u: see build_nsp.sh (cross toolchain vars from a
    # parent make would break the build; parallel ar output breaks ld).
    ( cd "$HACTOOL_DIR" \
      && sed 's/^CC = .*/CC = clang/' config.mk.template > config.mk \
      && env -u CC -u CXX -u LD -u AS -u AR -u RANLIB -u NM -u OBJDUMP -u OBJCOPY -u STRIP \
             -u CFLAGS -u LDFLAGS -u CPPFLAGS -u DEFINES \
             make >/dev/null )
    echo "$HACTOOL_REV" > "$HACTOOL_DIR/.rommate_rev"
fi
HT="$HACTOOL_DIR/hactool"

VERIFY="$BUILD/nsp_verify"
rm -rf "$VERIFY"
mkdir -p "$VERIFY"
cd "$VERIFY"

# --- Unpack the NSP container ---------------------------------------------------
# PFS0 layout (NSP = PFS0 with NSP0 magic): 0x10 header (magic, num_files,
# string_table_size, reserved), 0x18 entries (offset, size, name_off, res),
# string table, file data. Entry offsets are relative to the data start.
echo "== Unpacking NSP container ..."
python3 - "$NSP" <<'PY'
import struct, sys
data = open(sys.argv[1], "rb").read()
assert data[0:4] == b"NSP0", f"bad container magic: {data[0:4]!r}"
_, num, strtab_size, _ = struct.unpack("<IIII", data[0:0x10])
p = 0x10
st = 0x10 + num * 0x18
data_start = st + strtab_size
for i in range(num):
    off, size, nameoff, _ = struct.unpack("<QQII", data[p:p+0x18]); p += 0x18
    name = data[st+nameoff:data.index(b"\0", st+nameoff)].decode()
    open(name, "wb").write(data[data_start+off:data_start+off+size])
    print(f"  {name} ({size} B)")
PY

# --- Per-NCA checks ----------------------------------------------------------------
pass_n=0; fail_n=0
for nca in *.nca; do
    info="$("$HT" -k "$KEYSET" --disablekeywarns -i "$nca" 2>&1)" || { echo "FAIL: $nca — hactool could not parse"; fail_n=$((fail_n+1)); continue; }
    ctype="$(printf '%s' "$info" | awk '/Content Type:/{print $3}')"

    # 1. Hash verification. The only expected (FAIL) verdicts are the two
    # zero by design in homebrew NCAs — the fixed-key signature (sig0) and
    # the ACID signature (both require sigpatch on the console):
    #   "Fixed-Key Signature (FAIL):"            (column 0)
    #   "        Signature (FAIL):"              (indented — inside the ACID block)
    rm -rf raw
    if "$HT" -k "$KEYSET" --disablekeywarns --verify -x -r --outdir=raw "$nca" 2>&1 \
         | grep -E '\(FAIL\)' | grep -Ev 'Fixed-Key Signature|^[[:space:]]+Signature[[:space:]]'; then
        echo "FAIL: $nca ($ctype) — hash/signature mismatch"
        fail_n=$((fail_n+1)); continue
    fi

    # 2. Extraction round-trip, routed by content type. (hactool does not
    # create the romfs/exefs directories itself; use a fresh out/ per NCA so
    # files from other NCAs don't pollute the diff.)
    rm -rf out
    mkdir -p out/romfs out/exefs
    "$HT" -k "$KEYSET" --disablekeywarns -x \
        --romfsdir=out/romfs --exefsdir=out/exefs --outdir=out "$nca" >/dev/null
    case "$ctype" in
        Program*)
            diff -r "$ROOT/romfs" out/romfs >/dev/null \
                || { echo "FAIL: $nca — romfs differs from project romfs/"; fail_n=$((fail_n+1)); continue; }
            cmp -s "$ROOT/rommate.nso" out/exefs/main \
                || { echo "FAIL: $nca — exefs main != rommate.nso"; fail_n=$((fail_n+1)); continue; }
            if [ -x "$DKP/tools/bin/npdmtool" ]; then
                "$DKP/tools/bin/npdmtool" "$ROOT/tools/npdm.json" out/main.npdm >/dev/null
                # Compare modulo the ACID public-key region (modulus, 256 B at
                # acid_offset+0x100): hacbrewpack patches it with its embedded
                # homebrew key, so a fresh npdmtool build differs there.
                if ! python3 - out/main.npdm out/exefs/main.npdm <<'PY'
import struct, sys
def norm(path):
    d = bytearray(open(path, "rb").read())
    (acid_off,) = struct.unpack("<I", d[0x78:0x7C])
    d[acid_off + 0x100:acid_off + 0x200] = b"\x00" * 0x100
    return bytes(d)
sys.exit(0 if norm(sys.argv[1]) == norm(sys.argv[2]) else 1)
PY
                then
                    echo "FAIL: $nca — exefs main.npdm != npdmtool(tools/npdm.json) (modulo patched ACID key)"
                    fail_n=$((fail_n+1)); continue
                fi
            fi
            ;;
        Control*)
            # control.nacp — compare byte-for-byte except the fields
            # hacbrewpack patches when --titleid is given (title-ID group
            # + LogoHandling). Offsets from hbp's pack(1) nacp_t, which
            # maps from file 0x0 (devkitPro nacptool output has no NACP
            # magic header).
            if ! python3 - "$ROOT/rommate.nacp" out/romfs/control.nacp <<'PY'
import sys
a = bytearray(open(sys.argv[1], "rb").read())
b = bytearray(open(sys.argv[2], "rb").read())
for z, n in [(0x3038, 8), (0x3070, 8), (0x3078, 8), (0x30B0, 64), (0x30F1, 1)]:
    a[z:z+n] = b"\x00" * n
    b[z:z+n] = b"\x00" * n
sys.exit(0 if a == b else 1)
PY
            then
                echo "FAIL: $nca — control.nacp differs (modulo hacbrewpack's title-id/logo patches)"
                fail_n=$((fail_n+1)); continue
            fi
            cmp -s "$ROOT/romfs/img/demo_icon.jpg" out/romfs/icon_AmericanEnglish.dat \
                || { echo "FAIL: $nca — control icon differs"; fail_n=$((fail_n+1)); continue; }
            ;;
        Meta*) : ;;  # cnmt is engine-generated; hash check above is the coverage
        *)
            echo "FAIL: $nca — unknown content type '$ctype'"
            fail_n=$((fail_n+1)); continue
            ;;
    esac
    echo "PASS: $nca ($ctype) — hashes valid, extraction matches sources"
    pass_n=$((pass_n+1))
done

rm -rf "$VERIFY"
if [ "$fail_n" -eq 0 ]; then
    echo "OK: $NSP verified ($pass_n NCA(s), hactool @ ${HACTOOL_REV:0:7})"
else
    echo "FAIL: $fail_n NCA(s) failed verification" >&2
    exit 1
fi
