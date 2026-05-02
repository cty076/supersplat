import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-ply-sequence-clip-runtime-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/ply-sequence-clip-runtime.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/ply-sequence-clip-runtime.js`));
const { PlySequenceClipRuntime } = mod;

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
    const events = [];
    const runtime = new PlySequenceClipRuntime({
        loader: (frame) => {
            const task = deferred();
            pending.set(frame, task);
            return task.promise;
        },
        activate: (frame, value, previousValue) => {
            events.push(['activate', frame, value.frame, previousValue?.frame ?? null]);
        },
        dispose: (value) => {
            events.push(['dispose', value.frame]);
        },
        maxResidentFrames: 3
    });

    runtime.setFrameCount(4);
    runtime.requestFrame(0);
    pending.get(0).resolve({ frame: 0 });
    await flush();
    assert.deepEqual(events, [['activate', 0, 0, null]]);

    runtime.requestFrame(1);
    await flush();
    assert.deepEqual(
        events,
        [['activate', 0, 0, null]],
        'current frame must remain active while the requested frame is still loading'
    );

    pending.get(1).resolve({ frame: 1 });
    await flush();
    assert.deepEqual(
        events,
        [['activate', 0, 0, null], ['activate', 1, 1, 0]],
        'new frame should replace current only after it is fully loaded'
    );
}

{
    const events = [];
    const runtime = new PlySequenceClipRuntime({
        loader: async (frame) => ({ frame }),
        activate: (frame, value, previousValue) => {
            events.push(['activate', frame, value.frame, previousValue?.frame ?? null]);
        },
        dispose: (value) => {
            events.push(['dispose', value.frame]);
        },
        maxResidentFrames: 2
    });

    runtime.setFrameCount(4);
    await runtime.showFrameAsync(0);
    await runtime.showFrameAsync(1);
    await runtime.showFrameAsync(2);

    const activations = events.filter(event => event[0] === 'activate');
    assert.deepEqual(activations, [
        ['activate', 0, 0, null],
        ['activate', 1, 1, 0],
        ['activate', 2, 2, 1]
    ]);
    assert.ok(events.some(event => event[0] === 'dispose' && event[1] === 0), 'old hidden frames should be evicted after the replacement is active');
    assert.ok(!events.some(event => event[0] === 'dispose' && event[1] === 2), 'active frame must never be evicted');
}

{
    const events = [];
    const activationGate = deferred();
    const runtime = new PlySequenceClipRuntime({
        loader: async (frame) => ({ frame }),
        activate: async (frame, value, previousValue) => {
            events.push(['activate-start', frame, value.frame, previousValue?.frame ?? null]);
            if (frame === 1) {
                await activationGate.promise;
            }
            events.push(['activate-end', frame]);
        },
        dispose: (value) => {
            events.push(['dispose', value.frame]);
        },
        maxResidentFrames: 1
    });

    runtime.setFrameCount(3);
    await runtime.showFrameAsync(0);
    const frameOne = runtime.showFrameAsync(1);
    await flush();
    assert.ok(!events.some(event => event[0] === 'dispose' && event[1] === 0), 'previous frame must stay resident while activation is still waiting for the first render');
    activationGate.resolve();
    await frameOne;
    assert.ok(events.some(event => event[0] === 'dispose' && event[1] === 0), 'previous frame can be evicted only after activation completes');
}

rmSync(outDir, { recursive: true, force: true });
console.log('PLY sequence clip runtime tests passed');
