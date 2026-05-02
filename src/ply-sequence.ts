import type { FourDGSFrameSource } from './4dgs-manifest';
import { Events } from './events';
import { normalizeImportUpAxis, type ImportUpAxis } from './import-orientation';
import { PlySequenceClip } from './ply-sequence-clip';

type PlySequenceFrameInput = File | FourDGSFrameSource;

const normalizeFrameSource = (frame: PlySequenceFrameInput): FourDGSFrameSource => {
    if (frame instanceof File) {
        return {
            filename: frame.name,
            contents: frame
        };
    }

    return frame;
};

const registerPlySequenceEvents = (events: Events) => {
    let sequenceFiles: FourDGSFrameSource[] = [];
    let sequenceUpAxis: ImportUpAxis = 'y';
    let sequenceClip: PlySequenceClip | null = null;

    const ensureClip = () => {
        if (!sequenceClip) {
            sequenceClip = new PlySequenceClip(events);
        }

        return sequenceClip;
    };

    const setFrames = (files: PlySequenceFrameInput[], upAxis?: ImportUpAxis) => {
        // eslint-disable-next-line regexp/no-super-linear-backtracking
        const regex = /(.*?)(\d+)(?:\.compressed)?\.ply$/;

        const sorter = (a: FourDGSFrameSource, b: FourDGSFrameSource) => {
            const avalue = a.filename?.toLowerCase().match(regex)?.[2];
            const bvalue = b.filename?.toLowerCase().match(regex)?.[2];
            return (avalue && bvalue) ? parseInt(avalue, 10) - parseInt(bvalue, 10) : 0;
        };

        sequenceFiles = files.map(normalizeFrameSource);
        sequenceFiles.sort(sorter);
        sequenceUpAxis = normalizeImportUpAxis(upAxis);

        const clip = ensureClip();
        clip.setFrames(sequenceFiles, sequenceUpAxis);
        events.fire('timeline.frames', sequenceFiles.length);
    };

    const setFrame = async (frame: number) => {
        if (frame < 0 || frame >= sequenceFiles.length) {
            return;
        }

        const clip = ensureClip();
        if (frame === clip.currentFrame) {
            return;
        }

        if (events.invoke('scene.dirty')) {
            const result = await events.invoke('showPopup', {
                type: 'yesno',
                header: 'RESET SCENE',
                message: 'You have unsaved changes. Are you sure you want to reset the scene?'
            });

            if (result.action !== 'yes') {
                return;
            }

            events.fire('scene.clear');
            sequenceClip = null;
            const newClip = ensureClip();
            newClip.setFrames(sequenceFiles, sequenceUpAxis);
        }

        sequenceClip.requestFrame(frame);
    };

    events.on('plysequence.setFrames', (files: PlySequenceFrameInput[], upAxis?: ImportUpAxis) => {
        setFrames(files, upAxis);
    });

    events.on('timeline.frame', (frame: number) => {
        setFrame(frame).catch(console.error);
    });

    events.function('plysequence.setFrameAsync', (frame: number) => {
        if (frame < 0 || frame >= sequenceFiles.length) {
            return null;
        }

        const clip = ensureClip();
        if (clip.currentFrame === frame) {
            return null;
        }

        return clip.showFrameAsync(frame);
    });

    events.function('plysequence.currentFrame', () => {
        return sequenceClip?.currentFrame ?? -1;
    });

    events.on('scene.clear', () => {
        sequenceClip = null;
    });
};

export { registerPlySequenceEvents };
