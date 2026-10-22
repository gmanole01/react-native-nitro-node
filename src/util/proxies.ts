/**
 * Proxies, for util.types.isProxy() and inspect()'s showProxy. JavaScript can't
 * tell a proxy from its target, and Hermes has no API for it, so the proxies
 * are recorded as they are made: installProxyTracking() (run by
 * react-native-nitro-node/polyfill) wraps the global Proxy and
 * Proxy.revocable. Proxies made before it ran, or without it, aren't known.
 */

interface ProxyDetails {
  target: object;
  handler: ProxyHandler<object>;
}

// Weak: tracking a proxy doesn't keep it alive
const proxies = new WeakMap<object, ProxyDetails>();

let installed = false;

/** The target and handler of a proxy made since the tracking was installed. */
export function proxyDetails(value: unknown): ProxyDetails | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  return proxies.get(value);
}

/** Whether installProxyTracking() ran: without it, isProxy() is always false. */
export function isProxyTrackingInstalled(): boolean {
  return installed;
}

/** Replaces the global Proxy with one that records each proxy it makes. Runs once. */
export function installProxyTracking(): void {
  if (installed || typeof Proxy !== 'function') {
    return;
  }
  installed = true;
  const NativeProxy = Proxy;
  const nativeRevocable = Proxy.revocable;

  const revocable = function revocable(target: object, handler: ProxyHandler<object>) {
    const result = nativeRevocable(target, handler);
    proxies.set(result.proxy, { target, handler });
    return result;
  };

  // A proxy of Proxy: `new Proxy(...)` is recorded, the rest (calling it
  // without new, its name and length, revocable's own properties) stays the
  // engine's
  const TrackedProxy = new NativeProxy(NativeProxy, {
    construct(target, args) {
      // Proxy doesn't use new.target: a proxy has no prototype of its own
      const proxy = Reflect.construct(target, args);
      proxies.set(proxy, { target: args[0], handler: args[1] });
      return proxy;
    },
    get(target, key, receiver) {
      if (key === 'revocable') {
        return revocable;
      }
      return Reflect.get(target, key, receiver);
    },
  });

  (globalThis as { Proxy: ProxyConstructor }).Proxy = TrackedProxy;
}
