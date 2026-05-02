type DisplayLoadedFrameOptions = {
    requestedFrame: number;
    queuedFrame: number;
    loadGeneration: number;
    currentGeneration: number;
};

const shouldDisplayLoadedFrame = ({
    requestedFrame,
    queuedFrame,
    loadGeneration,
    currentGeneration
}: DisplayLoadedFrameOptions) => {
    if (loadGeneration !== currentGeneration) {
        return false;
    }

    return queuedFrame === -1 || queuedFrame === requestedFrame;
};

export { shouldDisplayLoadedFrame };
export type { DisplayLoadedFrameOptions };
