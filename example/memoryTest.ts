import DeviceInfo from 'react-native-device-info';
import * as net from 'react-native-nitro-node/net';
import { Buffer } from 'buffer';
import {
  HOST,
  LOG_PREFIX,
  collectGarbage,
  connectClient,
  delay,
  errorMessage,
  expectConnectError,
  makePayload,
  noLog,
  readBytes,
  waitFor,
} from './testUtils';

// The same workload is repeated every round. Memory that is only cached
// (allocator pools, the JS heap growing to its working size) levels off after
// a few rounds; memory that is leaked keeps growing with every round.
const ROUNDS = 20;
// Rounds ignored by the verdict while the app reaches its working size.
const WARMUP_ROUNDS = 4;

// Per round:
const BULK_CONNECTIONS = 5; // connections that each echo BULK_SIZE
const BULK_SIZE = 2 * 1024 * 1024;
const BULK_WRITE_SIZE = 64 * 1024;
const SMALL_WRITES = 5000; // tiny writes on one connection
const SMALL_WRITE_SIZE = 64;
const CHURN_CONNECTIONS = 20; // connect and close without sending anything
const ABANDONED_CONNECTIONS = 5; // connected, then dropped without closing
const FAILED_CONNECTS = 5; // connects to a closed port

// Growth across the measured rounds above which the run is flagged.
const SUSPECT_GROWTH_BYTES = 8 * 1024 * 1024;

const MB = 1024 * 1024;

export interface MemorySample {
  round: number;
  // Whole-process memory, native allocations included: resident size on iOS,
  // total PSS on Android.
  processBytes: number;
  // Live bytes on the Hermes heap, or null when not running on Hermes.
  jsHeapBytes: number | null;
}

export type MemoryVerdict = 'ok' | 'suspect' | 'inconclusive';

export interface MemoryReport {
  verdict: MemoryVerdict;
  summary: string;
  samples: MemorySample[];
}

function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`;
}

function formatDelta(bytes: number): string {
  return `${bytes >= 0 ? '+' : ''}${(bytes / MB).toFixed(2)}MB`;
}

function readJsHeapBytes(): number | null {
  const stats = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
  const allocated = stats?.js_allocatedBytes;
  return typeof allocated === 'number' ? allocated : null;
}

async function sample(round: number): Promise<MemorySample> {
  // Collect twice with a pause in between: the first pass releases the JS
  // objects, which lets the native buffers and sockets they own be freed on
  // the UV loop thread before the measurement.
  collectGarbage();
  await delay(250);
  collectGarbage();
  await delay(250);

  return {
    round,
    processBytes: await DeviceInfo.getUsedMemory(),
    jsHeapBytes: readJsHeapBytes(),
  };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Least-squares slope of `values` against their index. */
function slope(values: number[]): number {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, x) => {
    numerator += (x - meanX) * (value - meanY);
    denominator += (x - meanX) * (x - meanX);
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

async function closeClient(client: any) {
  const closed = waitFor(client, 'close');
  client.end();
  await closed;
}

async function runRound(bulk: Buffer, small: Buffer, canCollect: boolean) {
  const server: any = net.createServer((socket: any) => {
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => socket.write(chunk));
  });
  server.on('error', (err: Error) =>
    console.error(`${LOG_PREFIX} [memory] server error: ${err.message}`),
  );

  server.listen(0, HOST);
  await waitFor(server, 'listening');
  const port: number = server.address()?.port ?? 0;
  if (!port) {
    throw new Error('server.address() returned no port');
  }

  // Large transfers: exercises the read buffers handed to JS and the copies
  // made for each write.
  for (let i = 0; i < BULK_CONNECTIONS; i++) {
    const client = await connectClient(port, 'bulk client', noLog);
    const reading = readBytes(client, bulk.length);
    for (let offset = 0; offset < bulk.length; offset += BULK_WRITE_SIZE) {
      client.write(bulk.subarray(offset, offset + BULK_WRITE_SIZE));
    }
    const { data } = await reading;
    if (!data.equals(bulk)) {
      throw new Error('bulk echo does not match what was sent');
    }
    await closeClient(client);
  }

  // Many tiny writes: a small per-write or per-read leak adds up here.
  {
    const client = await connectClient(port, 'small-writes client', noLog);
    const expected = SMALL_WRITES * small.length;
    const reading = readBytes(client, expected);
    for (let i = 0; i < SMALL_WRITES; i++) {
      client.write(small);
    }
    const { data } = await reading;
    if (data.length !== expected) {
      throw new Error(`small echo length ${data.length} != ${expected}`);
    }
    await closeClient(client);
  }

  // Connection churn: handles, connect requests and close callbacks.
  for (let i = 0; i < CHURN_CONNECTIONS; i++) {
    const client = await connectClient(port, 'churn client', noLog);
    await closeClient(client);
  }

  // Sockets dropped while still connected: only the garbage collector can
  // release these, so it is skipped when collection cannot be forced.
  if (canCollect) {
    for (let i = 0; i < ABANDONED_CONNECTIONS; i++) {
      await connectClient(port, 'abandoned client', noLog);
    }
  }

  const closed = waitFor(server, 'close');
  server.close();
  await closed;

  // Failed connects: the error path frees the request and closes the handle.
  for (let i = 0; i < FAILED_CONNECTS; i++) {
    await expectConnectError(port, HOST);
  }
}

function analyse(samples: MemorySample[], canCollect: boolean): MemoryReport {
  const measured = samples.filter(item => item.round > WARMUP_ROUNDS);
  const process = measured.map(item => item.processBytes);

  if (process.some(value => !(value > 0))) {
    return {
      verdict: 'inconclusive',
      summary: 'The process memory reading failed, so there is nothing to judge.',
      samples,
    };
  }

  if (new Set(process).size === 1) {
    return {
      verdict: 'inconclusive',
      summary:
        'Process memory never changed between rounds. The OS is probably ' +
        'throttling the reading (Android limits how often it is refreshed); ' +
        'watch the app in Android Studio Profiler or Xcode instead.',
      samples,
    };
  }

  const edge = Math.min(3, Math.floor(measured.length / 2));
  const growth =
    median(process.slice(-edge)) - median(process.slice(0, edge));
  const perRound = slope(process);

  const heap = measured
    .map(item => item.jsHeapBytes)
    .filter((value): value is number => value !== null);
  const heapGrowth =
    heap.length === measured.length
      ? median(heap.slice(-edge)) - median(heap.slice(0, edge))
      : null;

  const numbers =
    `process ${formatDelta(growth)} over rounds ${WARMUP_ROUNDS + 1}-${ROUNDS} ` +
    `(${formatDelta(perRound)}/round)` +
    (heapGrowth === null ? '' : `, JS heap ${formatDelta(heapGrowth)}`);

  const caveat = canCollect
    ? ''
    : ' gc() is not available, so garbage was not collected before each ' +
      'reading and the numbers are noisier.';

  if (growth > SUSPECT_GROWTH_BYTES) {
    const where =
      heapGrowth !== null && heapGrowth > growth / 2
        ? 'Most of it is on the JS heap, so look at the JS side first.'
        : 'The JS heap does not account for it, so look at native memory.';
    return {
      verdict: 'suspect',
      summary: `Memory kept growing: ${numbers}. ${where}${caveat}`,
      samples,
    };
  }

  return {
    verdict: 'ok',
    summary: `No sustained growth: ${numbers}.${caveat}`,
    samples,
  };
}

export async function runMemoryTest(
  onSample: (sample: MemorySample, totalRounds: number) => void,
): Promise<MemoryReport> {
  const log = (message: string) =>
    console.log(`${LOG_PREFIX} [memory] ${message}`);

  const canCollect = collectGarbage();
  const bulk = makePayload(BULK_SIZE);
  const small = makePayload(SMALL_WRITE_SIZE);

  const perRoundBytes =
    BULK_CONNECTIONS * BULK_SIZE + SMALL_WRITES * SMALL_WRITE_SIZE;
  log('===== memory run started =====');
  log(
    `${ROUNDS} rounds, each echoing ${formatMb(perRoundBytes)} over ` +
      `${BULK_CONNECTIONS + 1 + CHURN_CONNECTIONS} connections, ` +
      `gc() ${canCollect ? 'available' : 'NOT available'}`,
  );

  const samples: MemorySample[] = [];
  const baseline = await sample(0);
  samples.push(baseline);
  onSample(baseline, ROUNDS);
  log(
    `baseline process=${formatMb(baseline.processBytes)}` +
      (baseline.jsHeapBytes === null
        ? ''
        : ` jsHeap=${formatMb(baseline.jsHeapBytes)}`),
  );

  for (let round = 1; round <= ROUNDS; round++) {
    const start = Date.now();
    try {
      await runRound(bulk, small, canCollect);
    } catch (err) {
      const summary = `Round ${round} failed: ${errorMessage(err)}`;
      console.error(`${LOG_PREFIX} [memory] ${summary}`);
      return { verdict: 'inconclusive', summary, samples };
    }
    const took = Date.now() - start;

    const current = await sample(round);
    const previous = samples[samples.length - 1];
    samples.push(current);
    onSample(current, ROUNDS);

    log(
      `round ${round}/${ROUNDS}${round <= WARMUP_ROUNDS ? ' (warm-up)' : ''} ` +
        `process=${formatMb(current.processBytes)} ` +
        `(${formatDelta(current.processBytes - previous.processBytes)}, ` +
        `${formatDelta(current.processBytes - baseline.processBytes)} total)` +
        (current.jsHeapBytes === null
          ? ''
          : ` jsHeap=${formatMb(current.jsHeapBytes)}`) +
        ` ${took}ms`,
    );
  }

  const report = analyse(samples, canCollect);
  const line = `===== memory run finished: ${report.verdict.toUpperCase()} - ${report.summary} =====`;
  if (report.verdict === 'ok') {
    log(line);
  } else {
    console.error(`${LOG_PREFIX} [memory] ${line}`);
  }
  return report;
}
