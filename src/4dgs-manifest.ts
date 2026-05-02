type FourDGSManifest = {
    format: '4dgs-baked-sequence';
    version: 1;
    sceneName: string;
    frameCount: number;
    frameRate: number;
    framePattern: string;
    timeMin?: number;
    timeMax?: number;
    source?: {
        method?: string;
        iteration?: number;
        modelPath?: string;
        sourcePath?: string;
    };
};

type FourDGSFileEntry = {
    filename: string;
    file: File;
};

type FourDGSFrameSource = {
    filename: string;
    contents?: File;
    url?: string;
};

type OrderedFrameSource = {
    order: number;
    source: FourDGSFrameSource;
};

type FourDGSSource = NonNullable<FourDGSManifest['source']>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const requireString = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid 4DGS manifest: ${key} must be a non-empty string`);
    }
    return value;
};

const requirePositiveNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid 4DGS manifest: ${key} must be a positive number`);
    }
    return value;
};

const optionalString = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    return typeof value === 'string' ? value : undefined;
};

const optionalNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const parseSource = (value: unknown): FourDGSSource | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        method: optionalString(value, 'method'),
        iteration: optionalNumber(value, 'iteration'),
        modelPath: optionalString(value, 'modelPath'),
        sourcePath: optionalString(value, 'sourcePath')
    };
};

const parseFourDGSManifest = (data: unknown): FourDGSManifest => {
    if (!isRecord(data)) {
        throw new Error('Invalid 4DGS manifest: expected object');
    }
    if (data.format !== '4dgs-baked-sequence') {
        throw new Error('Unsupported 4DGS package format');
    }
    if (data.version !== 1) {
        throw new Error('Unsupported 4DGS package version');
    }

    return {
        format: '4dgs-baked-sequence',
        version: 1,
        sceneName: requireString(data, 'sceneName'),
        frameCount: requirePositiveNumber(data, 'frameCount'),
        frameRate: requirePositiveNumber(data, 'frameRate'),
        framePattern: requireString(data, 'framePattern'),
        timeMin: typeof data.timeMin === 'number' ? data.timeMin : undefined,
        timeMax: typeof data.timeMax === 'number' ? data.timeMax : undefined,
        source: parseSource(data.source)
    };
};

const frameRegex = /(?:^|[/\\])time_(\d+)(?:\.compressed)?\.ply$/;
const framePatternTokenRegex = /%0?(\d*)d/;

const normalizePackagePath = (filename: string) => {
    return filename.replace(/\\/g, '/');
};

const collectFourDGSFrameSources = (files: FourDGSFileEntry[], manifest: FourDGSManifest): FourDGSFrameSource[] => {
    const frames = files
    .map((entry): OrderedFrameSource | null => {
        const normalized = normalizePackagePath(entry.filename);
        const match = normalized.toLowerCase().match(frameRegex);
        return match ? {
            order: parseInt(match[1], 10),
            source: {
                filename: normalized,
                contents: entry.file
            }
        } : null;
    })
    .filter((entry): entry is OrderedFrameSource => !!entry)
    .sort((a, b) => a.order - b.order);

    if (frames.length !== manifest.frameCount) {
        throw new Error(`Expected ${manifest.frameCount} frame files but found ${frames.length}`);
    }

    return frames.map(frame => frame.source);
};

const collectFourDGSFrames = (files: FourDGSFileEntry[], manifest: FourDGSManifest): File[] => {
    return collectFourDGSFrameSources(files, manifest).map(frame => frame.contents);
};

const formatFramePattern = (framePattern: string, frame: number) => {
    const match = framePattern.match(framePatternTokenRegex);
    if (!match) {
        throw new Error('Invalid 4DGS manifest: framePattern must contain a printf-style %d token');
    }

    const width = match[1] ? parseInt(match[1], 10) : 0;
    const frameText = width > 0 ? frame.toString().padStart(width, '0') : frame.toString();
    return normalizePackagePath(framePattern.replace(framePatternTokenRegex, frameText));
};

const createFourDGSFrameUrlSources = (manifestUrl: string, manifest: FourDGSManifest): FourDGSFrameSource[] => {
    const baseUrl = new URL('.', manifestUrl);
    const sources: FourDGSFrameSource[] = [];
    for (let frame = 0; frame < manifest.frameCount; frame++) {
        const filename = formatFramePattern(manifest.framePattern, frame);
        sources.push({
            filename,
            url: new URL(filename, baseUrl).toString()
        });
    }
    return sources;
};

export type {
    FourDGSManifest,
    FourDGSFileEntry,
    FourDGSFrameSource
};

export {
    parseFourDGSManifest,
    collectFourDGSFrames,
    collectFourDGSFrameSources,
    createFourDGSFrameUrlSources
};
