import { Asset } from 'playcanvas';

import { decodeNativeMotionSourceAsync, getNativeMotionByteLength, type Native4DGSFileSource, type Native4DGSManifest, type Native4DGSSources } from './4dgs-native';
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
        console.info(`Native 4DGS loading ${manifest.sceneName}: ${manifest.pointCount} points, ${manifest.keyframeCount} keyframes, ${manifest.motion.encoding}`);
        events.fire('progressStart', '加载 4DGS Native 包');
        try {
            events.fire('progressUpdate', { text: '读取运动数据', progress: 5 });
            const motionBuffer = await readSourceArrayBuffer(sources.motion);
            const expectedBytes = getNativeMotionByteLength(manifest);
            if (expectedBytes !== undefined && motionBuffer.byteLength !== expectedBytes) {
                throw new Error(`Native 4DGS motion buffer has ${motionBuffer.byteLength} bytes, expected ${expectedBytes}`);
            }
            console.info(`Native 4DGS motion loaded: ${motionBuffer.byteLength} bytes`);

            events.fire('progressUpdate', { text: '导入基础高斯点云', progress: 35 });
            const asset = await events.invoke('import.gsplatAsset', [sources.base], true) as Asset;
            if (!asset) {
                throw new Error('Native 4DGS base Gaussian asset failed to load');
            }
            console.info('Native 4DGS base asset loaded');

            events.fire('progressUpdate', { text: '解码运动轨迹', progress: 65 });
            const motionSource = await decodeNativeMotionSourceAsync(motionBuffer, manifest);
            console.info(`Native 4DGS motion decoded: ${motionSource.kind}`);

            events.fire('progressUpdate', { text: '创建实时播放对象', progress: 85 });
            destroyActiveClip();
            const nextClip = new Native4DGSClip(asset, manifest, motionSource, normalizeImportUpAxis(options.upAxis));
            await scene.add(nextClip);
            nextClip.setTimelineFrame(0);

            events.fire('selection', nextClip);
            events.fire('timeline.setPlaying', false);
            events.fire('timeline.setFrameRate', manifest.frameRate);
            events.fire('timeline.frames', manifest.frameCount);
            events.fire('timeline.setFrame', 0);
            activeClip = nextClip;
            events.fire('timeline.frame', 0);
            events.fire('native4dgs.loaded', activeClip, manifest);
            events.fire('progressUpdate', { text: '加载完成', progress: 100 });
            console.info('Native 4DGS load complete');

            return activeClip;
        } finally {
            events.fire('progressEnd');
        }
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
