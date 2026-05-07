import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

const BENCHMARK_REFERENCE_URL = 'app://4dgs-viewer/__benchmark_reference__/';

const formatBytes = (sizeBytes) => {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = sizeBytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
};

const formatBenchmarkSummary = (report) => {
    const lines = [
        `Scene: ${report.sceneName}`,
        'Name | Format | Size | Load | First Frame | FPS | PSNR | SSIM',
        '--- | --- | ---: | ---: | ---: | ---: | ---: | ---:'
    ];

    for (const pkg of report.packages) {
        lines.push([
            pkg.name,
            pkg.format,
            formatBytes(pkg.sizeBytes),
            `${pkg.loadMs.toFixed(1)} ms`,
            `${pkg.firstFrameMs.toFixed(1)} ms`,
            pkg.averageFps.toFixed(1),
            pkg.averagePsnr.toFixed(2),
            pkg.averageSsim.toFixed(4)
        ].join(' | '));
    }

    return lines.join('\n');
};

const resolveBenchmarkOutputName = (value) => {
    const stripped = value
    .replace(/\.4dgs-native$/i, '')
    .replace(/\.compressed\.ply$/i, '')
    .replace(/\.ply$/i, '');

    return stripped
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'benchmark';
};

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

const resolveManifestPath = (argv) => {
    const manifestArg = argv.find((value) => !value.startsWith('--'));
    if (!manifestArg) {
        throw new Error('Usage: node scripts/run-4dgs-benchmark.mjs <manifest.json> [--output-dir <dir>]');
    }
    return resolve(ROOT, manifestArg);
};

const resolveOutputDir = (argv, manifestPath) => {
    const outputIndex = argv.indexOf('--output-dir');
    if (outputIndex >= 0 && argv[outputIndex + 1]) {
        return resolve(ROOT, argv[outputIndex + 1]);
    }
    return join(dirname(manifestPath), 'results', resolveBenchmarkOutputName(manifestPath.replace(/.*[\\/]/, '').replace(/\.json$/i, '')));
};

const collectDirectorySize = (targetPath) => {
    const stats = statSync(targetPath);
    if (stats.isFile()) {
        return stats.size;
    }

    let total = 0;
    for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
        total += collectDirectorySize(join(targetPath, entry.name));
    }
    return total;
};

const normalizePackageFormat = (value) => {
    if (value !== 'ply' && value !== 'compressed-ply' && value !== '4dgs-native') {
        throw new Error(`Unsupported package format: ${value}`);
    }
    return value;
};

const normalizePackageMode = (value) => {
    if (value !== 'single' && value !== 'sequence' && value !== 'native') {
        throw new Error(`Unsupported package mode: ${value}`);
    }
    return value;
};

const loadBenchmarkManifest = (manifestPath) => {
    const manifest = readJson(manifestPath);
    if (typeof manifest.sceneName !== 'string' || !manifest.sceneName) {
        throw new Error('Benchmark manifest must include a sceneName');
    }
    if (typeof manifest.referenceRoot !== 'string' || !manifest.referenceRoot) {
        throw new Error('Benchmark manifest must include a referenceRoot');
    }
    if (!Array.isArray(manifest.packages) || !manifest.packages.length) {
        throw new Error('Benchmark manifest must include at least one package');
    }

    const manifestDir = dirname(manifestPath);
    const referenceRoot = resolve(manifestDir, manifest.referenceRoot);

    const packages = manifest.packages.map((entry, index) => {
        if (typeof entry.name !== 'string' || !entry.name) {
            throw new Error(`Package ${index} is missing name`);
        }
        const packageRoot = resolve(manifestDir, entry.packageRoot);
        const format = normalizePackageFormat(entry.format);
        const packageMode = normalizePackageMode(entry.packageMode ?? (format === '4dgs-native' ? 'native' : 'sequence'));
        const width = Number(entry.width);
        const height = Number(entry.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error(`Package ${entry.name} must define positive width and height`);
        }
        if (!Array.isArray(entry.frames) || !entry.frames.length) {
            throw new Error(`Package ${entry.name} must define at least one frame`);
        }

        const frames = entry.frames.map((frame, frameIndex) => {
            if (!Number.isInteger(frame.frame) || frame.frame < 0) {
                throw new Error(`Package ${entry.name} frame ${frameIndex} is missing a valid frame index`);
            }
            if (typeof frame.referenceFile !== 'string' || !frame.referenceFile) {
                throw new Error(`Package ${entry.name} frame ${frameIndex} is missing referenceFile`);
            }
            return {
                frame: frame.frame,
                referenceFile: frame.referenceFile
            };
        });

        return {
            name: entry.name,
            format,
            packageMode,
            packageRoot,
            loadUrl: typeof entry.loadUrl === 'string' && entry.loadUrl ? entry.loadUrl : null,
            loadFilename: typeof entry.loadFilename === 'string' && entry.loadFilename ? entry.loadFilename : null,
            referenceRoot,
            width,
            height,
            frames
        };
    });

    return {
        sceneName: manifest.sceneName,
        referenceRoot,
        packages
    };
};

const ensureBuild = () => {
    const distIndex = join(ROOT, 'dist', 'index.html');
    if (existsSync(distIndex)) {
        return;
    }

    console.log('Benchmark runner: dist/index.html missing, building viewer first');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
};

const spawnElectronBenchmark = (packageEntry, reportPath) => {
    const electronCommand = process.platform === 'win32'
        ? join(ROOT, 'node_modules', '.bin', 'electron.cmd')
        : join(ROOT, 'node_modules', '.bin', 'electron');
    const command = process.platform === 'win32' ? 'cmd.exe' : electronCommand;
    const args = process.platform === 'win32' ? ['/c', electronCommand, '.'] : ['.'];
    const loadUrl = packageEntry.loadUrl ?? (
        packageEntry.format === '4dgs-native'
            ? `app://4dgs-viewer/__local_4dgs_package__/manifest.json`
            : pathToFileURL(packageEntry.packageRoot).toString()
    );
    const loadFilename = packageEntry.loadFilename ?? (
        packageEntry.format === '4dgs-native'
            ? 'manifest.json'
            : basename(packageEntry.packageRoot)
    );
    const env = {
        ...process.env,
        ELECTRON_BENCHMARK_SPEC: JSON.stringify({
            sceneName: packageEntry.sceneName,
            packageName: packageEntry.name,
            packageMode: packageEntry.packageMode,
            width: packageEntry.width,
            height: packageEntry.height,
            frames: packageEntry.frames,
            referenceRootUrl: BENCHMARK_REFERENCE_URL
        }),
        ELECTRON_BENCHMARK_LOAD_URL: loadUrl,
        ELECTRON_BENCHMARK_LOAD_FILENAME: loadFilename,
        ELECTRON_BENCHMARK_REFERENCE_ROOT: packageEntry.referenceRoot,
        ELECTRON_BENCHMARK_OUTPUT: reportPath,
        ELECTRON_SMOKE_TEST_PACKAGE: packageEntry.format === '4dgs-native' ? packageEntry.packageRoot : ''
    };

    const result = spawnSync(command, args, {
        cwd: ROOT,
        env,
        stdio: 'inherit',
        shell: false
    });

    if (result.status !== 0) {
        throw new Error(`Electron benchmark failed for ${packageEntry.name}`);
    }

    return readJson(reportPath);
};

const runBenchmark = (manifestPath, outputDir) => {
    ensureBuild();
    const manifest = loadBenchmarkManifest(manifestPath);
    mkdirSync(outputDir, { recursive: true });

    const packageReports = [];
    const packageDir = join(outputDir, 'packages');
    mkdirSync(packageDir, { recursive: true });

    for (const packageEntry of manifest.packages) {
        const packageSizeBytes = collectDirectorySize(packageEntry.packageRoot);
        const reportPath = join(packageDir, `${resolveBenchmarkOutputName(packageEntry.name)}.json`);
        console.log(`Benchmark runner: ${packageEntry.name} (${packageEntry.format})`);
        const packageReport = spawnElectronBenchmark(packageEntry, reportPath);
        packageReports.push({
            name: packageEntry.name,
            ...packageReport,
            format: packageEntry.format,
            sizeBytes: packageSizeBytes,
            packageRoot: packageEntry.packageRoot
        });
    }

    const summary = {
        sceneName: manifest.sceneName,
        generatedAt: new Date().toISOString(),
        sourceManifest: manifestPath,
        packages: packageReports
    };

    const summaryJsonPath = join(outputDir, 'benchmark-report.json');
    const summaryMdPath = join(outputDir, 'benchmark-report.md');
    writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
    writeFileSync(summaryMdPath, `${formatBenchmarkSummary(summary)}\n`);

    console.log(`Benchmark summary written to ${summaryJsonPath}`);
    console.log(`Benchmark markdown written to ${summaryMdPath}`);
    console.log(formatBenchmarkSummary(summary));

    return summary;
};

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
    const argv = process.argv.slice(2);
    try {
        const manifestPath = resolveManifestPath(argv);
        const outputDir = resolveOutputDir(argv, manifestPath);
        runBenchmark(manifestPath, outputDir);
    } catch (error) {
        console.error(error?.message ?? error);
        process.exit(1);
    }
}

export {
    formatBenchmarkSummary,
    loadBenchmarkManifest,
    resolveBenchmarkOutputName,
    runBenchmark
};
