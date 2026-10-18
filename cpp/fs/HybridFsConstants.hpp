#pragma once

#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

#include "HybridNitroNodeFsConstantsSpec.hpp"

#define NITRO_NODE_FS_CONST(name)            \
  double get##name() override {      \
    return name;                     \
  }

namespace margelo::nitro::node {

class HybridFsConstants : public HybridNitroNodeFsConstantsSpec {
public:
    HybridFsConstants() : HybridObject(TAG), HybridNitroNodeFsConstantsSpec() {}
       
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
    double getO_SYMLINK() override {
        return -1;
    }
    #endif

    // these might not exist in ios
    #ifdef O_DIRECTORY
    NITRO_NODE_FS_CONST(O_DIRECTORY)
    #else
    double getO_DIRECTORY() override {
        return -1;
    }
    #endif

    #ifdef O_NOATIME
    NITRO_NODE_FS_CONST(O_NOATIME)
    #else
    double getO_NOATIME() override {
        return -1;
    }
    #endif

    #ifdef O_DIRECT
    NITRO_NODE_FS_CONST(O_DIRECT)
    #else
    double getO_DIRECT() override {
        return -1;
    }
    #endif
};

} // namespace margelo::nitro::node
