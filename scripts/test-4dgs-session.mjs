import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = '.tmp-4dgs-session-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/4dgs-session.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(`file:///${resolve(outDir, '4dgs-session.js').replace(/\\/g, '/')}`);

const session = mod.buildFourDGSSession({
    manifest: {
        format: '4dgs-baked-sequence',
        version: 1,
        sceneName: 'lego',
        frameCount: 160,
        frameRate: 30,
        framePattern: 'frames/time_%05d.ply'
    },
    upAxis: 'z',
    frame: 42,
    timeline: { frames: 160, frameRate: 30, frame: 42, smoothness: 1 },
    camera: { focalPoint: [1, 2, 3], azim: 4, elev: 5, distance: 6, fov: 45, tonemapping: 'neutral' }
});

assert.equal(session.format, '4dgs-viewer-session');
assert.equal(session.version, 1);
assert.equal(session.sceneName, 'lego');
assert.equal(session.packageName, 'lego.4dgs');
assert.equal(session.upAxis, 'z');
assert.equal(session.frame, 42);
assert.equal(session.frameCount, 160);
assert.equal(session.frameRate, 30);
assert.deepEqual(session.camera.focalPoint, [1, 2, 3]);

assert.deepEqual(mod.parseFourDGSSession(session), session);
assert.equal(mod.parseFourDGSSession({ ...session, upAxis: 'invalid' }).upAxis, 'y');
assert.throws(() => mod.parseFourDGSSession({ ...session, format: 'bad' }), /Unsupported 4DGS session format/);
assert.throws(() => mod.parseFourDGSSession({ ...session, frame: 200 }), /frame must be within frameCount/);
assert.equal(mod.sessionFilename('lego'), 'lego.4dgs-viewer.json');
assert.equal(mod.sessionFilename(''), 'scene.4dgs-viewer.json');

rmSync(outDir, { recursive: true, force: true });
console.log('4DGS session tests passed');
