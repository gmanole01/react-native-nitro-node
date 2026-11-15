import * as fs from 'react-native-nitro-node/fs';
import * as os from 'react-native-nitro-node/os';
import { type Step } from './testUtils';

/** os: the app's folders and the network interfaces. */
export async function runOsTests(step: Step) {
  await step('os.tmpdir() and os.homedir() are usable', async () => {
    const tmp = os.tmpdir();
    const home = os.homedir();
    for (const [name, dir] of [['tmpdir', tmp], ['homedir', home]]) {
      if (!dir.startsWith('/')) {
        throw new Error(`${name}() is not absolute: ${dir}`);
      }
      fs.accessSync(dir);
    }
    // only tmpdir() has to be writable: on an iOS device the sandbox root
    // (homedir) is not, only folders such as Documents in it
    fs.accessSync(tmp, fs.constants.W_OK);
    if (tmp.length > 1 && tmp.endsWith('/')) {
      throw new Error(`tmpdir() ends with a slash: ${tmp}`);
    }
    return `tmpdir ${tmp}, homedir ${home}`;
  });

  await step('os.networkInterfaces() lists the addresses, as Node', async log => {
    const interfaces = os.networkInterfaces();
    const all = Object.entries(interfaces).flatMap(([name, list]) =>
      list.map(entry => ({ name, ...entry })),
    );
    log(all.map(e => `${e.name} ${e.cidr ?? e.address}${e.internal ? ' (internal)' : ''}`).join(', '));
    for (const entry of all) {
      const where = `${entry.name} ${entry.address}`;
      if (entry.family !== 'IPv4' && entry.family !== 'IPv6') {
        throw new Error(`${where}: family ${entry.family}`);
      }
      if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(entry.mac)) {
        throw new Error(`${where}: mac ${entry.mac}`);
      }
      if (typeof entry.internal !== 'boolean' || typeof entry.netmask !== 'string') {
        throw new Error(`${where}: internal or netmask has the wrong type`);
      }
      // only IPv6 addresses have a scope id, as in Node
      if ((entry.family === 'IPv6') !== (typeof entry.scopeid === 'number')) {
        throw new Error(`${where}: scopeid ${entry.scopeid}`);
      }
      if (entry.cidr !== null && !entry.cidr.startsWith(`${entry.address}/`)) {
        throw new Error(`${where}: cidr ${entry.cidr}`);
      }
    }
    // the loopback: lo0 on iOS, lo on Android
    const loopback = all.find(e => e.address === '127.0.0.1');
    if (!loopback || !loopback.internal || loopback.cidr !== '127.0.0.1/8') {
      throw new Error(`no internal 127.0.0.1/8: ${JSON.stringify(loopback)}`);
    }
    return `${Object.keys(interfaces).length} interfaces, ${all.length} addresses`;
  });
}
