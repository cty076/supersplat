import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-splat-frame-init-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/splat-frame-init.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/splat-frame-init.js`));
const { fillIdentityTransformIndices } = mod;

const indices = new Uint16Array([11, 7, 3, 1]);
const result = fillIdentityTransformIndices(indices);

assert.equal(result, indices, 'initializer should mutate the supplied transform index buffer');
assert.deepEqual(Array.from(indices), [0, 0, 0, 0], 'all transform indices should point at identity transform 0');

const splatSource = readFileSync('src/splat.ts', 'utf8');
assert.match(splatSource, /fillIdentityTransformIndices/);
assert.match(splatSource, /this\.transformTexture\.lock\(\)/);
assert.match(splatSource, /this\.transformTexture\.unlock\(\)/);
assert.match(splatSource, /entity\.enabled = false/);

rmSync(outDir, { recursive: true, force: true });
console.log('Splat frame initialization tests passed');
