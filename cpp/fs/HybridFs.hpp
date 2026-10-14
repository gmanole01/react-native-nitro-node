#pragma once

#include <string>
#include <vector>

#include "HybridNitroNodeFsSpec.hpp"

namespace margelo::nitro::node {

// Plain POSIX calls. The *Sync and metadata calls run on the calling (JS)
// thread; read, write, readFile and writeFile run on Nitro's thread pool.
class HybridFs : public HybridNitroNodeFsSpec {
public:
  HybridFs() : HybridObject(TAG), HybridNitroNodeFsSpec() {}

  double open(const std::string& path, double flags, double mode) override;
  double close(double fd) override;
  double ftruncate(double fd, double length) override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> read(double fd, double length, double position) override;
  double readSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;
  std::shared_ptr<Promise<double>> write(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;
  double writeSync(double fd, const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length, double position) override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> readFile(const std::string& path) override;
  std::shared_ptr<ArrayBuffer> readFileSync(const std::string& path) override;
  std::shared_ptr<Promise<void>> writeFile(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) override;
  double writeFileSync(const std::string& path, const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double flags, double mode) override;

  double mkdir(const std::string& path, double mode) override;
  double mkdirRecursive(const std::string& path, double mode) override;
  double unlink(const std::string& path) override;
  double rmdir(const std::string& path) override;
  double rmRecursive(const std::string& path) override;
  double access(const std::string& path, double mode) override;
  std::vector<std::string> readdir(const std::string& path) override;
  StatFs statfs(const std::string& path) override;
};

} // namespace margelo::nitro::node
