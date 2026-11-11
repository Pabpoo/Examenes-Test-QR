// Banco sintético del escáner. Uso: npm run bench:escaner -- [casos=500] [semilla=1] [hilos=núcleos-1]
// Cada caso: examen y respuestas aleatorias, foto deformada, lectura y comparación. Reproducible por semilla.

import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeCase } from './cases';
import { evaluateCase, formatSummary, summarize, type CaseResult } from './evaluate';
import { Rng } from './rng';

interface Job {
  seeds: number[];
}

function runSeeds(seeds: number[], onResult: (r: CaseResult) => void): void {
  for (const seed of seeds) {
    const c = makeCase(seed, new Rng(seed * 7919 + 13));
    onResult(evaluateCase(c));
  }
}

if (isMainThread) {
  const [nArg, seedArg, threadsArg] = process.argv.slice(2);
  const n = Number(nArg ?? 500);
  const first = Number(seedArg ?? 1);
  const threads = Math.max(1, Number(threadsArg ?? Math.max(1, availableParallelism() - 1)));
  const seeds = Array.from({ length: n }, (_, i) => first + i);
  const chunks: number[][] = Array.from({ length: threads }, () => []);
  seeds.forEach((s, i) => chunks[i % threads].push(s));
  const results: CaseResult[] = [];
  const t0 = Date.now();
  let done = 0;
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    chunks
      .filter((c) => c.length)
      .map(
        (chunk) =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(file, { workerData: { seeds: chunk } satisfies Job, execArgv: process.execArgv });
            w.on('message', (r: CaseResult) => {
              results.push(r);
              done++;
              if (done % 50 === 0) console.log(`  ${done}/${n} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
            });
            w.on('error', reject);
            w.on('exit', () => resolve());
          }),
      ),
  );
  results.sort((a, b) => a.seed - b.seed);
  const summary = summarize(results);
  console.log(formatSummary(summary));
  console.log(`Duración: ${((Date.now() - t0) / 1000).toFixed(0)} s con ${threads} hilos`);
  mkdirSync('tests/bench/out', { recursive: true });
  writeFileSync('tests/bench/out/ultimo-banco.json', JSON.stringify({ summary, results }, null, 1));
  process.exitCode = summary.silentErrors.length > 0 ? 1 : 0;
} else {
  runSeeds((workerData as Job).seeds, (r) => parentPort!.postMessage(r));
}
