import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-ply-sequence-swap-policy-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/ply-sequence-swap-policy.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/ply-sequence-swap-policy.js`));
const { shouldDisplayLoadedFrame } = mod;

assert.equal(
    shouldDisplayLoadedFrame({ requestedFrame: 4, queuedFrame: -1, loadGeneration: 2, currentGeneration: 2 }),
    true,
    'a loaded frame should display when no newer frame is queued'
);

assert.equal(
    shouldDisplayLoadedFrame({ requestedFrame: 4, queuedFrame: 9, loadGeneration: 2, currentGeneration: 2 }),
    false,
    'a loaded frame should be discarded when a newer queued frame supersedes it'
);

assert.equal(
    shouldDisplayLoadedFrame({ requestedFrame: 4, queuedFrame: 4, loadGeneration: 2, currentGeneration: 2 }),
    true,
    'a duplicate request for the same loading frame should not suppress the frame'
);

assert.equal(
    shouldDisplayLoadedFrame({ requestedFrame: 4, queuedFrame: -1, loadGeneration: 1, currentGeneration: 2 }),
    false,
    'a loaded frame from an old sequence generation should never display'
);

rmSync(outDir, { recursive: true, force: true });
console.log('PLY sequence swap policy tests passed');
