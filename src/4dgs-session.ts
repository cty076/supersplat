import type { FourDGSManifest } from './4dgs-manifest';
import type { Native4DGSManifest } from './4dgs-native';
import type { ImportUpAxis } from './import-orientation';

type FourDGSSession = {
    format: '4dgs-viewer-session';
    version: 1;
    packageName: string;
    sceneName: string;
    upAxis: ImportUpAxis;
    frame: number;
    frameCount: number;
    frameRate: number;
    timeline?: unknown;
    camera?: unknown;
};

type BuildFourDGSSessionArgs = {
    manifest: FourDGSManifest | Native4DGSManifest;
    upAxis: ImportUpAxis;
    frame: number;
    timeline?: unknown;
    camera?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const normalizeSessionUpAxis = (value: unknown): ImportUpAxis => {
    return value === 'z' ? 'z' : 'y';
};

const requireString = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid 4DGS session: ${key} must be a non-empty string`);
    }
    return value;
};

const requirePositiveNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid 4DGS session: ${key} must be a positive number`);
    }
    return value;
};

const requireNonNegativeNumber = (data: Record<string, unknown>, key: string) => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid 4DGS session: ${key} must be a non-negative integer`);
    }
    return value;
};

const sessionFilename = (sceneName: string) => {
    return `${sceneName || 'scene'}.4dgs-viewer.json`;
};

const buildFourDGSSession = (args: BuildFourDGSSessionArgs): FourDGSSession => {
    const frame = Math.max(0, Math.min(args.manifest.frameCount - 1, Math.floor(args.frame)));
    const packageExtension = args.manifest.format === '4dgs-native-trajectory' ? '4dgs-native' : '4dgs';
    return {
        format: '4dgs-viewer-session',
        version: 1,
        packageName: `${args.manifest.sceneName}.${packageExtension}`,
        sceneName: args.manifest.sceneName,
        upAxis: normalizeSessionUpAxis(args.upAxis),
        frame,
        frameCount: args.manifest.frameCount,
        frameRate: args.manifest.frameRate,
        timeline: args.timeline,
        camera: args.camera
    };
};

const parseFourDGSSession = (data: unknown): FourDGSSession => {
    if (!isRecord(data)) {
        throw new Error('Invalid 4DGS session: expected object');
    }
    if (data.format !== '4dgs-viewer-session') {
        throw new Error('Unsupported 4DGS session format');
    }
    if (data.version !== 1) {
        throw new Error('Unsupported 4DGS session version');
    }

    const frameCount = requirePositiveNumber(data, 'frameCount');
    const frame = requireNonNegativeNumber(data, 'frame');
    if (frame >= frameCount) {
        throw new Error('Invalid 4DGS session: frame must be within frameCount');
    }

    return {
        format: '4dgs-viewer-session',
        version: 1,
        packageName: requireString(data, 'packageName'),
        sceneName: requireString(data, 'sceneName'),
        upAxis: normalizeSessionUpAxis(data.upAxis),
        frame,
        frameCount,
        frameRate: requirePositiveNumber(data, 'frameRate'),
        timeline: data.timeline,
        camera: data.camera
    };
};

export type { FourDGSSession, BuildFourDGSSessionArgs };
export { buildFourDGSSession, parseFourDGSSession, sessionFilename };
