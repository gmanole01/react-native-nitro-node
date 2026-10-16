project(NitroNode)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitroNode)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Enable Raw Props parsing in react-native (for Nitro Views)
add_compile_options(-DRN_SERIALIZABLE_STATE=1)

# set(OPENSSL_ROOT_DIR "/opt/homebrew/opt/openssl@3")
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
        uv
        tlsuv
        c-ares
)
