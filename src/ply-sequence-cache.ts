type FrameLoader<T> = (frame: number) => Promise<T>;
type FrameDisposer<T> = (value: T) => void;

type CacheEntry<T> = {
    frame: number;
    promise: Promise<T>;
    state: 'cached' | 'taken' | 'disposed';
};

class PlySequenceFrameCache<T> {
    private entries = new Map<number, CacheEntry<T>>();

    constructor(
        private loader: FrameLoader<T>,
        private disposer: FrameDisposer<T>,
        private maxEntries = 2
    ) {
    }

    private disposeEntry(entry: CacheEntry<T>) {
        if (entry.state !== 'cached') {
            return;
        }

        entry.state = 'disposed';
        this.entries.delete(entry.frame);
        entry.promise.then((value) => {
            this.disposer(value);
        }).catch(() => {
            // The original caller handles load failures. Disposing a failed
            // preload has nothing useful to release.
        });
    }

    private enforceLimit() {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.values().next().value as CacheEntry<T> | undefined;
            if (!oldest) {
                return;
            }
            this.disposeEntry(oldest);
        }
    }

    preload(frame: number) {
        if (this.entries.has(frame)) {
            return;
        }

        const entry: CacheEntry<T> = {
            frame,
            state: 'cached',
            promise: this.loader(frame)
        };
        entry.promise.catch(() => {
            // Background preloads may fail without being taken. Keep the
            // original promise intact so a later take still observes the error.
        });
        this.entries.set(frame, entry);
        this.enforceLimit();
    }

    take(frame: number) {
        if (!this.entries.has(frame)) {
            this.preload(frame);
        }

        const entry = this.entries.get(frame)!;
        entry.state = 'taken';
        this.entries.delete(frame);
        return entry.promise;
    }

    clear() {
        for (const entry of Array.from(this.entries.values())) {
            this.disposeEntry(entry);
        }
        this.entries.clear();
    }
}

export { PlySequenceFrameCache };
