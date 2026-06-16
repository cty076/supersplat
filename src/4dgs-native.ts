type Native4DGSMotionEncoding = 'float32-le' | 'float16-le' | 'property-delta-v3';
type Native4DGSMotionLayout = 'keyframes-points-xyz' | 'keyframes-points-channels';
type Native4DGSMotionChannel = 'xyz' | 'scale' | 'rotation';
type Native4DGSFormat = '4dgs-native-trajectory' | '4dgs-native-motion';

type Native4DGSPropertyRecord = {
    name: string;
    dtype: 'int8' | 'int16';
    mode: 'constant' | 'delta';
    index: number;
    scale: number[];
    payloadOffset: number;
    payloadBytes: number;
};

type Native4DGSManifest = {
    format: Native4DGSFormat;
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
    propertyRecords?: Native4DGSPropertyRecord[];
    motionCodec?: 'raw' | 'zlib';
    motionFormat?: 'property-delta-v3';
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

type Native4DGSDenseMotionSource = {
    kind: 'dense';
    keyframes: Float32Array;
};

type Native4DGSPropertyDeltaMotionSource = {
    kind: 'property-delta';
    manifest: Native4DGSManifest;
    records: Map<string, Native4DGSPropertyRecord>;
    readers: Map<string, (index: number) => number>;
    payload: Uint8Array;
};

type Native4DGSMotionSource = Native4DGSDenseMotionSource | Native4DGSPropertyDeltaMotionSource;

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

type SampleNativeMotionSourceOptions = Omit<SampleNativeMotionOptions, 'keyframes'> & {
    source: Native4DGSMotionSource;
};

const nativeMotionChannelSizes: Record<Native4DGSMotionChannel, number> = {
    xyz: 3,
    scale: 3,
    rotation: 4
};

const nativeMotionEncodingBytes: Record<Native4DGSMotionEncoding, number> = {
    'float32-le': 4,
    'float16-le': 2,
    'property-delta-v3': 0
};

const nativeMotionEncodingLabels: Record<Native4DGSMotionEncoding, string> = {
    'float32-le': 'FP32',
    'float16-le': 'FP16',
    'property-delta-v3': 'PDELTA'
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const isNative4DGSFormat = (value: unknown): value is Native4DGSFormat => {
    return value === '4dgs-native-trajectory' || value === '4dgs-native-motion';
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

const parsePropertyRecord = (value: unknown): Native4DGSPropertyRecord => {
    if (!isRecord(value)) {
        throw new Error('Invalid native 4DGS manifest: property record must be an object');
    }
    if (value.dtype !== 'int8' && value.dtype !== 'int16') {
        throw new Error('Invalid native 4DGS manifest: property record dtype must be int8 or int16');
    }
    if (value.mode !== 'constant' && value.mode !== 'delta') {
        throw new Error('Invalid native 4DGS manifest: property record mode must be constant or delta');
    }
    if (typeof value.name !== 'string' || value.name.length === 0) {
        throw new Error('Invalid native 4DGS manifest: property record name must be a non-empty string');
    }
    if (!Number.isInteger(value.index) || (value.index as number) < 0) {
        throw new Error('Invalid native 4DGS manifest: property record index must be a non-negative integer');
    }
    if (!Array.isArray(value.scale) || value.scale.length === 0 || value.scale.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Error('Invalid native 4DGS manifest: property record scale must be numeric');
    }
    if (!Number.isInteger(value.payloadOffset) || (value.payloadOffset as number) < 0) {
        throw new Error('Invalid native 4DGS manifest: property record payloadOffset must be a non-negative integer');
    }
    if (!Number.isInteger(value.payloadBytes) || (value.payloadBytes as number) < 0) {
        throw new Error('Invalid native 4DGS manifest: property record payloadBytes must be a non-negative integer');
    }

    return {
        name: value.name,
        dtype: value.dtype,
        mode: value.mode,
        index: value.index as number,
        scale: value.scale as number[],
        payloadOffset: value.payloadOffset as number,
        payloadBytes: value.payloadBytes as number
    };
};

const parsePropertyDeltaManifest = (data: Record<string, unknown>): Native4DGSManifest => {
    if (data.version !== 1) {
        throw new Error('Unsupported native 4DGS package version');
    }
    if (data.motionCodec !== 'raw' && data.motionCodec !== 'zlib') {
        throw new Error('Invalid native 4DGS manifest: motionCodec must be raw or zlib');
    }
    if (data.motionFormat !== 'property-delta-v3') {
        throw new Error('Invalid native 4DGS manifest: motionFormat must be property-delta-v3');
    }
    if (!Array.isArray(data.propertyRecords) || data.propertyRecords.length === 0) {
        throw new Error('Invalid native 4DGS manifest: propertyRecords must be a non-empty array');
    }

    return {
        format: '4dgs-native-motion',
        version: 1,
        sceneName: requireString(data, 'sceneName'),
        pointCount: requirePositiveInteger(data, 'vertexCount'),
        keyframeCount: requirePositiveInteger(data, 'frameCount'),
        frameCount: requirePositiveInteger(data, 'frameCount'),
        frameRate: requirePositiveNumber(data, 'frameRate'),
        baseFile: requireString(data, 'base'),
        motionFile: requireString(data, 'motion'),
        timeMin: optionalNumber(data, 'timeMin'),
        timeMax: optionalNumber(data, 'timeMax'),
        motion: {
            encoding: 'property-delta-v3',
            layout: 'keyframes-points-channels',
            channels: ['xyz', 'scale', 'rotation']
        },
        propertyRecords: data.propertyRecords.map(parsePropertyRecord),
        motionCodec: data.motionCodec,
        motionFormat: 'property-delta-v3',
        source: parseSource(data.source)
    };
};

const parseNative4DGSManifest = (data: unknown): Native4DGSManifest => {
    if (!isRecord(data)) {
        throw new Error('Invalid native 4DGS manifest: expected object');
    }
    if (data.format === '4dgs-native-motion') {
        return parsePropertyDeltaManifest(data);
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
    if (manifest.motion.encoding === 'property-delta-v3') {
        return undefined;
    }
    return getNativeMotionFloatCount(manifest) * nativeMotionEncodingBytes[manifest.motion.encoding];
};

const formatNative4DGSMotionSummary = (manifest: Native4DGSManifest) => {
    const parts = [
        `${manifest.pointCount} pts`,
        `${manifest.keyframeCount} keys`,
        manifest.motion.channels.join('+'),
        nativeMotionEncodingLabels[manifest.motion.encoding]
    ];
    if (manifest.motionCodec) {
        parts.push(manifest.motionCodec);
    }
    if (manifest.propertyRecords) {
        parts.push(`${manifest.propertyRecords.length} props`);
    }
    return parts.join(' | ');
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
    if (encoding === 'property-delta-v3') {
        throw new Error('Use decodeNativeMotionBufferAsync for property-delta-v3 motion');
    }
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

const inflateBytes = async (buffer: ArrayBuffer, codec: 'raw' | 'zlib' = 'raw') => {
    if (codec === 'raw') {
        return new Uint8Array(buffer);
    }
    if (!('DecompressionStream' in globalThis)) {
        throw new Error('This runtime does not support zlib native 4DGS decompression');
    }
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

const createDeltaReader = (payload: Uint8Array, record: Native4DGSPropertyRecord) => {
    if (record.payloadOffset + record.payloadBytes > payload.byteLength) {
        throw new Error(`Native 4DGS property-delta payload is too short for ${record.name}`);
    }
    if (record.dtype === 'int8') {
        return (index: number) => {
            const value = payload[record.payloadOffset + index];
            return value > 127 ? value - 256 : value;
        };
    }
    const view = new DataView(payload.buffer, payload.byteOffset + record.payloadOffset, record.payloadBytes);
    return (index: number) => view.getInt16(index * 2, true);
};

const decodePropertyDeltaMotionSource = async (buffer: ArrayBuffer, manifest: Native4DGSManifest): Promise<Native4DGSPropertyDeltaMotionSource> => {
    if (!manifest.propertyRecords) {
        throw new Error('Native 4DGS property-delta manifest is missing propertyRecords');
    }
    const data = await inflateBytes(buffer, manifest.motionCodec ?? 'raw');
    const headerLength = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
    const headerText = new TextDecoder().decode(data.slice(4, 4 + headerLength));
    const header = JSON.parse(headerText) as { records: Native4DGSPropertyRecord[] };
    const records = new Map(header.records.map(record => [record.name, record]));
    const payload = data.subarray(4 + headerLength);
    const readers = new Map<string, (index: number) => number>();
    for (const record of records.values()) {
        if (record.mode !== 'constant') {
            readers.set(record.name, createDeltaReader(payload, record));
        }
    }
    return {
        kind: 'property-delta',
        manifest,
        records,
        readers,
        payload
    };
};

const samplePropertyDeltaMotionSource = (source: Native4DGSPropertyDeltaMotionSource, options: SampleNativeMotionOptions) => {
    const manifest = source.manifest;
    const channels = manifest.motion.channels;
    const stride = getNativeMotionStride(channels);
    const frameStride = manifest.pointCount * stride;
    const out = options.out;
    const clamped = Math.max(0, Math.min(1, options.time));
    const position = clamped * (manifest.keyframeCount - 1);
    const frame0 = Math.floor(position);
    const frame1 = Math.min(manifest.keyframeCount - 1, frame0 + 1);
    const alpha = position - frame0;

    if (out.length < frameStride) {
        throw new Error('Native 4DGS output buffer is too small');
    }
    out.fill(0, 0, frameStride);

    const writeProperty = (propertyName: string, channel: Native4DGSMotionChannel, component: number) => {
        const channelOffset = getNativeMotionChannelOffset(channels, channel);
        if (channelOffset < 0) {
            return;
        }
        const record = source.records.get(propertyName);
        if (!record || record.mode === 'constant') {
            return;
        }
        const readDelta = source.readers.get(record.name);
        if (!readDelta) {
            throw new Error(`Native 4DGS property-delta reader is missing for ${record.name}`);
        }
        const sampleFrame = (frame: number, point: number) => {
            if (frame === 0) {
                return 0;
            }
            return readDelta((frame - 1) * manifest.pointCount + point) * record.scale[0];
        };
        for (let point = 0; point < manifest.pointCount; point++) {
            const value0 = sampleFrame(frame0, point);
            const value1 = sampleFrame(frame1, point);
            out[point * stride + channelOffset + component] = value0 * (1 - alpha) + value1 * alpha;
        }
    };

    writeProperty('x', 'xyz', 0);
    writeProperty('y', 'xyz', 1);
    writeProperty('z', 'xyz', 2);
    writeProperty('scale_0', 'scale', 0);
    writeProperty('scale_1', 'scale', 1);
    writeProperty('scale_2', 'scale', 2);
    writeProperty('rot_0', 'rotation', 0);
    writeProperty('rot_1', 'rotation', 1);
    writeProperty('rot_2', 'rotation', 2);
    writeProperty('rot_3', 'rotation', 3);
};

const decodePropertyDeltaMotionBuffer = async (buffer: ArrayBuffer, manifest: Native4DGSManifest) => {
    const source = await decodePropertyDeltaMotionSource(buffer, manifest);
    const result = new Float32Array(getNativeMotionFloatCount(manifest));
    const frameStride = manifest.pointCount * getNativeMotionStride(manifest.motion.channels);
    const sampled = new Float32Array(frameStride);
    for (let frame = 0; frame < manifest.keyframeCount; frame++) {
        samplePropertyDeltaMotionSource(source, {
            keyframes: result,
            pointCount: manifest.pointCount,
            keyframeCount: manifest.keyframeCount,
            channels: manifest.motion.channels,
            time: manifest.keyframeCount <= 1 ? 0 : frame / (manifest.keyframeCount - 1),
            out: sampled
        });
        result.set(sampled, frame * frameStride);
    }
    return result;
};

const decodeNativeMotionSourceAsync = async (buffer: ArrayBuffer, manifest: Native4DGSManifest): Promise<Native4DGSMotionSource> => {
    if (manifest.motion.encoding === 'property-delta-v3') {
        return decodePropertyDeltaMotionSource(buffer, manifest);
    }
    return {
        kind: 'dense',
        keyframes: decodeNativeMotionBuffer(buffer, manifest.motion.encoding, getNativeMotionFloatCount(manifest))
    };
};

const decodeNativeMotionBufferAsync = async (buffer: ArrayBuffer, manifest: Native4DGSManifest) => {
    if (manifest.motion.encoding === 'property-delta-v3') {
        return decodePropertyDeltaMotionBuffer(buffer, manifest);
    }
    return decodeNativeMotionBuffer(buffer, manifest.motion.encoding, getNativeMotionFloatCount(manifest));
};

const isNativeMotionDeltaEncoded = (manifest: Native4DGSManifest) => {
    return manifest.motion.encoding === 'property-delta-v3';
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

const sampleNativeMotionSource = (options: SampleNativeMotionSourceOptions) => {
    if (options.source.kind === 'dense') {
        sampleNativeMotion({
            ...options,
            keyframes: options.source.keyframes
        });
        return;
    }
    samplePropertyDeltaMotionSource(options.source, {
        keyframes: new Float32Array(0),
        pointCount: options.pointCount,
        keyframeCount: options.keyframeCount,
        channels: options.channels,
        time: options.time,
        out: options.out
    });
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
    Native4DGSMotionChannel,
    Native4DGSMotionSource,
    Native4DGSPropertyRecord
};

export {
    parseNative4DGSManifest,
    isNative4DGSFormat,
    createNative4DGSUrlSources,
    collectNative4DGSLocalSources,
    decodeNativeMotionBuffer,
    decodeNativeMotionBufferAsync,
    decodeNativeMotionSourceAsync,
    formatNative4DGSMotionSummary,
    getNativeMotionFloatCount,
    getNativeMotionByteLength,
    getNativeMotionStride,
    getNativeMotionChannelOffset,
    isNativeMotionDeltaEncoded,
    sampleNativeMotion,
    sampleNativeMotionSource,
    sampleNativePositions
};
