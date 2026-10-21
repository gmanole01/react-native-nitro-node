export * from 'url';

function StringPrototypeSlice(
  str: string,
  start?: number,
  end?: number,
): string {
  return str.slice(start, end);
}

/**
 * Utility function that converts a URL object into an ordinary options object
 * as expected by the `http.request` and `https.request` APIs.
 * @param {URL} url
 * @returns {Record<string, unknown>}
 */
export function urlToHttpOptions(url: any) {
  // validateObject(url, 'url', kValidateObjectAllowObjects);
  const { hostname, pathname, port, username, password, search } = url as any;
  const options = {
    __proto__: null,
    ...url, // In case the url object was extended by the user.
    protocol: url.protocol,
    hostname:
      hostname && hostname[0] === '['
        ? StringPrototypeSlice(hostname, 1, -1)
        : hostname,
    hash: url.hash,
    search: search,
    pathname: pathname,
    path: `${pathname || ''}${search || ''}`,
    href: url.href,
  };
  if (port !== '') {
    options.port = Number(port);
  }
  if (username || password) {
    options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(
      password,
    )}`;
  }
  return options;
}
