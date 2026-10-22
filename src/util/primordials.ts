/**
 * Node's `primordials`, as far as the ported util code (./inspect,
 * ./comparisons) uses them: built-ins taken once, by name, as Node does. A
 * name says what it is: `ArrayPrototypeJoin` is Array.prototype.join called
 * with its `this` as first argument, `MapPrototypeGetSize` is the `size`
 * getter, `SymbolIterator` is Symbol.iterator, `ObjectKeys` is Object.keys.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Any = any;

const uncurryThis =
  (fn: Function) =>
  (thisArg: unknown, ...args: unknown[]) =>
    Reflect.apply(fn, thisArg, args);

const TypedArray = Object.getPrototypeOf(Uint8Array);

// The globals a name can start with, longest first, so that ArrayBuffer wins over Array
const owners: Array<[string, Any]> = (
  [
    ['AggregateError', (globalThis as Any).AggregateError],
    ['ArrayBuffer', ArrayBuffer],
    ['Array', Array],
    ['BigInt', (globalThis as Any).BigInt],
    ['Boolean', Boolean],
    ['DataView', DataView],
    ['Date', Date],
    ['Error', Error],
    ['Function', Function],
    ['JSON', JSON],
    ['Map', Map],
    ['Math', Math],
    ['Number', Number],
    ['Object', Object],
    ['Promise', Promise],
    ['RangeError', RangeError],
    ['Reflect', Reflect],
    ['RegExp', RegExp],
    ['Set', Set],
    ['String', String],
    ['Symbol', Symbol],
    ['TypeError', TypeError],
    ['TypedArray', TypedArray],
    ['WeakMap', WeakMap],
    ['WeakSet', WeakSet],
  ] as Array<[string, Any]>
).sort((a, b) => b[0].length - a[0].length);

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function getterOf(object: Any, key: PropertyKey): Function {
  let o = object;
  while (o) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d) {
      return d.get!;
    }
    o = Object.getPrototypeOf(o);
  }
  throw new Error(`primordials: no getter ${String(key)}`);
}

/** What a primordial name stands for. */
function resolve(name: string): Any {
  const global = (globalThis as Any)[name];
  if (global !== undefined && !/Prototype/.test(name)) {
    return global;
  }
  for (const [ownerName, owner] of owners) {
    if (!name.startsWith(ownerName)) {
      continue;
    }
    const rest = name.slice(ownerName.length);
    if (rest === '') {
      return owner;
    }
    if (owner === undefined) {
      // a built-in this engine doesn't have (AggregateError on older engines)
      return undefined;
    }
    if (rest === 'Prototype') {
      return owner.prototype;
    }
    if (rest.startsWith('Prototype')) {
      const member = rest.slice('Prototype'.length);
      if (member.startsWith('Symbol')) {
        // RegExpPrototypeSymbolReplace: RegExp.prototype[Symbol.replace]
        const fn = owner.prototype[(Symbol as Any)[lowerFirst(member.slice('Symbol'.length))]];
        return fn ? uncurryThis(fn) : undefined;
      }
      if (member.startsWith('Get') && !(lowerFirst(member) in owner.prototype)) {
        // MapPrototypeGetSize: the `size` getter
        const key = member.slice('Get'.length);
        const prop = key.startsWith('Symbol') ? (Symbol as Any)[lowerFirst(key.slice('Symbol'.length))] : lowerFirst(key);
        return uncurryThis(getterOf(owner.prototype, prop));
      }
      const fn = owner.prototype[lowerFirst(member)];
      return typeof fn === 'function' ? uncurryThis(fn) : undefined;
    }
    if (ownerName === 'Symbol') {
      // SymbolIterator: Symbol.iterator
      return (Symbol as Any)[lowerFirst(rest)];
    }
    const value = owner[lowerFirst(rest)];
    return typeof value === 'function' ? value.bind(owner) : value;
  }
  throw new Error(`primordials: unknown ${name}`);
}

// Names that don't follow the pattern
const special: Record<string, Any> = {
  uncurryThis,
  globalThis,
  TypedArray,
  TypedArrayPrototype: TypedArray.prototype,
  SafeMap: Map,
  SafeSet: Set,
  // A string's code point iterator, for `for (const c of new SafeStringIterator(s))`
  SafeStringIterator: function SafeStringIterator(str: string) {
    return str[Symbol.iterator]();
  },
  ArrayPrototypePushApply: (array: unknown[], items: unknown[]) => {
    for (const item of items) {
      array.push(item);
    }
    return array.length;
  },
  JSONStringify: JSON.stringify,
  // Hermes may lack normalize() without Intl: then strings stay as they are
  StringPrototypeNormalize: (str: string, form?: string) =>
    typeof str.normalize === 'function' ? str.normalize(form) : str,
};

const cache = new Map<string, Any>();

/** Node's primordials: `primordials.ArrayPrototypeJoin`, ... */
export const primordials: Record<string, Any> = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== 'string') {
        return undefined;
      }
      if (!cache.has(name)) {
        cache.set(name, name in special ? special[name] : resolve(name));
      }
      return cache.get(name);
    },
  },
);
