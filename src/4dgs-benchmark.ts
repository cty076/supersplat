type BenchmarkPackageFormat = 'ply' | 'compressed-ply' | '4dgs-native';

type BenchmarkPackageReport = {
    name: string;
    format: BenchmarkPackageFormat;
    sizeBytes: number;
    loadMs: number;
    firstFrameMs: number;
    averageFps: number;
    averagePsnr: number;
    averageSsim: number;
};

type BenchmarkSceneReport = {
    sceneName: string;
    packages: BenchmarkPackageReport[];
};

const formatBytes = (sizeBytes: number) => {
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
    const decimals = unit === 0 ? 0 : 2;
    return `${value.toFixed(decimals)} ${units[unit]}`;
};

const formatBenchmarkSummary = (report: BenchmarkSceneReport) => {
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

export type {
    BenchmarkPackageFormat,
    BenchmarkPackageReport,
    BenchmarkSceneReport
};
export {
    formatBenchmarkSummary,
    formatBytes
};
