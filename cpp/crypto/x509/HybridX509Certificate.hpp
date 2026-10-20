#pragma once

#include "HybridNitroNodeCryptoX509CertificateHandleSpec.hpp"
#include <ncrypto.h>
#include <string>

namespace margelo::nitro::node {

class HybridX509Certificate : public HybridNitroNodeCryptoX509CertificateHandleSpec {
 public:
  HybridX509Certificate() : HybridObject(TAG) {}

  void init(const std::shared_ptr<ArrayBuffer>& buffer) override;

  std::string subject() override;
  std::string subjectAltName() override;
  std::string issuer() override;
  std::string infoAccess() override;
  std::string validFrom() override;
  std::string validTo() override;
  double validFromDate() override;
  double validToDate() override;
  std::string signatureAlgorithm() override;
  std::string signatureAlgorithmOid() override;
  std::string serialNumber() override;

  std::string fingerprint() override;
  std::string fingerprint256() override;
  std::string fingerprint512() override;

  std::shared_ptr<ArrayBuffer> raw() override;
  std::string pem() override;

  std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec> publicKey() override;
  std::vector<std::string> keyUsage() override;

  bool ca() override;
  bool checkIssued(const std::shared_ptr<HybridNitroNodeCryptoX509CertificateHandleSpec>& other) override;
  bool checkPrivateKey(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& key) override;
  bool verify(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& key) override;

  std::optional<std::string> checkHost(const std::string& name, double flags) override;
  std::optional<std::string> checkEmail(const std::string& email, double flags) override;
  std::optional<std::string> checkIP(const std::string& ip) override;

 private:
  ncrypto::X509Pointer cert_;
  std::string bioToString(ncrypto::BIOPointer bio) const;
};

} // namespace margelo::nitro::node
