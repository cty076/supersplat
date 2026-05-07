import assert from 'node:assert/strict';

const mod = await import(new URL('./run-4dgs-benchmark.mjs', import.meta.url));

assert.equal(mod.resolveBenchmarkOutputName('lego-native-half.4dgs-native'), 'lego-native-half');
assert.equal(mod.resolveBenchmarkOutputName('scene.compressed.ply'), 'scene');
assert.equal(mod.resolveBenchmarkOutputName('scene.ply'), 'scene');

console.log('4DGS benchmark runner tests passed');
