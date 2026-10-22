#include "HybridUrl.hpp"

#include <ada.h>

#include <array>
#include <cstdint>
#include <string_view>
#include <vector>

namespace margelo::nitro::node {

namespace {

// Node's url_update_action (src/node_url.h)
enum UrlUpdateAction {
  kProtocol = 0,
  kHost = 1,
  kHostname = 2,
  kPort = 3,
  kUsername = 4,
  kPassword = 5,
  kPathname = 6,
  kSearch = 7,
  kHash = 8,
  kHref = 9,
};

// Node's UpdateComponents(): the parts' offsets, then the scheme type
UrlParsed parsed(const ada::url_aggregator& url) {
  const ada::url_components& c = url.get_components();
  std::vector<double> components = {
      static_cast<double>(c.protocol_end), static_cast<double>(c.username_end), static_cast<double>(c.host_start),
      static_cast<double>(c.host_end),     static_cast<double>(c.port),         static_cast<double>(c.pathname_start),
      static_cast<double>(c.search_start), static_cast<double>(c.hash_start),   static_cast<double>(url.type),
  };
  return UrlParsed(std::string(url.get_href()), std::move(components));
}

constexpr char LARGEST_ASCII_CHAR_CODE_TO_ENCODE = '~';

// RFC1738 defines the following chars as "unsafe" for URLs
// @see https://www.ietf.org/rfc/rfc1738.txt 2.2. URL Character Encoding Issues
constexpr auto lookup_table = []() {
  // Each entry is an array that can hold up to 3 chars + null terminator
  std::array<std::array<char, 4>, LARGEST_ASCII_CHAR_CODE_TO_ENCODE + 1> result{};
  for (uint8_t i = 0; i <= LARGEST_ASCII_CHAR_CODE_TO_ENCODE; i++) {
    switch (i) {
#define ENCODE_CHAR(CHAR, HEX_DIGIT_2, HEX_DIGIT_1)   \
  case CHAR:                                          \
    result[i] = {{'%', HEX_DIGIT_2, HEX_DIGIT_1, 0}}; \
    break;
      ENCODE_CHAR('\0', '0', '0') // '\0' == 0x00
      ENCODE_CHAR('\t', '0', '9') // '\t' == 0x09
      ENCODE_CHAR('\n', '0', 'A') // '\n' == 0x0A
      ENCODE_CHAR('\r', '0', 'D') // '\r' == 0x0D
      ENCODE_CHAR(' ', '2', '0')  // ' ' == 0x20
      ENCODE_CHAR('"', '2', '2')  // '"' == 0x22
      ENCODE_CHAR('#', '2', '3')  // '#' == 0x23
      ENCODE_CHAR('%', '2', '5')  // '%' == 0x25
      ENCODE_CHAR('?', '3', 'F')  // '?' == 0x3F
      ENCODE_CHAR('[', '5', 'B')  // '[' == 0x5B
      ENCODE_CHAR('\\', '5', 'C') // '\\' == 0x5C
      ENCODE_CHAR(']', '5', 'D')  // ']' == 0x5D
      ENCODE_CHAR('^', '5', 'E')  // '^' == 0x5E
      ENCODE_CHAR('|', '7', 'C')  // '|' == 0x7C
      ENCODE_CHAR('~', '7', 'E')  // '~' == 0x7E
#undef ENCODE_CHAR

      default:
        result[i] = {{static_cast<char>(i), '\0', '\0', '\0'}};
        break;
    }
  }
  return result;
}();

enum class OS { WINDOWS, POSIX };

std::string EncodePathChars(std::string_view input_str, OS operating_system) {
  std::string encoded = "file://";
  encoded.reserve(input_str.size() + 7); // Reserve space for "file://" and input_str
  for (size_t i : input_str) {
    if (i > static_cast<size_t>(LARGEST_ASCII_CHAR_CODE_TO_ENCODE)) [[unlikely]] {
      encoded.push_back(static_cast<char>(i));
      continue;
    }
    if (operating_system == OS::WINDOWS) {
      if (i == '\\') {
        encoded.push_back('/');
        continue;
      }
    }
    encoded.append(lookup_table[i].data());
  }
  return encoded;
}

} // namespace

std::optional<UrlParsed> HybridUrl::parse(const std::string& input, const std::optional<std::string>& base) {
  ada::result<ada::url_aggregator> baseUrl;
  ada::url_aggregator* basePointer = nullptr;
  if (base.has_value()) {
    baseUrl = ada::parse<ada::url_aggregator>(*base);
    if (!baseUrl) {
      return std::nullopt;
    }
    basePointer = &baseUrl.value();
  }
  auto out = ada::parse<ada::url_aggregator>(input, basePointer);
  if (!out) {
    return std::nullopt;
  }
  return parsed(*out);
}

bool HybridUrl::canParse(const std::string& input, const std::optional<std::string>& base) {
  if (base.has_value()) {
    std::string_view baseView = *base;
    return ada::can_parse(input, &baseView);
  }
  return ada::can_parse(input);
}

std::optional<UrlParsed> HybridUrl::update(const std::string& href, double action, const std::string& value) {
  auto out = ada::parse<ada::url_aggregator>(href);
  if (!out) {
    return std::nullopt;
  }
  bool result = true;
  switch (static_cast<UrlUpdateAction>(static_cast<int>(action))) {
    case kPathname:
      result = out->set_pathname(value);
      break;
    case kHash:
      out->set_hash(value);
      break;
    case kHost:
      result = out->set_host(value);
      break;
    case kHostname:
      result = out->set_hostname(value);
      break;
    case kHref:
      result = out->set_href(value);
      break;
    case kPassword:
      result = out->set_password(value);
      break;
    case kPort:
      result = out->set_port(value);
      break;
    case kProtocol:
      result = out->set_protocol(value);
      break;
    case kSearch:
      out->set_search(value);
      break;
    case kUsername:
      result = out->set_username(value);
      break;
    default:
      return std::nullopt;
  }
  if (!result) {
    return std::nullopt;
  }
  return parsed(*out);
}

std::string HybridUrl::format(const std::string& href, bool hash, bool unicode, bool search, bool auth) {
  // ada::url provides a faster alternative to ada::url_aggregator if we
  // directly want to manipulate the url components without using the
  // respective setters. therefore we are using ada::url here.
  auto out = ada::parse<ada::url>(href);
  if (!out) {
    return href;
  }
  if (!hash) {
    out->hash = std::nullopt;
  }
  if (unicode && out->has_hostname()) {
    out->host = ada::idna::to_unicode(out->get_hostname());
  }
  if (!search) {
    out->query = std::nullopt;
  }
  if (!auth) {
    out->username = "";
    out->password = "";
  }
  return out->get_href();
}

std::optional<std::string> HybridUrl::getOrigin(const std::string& input) {
  auto out = ada::parse<ada::url_aggregator>(input);
  if (!out) {
    return std::nullopt;
  }
  return out->get_origin();
}

std::string HybridUrl::domainToASCII(const std::string& input) {
  if (input.empty()) {
    return "";
  }
  // It is important to have an initial value that contains a special scheme.
  // Since it will change the implementation of `set_hostname` according to URL
  // spec.
  auto out = ada::parse<ada::url>("ws://x");
  if (!out || !out->set_hostname(input)) {
    return "";
  }
  return out->get_hostname();
}

std::string HybridUrl::domainToUnicode(const std::string& input) {
  if (input.empty()) {
    return "";
  }
  // It is important to have an initial value that contains a special scheme.
  // Since it will change the implementation of `set_hostname` according to URL
  // spec.
  auto out = ada::parse<ada::url>("ws://x");
  if (!out || !out->set_hostname(input)) {
    return "";
  }
  return ada::idna::to_unicode(out->get_hostname());
}

std::optional<UrlParsed> HybridUrl::pathToFileURL(const std::string& path, bool windows,
                                                  const std::optional<std::string>& hostname) {
  OS os = windows ? OS::WINDOWS : OS::POSIX;
  auto out = ada::parse<ada::url_aggregator>(EncodePathChars(path, os), nullptr);
  if (!out) {
    return std::nullopt;
  }
  if (os == OS::WINDOWS && hostname.has_value()) [[unlikely]] {
    if (!out->set_hostname(*hostname)) {
      return std::nullopt;
    }
  }
  return parsed(*out);
}

std::string HybridUrl::toASCII(const std::string& input) {
  return ada::idna::to_ascii(input);
}

std::string HybridUrl::toUnicode(const std::string& input) {
  return ada::idna::to_unicode(input);
}

} // namespace margelo::nitro::node
