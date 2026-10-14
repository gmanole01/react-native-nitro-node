#include "HybridDns.hpp"

#include <cstring>
#include <exception>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <ares.h>

namespace margelo::nitro::node {

using std::string;
using std::vector;
using std::shared_ptr;
using std::runtime_error;

using ResolvePromise = Promise<vector<string>>;

// What a pending query carries through c-ares, which only passes a void* on to
// the callback. Keeps the promise alive until the query is answered.
struct DnsRequest {
  shared_ptr<ResolvePromise> promise;
};

// The name Node uses for a c-ares status, exposed to JS as `err.code`.
static const char* dnsErrorCode(int status) {
  switch (status) {
    case ARES_ENODATA: return "ENODATA";
    case ARES_EFORMERR: return "EFORMERR";
    case ARES_ESERVFAIL: return "ESERVFAIL";
    case ARES_ENOTFOUND: return "ENOTFOUND";
    case ARES_ENOTIMP: return "ENOTIMP";
    case ARES_EREFUSED: return "EREFUSED";
    case ARES_EBADQUERY: return "EBADQUERY";
    case ARES_EBADNAME: return "EBADNAME";
    case ARES_EBADFAMILY: return "EBADFAMILY";
    case ARES_EBADRESP: return "EBADRESP";
    case ARES_ECONNREFUSED: return "ECONNREFUSED";
    case ARES_ETIMEOUT: return "ETIMEOUT";
    case ARES_EOF: return "EOF";
    case ARES_EFILE: return "EFILE";
    case ARES_ENOMEM: return "ENOMEM";
    case ARES_EDESTRUCTION: return "EDESTRUCTION";
    case ARES_EBADSTR: return "EBADSTR";
    case ARES_EBADFLAGS: return "EBADFLAGS";
    case ARES_ENONAME: return "ENONAME";
    case ARES_EBADHINTS: return "EBADHINTS";
    case ARES_ENOTINITIALIZED: return "ENOTINITIALIZED";
    case ARES_ECANCELLED: return "ECANCELLED";
    case ARES_ESERVICE: return "ESERVICE";
    case ARES_ENOSERVER: return "ENOSERVER";
    default: return "EUNKNOWN";
  }
}

// "<code> <description>", e.g. "ENOTFOUND Domain name not found". The JS side
// reads the code back from the start of the message.
static std::exception_ptr dnsError(int status) {
  return std::make_exception_ptr(runtime_error(string(dnsErrorCode(status)) + " " + ares_strerror(status)));
}

static ares_channel_t* createChannel() {
  if (!ares_threadsafety()) {
    throw runtime_error("ENOTINITIALIZED c-ares was built without thread safety");
  }

  ares_channel_t* channel = nullptr;
  struct ares_options options;
  int optmask = 0;

  // Enable event thread so we don't have to monitor file descriptors
  memset(&options, 0, sizeof(options));
  optmask |= ARES_OPT_EVENT_THREAD;
  options.evsys = ARES_EVSYS_DEFAULT;

  int status = ares_init_options(&channel, &options, optmask);
  if (status != ARES_SUCCESS) {
    std::rethrow_exception(dnsError(status));
  }

  return channel;
}

// One channel serves every query, from any thread. Like the UV loop it is
// never destroyed: its event thread runs for the whole process.
//
// If creating it throws, the next call tries again.
static ares_channel_t* sharedChannel() {
  static ares_channel_t* channel = createChannel();
  return channel;
}

/* Callback that is called when a DNS query is finished */
static void onAddrInfo(void* arg, int status, int /* timeouts */, struct ares_addrinfo* result) {
  // Runs on the c-ares event thread, or inside ares_getaddrinfo() when the
  // answer is already known (cached, or the query is invalid).
  std::unique_ptr<DnsRequest> request(static_cast<DnsRequest*>(arg));
  const shared_ptr<ResolvePromise>& promise = request->promise;

  vector<string> addresses;

  if (status == ARES_SUCCESS && result != nullptr) {
    for (struct ares_addrinfo_node* node = result->nodes; node != nullptr; node = node->ai_next) {
      char text[64] = "";
      const void* address = nullptr;

      if (node->ai_family == AF_INET) {
        address = &((const struct sockaddr_in*) ((void*) node->ai_addr))->sin_addr;
      } else if (node->ai_family == AF_INET6) {
        address = &((const struct sockaddr_in6*) ((void*) node->ai_addr))->sin6_addr;
      } else {
        continue;
      }

      if (ares_inet_ntop(node->ai_family, address, text, sizeof(text)) != nullptr) {
        addresses.emplace_back(text);
      }
    }
  }

  if (result != nullptr) {
    ares_freeaddrinfo(result);
  }

  if (status != ARES_SUCCESS) {
    promise->reject(dnsError(status));
  } else if (addresses.empty()) {
    promise->reject(dnsError(ARES_ENODATA));
  } else {
    promise->resolve(std::move(addresses));
  }
}

static shared_ptr<ResolvePromise> resolveFamily(const string& hostname, int family) {
  ares_channel_t* channel = nullptr;
  try {
    channel = sharedChannel();
  } catch (...) {
    return ResolvePromise::rejected(std::current_exception());
  }

#if defined(__ANDROID__)
  // c-ares cannot watch for DNS configuration changes on Android, so a
  // long-lived channel would keep the servers of the network it was created
  // on. This reloads them in the background; a query already sent to a server
  // that is dropped by the reload is moved to the new ones.
  ares_reinit(channel);
#endif

  struct ares_addrinfo_hints hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = family;
  hints.ai_flags = ARES_AI_CANONNAME;

  auto promise = ResolvePromise::create();
  // Freed by onAddrInfo, which c-ares calls exactly once per query.
  auto* request = new DnsRequest{promise};
  ares_getaddrinfo(channel, hostname.c_str(), nullptr, &hints, onAddrInfo, request);

  return promise;
}

shared_ptr<ResolvePromise> HybridDns::resolve(const string& hostname) {
  return resolveFamily(hostname, AF_UNSPEC);
}

shared_ptr<ResolvePromise> HybridDns::resolve4(const string& hostname) {
  return resolveFamily(hostname, AF_INET);
}

shared_ptr<ResolvePromise> HybridDns::resolve6(const string& hostname) {
  return resolveFamily(hostname, AF_INET6);
}

} // namespace margelo::nitro::node
