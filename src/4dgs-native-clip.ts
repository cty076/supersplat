import { Asset, BoundingBox, GSplatResource } from 'playcanvas';

import { getNativeMotionChannelOffset, getNativeMotionStride, isNativeMotionDeltaEncoded, sampleNativeMotion, type Native4DGSManifest } from './4dgs-native';
import { getImportOrientation, type ImportUpAxis } from './import-orientation';
import { Splat } from './splat';

class Native4DGSClip extends Splat {
    readonly nativeManifest: Native4DGSManifest;
    private keyframes: Float32Array;
    private sampledMotion: Float32Array;
    private sampledCenters: Float32Array;
    private baseX: Float32Array;
    private baseY: Float32Array;
    private baseZ: Float32Array;
    private baseScale0: Float32Array | null;
    private baseScale1: Float32Array | null;
    private baseScale2: Float32Array | null;
    private baseRot0: Float32Array | null;
    private baseRot1: Float32Array | null;
    private baseRot2: Float32Array | null;
    private baseRot3: Float32Array | null;
    private pointStride: number;
    private scaleOffset: number;
    private rotationOffset: number;
    private deltaEncoded: boolean;
    private currentTimelineFrame = -1;
    private sequenceBound = new BoundingBox();

    constructor(asset: Asset, manifest: Native4DGSManifest, keyframes: Float32Array, upAxis: ImportUpAxis) {
        super(asset, getImportOrientation(manifest.baseFile, upAxis));

        this.nativeManifest = manifest;
        this.keyframes = keyframes;
        this.pointStride = getNativeMotionStride(manifest.motion.channels);
        this.scaleOffset = getNativeMotionChannelOffset(manifest.motion.channels, 'scale');
        this.rotationOffset = getNativeMotionChannelOffset(manifest.motion.channels, 'rotation');
        this.deltaEncoded = isNativeMotionDeltaEncoded(manifest);
        this.sampledMotion = new Float32Array(manifest.pointCount * this.pointStride);
        this.sampledCenters = new Float32Array(manifest.pointCount * 3);
        this.baseX = new Float32Array(this.splatData.getProp('x') as Float32Array);
        this.baseY = new Float32Array(this.splatData.getProp('y') as Float32Array);
        this.baseZ = new Float32Array(this.splatData.getProp('z') as Float32Array);
        this.baseScale0 = this.scaleOffset >= 0 ? new Float32Array(this.splatData.getProp('scale_0') as Float32Array) : null;
        this.baseScale1 = this.scaleOffset >= 0 ? new Float32Array(this.splatData.getProp('scale_1') as Float32Array) : null;
        this.baseScale2 = this.scaleOffset >= 0 ? new Float32Array(this.splatData.getProp('scale_2') as Float32Array) : null;
        this.baseRot0 = this.rotationOffset >= 0 ? new Float32Array(this.splatData.getProp('rot_0') as Float32Array) : null;
        this.baseRot1 = this.rotationOffset >= 0 ? new Float32Array(this.splatData.getProp('rot_1') as Float32Array) : null;
        this.baseRot2 = this.rotationOffset >= 0 ? new Float32Array(this.splatData.getProp('rot_2') as Float32Array) : null;
        this.baseRot3 = this.rotationOffset >= 0 ? new Float32Array(this.splatData.getProp('rot_3') as Float32Array) : null;
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
            x[i] = (this.deltaEncoded ? this.baseX[i] : 0) + motion[src + 0];
            y[i] = (this.deltaEncoded ? this.baseY[i] : 0) + motion[src + 1];
            z[i] = (this.deltaEncoded ? this.baseZ[i] : 0) + motion[src + 2];
            centers[center + 0] = x[i];
            centers[center + 1] = y[i];
            centers[center + 2] = z[i];

            if (scale0 && scale1 && scale2) {
                const scale = src + this.scaleOffset;
                scale0[i] = (this.deltaEncoded ? this.baseScale0?.[i] ?? 0 : 0) + motion[scale + 0];
                scale1[i] = (this.deltaEncoded ? this.baseScale1?.[i] ?? 0 : 0) + motion[scale + 1];
                scale2[i] = (this.deltaEncoded ? this.baseScale2?.[i] ?? 0 : 0) + motion[scale + 2];
            }

            if (rot0 && rot1 && rot2 && rot3) {
                const rotation = src + this.rotationOffset;
                rot0[i] = (this.deltaEncoded ? this.baseRot0?.[i] ?? 0 : 0) + motion[rotation + 0];
                rot1[i] = (this.deltaEncoded ? this.baseRot1?.[i] ?? 0 : 0) + motion[rotation + 1];
                rot2[i] = (this.deltaEncoded ? this.baseRot2?.[i] ?? 0 : 0) + motion[rotation + 2];
                rot3[i] = (this.deltaEncoded ? this.baseRot3?.[i] ?? 0 : 0) + motion[rotation + 3];
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
            const point = i % pointCount;
            const x = (this.deltaEncoded ? this.baseX[point] : 0) + keyframes[offset + 0];
            const y = (this.deltaEncoded ? this.baseY[point] : 0) + keyframes[offset + 1];
            const z = (this.deltaEncoded ? this.baseZ[point] : 0) + keyframes[offset + 2];
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
