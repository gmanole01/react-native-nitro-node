import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  LOG_PREFIX,
  type StepResult,
  createRunner,
  errorMessage,
} from './testUtils';
import { runNetBehaviourTests, runNetTests } from './netTests';
import { runHttpTests } from './httpTests';
import { runAgentTests } from './agentTests';
import { runGcTests } from './gcTests';
import { runTlsTests } from './tlsTests';
import { runOsTests } from './osTests';
import { runFsTests } from './fsTests';
import { runTimersTests } from './timersTests';
import { runCryptoTests } from './cryptoTests';
import { runZlibTests } from './zlibTests';
import { runUtilTests } from './utilTests';
import {
  type MemoryReport,
  type MemorySample,
  runMemoryTest,
} from './memoryTest';
import https from 'react-native-nitro-node/https';

async function runTests(report: (result: StepResult) => void) {
  const start = Date.now();
  const { step, counts } = createRunner(report);

  console.log(`${LOG_PREFIX} ===== run started =====`);

  await runNetTests(step);
  await runNetBehaviourTests(step);
  await runHttpTests(step);
  await runAgentTests(step);
  await runTlsTests(step);
  await runGcTests(step);
  await runOsTests(step);
  await runFsTests(step);
  await runTimersTests(step);
  await runCryptoTests(step);
  await runZlibTests(step);
  await runUtilTests(step);

  const summary =
    `${counts.passed} passed, ${counts.failed} failed, ` +
    `${counts.skipped} skipped in ${Date.now() - start}ms`;
  if (counts.failed > 0) {
    console.error(`${LOG_PREFIX} ===== run finished: ${summary} =====`);
  } else {
    console.log(`${LOG_PREFIX} ===== run finished: ${summary} =====`);
  }
}

function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function App(): React.JSX.Element {
  const [results, setResults] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const [memorySamples, setMemorySamples] = useState<MemorySample[]>([]);
  const [memoryRounds, setMemoryRounds] = useState(0);
  const [memoryReport, setMemoryReport] = useState<MemoryReport | null>(null);

  useEffect(() => {
    (async () => {
      let socket: any;

      let resolve: any, reject: any;
      const p = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      https.get('https://www.google.com', response => {
        socket = response.socket;

        console.log(response.statusCode);
        response.on('data', d => {
          console.log(d.toString('utf8'));
        });
        response.on('close', () => {
          resolve();
        });
      });

      await p;

      https.get('https://www.google.com', response => {
        const sock = response.socket;

        if (socket === sock) {
          console.log('SOCKET RESUED!!!');
        }

        console.log(response.statusCode);
        response.on('data', d => {
          console.log(d.toString('utf8'));
        });
      });
    })();
  }, []);

  const run = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setResults([]);

    runTests(result => {
      setResults(previous => {
        const index = previous.findIndex(item => item.name === result.name);
        if (index === -1) {
          return [...previous, result];
        }
        const next = previous.slice();
        next[index] = result;
        return next;
      });
    })
      .catch(err => {
        console.error(`${LOG_PREFIX} run crashed: ${errorMessage(err)}`);
      })
      .finally(() => {
        runningRef.current = false;
        setRunning(false);
      });
  }, []);

  const runMemory = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setMemorySamples([]);
    setMemoryReport(null);

    runMemoryTest((sample, totalRounds) => {
      setMemoryRounds(totalRounds);
      setMemorySamples(previous => [...previous, sample]);
    })
      .then(setMemoryReport)
      .catch(err => {
        console.error(`${LOG_PREFIX} memory run crashed: ${errorMessage(err)}`);
      })
      .finally(() => {
        runningRef.current = false;
        setRunning(false);
      });
  }, []);

  const lastSample = memorySamples[memorySamples.length - 1];
  const firstSample = memorySamples[0];

  const failed = results.filter(item => item.status === 'fail').length;
  const passed = results.filter(item => item.status === 'pass').length;
  const skipped = results.filter(item => item.status === 'skip').length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>react-native-nitro-node</Text>
      <Text style={styles.summary}>
        {running ? 'Running… ' : ''}
        {passed} passed, {failed} failed, {skipped} skipped
      </Text>

      <ScrollView style={styles.list}>
        {results.map(item => (
          <View key={item.name} style={styles.row}>
            <Text style={[styles.status, styles[item.status]]}>
              {item.status.toUpperCase()}
            </Text>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              {item.detail ? (
                <Text style={styles.detail}>
                  {item.detail} ({item.ms}ms)
                </Text>
              ) : null}
            </View>
          </View>
        ))}

        {lastSample ? (
          <View style={styles.row}>
            <Text
              style={[
                styles.status,
                memoryReport ? styles[memoryReport.verdict] : styles.running,
              ]}
            >
              {memoryReport ? memoryReport.verdict.toUpperCase() : 'RUNNING'}
            </Text>
            <View style={styles.rowText}>
              <Text style={styles.name}>
                memory: round {lastSample.round}/{memoryRounds}
              </Text>
              <Text style={styles.detail}>
                process {toMb(lastSample.processBytes)} (started at{' '}
                {toMb(firstSample.processBytes)})
                {lastSample.jsHeapBytes === null
                  ? ''
                  : `, JS heap ${toMb(lastSample.jsHeapBytes)}`}
              </Text>
              {memoryReport ? (
                <Text style={styles.detail}>{memoryReport.summary}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, running && styles.buttonDisabled]}
          disabled={running}
          onPress={run}
        >
          <Text style={styles.buttonText}>Run tests</Text>
        </Pressable>
        <Pressable
          style={[styles.button, running && styles.buttonDisabled]}
          disabled={running}
          onPress={runMemory}
        >
          <Text style={styles.buttonText}>Run memory test</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 16,
    paddingBottom: 32,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111111',
  },
  summary: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 14,
    color: '#555555',
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dddddd',
  },
  rowText: {
    flex: 1,
  },
  status: {
    width: 76,
    fontSize: 12,
    fontWeight: '700',
  },
  running: {
    color: '#8a6d00',
  },
  pass: {
    color: '#1a7f37',
  },
  fail: {
    color: '#c62828',
  },
  skip: {
    color: '#6e7781',
  },
  ok: {
    color: '#1a7f37',
  },
  suspect: {
    color: '#c62828',
  },
  inconclusive: {
    color: '#8a6d00',
  },
  name: {
    fontSize: 14,
    color: '#111111',
  },
  detail: {
    marginTop: 2,
    fontSize: 12,
    color: '#555555',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#1f6feb',
  },
  buttonDisabled: {
    backgroundColor: '#9bbcf0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

export default App;
