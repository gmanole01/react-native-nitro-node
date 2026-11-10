#!/usr/bin/env bash
#
# Builds c-ares (deps/c-ares) as a static library for every Apple platform
# NitroNode supports and writes ios/Frameworks/c-ares.xcframework, which
# NitroNode.podspec vendors. Android builds the same sources with CMake
# (android/CMakeLists.txt).
#
# Usage: scripts/build-cares-apple.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/deps/c-ares"
WORK="$ROOT/build/cares-apple"
OUT="$ROOT/ios/Frameworks/c-ares.xcframework"
JOBS="$(sysctl -n hw.ncpu)"

# The platforms in NitroNode.podspec. Deployment targets are at or below ours:
# a static archive built for an older minimum links into a newer app, not the
# reverse.
#
# variant | sdk | CMAKE_SYSTEM_NAME | archs | target triple suffix
SLICES=(
  "ios-arm64|iphoneos|iOS|arm64|apple-ios13.0"
  "ios-arm64_x86_64-simulator|iphonesimulator|iOS|arm64 x86_64|apple-ios13.0-simulator"
  "macos-arm64_x86_64|macosx|Darwin|arm64 x86_64|apple-macos11.0"
  "xros-arm64|xros|visionOS|arm64|apple-xros1.0"
  "xros-arm64_x86_64-simulator|xrsimulator|visionOS|arm64 x86_64|apple-xros1.0-simulator"
)

# Builds libcares.a for one arch of one slice.
build_arch() {
  local sdk="$1" system="$2" arch="$3" triple_suffix="$4" out="$5"
  local sysroot
  sysroot="$(xcrun --sdk "$sdk" --show-sdk-path)"

  rm -rf "$out"
  mkdir -p "$(dirname "$out")"
  # The target triple, not CMAKE_OSX_ARCHITECTURES/DEPLOYMENT_TARGET: it
  # also picks the simulator, and c-ares' feature checks compile with it.
  # pipe2 is in the SDKs from iOS/macOS 27 on, far above our deployment
  # targets, but c-ares' check only looks at the headers: use pipe() instead.
  cmake -S "$SRC" -B "$out" \
    -DCMAKE_SYSTEM_NAME="$system" \
    -DCMAKE_OSX_SYSROOT="$sysroot" \
    -DCMAKE_OSX_ARCHITECTURES="" \
    -DCMAKE_C_COMPILER="$(xcrun --sdk "$sdk" -f clang)" \
    -DCMAKE_C_FLAGS="-target $arch-$triple_suffix" \
    -DHAVE_PIPE2=0 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$out/install" \
    -DCARES_STATIC=ON -DCARES_STATIC_PIC=ON -DCARES_SHARED=OFF \
    -DCARES_BUILD_TOOLS=OFF -DCARES_BUILD_TESTS=OFF \
    >"$out.configure.log"
  cmake --build "$out" -j"$JOBS" >"$out.build.log" 2>&1
  cmake --install "$out" >"$out.install.log"
}

rm -rf "$WORK"
mkdir -p "$WORK"
create_args=()

for slice in "${SLICES[@]}"; do
  IFS='|' read -r variant sdk system archs triple_suffix <<<"$slice"
  echo "==> Building $variant"
  arch_libs=()
  for arch in $archs; do
    out="$WORK/$variant/$arch"
    build_arch "$sdk" "$system" "$arch" "$triple_suffix" "$out"
    arch_libs+=("$out/install/lib/libcares.a")
  done

  mkdir -p "$WORK/lib/$variant"
  xcrun lipo -create "${arch_libs[@]}" -output "$WORK/lib/$variant/libcares.a"
  # ares_build.h is generated, but the same for every 64-bit Apple target
  create_args+=(-library "$WORK/lib/$variant/libcares.a" -headers "$WORK/$variant/$arch/install/include")
done

rm -rf "$OUT"
xcrun xcodebuild -create-xcframework "${create_args[@]}" -output "$OUT"
echo "==> $OUT"
