import { Asset } from 'playcanvas';

import { getNativeMotionStride, type Native4DGSFileSource, type Native4DGSManifest, type Native4DGSSources } from './4dgs-native';
import { Native4DGSClip } from './4dgs-native-clip';
import { Events } from './events';
import { normalizeImportUpAxis, type ImportUpAxis } from './import-orientation';
import { Scene } from './scene';

type Native4DGSLoadOptions = {
    manifest: Native4DGSManifest;
    sources: Native4DGSSources;
    upAxis?: ImportUpAxis;
};

const readSourceArrayBuffer = async (source: Native4DGSFileSource) => {
    if (source.contents) {
        return source.contents.arrayBuffer();
    }

    const response = await fetch(source.url);
    if (!response.ok) {
        throw new Error(`Failed to load native 4DGS motion: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
};

const registerNative4DGSEvents = (events: Events, scene: Scene) => {
    let activeClip: Native4DGSClip | null = null;

    const destroyActiveClip = () => {
        if (activeClip) {
            scene.remove(activeClip);
            activeClip.destroy();
            activeClip = null;
        }
    };

    events.function('native4dgs.load', async (options: Native4DGSLoadOptions) => {
        const { manifest, sources } = options;
        const pointFloats = manifest.pointCount * manifest.keyframeCount * getNativeMotionStride(manifest.motion.channels);
        const motionBuffer = await readSourceArrayBuffer(sources.motion);
        if (motionBuffer.byteLength !== pointFloats * Float32Array.BYTES_PER_ELEMENT) {
            throw new Error(`Native 4DGS motion buffer has ${motionBuffer.byteLength} bytes, expected ${pointFloats * Float32Array.BYTES_PER_ELEMENT}`);
        }

        const asset = await events.invoke('import.gsplatAsset', [sources.base], true) as Asset;
        if (!asset) {
            throw new Error('Native 4DGS base Gaussian asset failed to load');
        }

        destroyActiveClip();
        activeClip = new Native4DGSClip(asset, manifest, new Float32Array(motionBuffer), normalizeImportUpAxis(options.upAxis));
        await scene.add(activeClip);
        activeClip.setTimelineFrame(0);

        events.fire('selection', activeClip);
        events.fire('timeline.setPlaying', false);
        events.fire('timeline.setFrameRate', manifest.frameRate);
        events.fire('timeline.frames', manifest.frameCount);
        events.fire('timeline.setFrame', 0);
        events.fire('timeline.frame', 0);
        events.fire('native4dgs.loaded', activeClip, manifest);

        return activeClip;
    });

    events.function('native4dgs.currentFrame', () => {
        return activeClip?.sequenceFrame ?? -1;
    });

    events.function('native4dgs.active', () => {
        return !!activeClip;
    });

    events.on('timeline.frame', (frame: number) => {
        if (activeClip) {
            activeClip.setTimelineFrame(frame);
        }
    });

    events.on('scene.clear', () => {
        activeClip = null;
    });
};

export { registerNative4DGSEvents };
