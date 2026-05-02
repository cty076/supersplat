import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-4dgs-native-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/4dgs-native.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/4dgs-native.js`));
const {
    parseNative4DGSManifest,
    createNative4DGSUrlSources,
    getNativeMotionStride,
    sampleNativeMotion,
    sampleNativePositions
} = mod;

{
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'lego',
        pointCount: 2,
        keyframeCount: 3,
        frameCount: 90,
        frameRate: 30,
        baseFile: 'base.ply',
        motionFile: 'motion.bin',
        motion: {
            encoding: 'float32-le',
            layout: 'keyframes-points-xyz',
            channels: ['xyz']
        }
    });

    assert.equal(manifest.sceneName, 'lego');
    assert.equal(manifest.pointCount, 2);
    assert.equal(manifest.keyframeCount, 3);
}

{
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'lego-full',
        pointCount: 2,
        keyframeCount: 2,
        frameCount: 60,
        frameRate: 30,
        baseFile: 'base.ply',
        motionFile: 'motion.bin',
        motion: {
            encoding: 'float32-le',
            layout: 'keyframes-points-channels',
            channels: ['xyz', 'scale', 'rotation']
        }
    });

    assert.equal(getNativeMotionStride(manifest.motion.channels), 10);
    assert.deepEqual(manifest.motion.channels, ['xyz', 'scale', 'rotation']);
}

{
    assert.throws(() => parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'bad',
        pointCount: 0,
        keyframeCount: 3,
        frameCount: 90,
        frameRate: 30,
        baseFile: 'base.ply',
        motionFile: 'motion.bin',
        motion: {
            encoding: 'float32-le',
            layout: 'keyframes-points-xyz',
            channels: ['xyz']
        }
    }), /pointCount/);
}

{
    const sources = createNative4DGSUrlSources('app://viewer/pkg/manifest.json', {
        baseFile: 'base.ply',
        motionFile: 'motion.bin'
    });

    assert.equal(sources.base.url, 'app://viewer/pkg/base.ply');
    assert.equal(sources.motion.url, 'app://viewer/pkg/motion.bin');
}

{
    const keyframes = new Float32Array([
        0, 0, 0, 10, 0, 0,
        0, 10, 0, 10, 10, 0,
        0, 20, 0, 10, 20, 0
    ]);
    const out = new Float32Array(6);

    sampleNativePositions({
        keyframes,
        pointCount: 2,
        keyframeCount: 3,
        time: 0.25,
        out
    });

    assert.deepEqual(Array.from(out), [0, 5, 0, 10, 5, 0]);

    sampleNativePositions({
        keyframes,
        pointCount: 2,
        keyframeCount: 3,
        time: 1,
        out
    });

    assert.deepEqual(Array.from(out), [0, 20, 0, 10, 20, 0]);
}

{
    const keyframes = new Float32Array([
        0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
        10, 0, 0, 2, 2, 2, 0, 1, 0, 0,
        0, 10, 0, 3, 3, 3, 0, 0, 1, 0,
        10, 10, 0, 4, 4, 4, 0, 0, 0, 1
    ]);
    const out = new Float32Array(20);

    sampleNativeMotion({
        keyframes,
        pointCount: 2,
        keyframeCount: 2,
        channels: ['xyz', 'scale', 'rotation'],
        time: 0.5,
        out
    });

    assert.deepEqual(Array.from(out.slice(0, 10)), [0, 5, 0, 2, 2, 2, 0.5, 0, 0.5, 0]);
    assert.deepEqual(Array.from(out.slice(10, 20)), [10, 5, 0, 3, 3, 3, 0, 0.5, 0, 0.5]);
}

rmSync(outDir, { recursive: true, force: true });
console.log('4DGS native tests passed');
