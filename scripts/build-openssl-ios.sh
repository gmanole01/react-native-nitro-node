#!/bin/bash
#
# Builds ios/Frameworks/OpenSSL.xcframework: OpenSSL as one static library
# (libssl + libcrypto) per slice, each with its own headers, like c-ares.
#
#   ios-arm64                   devices
#   ios-arm64_x86_64-simulator  simulators on Apple silicon and Intel Macs
#
# Usage: scripts/build-openssl-ios.sh
# Needs Xcode and perl. Takes a few minutes; the work is done in build/.

set -euo pipefail

# Keep in step with Android's android/libs/*/libssl.a and deps/openssl/include.
OPENSSL_VERSION="3.6.2"
OPENSSL_SHA256="aaf51a1fe064384f811daeaeb4ec4dce7340ec8bd893027eee676af31e83a04f"

# The oldest iOS the libraries run on. Without it they would require the
# SDK's own version. Keep it at or below React Native's minimum.
IOS_MIN="15.1"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/openssl-ios"
OUTPUT="$ROOT/ios/Frameworks/OpenSSL.xcframework"
TARBALL="openssl-$OPENSSL_VERSION.tar.gz"
JOBS="$(sysctl -n hw.ncpu)"

# What only libssl/libcrypto need: no command line tool, tests or manuals.
CONFIG_OPTIONS=(no-shared no-apps no-tests no-docs)

mkdir -p "$WORK"
cd "$WORK"

if [ ! -f "$TARBALL" ]; then
  echo "Downloading OpenSSL $OPENSSL_VERSION"
  curl -fsSL -o "$TARBALL.part" \
    "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/$TARBALL"
  mv "$TARBALL.part" "$TARBALL"
fi
echo "$OPENSSL_SHA256  $TARBALL" | shasum -a 256 -c - >/dev/null || {
  echo "error: $TARBALL does not match its checksum" >&2
  rm -f "$TARBALL"
  exit 1
}

# build <OpenSSL target> <min version flag>: builds one architecture into
# $WORK/install/<target>, each from a fresh copy of the sources.
build() {
  local target="$1" min_flag="$2"
  local src="$WORK/src/$target" prefix="$WORK/install/$target"

  echo "Building $target"
  rm -rf "$src" "$prefix"
  mkdir -p "$src"
  tar xzf "$TARBALL" -C "$src" --strip-components 1

  (
    cd "$src"
    ./Configure "$target" "${CONFIG_OPTIONS[@]}" "$min_flag" \
      --prefix="$prefix" --openssldir=/etc/ssl --libdir=lib >"$WORK/$target.log" 2>&1
    make -j"$JOBS" build_libs >>"$WORK/$target.log" 2>&1
    make install_dev >>"$WORK/$target.log" 2>&1
  ) || {
    echo "error: building $target failed, see $WORK/$target.log" >&2
    exit 1
  }

  # One library per slice is simpler to vendor than two.
  # (OpenSSL has objects that are empty on iOS, e.g. its Windows threads.)
  libtool -static -no_warning_for_no_symbols -o "$prefix/lib/libopenssl.a" "$prefix/lib/libssl.a" "$prefix/lib/libcrypto.a"
}

build ios64-xcrun "-mios-version-min=$IOS_MIN"
build iossimulator-arm64-xcrun "-mios-simulator-version-min=$IOS_MIN"
build iossimulator-x86_64-xcrun "-mios-simulator-version-min=$IOS_MIN"

# The simulator slice holds both architectures with one set of headers, which
# only works if their generated headers agree.
if ! diff -r "$WORK/install/iossimulator-arm64-xcrun/include" \
  "$WORK/install/iossimulator-x86_64-xcrun/include" >/dev/null; then
  echo "error: the arm64 and x86_64 simulator headers differ" >&2
  exit 1
fi

SIM="$WORK/install/iossimulator"
rm -rf "$SIM"
mkdir -p "$SIM/lib"
lipo -create \
  "$WORK/install/iossimulator-arm64-xcrun/lib/libopenssl.a" \
  "$WORK/install/iossimulator-x86_64-xcrun/lib/libopenssl.a" \
  -output "$SIM/lib/libopenssl.a"

rm -rf "$OUTPUT"
xcodebuild -create-xcframework \
  -library "$WORK/install/ios64-xcrun/lib/libopenssl.a" \
  -headers "$WORK/install/ios64-xcrun/include" \
  -library "$SIM/lib/libopenssl.a" \
  -headers "$WORK/install/iossimulator-arm64-xcrun/include" \
  -output "$OUTPUT" >/dev/null

# CocoaPods copies every slice of a pod's library xcframeworks into one folder,
# replacing what is there: OpenSSL's Headers would delete c-ares' Headers. So
# OpenSSL's are named OpenSSLHeaders (NitroNode.podspec adds them to the
# header search path itself).
for i in 0 1; do
  slice="$(/usr/libexec/PlistBuddy -c "Print :AvailableLibraries:$i:LibraryIdentifier" "$OUTPUT/Info.plist")"
  mv "$OUTPUT/$slice/Headers" "$OUTPUT/$slice/OpenSSLHeaders"
  /usr/libexec/PlistBuddy -c "Set :AvailableLibraries:$i:HeadersPath OpenSSLHeaders" "$OUTPUT/Info.plist"
done

echo "Created $OUTPUT (OpenSSL $OPENSSL_VERSION, iOS $IOS_MIN+)"
