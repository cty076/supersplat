import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const outDir = '.tmp-4dgs-benchmark-tests';
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/package.json`, '{"type":"module"}\n');

execFileSync('npx', [
    'tsc',
    'src/4dgs-benchmark.ts',
    '--module', 'es2022',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', outDir
], { stdio: 'inherit', shell: process.platform === 'win32' });

const mod = await import(pathToFileURL(`${process.cwd()}/${outDir}/4dgs-benchmark.js`));

const report = mod.formatBenchmarkSummary({
    sceneName: 'lego',
    packages: [{
        name: 'native-half',
        format: '4dgs-native',
        sizeBytes: 106100000,
        loadMs: 1200,
        firstFrameMs: 18.2,
        averageFps: 54.3,
        averagePsnr: 31.8,
        averageSsim: 0.9421
    }]
});

assert.match(report, /lego/);
assert.match(report, /native-half/);
assert.match(report, /4dgs-native/);

rmSync(outDir, { recursive: true, force: true });
console.log('4DGS benchmark tests passed');
