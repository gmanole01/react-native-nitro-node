#include "HybridFs.hpp"

#include <cstdlib>
#include <cstring>
#include <stdexcept>

#include <uv.h>

namespace margelo::nitro::node {

namespace {

// The largest file readFile() loads, as in Node: 2 GiB - 1. Bigger files fail
// with EFBIG, which JS reports as Node's ERR_FS_FILE_TOO_LARGE.
constexpr size_t kMaxReadFileSize = 0x7fffffff;

// The path separators: '/' everywhere, and '\' on Windows too.
#ifdef _WIN32
constexpr const char* kSeparators = "/\\";
#else
constexpr const char* kSeparators = "/";
#endif

// A synchronous uv_fs request: with no callback, libuv runs the call on the
// calling thread and doesn't touch the loop, so no loop is passed. Node's
// *Sync calls work the same way. Cleaned up when it goes out of scope.
struct FsRequest : uv_fs_t {
  FsRequest() : uv_fs_t() {}
  ~FsRequest() {
    uv_fs_req_cleanup(this);
  }
  FsRequest(const FsRequest&) = delete;
  FsRequest& operator=(const FsRequest&) = delete;
};

// The value a numeric call returns: `result`, or the libuv status of the error
// (the negated errno on iOS and Android).
double statusOf(int64_t result) {
  return static_cast<double>(result);
}

// Thrown by the calls that cannot return a status, with `status` being the
// libuv status. JS finds the status in the message, see src/fs/fs.ts.
[[noreturn]] void throwStatus(int64_t status) {
  throw std::runtime_error("[errno " + std::to_string(status) + "]");
}

// Raw bytes [offset, offset + length) of `buffer`, or nullptr when that range
// is outside of it.
uint8_t* rangeOf(const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length) {
  if (offset < 0 || length < 0 || offset + length > static_cast<double>(buffer->size())) {
    return nullptr;
  }
  // An empty ArrayBuffer may have no data at all (Hermes gives nullptr)
  static uint8_t empty;
  uint8_t* data = buffer->data();
  return data == nullptr ? &empty : data + static_cast<size_t>(offset);
}

// A copy of [offset, offset + length) of `buffer`. JS-owned buffers can only
// be touched on the JS thread, so async calls work on a copy.
std::vector<uint8_t> copyRange(const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length) {
  uint8_t* data = rangeOf(buffer, offset, length);
  if (data == nullptr) {
    throwStatus(UV_EINVAL);
  }
  return std::vector<uint8_t>(data, data + static_cast<size_t>(length));
}

// A uv_buf_t over [data, data + length). Its length is 32 bits on Windows:
// longer reads and writes are short ones, which callers already handle.
uv_buf_t bufferOf(const uint8_t* data, size_t length) {
  constexpr size_t kMaxLength = 0x7fffffff;
  return uv_buf_init(const_cast<char*>(reinterpret_cast<const char*>(data)),
                     static_cast<unsigned int>(length < kMaxLength ? length : kMaxLength));
}

// Reads at `position`, or at the current offset when it is negative. Returns
// the bytes read, or the libuv status.
int64_t readAt(uv_file fd, uint8_t* data, size_t length, double position) {
  FsRequest req;
  uv_buf_t buf = bufferOf(data, length);
  return uv_fs_read(nullptr, &req, fd, &buf, 1, position < 0 ? -1 : static_cast<int64_t>(position), nullptr);
}

// Writes at `position`, or at the current offset when it is negative. Returns
// the bytes written, or the libuv status.
int64_t writeAt(uv_file fd, const uint8_t* data, size_t length, double position) {
  FsRequest req;
  uv_buf_t buf = bufferOf(data, length);
  return uv_fs_write(nullptr, &req, fd, &buf, 1, position < 0 ? -1 : static_cast<int64_t>(position), nullptr);
}

int openFile(const std::string& path, int flags, int mode) {
  FsRequest req;
  return uv_fs_open(nullptr, &req, path.c_str(), flags, mode, nullptr);
}

int closeFile(uv_file fd) {
  FsRequest req;
  return uv_fs_close(nullptr, &req, fd, nullptr);
}

// stat(2), or lstat(2) with `noFollow`. Returns 0 or the libuv status.
int statPath(const std::string& path, bool noFollow, uv_stat_t* out) {
  FsRequest req;
  int r = noFollow ? uv_fs_lstat(nullptr, &req, path.c_str(), nullptr) : uv_fs_stat(nullptr, &req, path.c_str(), nullptr);
  if (r == 0) {
    *out = req.statbuf;
  }
  return r;
}

bool isDirectory(const uv_stat_t& st) {
  return (st.st_mode & S_IFMT) == S_IFDIR;
}

// The whole content of the file at `path`. Reads until end of file rather than
// trusting the size from stat, which is 0 for some special files.
std::shared_ptr<ArrayBuffer> readWholeFile(const std::string& path) {
  int fd = openFile(path, UV_FS_O_RDONLY, 0);
  if (fd < 0) {
    throwStatus(fd);
  }

  uint64_t statSize = 0;
  {
    FsRequest req;
    if (uv_fs_fstat(nullptr, &req, fd, nullptr) == 0) {
      statSize = req.statbuf.st_size;
    }
  }
  if (statSize > kMaxReadFileSize) {
    closeFile(fd);
    throwStatus(UV_EFBIG);
  }
  size_t capacity = statSize > 0 ? static_cast<size_t>(statSize) + 1 : 64 * 1024;
  size_t size = 0;
  auto* data = static_cast<uint8_t*>(malloc(capacity));

  while (data != nullptr) {
    if (size == capacity) {
      // special files report no size, so the limit is checked as they are read
      if (capacity > kMaxReadFileSize) {
        free(data);
        closeFile(fd);
        throwStatus(UV_EFBIG);
      }
      capacity *= 2;
      auto* bigger = static_cast<uint8_t*>(realloc(data, capacity));
      if (bigger == nullptr) {
        free(data);
        data = nullptr;
        break;
      }
      data = bigger;
    }
    int64_t r = readAt(fd, data + size, capacity - size, -1);
    if (r < 0) {
      free(data);
      closeFile(fd);
      throwStatus(r);
    }
    if (r == 0) {
      break;
    }
    size += static_cast<size_t>(r);
  }
  closeFile(fd);

  if (data == nullptr) {
    throwStatus(UV_ENOMEM);
  }
  if (size == 0) {
    free(data);
    return ArrayBuffer::allocate(0);
  }
  return ArrayBuffer::wrap(data, size, [data]() { free(data); });
}

// Opens `path` with `flags` and `mode` and writes all of `data` to it.
// Returns 0, or the libuv status.
int writeWholeFile(const std::string& path, const uint8_t* data, size_t size, int flags, int mode) {
  int fd = openFile(path, flags, mode);
  if (fd < 0) {
    return fd;
  }
  size_t written = 0;
  while (written < size) {
    int64_t r = writeAt(fd, data + written, size - written, -1);
    if (r < 0) {
      closeFile(fd);
      return static_cast<int>(r);
    }
    written += static_cast<size_t>(r);
  }
  return closeFile(fd);
}

int makeDirectoryAt(const std::string& path, int mode) {
  FsRequest req;
  return uv_fs_mkdir(nullptr, &req, path.c_str(), mode, nullptr);
}

// mkdir() that succeeds when `path` already is a directory.
int makeDirectoryOrExisting(const std::string& path, int mode) {
  int r = makeDirectoryAt(path, mode);
  if (r != UV_EEXIST) {
    return r;
  }
  uv_stat_t st;
  int s = statPath(path, false, &st);
  if (s != 0) {
    return s;
  }
  return isDirectory(st) ? 0 : UV_ENOTDIR;
}

// mkdir -p: as Node's MKDirpSync, the parents are created when the directory
// can't be for lack of them.
int makeDirectoryTree(const std::string& path, int mode) {
  int r = makeDirectoryOrExisting(path, mode);
  if (r != UV_ENOENT) {
    return r;
  }
  // The parent: `path` without its last component and the separators before it
  size_t end = path.find_last_of(kSeparators);
  if (end == std::string::npos) {
    return r;
  }
  size_t parentEnd = path.find_last_not_of(kSeparators, end);
  // `path` is in a root ("/a", "C:\a") that doesn't exist
  if (parentEnd == std::string::npos || (parentEnd == 1 && path[1] == ':')) {
    return r;
  }
  int p = makeDirectoryTree(path.substr(0, parentEnd + 1), mode);
  if (p != 0) {
    return p;
  }
  return makeDirectoryOrExisting(path, mode);
}

// The names in the directory at `path`, without '.' and '..', in libuv's
// order (sorted, as Node's readdir), or the libuv status.
int namesIn(const std::string& path, std::vector<std::string>* out) {
  FsRequest req;
  int r = uv_fs_scandir(nullptr, &req, path.c_str(), 0, nullptr);
  if (r < 0) {
    return r;
  }
  uv_dirent_t entry;
  while (uv_fs_scandir_next(&req, &entry) != UV_EOF) {
    out->emplace_back(entry.name);
  }
  return 0;
}

// rm -r: depth first, so a directory is emptied before it is removed; symlinks
// (and Windows junctions) are removed, not followed. Returns 0 or the libuv
// status.
int removeTree(const std::string& path) {
  uv_stat_t st;
  int r = statPath(path, true, &st);
  if (r != 0) {
    return r;
  }
  FsRequest req;
  if (!isDirectory(st)) {
    return uv_fs_unlink(nullptr, &req, path.c_str(), nullptr);
  }

  std::vector<std::string> names;
  r = namesIn(path, &names);
  if (r != 0) {
    return r;
  }
  for (const std::string& name : names) {
    r = removeTree(path + "/" + name);
    if (r != 0) {
      return r;
    }
  }
  return uv_fs_rmdir(nullptr, &req, path.c_str(), nullptr);
}

// A time as milliseconds since the epoch, with the nanoseconds as a fraction.
double toMs(const uv_timespec_t& t) {
  return static_cast<double>(t.tv_sec) * 1e3 + static_cast<double>(t.tv_nsec) / 1e6;
}

// libuv's birth time is the creation time on iOS and Windows, and on Android
// where statx() has it; elsewhere libuv (and so Node) reports the change time.
FileStats toFileStats(const uv_stat_t& st) {
  return FileStats(static_cast<double>(st.st_dev),
                   static_cast<double>(st.st_ino),
                   static_cast<double>(st.st_mode),
                   static_cast<double>(st.st_nlink),
                   static_cast<double>(st.st_uid),
                   static_cast<double>(st.st_gid),
                   static_cast<double>(st.st_rdev),
                   static_cast<double>(st.st_size),
                   static_cast<double>(st.st_blksize),
                   static_cast<double>(st.st_blocks),
                   toMs(st.st_atim),
                   toMs(st.st_mtim),
                   toMs(st.st_ctim),
                   toMs(st.st_birthtim));
}

// stat(2), or lstat(2) with `noFollow`, of `path`, or throws its status.
FileStats statOf(const std::string& path, bool noFollow) {
  uv_stat_t st;
  int r = statPath(path, noFollow, &st);
  if (r != 0) {
    throwStatus(r);
  }
  return toFileStats(st);
}

// fstat(2) of `fd`, or throws its status.
FileStats fstatOf(double fd) {
  FsRequest req;
  int r = uv_fs_fstat(nullptr, &req, static_cast<uv_file>(fd), nullptr);
  if (r != 0) {
    throwStatus(r);
  }
  return toFileStats(req.statbuf);
}

// statfs(2) of `path`, or throws its status.
StatFs statfsOf(const std::string& path) {
  FsRequest req;
  int r = uv_fs_statfs(nullptr, &req, path.c_str(), nullptr);
  if (r != 0) {
    throwStatus(r);
  }
  const auto* st = static_cast<const uv_statfs_t*>(req.ptr);
  return StatFs(static_cast<double>(st->f_type),
                static_cast<double>(st->f_bsize),
                static_cast<double>(st->f_blocks),
                static_cast<double>(st->f_bfree),
                static_cast<double>(st->f_bavail),
                static_cast<double>(st->f_files),
                static_cast<double>(st->f_ffree));
}

std::vector<std::string> readDirectory(const std::string& path) {
  std::vector<std::string> names;
  int r = namesIn(path, &names);
  if (r != 0) {
    throwStatus(r);
  }
  return names;
}

// The calls behind open() ... access() and their *Sync twins: each returns
// the result, or the libuv status.

double openPath(const std::string& path, double flags, double mode) {
  return statusOf(openFile(path, static_cast<int>(flags), static_cast<int>(mode)));
}

double closeFd(double fd) {
  return statusOf(closeFile(static_cast<uv_file>(fd)));
}

double truncateFd(double fd, double length) {
  FsRequest req;
  return statusOf(uv_fs_ftruncate(nullptr, &req, static_cast<uv_file>(fd), static_cast<int64_t>(length), nullptr));
}

double makeDirectory(const std::string& path, double mode) {
  return statusOf(makeDirectoryAt(path, static_cast<int>(mode)));
}

double makeDirectories(const std::string& path, double mode) {
  return statusOf(makeDirectoryTree(path, static_cast<int>(mode)));
}

double removeFile(const std::string& path) {
  FsRequest req;
  return statusOf(uv_fs_unlink(nullptr, &req, path.c_str(), nullptr));
}

double removeDirectory(const std::string& path) {
  FsRequest req;
  return statusOf(uv_fs_rmdir(nullptr, &req, path.c_str(), nullptr));
}

double removeRecursive(const std::string& path) {
  return statusOf(removeTree(path));
}

double checkAccess(const std::string& path, double mode) {
  FsRequest req;
  return statusOf(uv_fs_access(nullptr, &req, path.c_str(), static_cast<int>(mode), nullptr));
}

} // namespace

std::shared_ptr<Promise<double>> HybridFs::open(const std::string& path, double flags, double mode) {
  return Promise<double>::async([path, flags, mode]() { return openPath(path, flags, mode); });
}

double HybridFs::openSync(const std::string& path, double flags, double mode) {
  return openPath(path, flags, mode);
}

std::shared_ptr<Promise<double>> HybridFs::close(double fd) {
  return Promise<double>::async([fd]() { return closeFd(fd); });
}

double HybridFs::closeSync(double fd) {
  return closeFd(fd);
}

std::shared_ptr<Promise<double>> HybridFs::ftruncate(double fd, double length) {
  return Promise<double>::async([fd, length]() { return truncateFd(fd, length); });
}

double HybridFs::ftruncateSync(double fd, double length) {
  return truncateFd(fd, length);
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> HybridFs::read(double fd, double length, double position) {
  return Promise<std::shared_ptr<ArrayBuffer>>::async([fd, length, position]() -> std::shared_ptr<ArrayBuffer> {
    if (length <= 0) {
      return ArrayBuffer::allocate(0);
    }
    auto* data = static_cast<uint8_t*>(malloc(static_cast<size_t>(length)));
    if (data == nullptr) {
      throwStatus(UV_ENOMEM);
    }
    int64_t r = readAt(static_cast<uv_file>(fd), data, static_cast<size_t>(length), position);
    if (r <= 0) {
      free(data);
      if (r < 0) {
        throwStatus(r);
      }
      return ArrayBuffer::allocate(0);
    }
    // a short read keeps the larger allocation, only `r` bytes are exposed
    return ArrayBuffer::wrap(data, static_cast<size_t>(r), [data]() { free(data); });
  });
}

double HybridFs::readSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) {
  uint8_t* data = rangeOf(buffer, offset, length);
  if (data == nullptr) {
    return UV_EINVAL;
  }
  return statusOf(readAt(static_cast<uv_file>(fd), data, static_cast<size_t>(length), position));
}

std::shared_ptr<Promise<double>> HybridFs::write(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) {
  if (rangeOf(buffer, offset, length) == nullptr) {
    return Promise<double>::resolved(static_cast<double>(UV_EINVAL));
  }
  auto data = copyRange(buffer, offset, length);
  return Promise<double>::async([fd, data = std::move(data), position]() -> double {
    return statusOf(writeAt(static_cast<uv_file>(fd), data.data(), data.size(), position));
  });
}

double HybridFs::writeSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) {
  uint8_t* data = rangeOf(buffer, offset, length);
  if (data == nullptr) {
    return UV_EINVAL;
  }
  return statusOf(writeAt(static_cast<uv_file>(fd), data, static_cast<size_t>(length), position));
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> HybridFs::readFile(const std::string& path) {
  return Promise<std::shared_ptr<ArrayBuffer>>::async([path]() { return readWholeFile(path); });
}

std::shared_ptr<ArrayBuffer> HybridFs::readFileSync(const std::string& path) {
  return readWholeFile(path);
}

std::shared_ptr<Promise<void>> HybridFs::writeFile(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) {
  auto bytes = copyRange(data, offset, length);
  return Promise<void>::async([path, bytes = std::move(bytes), flags, mode]() {
    int r = writeWholeFile(path, bytes.data(), bytes.size(), static_cast<int>(flags), static_cast<int>(mode));
    if (r < 0) {
      throwStatus(r);
    }
  });
}

double HybridFs::writeFileSync(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) {
  uint8_t* bytes = rangeOf(data, offset, length);
  if (bytes == nullptr) {
    return UV_EINVAL;
  }
  return writeWholeFile(path, bytes, static_cast<size_t>(length), static_cast<int>(flags), static_cast<int>(mode));
}

std::shared_ptr<Promise<double>> HybridFs::mkdir(const std::string& path, double mode) {
  return Promise<double>::async([path, mode]() { return makeDirectory(path, mode); });
}

double HybridFs::mkdirSync(const std::string& path, double mode) {
  return makeDirectory(path, mode);
}

std::shared_ptr<Promise<double>> HybridFs::mkdirRecursive(const std::string& path, double mode) {
  return Promise<double>::async([path, mode]() { return makeDirectories(path, mode); });
}

double HybridFs::mkdirRecursiveSync(const std::string& path, double mode) {
  return makeDirectories(path, mode);
}

std::shared_ptr<Promise<double>> HybridFs::unlink(const std::string& path) {
  return Promise<double>::async([path]() { return removeFile(path); });
}

double HybridFs::unlinkSync(const std::string& path) {
  return removeFile(path);
}

std::shared_ptr<Promise<double>> HybridFs::rmdir(const std::string& path) {
  return Promise<double>::async([path]() { return removeDirectory(path); });
}

double HybridFs::rmdirSync(const std::string& path) {
  return removeDirectory(path);
}

std::shared_ptr<Promise<double>> HybridFs::rmRecursive(const std::string& path) {
  return Promise<double>::async([path]() { return removeRecursive(path); });
}

double HybridFs::rmRecursiveSync(const std::string& path) {
  return removeRecursive(path);
}

std::shared_ptr<Promise<double>> HybridFs::access(const std::string& path, double mode) {
  return Promise<double>::async([path, mode]() { return checkAccess(path, mode); });
}

double HybridFs::accessSync(const std::string& path, double mode) {
  return checkAccess(path, mode);
}

std::shared_ptr<Promise<std::vector<std::string>>> HybridFs::readdir(const std::string& path) {
  return Promise<std::vector<std::string>>::async([path]() { return readDirectory(path); });
}

std::vector<std::string> HybridFs::readdirSync(const std::string& path) {
  return readDirectory(path);
}

std::shared_ptr<Promise<StatFs>> HybridFs::statfs(const std::string& path) {
  return Promise<StatFs>::async([path]() {
    return statfsOf(path);
  });
}

StatFs HybridFs::statfsSync(const std::string& path) {
  return statfsOf(path);
}

std::shared_ptr<Promise<FileStats>> HybridFs::stat(const std::string& path) {
  return Promise<FileStats>::async([path]() {
    return statOf(path, false);
  });
}

FileStats HybridFs::statSync(const std::string& path) {
  return statOf(path, false);
}

std::shared_ptr<Promise<FileStats>> HybridFs::lstat(const std::string& path) {
  return Promise<FileStats>::async([path]() {
    return statOf(path, true);
  });
}

FileStats HybridFs::lstatSync(const std::string& path) {
  return statOf(path, true);
}

std::shared_ptr<Promise<FileStats>> HybridFs::fstat(double fd) {
  return Promise<FileStats>::async([fd]() {
    return fstatOf(fd);
  });
}

FileStats HybridFs::fstatSync(double fd) {
  return fstatOf(fd);
}

} // namespace margelo::nitro::node
