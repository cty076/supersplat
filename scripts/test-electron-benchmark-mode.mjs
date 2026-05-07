import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

const source = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

assert.match(source, /ELECTRON_BENCHMARK_SPEC/);
assert.match(source, /ELECTRON_BENCHMARK_REFERENCE_ROOT/);
assert.match(source, /ELECTRON_BENCHMARK_OUTPUT/);
assert.match(source, /runFourDGSBenchmark/);
assert.match(source, /__benchmark_reference__/);

console.log('Electron benchmark mode checks passed.');
