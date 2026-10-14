const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;
const CHAR_BACKWARD_SLASH = 92;

function validateString(value: string, name: string) {
  if (typeof value !== 'string') {
    throw new Error(`${name} should be a string`);
  }
}

function isPosixPathSeparator(code: number) {
  return code === CHAR_FORWARD_SLASH;
}

function normalizeString(
  path: string,
  allowAboveRoot: boolean,
  separator: string,
  isPathSeparator: (code: number) => boolean,
) {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = String.prototype.charCodeAt.call(path, i);
    else if (isPathSeparator(code)) break;
    else code = CHAR_FORWARD_SLASH;

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          String.prototype.charCodeAt.call(res, res.length - 1) !== CHAR_DOT ||
          String.prototype.charCodeAt.call(res, res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.length - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = '';
              lastSegmentLength = 0;
            } else {
              res = String.prototype.slice.call(res, 0, lastSlashIndex);
              lastSegmentLength =
                res.length -
                1 -
                String.prototype.lastIndexOf.call(res, separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += `${separator}${String.prototype.slice.call(
            path,
            lastSlash + 1,
            i,
          )}`;
        else res = String.prototype.slice.call(path, lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function posixCwd(): string {
  throw new Error('process.cwd() not supported in React Native');
}

const posix = {
  resolve(...args: string[]): string {
    if (
      args.length === 0 ||
      (args.length === 1 && (args[0] === '' || args[0] === '.'))
    ) {
      const cwd = posixCwd();
      if (String.prototype.charCodeAt.call(cwd, 0) === CHAR_FORWARD_SLASH) {
        return cwd;
      }
    }
    let resolvedPath = '';
    let resolvedAbsolute = false;

    for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
      const path = args[i];
      validateString(path, `paths[${i}]`);

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }

      resolvedPath = `${path}/${resolvedPath}`;
      resolvedAbsolute =
        String.prototype.charCodeAt.call(path, 0) === CHAR_FORWARD_SLASH;
    }

    if (!resolvedAbsolute) {
      const cwd = posixCwd();
      resolvedPath = `${cwd}/${resolvedPath}`;
      resolvedAbsolute =
        String.prototype.charCodeAt.call(cwd, 0) === CHAR_FORWARD_SLASH;
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeString(
      resolvedPath,
      !resolvedAbsolute,
      '/',
      isPosixPathSeparator,
    );

    if (resolvedAbsolute) {
      return `/${resolvedPath}`;
    }
    return resolvedPath.length > 0 ? resolvedPath : '.';
  },

  normalize(path: string) {
    validateString(path, 'path');

    if (path.length === 0) return '.';

    const isAbsolute =
      String.prototype.charCodeAt.call(path, 0) === CHAR_FORWARD_SLASH;
    const trailingSeparator =
      String.prototype.charCodeAt.call(path, path.length - 1) ===
      CHAR_FORWARD_SLASH;

    // Normalize the path
    path = normalizeString(path, !isAbsolute, '/', isPosixPathSeparator);

    if (path.length === 0) {
      if (isAbsolute) return '/';
      return trailingSeparator ? './' : '.';
    }
    if (trailingSeparator) path += '/';

    return isAbsolute ? `/${path}` : path;
  },

  isAbsolute(path: string) {
    validateString(path, 'path');
    return (
      path.length > 0 &&
      String.prototype.charCodeAt.call(path, 0) === CHAR_FORWARD_SLASH
    );
  },

  join(...args: string[]) {
    if (args.length === 0) {
      return '.';
    }

    const path = [];
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      validateString(arg, 'path');
      if (arg.length > 0) {
        path.push(arg);
      }
    }

    if (path.length === 0) {
      return '.';
    }

    return posix.normalize(Array.prototype.join.call(path, '/'));
  },

  relative(from: string, to: string) {
    validateString(from, 'from');
    validateString(to, 'to');

    if (from === to) return '';

    // Trim leading forward slashes.
    from = posix.resolve(from);
    to = posix.resolve(to);

    if (from === to) return '';

    const fromStart = 1;
    const fromEnd = from.length;
    const fromLen = fromEnd - fromStart;
    const toStart = 1;
    const toLen = to.length - toStart;

    // Compare paths to find the longest common path from root
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = String.prototype.charCodeAt.call(from, fromStart + i);
      if (fromCode !== String.prototype.charCodeAt.call(to, toStart + i)) break;
      else if (fromCode === CHAR_FORWARD_SLASH) lastCommonSep = i;
    }
    if (i === length) {
      if (toLen > length) {
        if (
          String.prototype.charCodeAt.call(to, toStart + i) ===
          CHAR_FORWARD_SLASH
        ) {
          // We get here if `from` is the exact base path for `to`.
          // For example: from='/foo/bar'; to='/foo/bar/baz'
          return String.prototype.slice.call(to, toStart + i + 1);
        }
        if (i === 0) {
          // We get here if `from` is the root
          // For example: from='/'; to='/foo'
          return String.prototype.slice.call(to, toStart + i);
        }
      } else if (fromLen > length) {
        if (
          String.prototype.charCodeAt.call(from, fromStart + i) ===
          CHAR_FORWARD_SLASH
        ) {
          // We get here if `to` is the exact base path for `from`.
          // For example: from='/foo/bar/baz'; to='/foo/bar'
          lastCommonSep = i;
        } else if (i === 0) {
          // We get here if `to` is the root.
          // For example: from='/foo/bar'; to='/'
          lastCommonSep = 0;
        }
      }
    }

    let out = '';
    // Generate the relative path based on the path difference between `to`
    // and `from`.
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (
        i === fromEnd ||
        String.prototype.charCodeAt.call(from, i) === CHAR_FORWARD_SLASH
      ) {
        out += out.length === 0 ? '..' : '/..';
      }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts.
    return `${out}${String.prototype.slice.call(to, toStart + lastCommonSep)}`;
  },

  dirname(path: string) {
    validateString(path, 'path');
    if (path.length === 0) return '.';
    const hasRoot =
      String.prototype.charCodeAt.call(path, 0) === CHAR_FORWARD_SLASH;
    let end = -1;
    let matchedSlash = true;
    for (let i = path.length - 1; i >= 1; --i) {
      if (String.prototype.charCodeAt.call(path, i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 1) return '//';
    return String.prototype.slice.call(path, 0, end);
  },

  basename(path: string, suffix?: string) {
    if (suffix !== undefined) {
      validateString(suffix, 'suffix');
    }
    validateString(path, 'path');

    let start = 0;
    let end = -1;
    let matchedSlash = true;

    if (
      suffix !== undefined &&
      suffix.length > 0 &&
      suffix.length <= path.length
    ) {
      if (suffix === path) return '';
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (let i = path.length - 1; i >= 0; --i) {
        const code = String.prototype.charCodeAt.call(path, i);
        if (code === CHAR_FORWARD_SLASH) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === String.prototype.charCodeAt.call(suffix, extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;
      else if (end === -1) end = path.length;
      return String.prototype.slice.call(path, start, end);
    }
    for (let i = path.length - 1; i >= 0; --i) {
      if (String.prototype.charCodeAt.call(path, i) === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1) return '';
    return String.prototype.slice.call(path, start, end);
  },

  extname(path: string) {
    validateString(path, 'path');
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;
    for (let i = path.length - 1; i >= 0; --i) {
      const char = path[i];
      if (char === '/') {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (char === '.') {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (
      startDot === -1 ||
      end === -1 ||
      // We saw a non-dot character immediately before the dot
      preDotState === 0 ||
      // The (right-most) trimmed path component is exactly '..'
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      return '';
    }
    return String.prototype.slice.call(path, startDot, end);
  },

  sep: '/',
  delimiter: ':',
};

export const {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  dirname,
  basename,
  extname,
  sep,
  delimiter,
} = posix;
export { posix };
