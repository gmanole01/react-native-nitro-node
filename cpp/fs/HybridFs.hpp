#pragma once

#include <string>
#include <vector>

#include "HybridNitroNodeFsSpec.hpp"

namespace margelo::nitro::node {

// Plain POSIX calls, each in two forms: the *Sync one runs on the calling (JS)
// thread, the other on Nitro's thread pool.
class HybridFs : public HybridNitroNodeFsSpec {
public:
  HybridFs() : HybridObject(TAG), HybridNitroNodeFsSpec() {}

  std::shared_ptr<Promise<double>> open(const std::string& path, double flags, double mode) override;
  double openSync(const std::string& path, double flags, double mode) override;
  std::shared_ptr<Promise<double>> close(double fd) override;
  double closeSync(double fd) override;
  std::shared_ptr<Promise<double>> ftruncate(double fd, double length) override;
  double ftruncateSync(double fd, double length) override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> read(double fd, double length, double position) override;
  double readSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;
  std::shared_ptr<Promise<double>> write(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;
  double writeSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> readFile(const std::string& path) override;
  std::shared_ptr<ArrayBuffer> readFileSync(const std::string& path) override;
  std::shared_ptr<Promise<void>> writeFile(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) override;
  double writeFileSync(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) override;

  std::shared_ptr<Promise<double>> mkdir(const std::string& path, double mode) override;
  double mkdirSync(const std::string& path, double mode) override;
  std::shared_ptr<Promise<double>> mkdirRecursive(const std::string& path, double mode) override;
  double mkdirRecursiveSync(const std::string& path, double mode) override;
  std::shared_ptr<Promise<double>> unlink(const std::string& path) override;
  double unlinkSync(const std::string& path) override;
  std::shared_ptr<Promise<double>> rmdir(const std::string& path) override;
  double rmdirSync(const std::string& path) override;
  std::shared_ptr<Promise<double>> rmRecursive(const std::string& path) override;
  double rmRecursiveSync(const std::string& path) override;
  std::shared_ptr<Promise<double>> access(const std::string& path, double mode) override;
  double accessSync(const std::string& path, double mode) override;
  std::shared_ptr<Promise<std::vector<std::string>>> readdir(const std::string& path) override;
  std::vector<std::string> readdirSync(const std::string& path) override;
  std::shared_ptr<Promise<StatFs>> statfs(const std::string& path) override;
  StatFs statfsSync(const std::string& path) override;
  std::shared_ptr<Promise<FileStats>> stat(const std::string& path) override;
  FileStats statSync(const std::string& path) override;
  std::shared_ptr<Promise<FileStats>> lstat(const std::string& path) override;
  FileStats lstatSync(const std::string& path) override;
  std::shared_ptr<Promise<FileStats>> fstat(double fd) override;
  FileStats fstatSync(double fd) override;
};

} // namespace margelo::nitro::node
