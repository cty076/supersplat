import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

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
    collectNative4DGSLocalSources,
    decodeNativeMotionBuffer,
    formatNative4DGSMotionSummary,
    getNativeMotionByteLength,
    getNativeMotionStride,
    sampleNativeMotion,
    sampleNativeMotionSource,
    sampleNativePositions
} = mod;

assert.equal(mod.isNative4DGSFormat('4dgs-native-trajectory'), true);
assert.equal(mod.isNative4DGSFormat('4dgs-native-motion'), true);
assert.equal(mod.isNative4DGSFormat('4dgs-baked-sequence'), false);

{
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-motion',
        version: 1,
        sceneName: 'property-delta',
        frameCount: 2,
        frameRate: 30,
        vertexCount: 2,
        propertyCount: 6,
        base: 'base.ply',
        motion: 'motion.bin',
        motionCodec: 'raw',
        motionFormat: 'property-delta-v3',
        propertyRecords: [
            { name: 'x', dtype: 'int16', mode: 'delta', index: 0, scale: [0.1], payloadOffset: 0, payloadBytes: 4 },
            { name: 'y', dtype: 'int8', mode: 'delta', index: 1, scale: [0.2], payloadOffset: 4, payloadBytes: 2 },
            { name: 'z', dtype: 'int16', mode: 'delta', index: 2, scale: [0.3], payloadOffset: 6, payloadBytes: 4 },
            { name: 'scale_0', dtype: 'int8', mode: 'delta', index: 3, scale: [0.01], payloadOffset: 10, payloadBytes: 2 },
            { name: 'scale_1', dtype: 'int8', mode: 'constant', index: 4, scale: [1], payloadOffset: 12, payloadBytes: 0 },
            { name: 'rot_0', dtype: 'int8', mode: 'delta', index: 5, scale: [0.05], payloadOffset: 12, payloadBytes: 2 }
        ]
    });

    assert.equal(manifest.format, '4dgs-native-motion');
    assert.equal(manifest.motion.encoding, 'property-delta-v3');
    assert.equal(manifest.pointCount, 2);
    assert.equal(manifest.keyframeCount, 2);

    const payload = new Uint8Array(14);
    new Int16Array(payload.buffer, 0, 2).set([1, 2]);
    new Int8Array(payload.buffer, 4, 2).set([3, 4]);
    new Int16Array(payload.buffer, 6, 2).set([5, 6]);
    new Int8Array(payload.buffer, 10, 2).set([7, 8]);
    new Int8Array(payload.buffer, 12, 2).set([9, 10]);
    const header = new TextEncoder().encode(JSON.stringify({ records: manifest.propertyRecords }));
    const motion = new Uint8Array(4 + header.length + payload.length);
    new DataView(motion.buffer).setUint32(0, header.length, true);
    motion.set(header, 4);
    motion.set(payload, 4 + header.length);
    const decoded = await mod.decodeNativeMotionBufferAsync(motion.buffer, manifest);

    assert.deepEqual(Array.from(decoded.slice(0, 20)), new Array(20).fill(0));
    assert.deepEqual(
        Array.from(decoded.slice(20, 40)).map(v => Number(v.toFixed(3))),
        [
            0.1, 0.6, 1.5, 0.07, 0, 0, 0.45, 0, 0, 0,
            0.2, 0.8, 1.8, 0.08, 0, 0, 0.5, 0, 0, 0
        ]
    );

    const zlibManifest = { ...manifest, motionCodec: 'zlib' };
    const deflated = deflateSync(motion);
    const zlibDecoded = await mod.decodeNativeMotionBufferAsync(
        deflated.buffer.slice(deflated.byteOffset, deflated.byteOffset + deflated.byteLength),
        zlibManifest
    );
    assert.deepEqual(Array.from(zlibDecoded), Array.from(decoded));

    const source = await mod.decodeNativeMotionSourceAsync(motion.buffer, manifest);
    assert.equal(source.kind, 'property-delta');
    assert.equal('keyframes' in source, false);
    const sampled = new Float32Array(20);
    sampleNativeMotionSource({
        source,
        pointCount: manifest.pointCount,
        keyframeCount: manifest.keyframeCount,
        channels: manifest.motion.channels,
        time: 1,
        out: sampled
    });
    assert.deepEqual(Array.from(sampled), Array.from(decoded.slice(20, 40)));

    const truncated = motion.slice(0, motion.length - 1);
    await assert.rejects(
        () => mod.decodeNativeMotionBufferAsync(truncated.buffer, manifest),
        /payload is too short/
    );
}

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
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'lego-half',
        pointCount: 2,
        keyframeCount: 2,
        frameCount: 60,
        frameRate: 30,
        baseFile: 'base.ply',
        motionFile: 'motion.bin',
        motion: {
            encoding: 'float16-le',
            layout: 'keyframes-points-channels',
            channels: ['xyz', 'scale', 'rotation']
        }
    });

    assert.equal(getNativeMotionStride(manifest.motion.channels), 10);
    assert.equal(getNativeMotionByteLength(manifest), 80);
    assert.equal(formatNative4DGSMotionSummary(manifest), '2 pts | 2 keys | xyz+scale+rotation | FP16');
}

{
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'half-source',
        pointCount: 1,
        keyframeCount: 4,
        frameCount: 4,
        frameRate: 30,
        baseFile: 'base.ply',
        motionFile: 'motion.bin',
        motion: {
            encoding: 'float16-le',
            layout: 'keyframes-points-xyz',
            channels: ['xyz']
        }
    });
    const halfValues = new Uint16Array([0x0000, 0x3c00, 0xc000, 0x3800]);
    const decoded = decodeNativeMotionBuffer(halfValues.buffer, 'float16-le', 4);

    assert.ok(decoded instanceof Float32Array);
    assert.deepEqual(Array.from(decoded), [0, 1, -2, 0.5]);

    const sourceHalfValues = new Uint16Array([
        0x0000, 0x3c00, 0xc000,
        0x3800, 0x0000, 0x3c00,
        0xc000, 0x3800, 0x0000,
        0x3c00, 0xc000, 0x3800
    ]);
    const source = await mod.decodeNativeMotionSourceAsync(sourceHalfValues.buffer, manifest);
    assert.equal(source.kind, 'dense');
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
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'folder-drag',
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
    const files = [
        { filename: 'lego-native-full.4dgs-native/manifest.json', contents: new File(['{}'], 'manifest.json') },
        { filename: 'lego-native-full.4dgs-native/base.ply', contents: new File(['ply'], 'base.ply') },
        { filename: 'lego-native-full.4dgs-native/motion.bin', contents: new File(['bin'], 'motion.bin') }
    ];

    const sources = collectNative4DGSLocalSources(files, files[0], manifest);
    assert.equal(sources.base.filename, 'lego-native-full.4dgs-native/base.ply');
    assert.equal(sources.motion.filename, 'lego-native-full.4dgs-native/motion.bin');
}

{
    const manifest = parseNative4DGSManifest({
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: 'missing-motion',
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
    const files = [
        { filename: 'manifest.json', contents: new File(['{}'], 'manifest.json') },
        { filename: 'base.ply', contents: new File(['ply'], 'base.ply') }
    ];

    assert.throws(
        () => collectNative4DGSLocalSources(files, files[0], manifest),
        /missing motion\.bin/
    );
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
