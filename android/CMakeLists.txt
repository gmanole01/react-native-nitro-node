project(NitroNode)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitroNode)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Enable Raw Props parsing in react-native (for Nitro Views)
add_compile_options(-DRN_SERIALIZABLE_STATE=1)

# BLAKE3 sources - architecture-specific SIMD support
set(BLAKE3_SOURCES
        ../deps/blake3/c/blake3.c
        ../deps/blake3/c/blake3_dispatch.c
        ../deps/blake3/c/blake3_portable.c
)

if(CMAKE_ANDROID_ARCH_ABI STREQUAL "arm64-v8a")
        # ARM64 uses NEON intrinsics (auto-detected via IS_AARCH64 in blake3_impl.h)
        list(APPEND BLAKE3_SOURCES ../deps/blake3/c/blake3_neon.c)
elseif(CMAKE_ANDROID_ARCH_ABI STREQUAL "x86" OR CMAKE_ANDROID_ARCH_ABI STREQUAL "x86_64")
        # Disable x86 SIMD - would require assembly files we don't compile
        # Falls back to portable C implementation
        add_definitions(-DBLAKE3_NO_SSE2 -DBLAKE3_NO_SSE41 -DBLAKE3_NO_AVX2 -DBLAKE3_NO_AVX512)
endif()

# OpenSSL, from the openssl-static prefab (see build.gradle). Found before
# tlsuv, which links it too.
find_package(opensslstatic REQUIRED CONFIG)

set(LIBUV_SRC "../deps/libuv")
set(LIBUV_BUILD "${CMAKE_BINARY_DIR}/libuv_build")
add_subdirectory(${LIBUV_SRC} ${LIBUV_BUILD})

# tlsuv looks for this target first. Without it, it asks pkg-config for a
# system libuv: missing on most machines, and the host's (e.g. Homebrew's)
# headers where there is one.
add_library(libuv::uv ALIAS uv)

set(TLSUV_HTTP OFF CACHE BOOL "disable HTTP support" FORCE)
set(TLSUV_TLSLIB "openssl" CACHE STRING "TLS implementation library ${supported_tls_libs}" FORCE)
set(TLSUV_SRC "../deps/tlsuv")
set(TLSUV_BUILD "${CMAKE_BINARY_DIR}/tlsuv_build")
add_subdirectory(${TLSUV_SRC} ${TLSUV_BUILD})

set(CARES_SRC "../deps/c-ares")
set(CARES_BUILD "${CMAKE_BINARY_DIR}/cares_build")
add_subdirectory(${CARES_SRC} ${CARES_BUILD})

# Define C++ library and add all sources
# Brotli and zstd, for zlib: static archives inside this .so, their symbols
# kept out of its dynamic table by --exclude-libs (see below)
file(GLOB BROTLI_SOURCES
        "../deps/brotli/c/common/*.c"
        "../deps/brotli/c/dec/*.c"
        "../deps/brotli/c/enc/*.c")
add_library(nitro_brotli STATIC ${BROTLI_SOURCES})
target_include_directories(nitro_brotli PUBLIC "../deps/brotli/c/include")
set_target_properties(nitro_brotli PROPERTIES C_VISIBILITY_PRESET hidden POSITION_INDEPENDENT_CODE ON)

file(GLOB ZSTD_SOURCES
        "../deps/zstd/lib/common/*.c"
        "../deps/zstd/lib/compress/*.c"
        "../deps/zstd/lib/decompress/*.c")
add_library(nitro_zstd STATIC ${ZSTD_SOURCES})
target_include_directories(nitro_zstd PUBLIC "../deps/zstd/lib")
# no x86 assembly, no legacy formats; multithreading (ZSTD_c_nbWorkers), as Node
target_compile_definitions(nitro_zstd PRIVATE ZSTD_DISABLE_ASM=1 ZSTD_LEGACY_SUPPORT=0 ZSTD_MULTITHREAD=1)
set_target_properties(nitro_zstd PROPERTIES C_VISIBILITY_PRESET hidden POSITION_INDEPENDENT_CODE ON)

add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        ../cpp/core/UVLoop.cpp
        ../cpp/dns/HybridDns.cpp
        ../cpp/fs/HybridFs.cpp
        ../cpp/net/HybridNet.cpp
        ../cpp/net/HybridNetServer.cpp
        ../cpp/net/HybridNetSocket.cpp
        ../cpp/net/SockAddrUtil.cpp
        ../cpp/tls/HybridTls.cpp
        ../cpp/tls/HybridTlsSocket.cpp
        ../cpp/tls/HybridTlsServer.cpp
        ../cpp/tls/HybridTlsSecureContext.cpp
        ../cpp/timers/HybridTimers.cpp
        ../cpp/zlib/HybridZlib.cpp
        ../cpp/zlib/CompressionContexts.cpp
        ../cpp/url/HybridUrl.cpp
        ../deps/ada/ada.cpp

        # crypto
        ../cpp/crypto/argon2/HybridArgon2.cpp
        ../cpp/crypto/blake3/HybridBlake3.cpp
        ../cpp/crypto/certificate/HybridCertificate.cpp
        ../cpp/crypto/cipher/CCMCipher.cpp
        ../cpp/crypto/cipher/GCMCipher.cpp
        ../cpp/crypto/cipher/HybridCipher.cpp
        ../cpp/crypto/cipher/HybridRsaCipher.cpp
        ../cpp/crypto/cipher/OCBCipher.cpp
        ../cpp/crypto/cipher/XSalsa20Cipher.cpp
        ../cpp/crypto/cipher/XSalsa20Poly1305Cipher.cpp
        ../cpp/crypto/cipher/XChaCha20Poly1305Cipher.cpp
        ../cpp/crypto/cipher/ChaCha20Cipher.cpp
        ../cpp/crypto/cipher/ChaCha20Poly1305Cipher.cpp
        ../cpp/crypto/dh/HybridDiffieHellman.cpp
        ../cpp/crypto/dh/HybridDhKeyPair.cpp
        ../cpp/crypto/dsa/HybridDsaKeyPair.cpp
        ../cpp/crypto/ec/HybridEcKeyPair.cpp
        ../cpp/crypto/ecdh/HybridECDH.cpp
        ../cpp/crypto/ed25519/HybridEdKeyPair.cpp
        ../cpp/crypto/hash/HybridHash.cpp
        ../cpp/crypto/hmac/HybridHmac.cpp
        ../cpp/crypto/hkdf/HybridHkdf.cpp
        ../cpp/crypto/kmac/HybridKmac.cpp
        ../cpp/crypto/keys/HybridKeyObjectHandle.cpp
        ../cpp/crypto/keys/KeyObjectData.cpp
        ../cpp/crypto/mldsa/HybridMlDsaKeyPair.cpp
        ../cpp/crypto/mlkem/HybridMlKemKeyPair.cpp
        ../cpp/crypto/slhdsa/HybridSlhDsaKeyPair.cpp
        ../cpp/crypto/pbkdf2/HybridPbkdf2.cpp
        ../cpp/crypto/prime/HybridPrime.cpp
        ../cpp/crypto/random/HybridRandom.cpp
        ../cpp/crypto/rsa/HybridRsaKeyPair.cpp
        ../cpp/crypto/scrypt/HybridScrypt.cpp
        ../cpp/crypto/sign/HybridSignHandle.cpp
        ../cpp/crypto/sign/HybridVerifyHandle.cpp
        ../cpp/crypto/turboshake/HybridTurboShake.cpp
        ../cpp/crypto/x509/HybridX509Certificate.cpp
        ../cpp/crypto/utils/HybridUtils.cpp
        ../cpp/crypto/utils/QuickCryptoUtils.cpp

        # crypto deps
        ${BLAKE3_SOURCES}
        ../deps/fastpbkdf2/fastpbkdf2.c
        ../deps/ncrypto/src/aead.cpp
        ../deps/ncrypto/src/engine.cpp
        ../deps/ncrypto/src/ncrypto.cpp
        ../deps/simdutf/src/simdutf.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroNode+autolinking.cmake)

# Set up local includes
include_directories(
        "src/main/cpp"
        "../cpp"
        "../cpp/core"
        "../cpp/net"
        "../cpp/dns"
        "../cpp/fs"
        "../cpp/tls"
        "../cpp/timers"
        "../cpp/zlib"
        "../cpp/url"
        "../deps/ada"

        # crypto
        "../cpp/crypto/argon2"
        "../cpp/crypto/blake3"
        "../cpp/crypto/certificate"
        "../cpp/crypto/cipher"
        "../cpp/crypto/dh"
        "../cpp/crypto/dsa"
        "../cpp/crypto/ec"
        "../cpp/crypto/ecdh"
        "../cpp/crypto/ed25519"
        "../cpp/crypto/hash"
        "../cpp/crypto/hkdf"
        "../cpp/crypto/hmac"
        "../cpp/crypto/kmac"
        "../cpp/crypto/keys"
        "../cpp/crypto/mldsa"
        "../cpp/crypto/mlkem"
        "../cpp/crypto/slhdsa"
        "../cpp/crypto/pbkdf2"
        "../cpp/crypto/prime"
        "../cpp/crypto/random"
        "../cpp/crypto/rsa"
        "../cpp/crypto/sign"
        "../cpp/crypto/scrypt"
        "../cpp/crypto/turboshake"
        "../cpp/crypto/utils"
        "../cpp/crypto/x509"

        # crypto deps
        "../deps/blake3/c"
        "../deps/fastpbkdf2"
        "../deps/ncrypto/include"
        "../deps/simdutf/include"
        "../deps/simdutf/src"
)

target_include_directories(${PACKAGE_NAME} PRIVATE
        ../deps/libuv/include
        ../deps/c-ares/include
        ../deps/tlsuv/include
)

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
        z # <-- the system zlib, for zlib
        nitro_brotli # <-- Brotli, for zlib
        nitro_zstd # <-- zstd, for zlib
        uv
        tlsuv
        c-ares
        opensslstatic::ssl # <-- OpenSSL   (SSL)
        opensslstatic::crypto # <-- OpenSSL   (Crypto)
)

# Keep every symbol we pull in from a static archive — i.e. all of OpenSSL — out
# of this .so's dynamic symbol table, so our OpenSSL and another library's
# OpenSSL cannot interpose on each other at runtime. Symbols from our own
# sources are unaffected, so the Nitro/JNI entry points stay exported.
# See issue #1059.
target_link_options(${PACKAGE_NAME} PRIVATE "-Wl,--exclude-libs,ALL")

if(SODIUM_ENABLED)
        add_definitions(-DBLSALLOC_SODIUM)
        find_package(sodium REQUIRED CONFIG)
        target_link_libraries(
                ${PACKAGE_NAME}
                sodium::sodium
        )
endif()