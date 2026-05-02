import { Asset, BoundingBox, GSplatResource } from 'playcanvas';

import { getNativeMotionChannelOffset, getNativeMotionStride, sampleNativeMotion, type Native4DGSManifest } from './4dgs-native';
import { getImportOrientation, type ImportUpAxis } from './import-orientation';
import { Splat } from './splat';

class Native4DGSClip extends Splat {
    readonly nativeManifest: Native4DGSManifest;
    private keyframes: Float32Array;
    private sampledMotion: Float32Array;
    private sampledCenters: Float32Array;
    private pointStride: number;
    private scaleOffset: number;
    private rotationOffset: number;
    private currentTimelineFrame = -1;
    private sequenceBound = new BoundingBox();

    constructor(asset: Asset, manifest: Native4DGSManifest, keyframes: Float32Array, upAxis: ImportUpAxis) {
        super(asset, getImportOrientation(manifest.baseFile, upAxis));

        this.nativeManifest = manifest;
        this.keyframes = keyframes;
        this.pointStride = getNativeMotionStride(manifest.motion.channels);
        this.scaleOffset = getNativeMotionChannelOffset(manifest.motion.channels, 'scale');
        this.rotationOffset = getNativeMotionChannelOffset(manifest.motion.channels, 'rotation');
        this.sampledMotion = new Float32Array(manifest.pointCount * this.pointStride);
        this.sampledCenters = new Float32Array(manifest.pointCount * 3);
        this.name = `${manifest.sceneName} (native 4DGS)`;
        this.computeSequenceBound();
    }

    setTimelineFrame(frame: number) {
        if (frame === this.currentTimelineFrame) {
            return;
        }

        const time = this.nativeManifest.frameCount <= 1 ? 0 : frame / (this.nativeManifest.frameCount - 1);
        sampleNativeMotion({
            keyframes: this.keyframes,
            pointCount: this.nativeManifest.pointCount,
            keyframeCount: this.nativeManifest.keyframeCount,
            channels: this.nativeManifest.motion.channels,
            time,
            out: this.sampledMotion
        });

        this.applySampledMotion();
        this.currentTimelineFrame = frame;
    }

    get sequenceFrame() {
        return this.currentTimelineFrame;
    }

    private applySampledMotion() {
        const x = this.splatData.getProp('x') as Float32Array;
        const y = this.splatData.getProp('y') as Float32Array;
        const z = this.splatData.getProp('z') as Float32Array;
        const scale0 = this.scaleOffset >= 0 ? this.splatData.getProp('scale_0') as Float32Array : null;
        const scale1 = this.scaleOffset >= 0 ? this.splatData.getProp('scale_1') as Float32Array : null;
        const scale2 = this.scaleOffset >= 0 ? this.splatData.getProp('scale_2') as Float32Array : null;
        const rot0 = this.rotationOffset >= 0 ? this.splatData.getProp('rot_0') as Float32Array : null;
        const rot1 = this.rotationOffset >= 0 ? this.splatData.getProp('rot_1') as Float32Array : null;
        const rot2 = this.rotationOffset >= 0 ? this.splatData.getProp('rot_2') as Float32Array : null;
        const rot3 = this.rotationOffset >= 0 ? this.splatData.getProp('rot_3') as Float32Array : null;
        const motion = this.sampledMotion;
        const centers = this.sampledCenters;

        for (let i = 0; i < this.nativeManifest.pointCount; i++) {
            const src = i * this.pointStride;
            const center = i * 3;
            x[i] = motion[src + 0];
            y[i] = motion[src + 1];
            z[i] = motion[src + 2];
            centers[center + 0] = motion[src + 0];
            centers[center + 1] = motion[src + 1];
            centers[center + 2] = motion[src + 2];

            if (scale0 && scale1 && scale2) {
                const scale = src + this.scaleOffset;
                scale0[i] = motion[scale + 0];
                scale1[i] = motion[scale + 1];
                scale2[i] = motion[scale + 2];
            }

            if (rot0 && rot1 && rot2 && rot3) {
                const rotation = src + this.rotationOffset;
                rot0[i] = motion[rotation + 0];
                rot1[i] = motion[rotation + 1];
                rot2[i] = motion[rotation + 2];
                rot3[i] = motion[rotation + 3];
            }
        }

        const resource = this.asset.resource as GSplatResource;
        resource.updateTransformData(this.splatData);

        const sorter = this.entity.gsplat.instance.sorter;
        if (sorter?.centers) {
            sorter.centers.set(centers);
            sorter.setMapping(null);
        }

        this.localBoundStorage.copy(this.sequenceBound);
        this.updateWorldBoundFromNative();
        this.scene.forceRender = true;
    }

    private computeSequenceBound() {
        const { keyframes } = this;
        const pointCount = this.nativeManifest.pointCount;
        const total = pointCount * this.nativeManifest.keyframeCount;

        if (total === 0) {
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < total; i++) {
            const offset = i * this.pointStride;
            const x = keyframes[offset + 0];
            const y = keyframes[offset + 1];
            const z = keyframes[offset + 2];
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        this.sequenceBound.center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
        this.sequenceBound.halfExtents.set((maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5);
    }

    private updateWorldBoundFromNative() {
        this.worldBoundStorage.setFromTransformedAabb(this.localBoundStorage, this.entity.getWorldTransform());
        this.scene.boundDirty = true;
    }
}

export { Native4DGSClip };
