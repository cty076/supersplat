import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-import-orientation-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/import-orientation.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/import-orientation.js`));

const vec = (value) => [value.x, value.y, value.z];

assert.deepEqual(vec(mod.getImportOrientation('time_00000.ply', 'y')), [0, 0, 180]);
assert.deepEqual(vec(mod.getImportOrientation('time_00000.ply', 'z')), [90, 0, 180]);
assert.deepEqual(vec(mod.getImportOrientation('scene.spz', 'y')), [0, 0, 0]);
assert.deepEqual(vec(mod.getImportOrientation('scene.spz', 'z')), [90, 0, 0]);
assert.deepEqual(vec(mod.getImportOrientation('scene.lcc', 'y')), [90, 0, 180]);
assert.deepEqual(vec(mod.getImportOrientation('scene.lcc', 'z')), [180, 0, 180]);

assert.equal(mod.normalizeImportUpAxis('z'), 'z');
assert.equal(mod.normalizeImportUpAxis('anything'), 'y');

rmSync(outDir, { recursive: true, force: true });
console.log('Import orientation tests passed');
