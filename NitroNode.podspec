require "json"
require "digest"
require "shellwords"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroNode"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/gmanole01/react-native-nitro-node.git", :tag => "#{s.version}" }

  # Our prebuilt static OpenSSL, for TLS and crypto (scripts/build-openssl-apple.sh).
  # Every global symbol in it is renamed to rnnn_*, and its prefix header,
  # included in every file of this pod, makes our code call those names: so
  # another library that statically embeds OpenSSL can't take its place when
  # the app links. It's our own build, not react-native-quick-crypto's: CocoaPods
  # refuses two pods vendoring a framework with the same name.
  #
  # Downloaded while the podspec is evaluated, because prepare_command is
  # skipped for :path pods.
  openssl_version = "3.6.2"
  openssl_sha256 = "47e2000d40b1eab9c46d48167f34524a6f65dc3da5904e90c66ad76456c0ee8d"
  openssl_dir = File.join(__dir__, "ios", "openssl")
  openssl_prefix_header = File.join(openssl_dir, "nitronode_openssl_prefix.h")

  unless File.exist?(openssl_prefix_header)
    archive = File.join(__dir__, "ios", "NitroNodeOpenSSL.zip")
    url = "https://github.com/gmanole01/react-native-nitro-node/releases/download/openssl-apple-#{openssl_version}/NitroNodeOpenSSL-#{openssl_version}.zip"

    Pod::UI.puts "[NitroNode] Downloading static OpenSSL #{openssl_version}..."
    FileUtils.mkdir_p(File.join(__dir__, "ios"))
    FileUtils.rm_rf(openssl_dir)
    system("curl -sSfL --retry 3 --retry-all-errors --connect-timeout 30 --max-time 600 -o #{archive.shellescape} #{url.shellescape}") || raise("[NitroNode] Failed to download static OpenSSL")

    actual = Digest::SHA256.file(archive).hexdigest
    unless actual == openssl_sha256
      File.delete(archive)
      raise "[NitroNode] Static OpenSSL checksum mismatch: expected #{openssl_sha256}, got #{actual}"
    end

    system("unzip -q #{archive.shellescape} -d #{openssl_dir.shellescape}") || raise("[NitroNode] Failed to extract static OpenSSL")
    File.delete(archive)
  end

  # crypto: libsodium (XSalsa20 ciphers), off by default. Set SODIUM_ENABLED=1
  # before `pod install` to build it in.
  sodium_enabled = ENV['SODIUM_ENABLED'] == '1'
  Pod::UI.puts("[NitroNode] libsodium #{sodium_enabled ? "enabled" : "disabled"}")

  # Download the libsodium source while the podspec is evaluated, because
  # prepare_command is skipped for :path pods.
  if sodium_enabled
    sodium_version = "1.0.22"
    # The GitHub release asset, not download.libsodium.org's -stable tarball: the
    # latter is regenerated from the stable branch, so no hash can be pinned to it.
    sodium_sha256 = "adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349"
    sodium_url = "https://github.com/jedisct1/libsodium/releases/download/#{sodium_version}-RELEASE/libsodium-#{sodium_version}.tar.gz"
    sodium_dir = File.join(__dir__, "ios", "libsodium-stable")
    sodium_header = File.join(sodium_dir, "src", "libsodium", "include", "sodium.h")
    unless File.exist?(sodium_header)
      ios_dir = File.join(__dir__, "ios")
      archive = File.join(ios_dir, "libsodium.tar.gz")
      extracted = File.join(ios_dir, "libsodium-#{sodium_version}")

      FileUtils.mkdir_p(ios_dir)
      FileUtils.rm_rf([sodium_dir, extracted])

      Pod::UI.puts "[NitroNode] Downloading libsodium #{sodium_version} source..."
      system("curl -sSfL --retry 3 --retry-all-errors --connect-timeout 30 --max-time 300 -o #{archive.shellescape} #{sodium_url.shellescape}") || raise("[NitroNode] Failed to download libsodium")

      actual = Digest::SHA256.file(archive).hexdigest
      unless actual == sodium_sha256
        File.delete(archive)
        raise "[NitroNode] libsodium checksum mismatch: expected #{sodium_sha256}, got #{actual}"
      end

      system("tar -xzf #{archive.shellescape} -C #{ios_dir.shellescape}") || raise("[NitroNode] Failed to extract libsodium")
      File.rename(extracted, sodium_dir)
      File.delete(archive)
    end

    s.prepare_command = <<-CMD
      set -e
      cd ios/libsodium-stable
      ./configure --disable-shared --enable-static
      make -j$(sysctl -n hw.ncpu)
    CMD
  else
    s.prepare_command = <<-CMD
      set -e
      rm -rf ios/libsodium-stable
      rm -f ios/libsodium.tar.gz
    CMD
  end

  # Only source files go in the Xcode project, never our headers: they are
  # found through HEADER_SEARCH_PATHS and kept with preserve_paths. Xcode puts
  # the headers of every pod in one header map (project-headers.hmap) that
  # quoted includes search before a pod's own headers, so two pods with a
  # header of the same name get each other's. Our crypto is
  # react-native-quick-crypto's, with its file names (QuickCryptoUtils.hpp,
  # HybridCipher.hpp, CipherArgs.hpp...): with both libraries in an app, its
  # files would include ours. USE_HEADERMAP = NO below is the other direction.
  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{c,cpp}",
    
    # libuv
    "deps/libuv/src/*.c",
    "deps/libuv/src/unix/async.c",
    "deps/libuv/src/unix/core.c",
    "deps/libuv/src/unix/dl.c",
    "deps/libuv/src/unix/fs.c",
    "deps/libuv/src/unix/getaddrinfo.c",
    "deps/libuv/src/unix/getnameinfo.c",
    "deps/libuv/src/unix/loop-watcher.c",
    "deps/libuv/src/unix/loop.c",
    "deps/libuv/src/unix/pipe.c",
    "deps/libuv/src/unix/poll.c",
    "deps/libuv/src/unix/process.c",
    "deps/libuv/src/unix/random-devurandom.c",
    "deps/libuv/src/unix/signal.c",
    "deps/libuv/src/unix/stream.c",
    "deps/libuv/src/unix/tcp.c",
    "deps/libuv/src/unix/thread.c",
    "deps/libuv/src/unix/tty.c",
    "deps/libuv/src/unix/udp.c",
    "deps/libuv/src/unix/darwin-proctitle.c",
    "deps/libuv/src/unix/darwin.c",
    "deps/libuv/src/unix/fsevents.c",
    "deps/libuv/src/unix/random-getentropy.c",
    "deps/libuv/src/unix/proctitle.c",
    "deps/libuv/src/unix/bsd-ifaddrs.c",
    "deps/libuv/src/unix/kqueue.c",

    # tlsuv: only its TLS engine (OpenSSL), not its HTTP client. Its headers
    # are found through HEADER_SEARCH_PATHS, so its generic names (util.h,
    # keychain.h, ...) stay out of the pod's header map.
    "deps/tlsuv/src/tls_engine.c",
    "deps/tlsuv/src/alloc.c",
    "deps/tlsuv/src/um_debug.c",
    "deps/tlsuv/src/keychain.c",
    "deps/tlsuv/src/p11.c",
    "deps/tlsuv/src/apple/keychain.c",
    "deps/tlsuv/src/openssl/engine.c",
    "deps/tlsuv/src/openssl/keys.c",

    # crypto: ncrypto, simdutf, BLAKE3 (its C implementation) and fastpbkdf2
    "deps/ncrypto/src/*.{cpp}",
    "deps/simdutf/src/simdutf.cpp",
    "deps/blake3/c/*.c",
    "deps/fastpbkdf2/*.c",

    # zlib: Brotli and zstd, only their .c files. Their own includes are
    # relative, their public headers come through HEADER_SEARCH_PATHS, so
    # their generic names (version.h, platform.h, ...) stay out of the pod's
    # header map.
    "deps/brotli/c/common/*.c",
    "deps/brotli/c/dec/*.c",
    "deps/brotli/c/enc/*.c",
    "deps/zstd/lib/common/*.c",
    "deps/zstd/lib/compress/*.c",
    "deps/zstd/lib/decompress/*.c",

    # url: ada, the WHATWG URL parser Node uses
    "deps/ada/ada.cpp",
  ]
  if sodium_enabled
    s.source_files += ["ios/libsodium-stable/src/libsodium/**/*.{h,c}"]
  end

  s.exclude_files = [
    # BLAKE3's x86 SIMD implementations use Intel intrinsics, which don't
    # compile for ARM; its portable and NEON code covers every slice
    "deps/blake3/c/blake3_sse2.c",
    "deps/blake3/c/blake3_sse41.c",
    "deps/blake3/c/blake3_avx2.c",
    "deps/blake3/c/blake3_avx512.c",
    "deps/blake3/c/blake3_sse2_x86-64_unix.S",
    "deps/blake3/c/blake3_sse41_x86-64_unix.S",
    "deps/blake3/c/blake3_avx2_x86-64_unix.S",
    "deps/blake3/c/blake3_avx512_x86-64_unix.S",
    "deps/blake3/c/blake3_sse2_x86-64_windows_gnu.S",
    "deps/blake3/c/blake3_sse41_x86-64_windows_gnu.S",
    "deps/blake3/c/blake3_avx2_x86-64_windows_gnu.S",
    "deps/blake3/c/blake3_avx512_x86-64_windows_gnu.S",
    "deps/blake3/c/blake3_sse2_x86-64_windows_msvc.asm",
    "deps/blake3/c/blake3_sse41_x86-64_windows_msvc.asm",
    "deps/blake3/c/blake3_avx2_x86-64_windows_msvc.asm",
    "deps/blake3/c/blake3_avx512_x86-64_windows_msvc.asm",
    # BLAKE3's examples and TBB variant
    "deps/blake3/c/main.c",
    "deps/blake3/c/example.c",
    "deps/blake3/c/example_tbb.c",
    "deps/blake3/c/blake3_tbb.cpp",
  ]
  s.preserve_paths = [
    "cpp/**/*.{h,hpp}",
    "nitrogen/generated/shared/**/*.{h,hpp}",
    "deps/libuv/include/**/*.h",
    "deps/libuv/src/**/*.h",
    "deps/ncrypto/include/**/*.h",
    "deps/simdutf/include/**/*.h",
    "deps/simdutf/src/**/*.h",
    "deps/blake3/c/*.h",
    "deps/fastpbkdf2/*.h",
    "deps/ada/ada.h",
    "deps/tlsuv/include/**/*.h",
    "deps/tlsuv/src/**/*.h",
    "deps/brotli/c/**/*.h",
    "deps/zstd/lib/**/*.h",
  ]

  # Add vendored xcframeworks
  s.vendored_frameworks = [
    "ios/Frameworks/c-ares.xcframework",
    "ios/openssl/NitroNodeOpenSSL.xcframework",
  ]
  # tlsuv verifies certificates with Apple's trust store
  s.frameworks = "Security", "CoreFoundation"
  # the system zlib, for zlib
  s.libraries = "z"

  header_search_paths = [
    # libuv
    '"$(PODS_TARGET_SRCROOT)/deps/libuv/include"',
    # OpenSSL. The absolute path too: in a monorepo the podspec is reached
    # through a symlink, but sources are compiled from their real paths
    '"$(PODS_TARGET_SRCROOT)/ios/openssl/include"',
    "\"#{File.join(openssl_dir, "include")}\"",
    # tlsuv
    '"$(PODS_TARGET_SRCROOT)/deps/tlsuv/include"',
    # Brotli and zstd's public headers
    '"$(PODS_TARGET_SRCROOT)/deps/brotli/c/include"',
    '"$(PODS_TARGET_SRCROOT)/deps/zstd/lib"',
    '"$(PODS_TARGET_SRCROOT)/deps/tlsuv/src"',
    '"$(PODS_TARGET_SRCROOT)/deps/tlsuv/src/pkcs11"',
    # libuv's internal headers (uv-common.h...)
    '"$(PODS_TARGET_SRCROOT)/deps/libuv/src"',
    '"$(PODS_TARGET_SRCROOT)/deps/ada"',
    # NitroModules' headers: its module's umbrella includes them as
    # "AnyMap.hpp", and those include its private ones the same way. Other
    # pods find them through the header maps we don't use
    '"${PODS_ROOT}/Headers/Public/NitroModules"',
    '"${PODS_ROOT}/Headers/Private/NitroModules"',
    # Nitrogen's generated specs and structs
    '"$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++"',
    '"$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios"',
    '"$(PODS_TARGET_SRCROOT)/ios"',
    # crypto
    '"$(PODS_TARGET_SRCROOT)/deps/ncrypto/include"',
    '"$(PODS_TARGET_SRCROOT)/deps/simdutf/include"',
    '"$(PODS_TARGET_SRCROOT)/deps/simdutf/src"',
    '"$(PODS_TARGET_SRCROOT)/deps/blake3/c"',
    '"$(PODS_TARGET_SRCROOT)/deps/fastpbkdf2"',
  ]
  # C++ implementation: every folder of cpp/, so a new one needs no change here
  header_search_paths += Dir.glob("cpp/**/", base: __dir__).map do |dir|
    "\"$(PODS_TARGET_SRCROOT)/#{dir.chomp("/")}\""
  end
  if sodium_enabled
    # The absolute path too: in a monorepo the podspec is reached through a
    # symlink, but sources are compiled from their real paths
    real_sodium_include = File.join(__dir__, "ios", "libsodium-stable", "src", "libsodium", "include")
    header_search_paths += [
      '"$(PODS_TARGET_SRCROOT)/ios/libsodium-stable/src/libsodium/include"',
      '"$(PODS_TARGET_SRCROOT)/ios/libsodium-stable/src/libsodium/include/sodium"',
      "\"#{real_sodium_include}\"",
      "\"#{real_sodium_include}/sodium\"",
    ]
  end

  # tlsuv's TLS engine
  # zstd: no x86 assembly, no legacy formats; multithreading (ZSTD_c_nbWorkers),
  # as Node. ZSTD_STATIC_LINKING_ONLY on the command line: with Clang modules,
  # zstd.h is imported as zstd's module (lib/module.modulemap), which ignores
  # the #define its sources put before including it.
  definitions = '$(inherited) TLS_IMPL=openssl USE_OPENSSL ZSTD_DISABLE_ASM=1 ZSTD_LEGACY_SUPPORT=0 ZSTD_MULTITHREAD=1 ZSTD_STATIC_LINKING_ONLY=1'
  definitions += ' BLSALLOC_SODIUM=1' if sodium_enabled

  # Every file calls OpenSSL by its renamed symbols: a missed rename is a link
  # error, never a silent bind to another OpenSSL
  force_include = "-include \"#{openssl_prefix_header}\""

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => header_search_paths.join(' '),
    'OTHER_CFLAGS' => "$(inherited) #{force_include}",
    'OTHER_CPLUSPLUSFLAGS' => "$(inherited) #{force_include}",
    'GCC_PREPROCESSOR_DEFINITIONS' => definitions,
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    # Our includes don't go through Xcode's header maps, which hold every
    # pod's headers (see source_files): react-native-quick-crypto's would win
    # over ours of the same name
    'USE_HEADERMAP' => 'NO',
    # BLAKE3: no NEON on the x86_64 simulator, and no x86 SIMD anywhere (its
    # sources are excluded above, but blake3_dispatch.c still refers to them)
    'EXCLUDED_SOURCE_FILE_NAMES[sdk=iphonesimulator*][arch=x86_64]' => 'deps/blake3/c/blake3_neon.c',
    'GCC_PREPROCESSOR_DEFINITIONS[sdk=iphonesimulator*][arch=x86_64]' => "#{definitions} BLAKE3_NO_AVX512 BLAKE3_NO_AVX2 BLAKE3_NO_SSE41 BLAKE3_NO_SSE2",
  }

  load 'nitrogen/generated/ios/NitroNode+autolinking.rb'
  add_nitrogen_files(s)

  # Nitrogen adds its generated headers to the project; keep them out like ours
  # (see source_files). Its struct headers have quick-crypto's names too
  # (CipherArgs.hpp...). Swift only needs the bridge header, which includes none.
  s.source_files = s.attributes_hash['source_files'].map do |pattern|
    pattern
      .sub("nitrogen/generated/shared/**/*.{h,hpp,c,cpp,swift}", "nitrogen/generated/shared/**/*.{c,cpp,swift}")
      .sub("nitrogen/generated/ios/**/*.{h,hpp,c,cpp,mm,swift}", "nitrogen/generated/ios/**/*.{hpp,c,cpp,mm,swift}")
  end
  s.public_header_files = ["nitrogen/generated/ios/NitroNode-Swift-Cxx-Bridge.hpp"]
  s.private_header_files = []

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
