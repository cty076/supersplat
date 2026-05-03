import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

const readJson = (relativePath) => {
    const fullPath = path.join(root, relativePath);
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
};

const packageJson = readJson('package.json');

assert.equal(packageJson.main, 'electron/main.cjs');
assert.match(packageJson.scripts.build, /max-old-space-size=8192/);
assert.equal(packageJson.scripts.desktop, 'npm run build && electron .');
assert.equal(packageJson.scripts['desktop:smoke'], 'npm run build && cross-env ELECTRON_SMOKE_TEST=1 electron .');
assert.equal(packageJson.scripts['desktop:pack'], 'npm run build && electron-builder --dir');
assert.equal(packageJson.scripts['test:desktop'], 'node scripts/test-desktop-config.mjs');

assert.ok(packageJson.devDependencies.electron, 'electron devDependency is required');
assert.ok(packageJson.devDependencies['electron-builder'], 'electron-builder devDependency is required');

assert.equal(packageJson.build.appId, 'local.supersplat.4dgs');
assert.equal(packageJson.build.productName, '4DGS Viewer');
assert.deepEqual(packageJson.build.win.target, ['dir']);
assert.ok(packageJson.build.files.includes('dist/**/*'));
assert.ok(packageJson.build.files.includes('electron/**/*'));

const mainPath = path.join(root, 'electron', 'main.cjs');
assert.ok(fs.existsSync(mainPath), 'electron main process file should exist');

const mainSource = fs.readFileSync(mainPath, 'utf8');
const nativeRuntimeSource = fs.readFileSync(path.join(root, 'src', '4dgs-native-runtime.ts'), 'utf8');
const statusBarSource = fs.readFileSync(path.join(root, 'src', 'ui', 'status-bar.ts'), 'utf8');

assert.match(mainSource, /force_high_performance_gpu/);
assert.match(mainSource, /use-angle/);
assert.match(mainSource, /d3d11/);
assert.match(mainSource, /ignore-gpu-blocklist/);
assert.match(mainSource, /disable-gpu-sandbox/);
assert.match(mainSource, /registerSchemesAsPrivileged/);
assert.match(mainSource, /supportFetchAPI:\s*true/);
assert.match(mainSource, /protocol\.handle\('app'/);
assert.match(mainSource, /APP_ORIGIN = 'app:\/\/4dgs-viewer\/'/);
assert.match(mainSource, /LOCAL_PACKAGE_PREFIX = '__local_4dgs_package__'/);
assert.match(mainSource, /ELECTRON_SMOKE_TEST_PACKAGE/);
assert.match(mainSource, /ELECTRON_SMOKE_TEST_TIMEOUT_MS/);
assert.match(mainSource, /runFourDGSSmokeTest/);
assert.match(mainSource, /Electron smoke phase/);
assert.match(mainSource, /console-message/);
assert.match(mainSource, /render-process-gone/);
assert.match(mainSource, /native4dgs\.currentFrame/);
assert.match(mainSource, /native4dgs\.active/);
assert.match(mainSource, /searchParams\.set\('load'/);
assert.match(mainSource, /ELECTRON_SMOKE_TEST/);
assert.match(mainSource, /Electron smoke loaded/);
assert.match(mainSource, /contextIsolation:\s*true/);
assert.match(mainSource, /nodeIntegration:\s*false/);
assert.match(mainSource, /sandbox:\s*true/);

assert.match(nativeRuntimeSource, /progressStart/);
assert.match(nativeRuntimeSource, /progressUpdate/);
assert.match(nativeRuntimeSource, /progressEnd/);
assert.match(nativeRuntimeSource, /console\.info/);
assert.match(nativeRuntimeSource, /const nextClip = new Native4DGSClip/);
assert.doesNotMatch(nativeRuntimeSource, /activeClip = new Native4DGSClip/);

assert.match(statusBarSource, /native4dgs\.loaded/);
assert.match(statusBarSource, /formatNative4DGSMotionSummary/);
assert.doesNotMatch(statusBarSource, /formatNativeSummary\(manifest\)/);
assert.doesNotMatch(statusBarSource, /绗\?|甯\?/);

console.log('Desktop configuration checks passed.');
