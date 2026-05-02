type FrameLoader<T> = (frame: number) => Promise<T>;
type FrameActivator<T> = (frame: number, value: T, previousValue: T | null) => void | Promise<void>;
type FrameDisposer<T> = (value: T) => void;

type PlySequenceRuntimeOptions<T> = {
    loader: FrameLoader<T>;
    activate: FrameActivator<T>;
    dispose: FrameDisposer<T>;
    getPlaybackActive?: () => boolean;
    maxResidentFrames?: number;
};

type ResidentFrame<T> = {
    frame: number;
    promise: Promise<T>;
    value: T | null;
    generation: number;
    lastUsed: number;
    disposed: boolean;
};

class PlySequenceRuntime<T> {
    private frameCount = 0;
    private generation = 0;
    private entries = new Map<number, ResidentFrame<T>>();
    private requestedFrame = -1;
    private primaryLoadFrame = -1;
    private primaryLoadPromise: Promise<void> | null = null;
    private useCounter = 0;
    private currentValue: T | null = null;
    currentFrame = -1;

    constructor(private options: PlySequenceRuntimeOptions<T>) {
    }

    setFrameCount(frameCount: number) {
        this.clear();
        this.frameCount = frameCount;
    }

    clear() {
        this.generation++;
        this.requestedFrame = -1;
        this.primaryLoadFrame = -1;
        this.primaryLoadPromise = null;
        this.currentFrame = -1;
        this.currentValue = null;

        for (const entry of this.entries.values()) {
            this.disposeEntry(entry);
        }
        this.entries.clear();
    }

    requestFrame(frame: number) {
        if (!this.isValidFrame(frame)) {
            return;
        }

        this.requestedFrame = frame;

        const ready = this.entries.get(frame);
        if (ready?.value) {
            this.activateFrame(frame, ready.value).catch(() => {});
            return;
        }

        if (this.primaryLoadFrame === -1) {
            this.startPrimaryLoad(frame);
        }
    }

    async showFrameAsync(frame: number): Promise<T | null> {
        if (!this.isValidFrame(frame)) {
            return null;
        }

        this.requestedFrame = frame;
        const entry = this.ensureEntry(frame);
        const value = await entry.promise;
        await this.activateFrame(frame, value);
        return value;
    }

    private isValidFrame(frame: number) {
        return frame >= 0 && frame < this.frameCount;
    }

    private ensureEntry(frame: number) {
        const existing = this.entries.get(frame);
        if (existing) {
            existing.lastUsed = ++this.useCounter;
            return existing;
        }

        const entry: ResidentFrame<T> = {
            frame,
            promise: null,
            value: null,
            generation: this.generation,
            lastUsed: ++this.useCounter,
            disposed: false
        };

        entry.promise = this.options.loader(frame).then((value) => {
            if (entry.disposed || entry.generation !== this.generation) {
                this.options.dispose(value);
                throw new Error('Frame load was disposed before activation');
            }

            entry.value = value;
            entry.lastUsed = ++this.useCounter;
            return value;
        });

        this.entries.set(frame, entry);
        return entry;
    }

    private startPrimaryLoad(frame: number) {
        const entry = this.ensureEntry(frame);
        this.primaryLoadFrame = frame;

        this.primaryLoadPromise = entry.promise.then(async (value) => {
            const shouldActivate =
                this.currentFrame === -1 ||
                this.requestedFrame === frame ||
                this.options.getPlaybackActive?.() === true;

            if (shouldActivate) {
                await this.activateFrame(frame, value);
            }
        }).catch(() => {
            // Import errors are surfaced by the loader path. The runtime only
            // needs to unblock the next requested frame.
        }).finally(() => {
            if (this.primaryLoadFrame === frame) {
                this.primaryLoadFrame = -1;
                this.primaryLoadPromise = null;
            }

            const nextFrame = this.requestedFrame;
            if (this.isValidFrame(nextFrame) && nextFrame !== this.currentFrame) {
                this.requestFrame(nextFrame);
            }
        });
    }

    private async activateFrame(frame: number, value: T) {
        if (frame === this.currentFrame && value === this.currentValue) {
            return;
        }

        const previousValue = this.currentValue;
        await this.options.activate(frame, value, previousValue);
        this.currentFrame = frame;
        this.currentValue = value;

        const entry = this.entries.get(frame);
        if (entry) {
            entry.lastUsed = ++this.useCounter;
        }

        this.preload(frame + 1);
        this.trimResidentFrames();
    }

    private preload(frame: number) {
        if (!this.isValidFrame(frame) || this.entries.has(frame)) {
            return;
        }

        const entry = this.ensureEntry(frame);
        entry.promise.catch(() => {
            // Background preloads are opportunistic.
        });
    }

    private trimResidentFrames() {
        const maxResidentFrames = this.options.maxResidentFrames ?? 5;
        const protectedFrames = new Set([
            this.currentFrame,
            this.requestedFrame,
            this.primaryLoadFrame
        ]);

        const evictable = Array.from(this.entries.values())
        .filter(entry => entry.value && !protectedFrames.has(entry.frame))
        .sort((a, b) => a.lastUsed - b.lastUsed);

        while (this.entries.size > maxResidentFrames && evictable.length > 0) {
            const entry = evictable.shift();
            this.disposeEntry(entry);
            this.entries.delete(entry.frame);
        }
    }

    private disposeEntry(entry: ResidentFrame<T>) {
        if (entry.disposed) {
            return;
        }

        entry.disposed = true;
        if (entry.value) {
            this.options.dispose(entry.value);
            entry.value = null;
        } else {
            entry.promise.catch(() => {}).then((value) => {
                if (value) {
                    this.options.dispose(value);
                }
            });
        }
    }
}

export { PlySequenceRuntime };
export type { PlySequenceRuntimeOptions };
