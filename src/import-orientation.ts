import { getInputFormat } from '@playcanvas/splat-transform';
import { Vec3 } from 'playcanvas';

type ImportUpAxis = 'y' | 'z';

const normalizeImportUpAxis = (value: unknown): ImportUpAxis => {
    return value === 'z' ? 'z' : 'y';
};

const getBaseOrientation = (filename: string) => {
    switch (getInputFormat(filename)) {
        case 'spz':
            return new Vec3(0, 0, 0);
        case 'lcc':
            return new Vec3(90, 0, 180);
        default:
            return new Vec3(0, 0, 180);
    }
};

const getImportOrientation = (filename: string, upAxis: ImportUpAxis = 'y') => {
    const orientation = getBaseOrientation(filename);
    if (upAxis === 'z') {
        orientation.x += 90;
    }
    return orientation;
};

export type { ImportUpAxis };
export { getImportOrientation, normalizeImportUpAxis };
