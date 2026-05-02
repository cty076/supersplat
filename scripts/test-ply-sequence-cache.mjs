import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = '.tmp-ply-sequence-cache-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/ply-sequence-cache.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(`file:///${resolve(outDir, 'ply-sequence-cache.js').replace(/\\/g, '/')}`);
const { PlySequenceFrameCache } = mod;

let loads = 0;
const disposed = [];
const cache = new PlySequenceFrameCache(
    async (frame) => {
        loads++;
        return { frame };
    },
    (value) => disposed.push(value.frame),
    2
);

cache.preload(3);
assert.deepEqual(await cache.take(3), { frame: 3 });
assert.equal(loads, 1, 'preload and take should share one load');
assert.deepEqual(disposed, [], 'taken frames are owned by the caller');

cache.preload(4);
cache.preload(5);
cache.preload(6);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(disposed, [4], 'oldest unused preloaded frame should be disposed after cache limit');

cache.clear();
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(disposed.sort((a, b) => a - b), [4, 5, 6], 'clear should dispose remaining unused frames');

rmSync(outDir, { recursive: true, force: true });
console.log('PLY sequence cache tests passed');
