// 64-bit file offsets on 32-bit Android (armeabi-v7a, x86), where off_t is
// otherwise 32 bits and positions past 2 GiB are cut off. iOS and 64-bit
// Android always have a 64-bit off_t. Must come before any system header.
#define _FILE_OFFSET_BITS 64

#include "HybridFs.hpp"

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

#include <dirent.h>
#include <fcntl.h>
#include <ftw.h>
#include <sys/stat.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <sys/mount.h>
#else
#include <sys/vfs.h>
#endif

static_assert(sizeof(off_t) == 8, "file offsets must be 64-bit");

namespace margelo::nitro::node {

namespace {

// The largest file readFile() loads, as in Node: 2 GiB - 1. Bigger files fail
// with EFBIG, which JS reports as Node's ERR_FS_FILE_TOO_LARGE.
constexpr size_t kMaxReadFileSize = 0x7fffffff;

// The value a numeric call returns: `result`, or the negated errno when the
// call failed. On iOS and Android that is also the libuv status of the error.
double statusOf(long result) {
  return result < 0 ? static_cast<double>(-errno) : static_cast<double>(result);
}

// Thrown by the calls that cannot return a status, with `status` being the
// negated errno. JS finds the status in the message, see src/fs/fs.ts.
[[noreturn]] void throwErrno(int status) {
  throw std::runtime_error("[errno " + std::to_string(status) + "]");
}

// Raw bytes [offset, offset + length) of `buffer`, or nullptr when that range
// is outside of it.
uint8_t* rangeOf(const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length) {
  if (offset < 0 || length < 0 || offset + length > static_cast<double>(buffer->size())) {
    return nullptr;
  }
  return buffer->data() + static_cast<size_t>(offset);
}

// A copy of [offset, offset + length) of `buffer`. JS-owned buffers can only
// be touched on the JS thread, so async calls work on a copy.
std::vector<uint8_t> copyRange(const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length) {
  uint8_t* data = rangeOf(buffer, offset, length);
  if (data == nullptr) {
    throwErrno(-EINVAL);
  }
  return std::vector<uint8_t>(data, data + static_cast<size_t>(length));
}

// pread(), or read() at the current offset when `position` is negative.
ssize_t readAt(int fd, uint8_t* data, size_t length, double position) {
  ssize_t r;
  do {
    r = position < 0 ? ::read(fd, data, length) : ::pread(fd, data, length, static_cast<off_t>(position));
  } while (r < 0 && errno == EINTR);
  return r;
}

// pwrite(), or write() at the current offset when `position` is negative.
ssize_t writeAt(int fd, const uint8_t* data, size_t length, double position) {
  ssize_t r;
  do {
    r = position < 0 ? ::write(fd, data, length) : ::pwrite(fd, data, length, static_cast<off_t>(position));
  } while (r < 0 && errno == EINTR);
  return r;
}

// The whole content of the file at `path`. Reads until end of file rather than
// trusting the size from stat, which is 0 for some special files.
std::shared_ptr<ArrayBuffer> readWholeFile(const std::string& path) {
  int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    throwErrno(-errno);
  }

  struct stat st {};
  if (::fstat(fd, &st) == 0 && static_cast<uint64_t>(st.st_size) > kMaxReadFileSize) {
    ::close(fd);
    throwErrno(-EFBIG);
  }
  size_t capacity = st.st_size > 0 ? static_cast<size_t>(st.st_size) + 1 : 64 * 1024;
  size_t size = 0;
  auto* data = static_cast<uint8_t*>(malloc(capacity));

  while (data != nullptr) {
    if (size == capacity) {
      // special files report no size, so the limit is checked as they are read
      if (capacity > kMaxReadFileSize) {
        free(data);
        ::close(fd);
        throwErrno(-EFBIG);
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
    ssize_t r = readAt(fd, data + size, capacity - size, -1);
    if (r < 0) {
      int err = errno;
      free(data);
      ::close(fd);
      throwErrno(-err);
    }
    if (r == 0) {
      break;
    }
    size += static_cast<size_t>(r);
  }
  ::close(fd);

  if (data == nullptr) {
    throwErrno(-ENOMEM);
  }
  if (size == 0) {
    free(data);
    return ArrayBuffer::allocate(0);
  }
  return ArrayBuffer::wrap(data, size, [data]() { free(data); });
}

// Opens `path` with `flags` and `mode` and writes all of `data` to it.
// Returns 0, or the negated errno.
int writeWholeFile(const std::string& path, const uint8_t* data, size_t size, int flags, mode_t mode) {
  int fd = ::open(path.c_str(), flags | O_CLOEXEC, mode);
  if (fd < 0) {
    return -errno;
  }
  size_t written = 0;
  while (written < size) {
    ssize_t r = writeAt(fd, data + written, size - written, -1);
    if (r < 0) {
      int err = errno;
      ::close(fd);
      return -err;
    }
    written += static_cast<size_t>(r);
  }
  if (::close(fd) < 0) {
    return -errno;
  }
  return 0;
}

// mkdir() that succeeds when `path` already is a directory.
int mkdirExisting(const char* path, mode_t mode) {
  if (::mkdir(path, mode) == 0) {
    return 0;
  }
  if (errno != EEXIST) {
    return -1;
  }
  struct stat st {};
  if (::stat(path, &st) != 0) {
    return -1;
  }
  if (!S_ISDIR(st.st_mode)) {
    errno = ENOTDIR;
    return -1;
  }
  return 0;
}

int removeEntry(const char* path, const struct stat* /* sb */, int /* typeflag */, struct FTW* /* ftwbuf */) {
  return ::remove(path);
}

// A time as milliseconds since the epoch, with the nanoseconds as a fraction.
double toMs(const struct timespec& t) {
  return static_cast<double>(t.tv_sec) * 1e3 + static_cast<double>(t.tv_nsec) / 1e6;
}

FileStats toFileStats(const struct stat& st) {
#if defined(__APPLE__)
  const struct timespec& atime = st.st_atimespec;
  const struct timespec& mtime = st.st_mtimespec;
  const struct timespec& ctime = st.st_ctimespec;
  const struct timespec& birthtime = st.st_birthtimespec;
#else
  const struct timespec& atime = st.st_atim;
  const struct timespec& mtime = st.st_mtim;
  const struct timespec& ctime = st.st_ctim;
  // Linux's stat() has no creation time; libuv (and so Node, without statx)
  // reports the change time instead.
  const struct timespec& birthtime = st.st_ctim;
#endif
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
                   toMs(atime),
                   toMs(mtime),
                   toMs(ctime),
                   toMs(birthtime));
}

// The names in the directory at `path`, without '.' and '..', or throws the
// errno.
std::vector<std::string> namesIn(const std::string& path) {
  DIR* dir = ::opendir(path.c_str());
  if (dir == nullptr) {
    throwErrno(-errno);
  }

  std::vector<std::string> names;
  errno = 0;
  while (struct dirent* entry = ::readdir(dir)) {
    if (strcmp(entry->d_name, ".") != 0 && strcmp(entry->d_name, "..") != 0) {
      names.emplace_back(entry->d_name);
    }
  }
  // readdir() returns null both at the end and on an error
  int err = errno;
  ::closedir(dir);
  if (err != 0) {
    throwErrno(-err);
  }
  return names;
}

// statfs(2) of `path`, or throws its errno.
StatFs statfsOf(const std::string& path) {
  struct statfs st {};
  if (::statfs(path.c_str(), &st) != 0) {
    throwErrno(-errno);
  }
  return StatFs(static_cast<double>(st.f_type),
                static_cast<double>(st.f_bsize),
                static_cast<double>(st.f_blocks),
                static_cast<double>(st.f_bfree),
                static_cast<double>(st.f_bavail),
                static_cast<double>(st.f_files),
                static_cast<double>(st.f_ffree));
}

// stat(2), or lstat(2) with `noFollow`, of `path`, or throws its errno.
FileStats statOf(const std::string& path, bool noFollow) {
  struct stat st {};
  int r = noFollow ? ::lstat(path.c_str(), &st) : ::stat(path.c_str(), &st);
  if (r != 0) {
    throwErrno(-errno);
  }
  return toFileStats(st);
}

// fstat(2) of `fd`, or throws its errno.
FileStats fstatOf(double fd) {
  struct stat st {};
  if (::fstat(static_cast<int>(fd), &st) != 0) {
    throwErrno(-errno);
  }
  return toFileStats(st);
}

// The calls behind open() ... access() and their *Sync twins: each returns
// the result, or the negated errno.

double openPath(const std::string& path, double flags, double mode) {
  return statusOf(::open(path.c_str(), static_cast<int>(flags) | O_CLOEXEC, static_cast<mode_t>(mode)));
}

double closeFd(double fd) {
  return statusOf(::close(static_cast<int>(fd)));
}

double truncateFd(double fd, double length) {
  return statusOf(::ftruncate(static_cast<int>(fd), static_cast<off_t>(length)));
}

double makeDirectory(const std::string& path, double mode) {
  return statusOf(::mkdir(path.c_str(), static_cast<mode_t>(mode)));
}

// mkdir -p.
double makeDirectories(const std::string& path, double mode) {
  std::string partial = path;
  // create every parent, then the directory itself
  for (size_t i = 1; i < partial.size(); i++) {
    if (partial[i] != '/') {
      continue;
    }
    partial[i] = '\0';
    if (mkdirExisting(partial.c_str(), static_cast<mode_t>(mode)) != 0) {
      return -errno;
    }
    partial[i] = '/';
  }
  return statusOf(mkdirExisting(path.c_str(), static_cast<mode_t>(mode)));
}

double removeFile(const std::string& path) {
  return statusOf(::unlink(path.c_str()));
}

double removeDirectory(const std::string& path) {
  return statusOf(::rmdir(path.c_str()));
}

// rm -r.
double removeTree(const std::string& path) {
  // depth first, so a directory is emptied before it is removed; symlinks are
  // removed, not followed
  return statusOf(::nftw(path.c_str(), removeEntry, 64, FTW_DEPTH | FTW_PHYS));
}

double checkAccess(const std::string& path, double mode) {
  return statusOf(::access(path.c_str(), static_cast<int>(mode)));
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
      throwErrno(-ENOMEM);
    }
    ssize_t r = readAt(static_cast<int>(fd), data, static_cast<size_t>(length), position);
    if (r <= 0) {
      int err = errno;
      free(data);
      if (r < 0) {
        throwErrno(-err);
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
    return -EINVAL;
  }
  return statusOf(readAt(static_cast<int>(fd), data, static_cast<size_t>(length), position));
}

std::shared_ptr<Promise<double>> HybridFs::write(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) {
  if (rangeOf(buffer, offset, length) == nullptr) {
    return Promise<double>::resolved(static_cast<double>(-EINVAL));
  }
  auto data = copyRange(buffer, offset, length);
  return Promise<double>::async([fd, data = std::move(data), position]() -> double {
    return statusOf(writeAt(static_cast<int>(fd), data.data(), data.size(), position));
  });
}

double HybridFs::writeSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) {
  uint8_t* data = rangeOf(buffer, offset, length);
  if (data == nullptr) {
    return -EINVAL;
  }
  return statusOf(writeAt(static_cast<int>(fd), data, static_cast<size_t>(length), position));
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
    int r = writeWholeFile(path, bytes.data(), bytes.size(), static_cast<int>(flags), static_cast<mode_t>(mode));
    if (r < 0) {
      throwErrno(r);
    }
  });
}

double HybridFs::writeFileSync(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) {
  uint8_t* bytes = rangeOf(data, offset, length);
  if (bytes == nullptr) {
    return -EINVAL;
  }
  return writeWholeFile(path, bytes, static_cast<size_t>(length), static_cast<int>(flags), static_cast<mode_t>(mode));
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
  return Promise<double>::async([path]() { return removeTree(path); });
}

double HybridFs::rmRecursiveSync(const std::string& path) {
  return removeTree(path);
}

std::shared_ptr<Promise<double>> HybridFs::access(const std::string& path, double mode) {
  return Promise<double>::async([path, mode]() { return checkAccess(path, mode); });
}

double HybridFs::accessSync(const std::string& path, double mode) {
  return checkAccess(path, mode);
}

std::shared_ptr<Promise<std::vector<std::string>>> HybridFs::readdir(const std::string& path) {
  return Promise<std::vector<std::string>>::async([path]() { return namesIn(path); });
}

std::vector<std::string> HybridFs::readdirSync(const std::string& path) {
  return namesIn(path);
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
