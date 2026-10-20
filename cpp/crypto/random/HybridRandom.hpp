#include <cmath>
#include <future>
#include <iostream>
#include <memory>

#include "HybridNitroNodeCryptoRandomSpec.hpp"

namespace margelo::nitro::node {

using namespace facebook;

class HybridRandom : public HybridNitroNodeCryptoRandomSpec {
 public:
  HybridRandom() : HybridObject(TAG) {}

 public:
  // Methods
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> randomFill(const std::shared_ptr<ArrayBuffer>& buffer, double dOffset,
                                                                    double dSize) override;

  std::shared_ptr<ArrayBuffer> randomFillSync(const std::shared_ptr<ArrayBuffer>& buffer, double dOffset, double dSize) override;
};

inline void printData(std::string name, uint8_t* data, size_t size) {
  std::cout << "data - " << name << std::endl;
  for (size_t i = 0; i < size; i++) {
    printf("%u ", data[i]);
  }
  printf("\n");
}

} // namespace margelo::nitro::node
