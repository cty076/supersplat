import { Asset, BoundingBox, Color, GSplatResource, Quat, Vec3 } from 'playcanvas';

import type { FourDGSFrameSource } from './4dgs-manifest';
import { Element, ElementType } from './element';
import { Events } from './events';
import { getImportOrientation, normalizeImportUpAxis, type ImportUpAxis } from './import-orientation';
import { PlySequenceClipRuntime } from './ply-sequence-clip-runtime';
import { Serializer } from './serializer';
import { Splat } from './splat';
import { Transform } from './transform';

type ClipFrame = {
    frame: number;
    asset: Asset;
};

type ImportFile = {
    filename: string;
    url?: string;
    contents?: File;
};

const identityMatrixData = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);

class PlySequenceClip extends Element {
    entity: Splat['entity'] | null = null;
    name = '4DGS Clip';
    numSplats = 0;
    visible = true;
    tintClr = new Color(1, 1, 1);
    temperature = 0;
    saturation = 1;
    brightness = 0;
    blackPoint = 0;
    whitePoint = 1;
    transparency = 1;
    numDeleted = 0;
    numLocked = 0;
    numSelected = 0;
    selectionAlpha = 1;

    private files: FourDGSFrameSource[] = [];
    private upAxis: ImportUpAxis = 'y';
    private currentAsset: Asset | null = null;
    private bufferSplats: (Splat | null)[] = [null, null];
    private bufferAssets: (Asset | null)[] = [null, null];
    private pendingDisposals = new Set<Asset>();
    private activeBuffer = 0;
    private localBoundStorage = new BoundingBox();
    private worldBoundStorage = new BoundingBox();
    private runtime: PlySequenceClipRuntime<ClipFrame>;
    private addingToScene: Promise<void> | null = null;

    constructor(private events: Events) {
        super(ElementType.splat);

        this.runtime = new PlySequenceClipRuntime<ClipFrame>({
            loader: async (frame: number) => {
                const source = this.files[frame];
                const asset = await this.events.invoke('import.gsplatAsset', [{
                    filename: source.filename,
                    contents: source.contents,
                    url: source.url
                } satisfies ImportFile], true) as Asset;
                return { frame, asset };
            },
            activate: async (frame: number, value: ClipFrame, previousValue: ClipFrame | null) => {
                await this.activateAsset(frame, value.asset, previousValue?.asset ?? null);
            },
            dispose: (value: ClipFrame) => {
                if (this.bufferAssets.includes(value.asset)) {
                    this.pendingDisposals.add(value.asset);
                } else if (value.asset !== this.currentAsset) {
                    this.disposeAsset(value.asset);
                }
            },
            maxResidentFrames: 12
        });
    }

    get activeSplat() {
        return this.bufferSplats[this.activeBuffer];
    }

    get asset() {
        return this.activeSplat?.asset ?? this.currentAsset;
    }

    get splatData() {
        return this.activeSplat?.splatData;
    }

    get stateTexture() {
        return this.activeSplat?.stateTexture;
    }

    get transformTexture() {
        return this.activeSplat?.transformTexture;
    }

    get transformPalette() {
        return this.activeSplat?.transformPalette;
    }

    get changedCounter() {
        return this.activeSplat?.changedCounter ?? 0;
    }

    get worldTransform() {
        return this.entity?.getWorldTransform();
    }

    get selectionBound() {
        return this.activeSplat?.selectionBound ?? this.localBoundStorage;
    }

    setFrames(files: FourDGSFrameSource[], upAxis?: ImportUpAxis) {
        const bufferedAssets = Array.from(new Set(this.bufferAssets.filter((asset): asset is Asset => !!asset)));
        this.files = files;
        this.upAxis = normalizeImportUpAxis(upAxis);
        this.runtime.setFrameCount(files.length);
        this.currentAsset = null;
        this.numSplats = 0;
        this.pendingDisposals.clear();
        this.bufferSplats.forEach((splat) => {
            if (splat) {
                this.removeBufferSplat(splat);
            }
        });
        this.bufferSplats = [null, null];
        this.bufferAssets = [null, null];
        bufferedAssets.forEach(asset => this.disposeAsset(asset));
        this.entity = null;
    }

    requestFrame(frame: number) {
        this.runtime.requestFrame(frame);
    }

    showFrameAsync(frame: number) {
        return this.runtime.showFrameAsync(frame);
    }

    get currentFrame() {
        return this.runtime.currentFrame;
    }

    async add() {
        for (const splat of this.bufferSplats) {
            if (splat && !splat.scene) {
                await this.addBufferSplat(splat);
            }
        }
    }

    remove() {
        this.bufferSplats.forEach((splat) => {
            if (splat) {
                this.removeBufferSplat(splat);
            }
        });
        this.scene.boundDirty = true;
    }

    destroy() {
        const splats = this.bufferSplats.filter((splat): splat is Splat => !!splat);
        this.runtime.clear();
        this.currentAsset = null;
        this.bufferSplats = [null, null];
        this.bufferAssets = [null, null];
        this.pendingDisposals.clear();
        super.destroy();
        splats.forEach(splat => splat.destroy());
    }

    serialize(serializer: Serializer) {
        serializer.packa(this.entity?.getWorldTransform().data ?? identityMatrixData);
        serializer.pack(this.currentFrame);
        serializer.pack(this.visible);
        serializer.pack(this.currentAsset?.id ?? -1);
    }

    onPreRender() {
        this.bufferSplats.forEach((splat, index) => {
            if (splat) {
                splat.visible = this.visible && !!this.bufferAssets[index];
                splat.onPreRender();
            }
        });
    }

    get worldBound() {
        return this.worldBoundStorage;
    }

    get localBound() {
        return this.localBoundStorage;
    }

    focalPoint() {
        return this.worldBound.center;
    }

    get filename() {
        return (this.currentAsset?.file as { filename?: string })?.filename ?? this.files[this.currentFrame]?.filename ?? this.name;
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) {
            this.bufferSplats.forEach(splat => splat?.entity.setLocalPosition(position));
        }
        if (rotation) {
            this.bufferSplats.forEach(splat => splat?.entity.setLocalRotation(rotation));
        }
        if (scale) {
            this.bufferSplats.forEach(splat => splat?.entity.setLocalScale(scale));
        }
        this.updateWorldBound();
        this.scene.events.fire('splat.moved', this);
    }

    getPivot(_mode: 'center' | 'boundCenter', _selection: boolean, result: Transform) {
        if (this.entity) {
            result.set(
                this.entity.getLocalPosition(),
                this.entity.getLocalRotation(),
                this.entity.getLocalScale()
            );
        }
    }

    calcSplatWorldPosition(_splatId: number, result: Vec3) {
        return this.activeSplat?.calcSplatWorldPosition(_splatId, result) ?? false;
    }

    async updateState(changedState?: number) {
        await this.activeSplat?.updateState(changedState);
        this.syncFromActiveSplat();
    }

    async updatePositions() {
        await this.activeSplat?.updatePositions();
        this.syncFromActiveSplat();
    }

    async updateLocalBounds() {
        await this.activeSplat?.updateLocalBounds();
        this.syncFromActiveSplat();
    }

    private async activateAsset(frame: number, asset: Asset, previousAsset: Asset | null) {
        const nextBuffer = this.currentAsset ? 1 - this.activeBuffer : this.activeBuffer;
        const previousBuffer = this.currentAsset ? this.activeBuffer : -1;
        const previousSplat = previousBuffer === -1 ? null : this.bufferSplats[previousBuffer];
        const nextSplat = new Splat(asset, this.files[frame] ? getImportOrientation(this.files[frame].filename, this.upAxis) : new Vec3());

        if (this.entity) {
            this.copyTransform(this.entity, nextSplat.entity);
        }
        this.bufferSplats[nextBuffer] = nextSplat;
        this.bufferAssets[nextBuffer] = asset;
        this.activeBuffer = nextBuffer;
        this.entity = nextSplat.entity;
        this.currentAsset = asset;

        await this.ensureAddedToScene();
        if (!nextSplat.scene) {
            this.addBufferSplat(nextSplat);
        }
        nextSplat.visible = this.visible;
        nextSplat.entity.enabled = this.visible;

        const resource = asset.resource as GSplatResource;
        this.numSplats = resource?.numSplats ?? 0;
        if (resource?.aabb) {
            this.localBoundStorage.copy(resource.aabb);
            this.updateWorldBound();
        }

        this.scene.forceRender = true;
        this.events.fire('plysequence.frameReady', frame);

        if (previousSplat && previousAsset) {
            this.releasePreviousBufferAfterRender(previousBuffer, previousSplat, previousAsset);
        }
    }

    private addBufferSplat(splat: Splat) {
        splat.scene = this.scene;
        return splat.add();
    }

    private syncFromActiveSplat() {
        const splat = this.activeSplat;
        this.numSplats = splat?.numSplats ?? 0;
        this.numDeleted = splat?.numDeleted ?? 0;
        this.numLocked = splat?.numLocked ?? 0;
        this.numSelected = splat?.numSelected ?? 0;
        if (splat?.localBound) {
            this.localBoundStorage.copy(splat.localBound);
        }
        if (splat?.worldBound) {
            this.worldBoundStorage.copy(splat.worldBound);
        }
    }

    private async ensureAddedToScene() {
        if (this.scene) {
            return;
        }

        if (!this.addingToScene) {
            this.addingToScene = this.events.invoke('scene.addElement', this) as Promise<void>;
        }

        await this.addingToScene;
        this.addingToScene = null;
    }

    private disposeAsset(asset: Asset) {
        this.scene?.app.assets.remove(asset);
        asset.unload();
    }

    private releasePreviousBufferAfterRender(buffer: number, splat: Splat, asset: Asset) {
        this.waitForPostRender().then(() => {
            if (this.currentAsset !== asset) {
                this.removeBufferSplat(splat);
                this.bufferAssets[buffer] = null;
                this.bufferSplats[buffer] = null;

                if (this.pendingDisposals.delete(asset)) {
                    splat.destroy();
                }

                this.scene.forceRender = true;
            }
        }).catch(() => {});
    }

    private removeBufferSplat(splat: Splat) {
        if (splat.scene) {
            splat.remove();
            splat.scene = null;
        }
    }

    private copyTransform(source: Splat['entity'], target: Splat['entity']) {
        target.setLocalPosition(source.getLocalPosition());
        target.setLocalRotation(source.getLocalRotation());
        target.setLocalScale(source.getLocalScale());
    }

    private waitForPostRender() {
        return new Promise<void>((resolve) => {
            const off = this.events.on('postrender', () => {
                off.off();
                resolve();
            });
            this.scene.forceRender = true;
        });
    }

    private updateWorldBound() {
        if (this.entity) {
            this.worldBoundStorage.setFromTransformedAabb(this.localBoundStorage, this.entity.getWorldTransform());
        }
        this.scene.boundDirty = true;
    }
}

export { PlySequenceClip };
