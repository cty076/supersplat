import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-ply-sequence-runtime-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/ply-sequence-runtime.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/ply-sequence-runtime.js`));
const { PlySequenceRuntime } = mod;

const deferred = () => {
    let resolve;
    const promise = new Promise((resolveIn) => {
        resolve = resolveIn;
    });
    return { promise, resolve };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

{
    const pending = new Map();
    const activations = [];
    let playing = true;
    const runtime = new PlySequenceRuntime({
        loader: (frame) => {
            const task = deferred();
            pending.set(frame, task);
            return task.promise;
        },
        activate: (frame, value) => {
            activations.push([frame, value.frame]);
        },
        dispose: () => {},
        getPlaybackActive: () => playing,
        maxResidentFrames: 3
    });

    runtime.setFrameCount(4);
    runtime.requestFrame(0);
    runtime.requestFrame(1);
    assert.deepEqual([...pending.keys()], [0], 'playback should not launch every requested frame while one frame is loading');

    pending.get(0).resolve({ frame: 0 });
    await flush();
    assert.deepEqual(activations, [[0, 0]], 'playback should display the completed frame even when a newer frame is queued');
    assert.ok(pending.has(1), 'runtime should continue toward the newest requested frame after showing the available frame');

    pending.get(1).resolve({ frame: 1 });
    await flush();
    assert.deepEqual(activations, [[0, 0], [1, 1]]);
    playing = false;
}

{
    const pending = new Map();
    const activations = [];
    const runtime = new PlySequenceRuntime({
        loader: (frame) => {
            const task = deferred();
            pending.set(frame, task);
            return task.promise;
        },
        activate: (frame, value) => {
            activations.push([frame, value.frame]);
        },
        dispose: () => {},
        getPlaybackActive: () => false,
        maxResidentFrames: 3
    });

    runtime.setFrameCount(4);
    const first = runtime.showFrameAsync(0);
    pending.get(0).resolve({ frame: 0 });
    await first;
    assert.deepEqual(activations, [[0, 0]]);

    runtime.requestFrame(1);
    runtime.requestFrame(2);
    pending.get(1).resolve({ frame: 1 });
    await flush();
    assert.deepEqual(activations, [[0, 0]], 'scrubbing should not display stale frames when a newer target is queued');

    pending.get(2).resolve({ frame: 2 });
    await flush();
    assert.deepEqual(activations, [[0, 0], [2, 2]]);
}

{
    const loadsByFrame = new Map();
    const disposed = [];
    const activations = [];
    const runtime = new PlySequenceRuntime({
        loader: async (frame) => {
            loadsByFrame.set(frame, (loadsByFrame.get(frame) ?? 0) + 1);
            return { frame };
        },
        activate: (frame, value) => {
            activations.push([frame, value.frame]);
        },
        dispose: (value) => {
            disposed.push(value.frame);
        },
        getPlaybackActive: () => false,
        maxResidentFrames: 3
    });

    runtime.setFrameCount(5);
    await runtime.showFrameAsync(0);
    await runtime.showFrameAsync(1);
    await runtime.showFrameAsync(0);
    assert.equal(loadsByFrame.get(0), 1, 'resident frames should be reused without reloading');
    assert.deepEqual(activations, [[0, 0], [1, 1], [0, 0]]);

    await runtime.showFrameAsync(2);
    await flush();
    assert.ok(disposed.includes(1), 'hidden resident frames should be evicted when the resident limit is exceeded');
    assert.ok(!disposed.includes(0), 'the active frame must not be evicted');
}

rmSync(outDir, { recursive: true, force: true });
console.log('PLY sequence runtime tests passed');
