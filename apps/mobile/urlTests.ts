import url, {
  URL,
  URLSearchParams,
  domainToASCII,
  domainToUnicode,
  fileURLToPath,
  pathToFileURL,
  urlToHttpOptions,
} from 'react-native-nitro-node/url';
import querystring from 'react-native-nitro-node/querystring';
import { type Step } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** The error `fn` throws. */
function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('did not throw');
}

// The expected values are Node 22's: the parser is ada, the version Node uses
export async function runUrlTests(step: Step) {
  await step('url: new URL() parses as Node', async () => {
    const u = new URL('https://user:pass@例え.テスト:8080/p/a/t/h?query=string#hash');
    expectEqual(
      'parts',
      [u.href, u.origin, u.host, u.hostname, u.port, u.pathname, u.search, u.hash, u.username, u.password],
      [
        'https://user:pass@xn--r8jz45g.xn--zckzah:8080/p/a/t/h?query=string#hash',
        'https://xn--r8jz45g.xn--zckzah:8080',
        'xn--r8jz45g.xn--zckzah:8080',
        'xn--r8jz45g.xn--zckzah',
        '8080',
        '/p/a/t/h',
        '?query=string',
        '#hash',
        'user',
        'pass',
      ],
    );
    expectEqual('IPv6', new URL('http://[2001:DB8::1]:80/').href, 'http://[2001:db8::1]/');
    expectEqual('relative', new URL('../f?x#y', 'https://x.com/d/e/').href, 'https://x.com/d/f?x#y');
    expectEqual('normalized', new URL('HTTP://EXAMPLE.com:80/a/../b/%7E?c d').href, 'http://example.com/b/%7E?c%20d');
    const err = thrown(() => new URL('http://exa mple.com'));
    expectEqual('invalid', [err.name, err.code, err.message, err.input], [
      'TypeError',
      'ERR_INVALID_URL',
      'Invalid URL',
      'http://exa mple.com',
    ]);
    expectEqual('URL.canParse / URL.parse', [URL.canParse('https://a'), URL.canParse('/x'), URL.canParse('/x', 'https://a'), URL.parse('nope')], [
      true,
      false,
      true,
      null,
    ]);
    return 'IDN, IPv6, relative, normalization, errors';
  });

  await step('url: setters and URLSearchParams, as Node', async () => {
    const v = new URL('https://a.com/p?q=1#h');
    v.protocol = 'http';
    v.hostname = 'b.org';
    v.port = '81';
    v.pathname = '/x y';
    v.search = 'k=v';
    v.hash = 'z';
    v.username = 'me';
    expectEqual('setters', v.href, 'http://me@b.org:81/x%20y?k=v#z');
    const bad = new URL('https://a.com');
    bad.port = '99999';
    expectEqual('refused port', bad.href, 'https://a.com/');

    const p = new URLSearchParams('?b=2&a=1&a=3&s=x+y');
    p.append('é', '&=');
    p.sort();
    expectEqual('URLSearchParams', [p.toString(), p.getAll('a'), p.get('s'), p.size], [
      'a=1&a=3&b=2&s=x+y&%C3%A9=%26%3D',
      ['1', '3'],
      'x y',
      5,
    ]);

    const linked = new URL('https://a.com/?x=1');
    linked.searchParams.append('y', '2 3');
    const first = linked.href;
    linked.search = '?z=4';
    expectEqual('URL and its searchParams', [first, linked.searchParams.get('z'), [...linked.searchParams.keys()]], [
      'https://a.com/?x=1&y=2+3',
      '4',
      ['z'],
    ]);
    return 'every setter kind, sorting, the URL link';
  });

  await step('url: the legacy parse(), format() and resolve(), as Node', async () => {
    const p = url.parse('http://user:pw@Host.com:8080/p/a?x=1&y=2#h', true);
    expectEqual(
      'parse',
      [p.protocol, p.auth, p.host, p.hostname, p.port, p.pathname, p.search, JSON.stringify(p.query), p.hash, p.path, p.href],
      [
        'http:',
        'user:pw',
        'host.com:8080',
        'host.com',
        '8080',
        '/p/a',
        '?x=1&y=2',
        '{"x":"1","y":"2"}',
        '#h',
        '/p/a?x=1&y=2',
        'http://user:pw@host.com:8080/p/a?x=1&y=2#h',
      ],
    );
    expectEqual(
      'format',
      url.format({ protocol: 'https', hostname: 'a.com', pathname: '/p', query: { a: [1, 2], b: 'x y' } }),
      'https://a.com/p?a=1&a=2&b=x%20y',
    );
    expectEqual('format(URL)', url.format(new URL('https://u:p@a.com/p?q#h'), { auth: false, fragment: false }), 'https://a.com/p?q');
    expectEqual(
      'resolve',
      [url.resolve('http://a/b/c/d;p?q', '../g'), url.resolve('/one/two/three', 'four'), url.resolve('http://example.com/one', '/two')],
      ['http://a/b/g', '/one/two/four', 'http://example.com/two'],
    );
    return 'parse, format, resolve';
  });

  await step('url: files, domains, http options and querystring.parse()', async () => {
    expectEqual('fileURLToPath', fileURLToPath('file:///tmp/a%20b/%C3%A9'), '/tmp/a b/é');
    expectEqual('pathToFileURL', pathToFileURL('/tmp/a b#c?d%').href, 'file:///tmp/a%20b%23c%3Fd%25');
    expectEqual('domains', [domainToASCII('español.com'), domainToUnicode('xn--espaol-zwa.com'), domainToASCII('xn--iñvalid.com')], [
      'xn--espaol-zwa.com',
      'español.com',
      '',
    ]);
    expectEqual('urlToHttpOptions', JSON.stringify(urlToHttpOptions(new URL('https://u:p%20w@[::1]:8443/x?y=1'))),
      '{"protocol":"https:","hostname":"::1","hash":"","search":"?y=1","pathname":"/x","path":"/x?y=1","href":"https://u:p%20w@[::1]:8443/x?y=1","port":8443,"auth":"u:p w"}');
    expectEqual('querystring.parse', JSON.stringify(querystring.parse('a=1&b=2&a=3&c=x+y&d=%E2%9C%93')), '{"a":["1","3"],"b":"2","c":"x y","d":"✓"}');
    expectEqual(
      'custom decode',
      JSON.stringify(querystring.parse('w=%D6%D0%CE%C4&foo=bar', undefined, undefined, { decodeURIComponent: s => s })),
      '{"w":"%D6%D0%CE%C4","foo":"bar"}',
    );
    expectEqual('unescape', querystring.unescape('%41%zz'), 'A%zz');
    return 'file URLs, IDNA, http options, query strings';
  });
}
