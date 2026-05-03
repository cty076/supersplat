type Native4DGSMotionEncoding = 'float32-le' | 'float16-le';
type Native4DGSMotionLayout = 'keyframes-points-xyz' | 'keyframes-points-channels';
type Native4DGSMotionChannel = 'xyz' | 'scale' | 'rotation';

type Native4DGSManifest = {
    format: '4dgs-native-trajectory';
    version: 1;
    sceneName: string;
    pointCount: number;
    keyframeCount: number;
    frameCount: number;
    frameRate: number;
    baseFile: string;
    motionFile: string;
    timeMin?: number;
    timeMax?: number;
    motion: {
        encoding: Native4DGSMotionEncoding;
        layout: Native4DGSMotionLayout;
        channels: Native4DGSMotionChannel[];
    };
    source?: {
        method?: string;
        iteration?: number;
        modelPath?: string;
    };
};

type Native4DGSFileSource = {
    filename: string;
    contents?: File;
    url?: string;
};

type Native4DGSSources = {
    base: Native4DGSFileSource;
    motion: Native4DGSFileSource;
};

type SampleNativePositionsOptions = {
    keyframes: Float32Array;
    pointCount: number;
    keyframeCount: number;
    time: number;
    out: Float32Array;
};

type SampleNativeMotionOptions = SampleNativePositionsOptions & {
    channels: Native4DGSMotionChannel[];
};

const nativeMotionChannelSizes: Record<Native4DGSMotionChannel, number> = {
    xyz: 3,
    scale: 3,
    rotation: 4
};

const nativeMotionEncodingBytes: Record<Native4DGSMotionEncoding, number> = {
    'float32-le': 4,
    'float16-le': 2
};

const nativeMotionEncodingLabels: Record<Native4DGSMotionEncoding, string> = {
    'float32-le': 'FP32',
    'float16-le': 'FP16'
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const requireString = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid native 4DGS manifest: ${key} must be a non-empty string`);
    }
    return value;
};

const requirePositiveInteger = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new Error(`Invalid native 4DGS manifest: ${key} must be a positive integer`);
    }
    return value as number;
};

const requirePositiveNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid native 4DGS manifest: ${key} must be a positive number`);
    }
    return value;
};

const optionalNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const optionalString = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    return typeof value === 'string' ? value : undefined;
};

const parseSource = (value: unknown): Native4DGSManifest['source'] | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        method: optionalString(value, 'method'),
        iteration: optionalNumber(value, 'iteration'),
        modelPath: optionalString(value, 'modelPath')
    };
};

const parseMotion = (value: unknown): Native4DGSManifest['motion'] => {
    if (!isRecord(value)) {
        throw new Error('Invalid native 4DGS manifest: motion must be an object');
    }

    if (value.encoding !== 'float32-le' && value.encoding !== 'float16-le') {
        throw new Error('Invalid native 4DGS manifest: motion.encoding must be float32-le or float16-le');
    }
    if (value.layout !== 'keyframes-points-xyz' && value.layout !== 'keyframes-points-channels') {
        throw new Error('Invalid native 4DGS manifest: motion.layout must be keyframes-points-xyz or keyframes-points-channels');
    }
    if (!Array.isArray(value.channels) || value.channels.length === 0) {
        throw new Error('Invalid native 4DGS manifest: motion.channels must be a non-empty array');
    }
    const channels = value.channels.map((channel) => {
        if (channel !== 'xyz' && channel !== 'scale' && channel !== 'rotation') {
            throw new Error('Invalid native 4DGS manifest: unsupported motion channel');
        }
        return channel;
    });
    if (channels[0] !== 'xyz') {
        throw new Error('Invalid native 4DGS manifest: first motion channel must be xyz');
    }
    if (new Set(channels).size !== channels.length) {
        throw new Error('Invalid native 4DGS manifest: duplicate motion channels are not supported');
    }
    if (value.layout === 'keyframes-points-xyz' && (channels.length !== 1 || channels[0] !== 'xyz')) {
        throw new Error('Invalid native 4DGS manifest: keyframes-points-xyz layout only supports ["xyz"]');
    }

    return {
        encoding: value.encoding,
        layout: value.layout,
        channels
    };
};

const parseNative4DGSManifest = (data: unknown): Native4DGSManifest => {
    if (!isRecord(data)) {
        throw new Error('Invalid native 4DGS manifest: expected object');
    }
    if (data.format !== '4dgs-native-trajectory') {
        throw new Error('Unsupported native 4DGS package format');
    }
    if (data.version !== 1) {
        throw new Error('Unsupported native 4DGS package version');
    }

    return {
        format: '4dgs-native-trajectory',
        version: 1,
        sceneName: requireString(data, 'sceneName'),
        pointCount: requirePositiveInteger(data, 'pointCount'),
        keyframeCount: requirePositiveInteger(data, 'keyframeCount'),
        frameCount: requirePositiveInteger(data, 'frameCount'),
        frameRate: requirePositiveNumber(data, 'frameRate'),
        baseFile: requireString(data, 'baseFile'),
        motionFile: requireString(data, 'motionFile'),
        timeMin: optionalNumber(data, 'timeMin'),
        timeMax: optionalNumber(data, 'timeMax'),
        motion: parseMotion(data.motion),
        source: parseSource(data.source)
    };
};

const createNative4DGSUrlSources = (manifestUrl: string, files: { baseFile: string; motionFile: string }): Native4DGSSources => {
    const baseUrl = new URL('.', manifestUrl);
    return {
        base: {
            filename: files.baseFile,
            url: new URL(files.baseFile, baseUrl).toString()
        },
        motion: {
            filename: files.motionFile,
            url: new URL(files.motionFile, baseUrl).toString()
        }
    };
};

const normalizeNativePackageFilename = (filename: string) => {
    return filename.replace(/\\/g, '/').replace(/^\/+/, '');
};

const collectNative4DGSLocalSources = (
    files: Native4DGSFileSource[],
    manifestFile: Native4DGSFileSource,
    manifest: Pick<Native4DGSManifest, 'baseFile' | 'motionFile'>
): Native4DGSSources => {
    const manifestName = normalizeNativePackageFilename(manifestFile.filename);
    const manifestPrefix = manifestName.endsWith('manifest.json') ? manifestName.slice(0, -'manifest.json'.length) : '';

    const resolveLocal = (relativeFilename: string) => {
        const expected = normalizeNativePackageFilename(`${manifestPrefix}${relativeFilename}`).toLowerCase();
        const suffix = normalizeNativePackageFilename(relativeFilename).toLowerCase();
        const file = files.find((candidate) => {
            const normalized = normalizeNativePackageFilename(candidate.filename).toLowerCase();
            return normalized === expected || normalized.endsWith(`/${suffix}`);
        });
        if (!file) {
            throw new Error(`Native 4DGS package is missing ${relativeFilename}`);
        }
        return file;
    };

    return {
        base: resolveLocal(manifest.baseFile),
        motion: resolveLocal(manifest.motionFile)
    };
};

const getNativeMotionStride = (channels: Native4DGSMotionChannel[]) => {
    return channels.reduce((sum, channel) => sum + nativeMotionChannelSizes[channel], 0);
};

const getNativeMotionFloatCount = (manifest: Native4DGSManifest) => {
    return manifest.pointCount * manifest.keyframeCount * getNativeMotionStride(manifest.motion.channels);
};

const getNativeMotionByteLength = (manifest: Native4DGSManifest) => {
    return getNativeMotionFloatCount(manifest) * nativeMotionEncodingBytes[manifest.motion.encoding];
};

const formatNative4DGSMotionSummary = (manifest: Native4DGSManifest) => {
    return `${manifest.pointCount} pts | ${manifest.keyframeCount} keys | ${manifest.motion.channels.join('+')} | ${nativeMotionEncodingLabels[manifest.motion.encoding]}`;
};

const halfFloatToNumber = (value: number) => {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;

    if (exponent === 0) {
        return sign * (fraction === 0 ? 0 : Math.pow(2, -14) * (fraction / 1024));
    }
    if (exponent === 0x1f) {
        return fraction === 0 ? sign * Infinity : NaN;
    }
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
};

const decodeNativeMotionBuffer = (buffer: ArrayBuffer, encoding: Native4DGSMotionEncoding, expectedFloats?: number) => {
    const byteLength = expectedFloats === undefined ? buffer.byteLength : expectedFloats * nativeMotionEncodingBytes[encoding];
    if (buffer.byteLength !== byteLength) {
        throw new Error(`Native 4DGS motion buffer has ${buffer.byteLength} bytes, expected ${byteLength}`);
    }

    if (encoding === 'float32-le') {
        return new Float32Array(buffer);
    }

    const source = new Uint16Array(buffer);
    const result = new Float32Array(source.length);
    for (let i = 0; i < source.length; i++) {
        result[i] = halfFloatToNumber(source[i]);
    }
    return result;
};

const getNativeMotionChannelOffset = (channels: Native4DGSMotionChannel[], target: Native4DGSMotionChannel) => {
    let offset = 0;
    for (const channel of channels) {
        if (channel === target) {
            return offset;
        }
        offset += nativeMotionChannelSizes[channel];
    }
    return -1;
};

const sampleNativeMotion = (options: SampleNativeMotionOptions) => {
    const { keyframes, pointCount, keyframeCount, channels, time, out } = options;
    const pointStride = getNativeMotionStride(channels);
    const frameStride = pointCount * pointStride;
    const clamped = Math.max(0, Math.min(1, time));
    const position = clamped * (keyframeCount - 1);
    const frame0 = Math.floor(position);
    const frame1 = Math.min(keyframeCount - 1, frame0 + 1);
    const alpha = position - frame0;
    const offset0 = frame0 * frameStride;
    const offset1 = frame1 * frameStride;

    if (out.length < frameStride) {
        throw new Error('Native 4DGS output buffer is too small');
    }
    if (keyframes.length < keyframeCount * frameStride) {
        throw new Error('Native 4DGS keyframe buffer is too small');
    }

    for (let i = 0; i < frameStride; i++) {
        out[i] = keyframes[offset0 + i] * (1 - alpha) + keyframes[offset1 + i] * alpha;
    }
};

const sampleNativePositions = (options: SampleNativePositionsOptions) => {
    sampleNativeMotion({
        ...options,
        channels: ['xyz']
    });
};

export type {
    Native4DGSManifest,
    Native4DGSSources,
    Native4DGSFileSource,
    Native4DGSMotionChannel
};

export {
    parseNative4DGSManifest,
    createNative4DGSUrlSources,
    collectNative4DGSLocalSources,
    decodeNativeMotionBuffer,
    formatNative4DGSMotionSummary,
    getNativeMotionFloatCount,
    getNativeMotionByteLength,
    getNativeMotionStride,
    getNativeMotionChannelOffset,
    sampleNativeMotion,
    sampleNativePositions
};
