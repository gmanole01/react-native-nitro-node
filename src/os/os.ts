import { NitroOs, NitroUv } from '../native';
import { uvError } from '../errors';

/** The line separator. */
export const EOL = '\n';

/**
 * The app's directory for temporary files: iOS's per-app tmp directory, or
 * Android's cache directory. The system may delete its files when it needs
 * space. Like Node's, the path has no trailing slash.
 */
export function tmpdir(): string {
  const dir = NitroOs.tmpdir();
  // iOS's $TMPDIR ends with a slash; Node strips it
  return dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/**
 * The app's private data directory: the app's sandbox on iOS (which holds
 * Documents, Library and tmp), or /data/user/0/<package> on Android. On iOS
 * the directory itself is not writable, only the folders in it.
 */
export function homedir(): string {
  return NitroOs.homedir();
}

/** One address of a network interface, as Node's os.NetworkInterfaceInfo. */
export interface NetworkInterfaceInfo {
  address: string;
  netmask: string;
  family: 'IPv4' | 'IPv6';
  mac: string;
  internal: boolean;
  /** The address with its routing prefix ('192.168.1.2/24'), null if the netmask is not one. */
  cidr: string | null;
  /** IPv6 only. */
  scopeid?: number;
}

/**
 * The device's network interfaces and their addresses, by interface name,
 * as Node's (ported from its lib/os.js). Interfaces without an address are
 * left out. On iOS the MAC address of most interfaces is 02:00:00:00:00:00:
 * the system hides the real one from apps.
 */
export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
  let addresses;
  try {
    addresses = NitroUv.uv_interface_addresses();
  } catch (e) {
    const match = /\[errno (-?\d+)\]/.exec(e instanceof Error ? e.message : String(e));
    throw match ? uvError('uv_interface_addresses', Number(match[1])) : e;
  }

  const result: Record<string, NetworkInterfaceInfo[]> = {};
  for (const { name, address, netmask, family, mac, internal, scopeid } of addresses) {
    const entry: NetworkInterfaceInfo = {
      address,
      netmask,
      family: family as NetworkInterfaceInfo['family'],
      mac,
      internal,
      cidr: getCIDR(address, netmask, family),
    };
    if (scopeid !== -1) {
      entry.scopeid = scopeid;
    }
    const existing = result[name];
    if (existing !== undefined) {
      existing.push(entry);
    } else {
      result[name] = [entry];
    }
  }
  return result;
}

// Node's getCIDR: the number of leading ones of the netmask, or null when its
// ones are not all leading.
function getCIDR(address: string, netmask: string, family: string): string | null {
  let ones = 0;
  let split = '.';
  let range = 10;
  let groupLength = 8;
  let hasZeros = false;
  let lastPos = 0;

  if (family === 'IPv6') {
    split = ':';
    range = 16;
    groupLength = 16;
  }

  for (let i = 0; i < netmask.length; i++) {
    if (netmask[i] !== split) {
      if (i + 1 < netmask.length) {
        continue;
      }
      i++;
    }
    const part = netmask.slice(lastPos, i);
    lastPos = i + 1;
    if (part !== '') {
      if (hasZeros) {
        if (part !== '0') {
          return null;
        }
        continue;
      }
      const binary = Number.parseInt(part, range);
      const binaryOnes = countBinaryOnes(binary);
      ones += binaryOnes;
      if (binaryOnes !== groupLength) {
        if (binary.toString(2).includes('01')) {
          return null;
        }
        hasZeros = true;
      }
    }
  }

  return `${address}/${ones}`;
}

function countBinaryOnes(n: number): number {
  // Count the number of bits set in parallel, which is faster than looping
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return ((((n + (n >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24);
}
