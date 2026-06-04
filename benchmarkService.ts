/**
 * Lightweight in-memory + persisted benchmark collector for the dashboard and
 * the PPT/PDF page. Judges trust measured numbers.
 */
import {MMKV} from 'react-native-mmkv';

const bench = new MMKV({id: 'faceauth-bench'}); // non-secret metrics

interface Stats {
  recognitionMs: number[];
  livenessMs: number[];
  endToEndMs: number[];
  trueAccept: number; // correct user accepted
  falseAccept: number; // wrong user accepted (FAR)
  falseReject: number; // correct user rejected (FRR)
  spoofBlocked: number;
  spoofPassed: number;
}

const KEY = 'stats';

function read(): Stats {
  const raw = bench.getString(KEY);
  return raw
    ? JSON.parse(raw)
    : {
        recognitionMs: [],
        livenessMs: [],
        endToEndMs: [],
        trueAccept: 0,
        falseAccept: 0,
        falseReject: 0,
        spoofBlocked: 0,
        spoofPassed: 0,
      };
}

function write(s: Stats): void {
  bench.set(KEY, JSON.stringify(s));
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export const Benchmark = {
  recordTiming(recognitionMs: number, livenessMs: number, endToEndMs: number) {
    const s = read();
    s.recognitionMs.push(recognitionMs);
    s.livenessMs.push(livenessMs);
    s.endToEndMs.push(endToEndMs);
    write(s);
  },
  recordOutcome(kind: keyof Pick<Stats, 'trueAccept' | 'falseAccept' | 'falseReject'>) {
    const s = read();
    s[kind] += 1;
    write(s);
  },
  recordSpoof(blocked: boolean) {
    const s = read();
    if (blocked) s.spoofBlocked += 1;
    else s.spoofPassed += 1;
    write(s);
  },
  summary() {
    const s = read();
    const totalReal = s.trueAccept + s.falseReject;
    const totalImposter = s.falseAccept; // imposter attempts that got in
    return {
      attempts: s.endToEndMs.length,
      avgRecognitionMs: Math.round(avg(s.recognitionMs)),
      avgLivenessMs: Math.round(avg(s.livenessMs)),
      avgEndToEndMs: Math.round(avg(s.endToEndMs)),
      far: totalImposter ? +(s.falseAccept / totalImposter).toFixed(3) : 0,
      frr: totalReal ? +(s.falseReject / totalReal).toFixed(3) : 0,
      spoofBlocked: s.spoofBlocked,
      spoofPassed: s.spoofPassed,
    };
  },
  reset() {
    bench.delete(KEY);
  },
};
