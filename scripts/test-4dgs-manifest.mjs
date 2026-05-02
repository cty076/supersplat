import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-4dgs-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
    'tsc',
    'src/4dgs-manifest.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/4dgs-manifest.js`));

const validManifest = {
    format: '4dgs-baked-sequence',
    version: 1,
    sceneName: 'bouncingballs',
    frameCount: 3,
    frameRate: 30,
    framePattern: 'frames/time_%05d.ply'
};

assert.equal(mod.parseFourDGSManifest(validManifest).sceneName, 'bouncingballs');
assert.throws(() => mod.parseFourDGSManifest({ ...validManifest, format: 'other' }), /Unsupported 4DGS package format/);
assert.throws(() => mod.parseFourDGSManifest({ ...validManifest, version: 2 }), /Unsupported 4DGS package version/);

const files = [
    { filename: 'frames/time_00002.ply', file: new File(['2'], 'time_00002.ply') },
    { filename: 'manifest.json', file: new File(['{}'], 'manifest.json') },
    { filename: 'frames/time_00000.ply', file: new File(['0'], 'time_00000.ply') },
    { filename: 'frames/time_00001.ply', file: new File(['1'], 'time_00001.ply') }
];

const frames = mod.collectFourDGSFrames(files, validManifest);
assert.deepEqual(frames.map((file) => file.name), ['time_00000.ply', 'time_00001.ply', 'time_00002.ply']);

const sources = mod.collectFourDGSFrameSources(files, validManifest);
assert.deepEqual(
    sources.map((source) => ({ filename: source.filename, contentsName: source.contents.name })),
    [
        { filename: 'frames/time_00000.ply', contentsName: 'time_00000.ply' },
        { filename: 'frames/time_00001.ply', contentsName: 'time_00001.ply' },
        { filename: 'frames/time_00002.ply', contentsName: 'time_00002.ply' }
    ],
    'frame sources should keep the package-relative filename for loader base-url resolution'
);

const urlSources = mod.createFourDGSFrameUrlSources('app://4dgs-viewer/__smoke_4dgs__/manifest.json', validManifest);
assert.deepEqual(
    urlSources,
    [
        {
            filename: 'frames/time_00000.ply',
            url: 'app://4dgs-viewer/__smoke_4dgs__/frames/time_00000.ply'
        },
        {
            filename: 'frames/time_00001.ply',
            url: 'app://4dgs-viewer/__smoke_4dgs__/frames/time_00001.ply'
        },
        {
            filename: 'frames/time_00002.ply',
            url: 'app://4dgs-viewer/__smoke_4dgs__/frames/time_00002.ply'
        }
    ],
    'URL manifests should create frame URLs from framePattern relative to the manifest URL'
);

assert.throws(
    () => mod.collectFourDGSFrames(files.slice(0, 3), validManifest),
    /Expected 3 frame files/
);
assert.throws(
    () => mod.createFourDGSFrameUrlSources('https://example.test/manifest.json', { ...validManifest, framePattern: 'frames/time.ply' }),
    /framePattern/
);

rmSync(outDir, { recursive: true, force: true });
console.log('4DGS manifest tests passed');
