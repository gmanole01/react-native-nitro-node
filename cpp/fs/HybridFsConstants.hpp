#pragma once

#include <uv.h>

#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

#include "HybridNitroNodeFsConstantsSpec.hpp"

#define NITRO_NODE_FS_CONST(name)            \
  double get##name() override {      \
    return name;                     \
  }

// A constant this platform doesn't have: fs.ts leaves it out of fs.constants
#define NITRO_NODE_FS_NO_CONST(name)        \
  double get##name() override {      \
    return -1;                       \
  }

namespace margelo::nitro::node {

class HybridFsConstants : public HybridNitroNodeFsConstantsSpec {
public:
    HybridFsConstants() : HybridObject(TAG), HybridNitroNodeFsConstantsSpec() {}

#ifdef _WIN32
    // Node's fs.constants on Windows: libuv's open() flags (its UV_FS_O_*,
    // which it maps to the CRT's), S_IRUSR and S_IWUSR for modes, and the
    // file types libuv's stat() reports.
    double getO_RDONLY() override { return UV_FS_O_RDONLY; }
    double getO_WRONLY() override { return UV_FS_O_WRONLY; }
    double getO_RDWR() override { return UV_FS_O_RDWR; }
    double getO_CREAT() override { return UV_FS_O_CREAT; }
    double getO_EXCL() override { return UV_FS_O_EXCL; }
    double getO_TRUNC() override { return UV_FS_O_TRUNC; }
    double getO_APPEND() override { return UV_FS_O_APPEND; }
    NITRO_NODE_FS_NO_CONST(O_NOCTTY)
    NITRO_NODE_FS_NO_CONST(O_NOFOLLOW)
    NITRO_NODE_FS_NO_CONST(O_SYNC)
    NITRO_NODE_FS_NO_CONST(O_DSYNC)
    NITRO_NODE_FS_NO_CONST(O_NONBLOCK)
    NITRO_NODE_FS_NO_CONST(O_SYMLINK)
    NITRO_NODE_FS_NO_CONST(O_DIRECTORY)
    NITRO_NODE_FS_NO_CONST(O_NOATIME)
    NITRO_NODE_FS_NO_CONST(O_DIRECT)
    NITRO_NODE_FS_NO_CONST(S_IRWXU)
    double getS_IRUSR() override { return _S_IREAD; }
    double getS_IWUSR() override { return _S_IWRITE; }
    NITRO_NODE_FS_NO_CONST(S_IXUSR)
    NITRO_NODE_FS_NO_CONST(S_IRWXG)
    NITRO_NODE_FS_NO_CONST(S_IRGRP)
    NITRO_NODE_FS_NO_CONST(S_IWGRP)
    NITRO_NODE_FS_NO_CONST(S_IXGRP)
    NITRO_NODE_FS_NO_CONST(S_IRWXO)
    NITRO_NODE_FS_NO_CONST(S_IROTH)
    NITRO_NODE_FS_NO_CONST(S_IWOTH)
    NITRO_NODE_FS_NO_CONST(S_IXOTH)
    NITRO_NODE_FS_CONST(S_IFMT)
    NITRO_NODE_FS_CONST(S_IFREG)
    NITRO_NODE_FS_CONST(S_IFDIR)
    NITRO_NODE_FS_CONST(S_IFCHR)
    NITRO_NODE_FS_NO_CONST(S_IFBLK)
    NITRO_NODE_FS_NO_CONST(S_IFIFO)
    NITRO_NODE_FS_CONST(S_IFLNK)
    NITRO_NODE_FS_NO_CONST(S_IFSOCK)
    NITRO_NODE_FS_CONST(F_OK)
    NITRO_NODE_FS_CONST(R_OK)
    NITRO_NODE_FS_CONST(W_OK)
    NITRO_NODE_FS_CONST(X_OK)
#else
    NITRO_NODE_FS_CONST(O_RDONLY)
    NITRO_NODE_FS_CONST(O_WRONLY)
    NITRO_NODE_FS_CONST(O_RDWR)
    NITRO_NODE_FS_CONST(O_CREAT)
    NITRO_NODE_FS_CONST(O_EXCL)
    NITRO_NODE_FS_CONST(O_NOCTTY)
    NITRO_NODE_FS_CONST(O_TRUNC)
    NITRO_NODE_FS_CONST(O_APPEND)
    NITRO_NODE_FS_CONST(O_NOFOLLOW)
    NITRO_NODE_FS_CONST(O_SYNC)
    NITRO_NODE_FS_CONST(O_DSYNC)
    NITRO_NODE_FS_CONST(O_NONBLOCK)
    NITRO_NODE_FS_CONST(S_IRWXU)
    NITRO_NODE_FS_CONST(S_IRUSR)
    NITRO_NODE_FS_CONST(S_IWUSR)
    NITRO_NODE_FS_CONST(S_IXUSR)
    NITRO_NODE_FS_CONST(S_IRWXG)
    NITRO_NODE_FS_CONST(S_IRGRP)
    NITRO_NODE_FS_CONST(S_IWGRP)
    NITRO_NODE_FS_CONST(S_IXGRP)
    NITRO_NODE_FS_CONST(S_IRWXO)
    NITRO_NODE_FS_CONST(S_IROTH)
    NITRO_NODE_FS_CONST(S_IWOTH)
    NITRO_NODE_FS_CONST(S_IXOTH)
    NITRO_NODE_FS_CONST(S_IFMT)
    NITRO_NODE_FS_CONST(S_IFREG)
    NITRO_NODE_FS_CONST(S_IFDIR)
    NITRO_NODE_FS_CONST(S_IFCHR)
    NITRO_NODE_FS_CONST(S_IFBLK)
    NITRO_NODE_FS_CONST(S_IFIFO)
    NITRO_NODE_FS_CONST(S_IFLNK)
    NITRO_NODE_FS_CONST(S_IFSOCK)
    NITRO_NODE_FS_CONST(F_OK)
    NITRO_NODE_FS_CONST(R_OK)
    NITRO_NODE_FS_CONST(W_OK)
    NITRO_NODE_FS_CONST(X_OK)

    // these might not exist in android
    #ifdef O_SYMLINK
    NITRO_NODE_FS_CONST(O_SYMLINK)
    #else
    NITRO_NODE_FS_NO_CONST(O_SYMLINK)
    #endif

    // these might not exist in ios
    #ifdef O_DIRECTORY
    NITRO_NODE_FS_CONST(O_DIRECTORY)
    #else
    NITRO_NODE_FS_NO_CONST(O_DIRECTORY)
    #endif

    #ifdef O_NOATIME
    NITRO_NODE_FS_CONST(O_NOATIME)
    #else
    NITRO_NODE_FS_NO_CONST(O_NOATIME)
    #endif

    #ifdef O_DIRECT
    NITRO_NODE_FS_CONST(O_DIRECT)
    #else
    NITRO_NODE_FS_NO_CONST(O_DIRECT)
    #endif
#endif
};

} // namespace margelo::nitro::node
