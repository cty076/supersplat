import { path, Quat, Vec3 } from 'playcanvas';

import { collectFourDGSFrameSources, createFourDGSFrameUrlSources, parseFourDGSManifest, type FourDGSManifest } from './4dgs-manifest';
import { collectNative4DGSLocalSources, createNative4DGSUrlSources, isNative4DGSFormat, parseNative4DGSManifest, type Native4DGSManifest, type Native4DGSSources } from './4dgs-native';
import { buildFourDGSSession, parseFourDGSSession, sessionFilename, type FourDGSSession } from './4dgs-session';
import { CreateDropHandler } from './drop-handler';
import { ElementType } from './element';
import { Events } from './events';
import { normalizeImportUpAxis, type ImportUpAxis } from './import-orientation';
import { BrowserFileSystem, MappedReadFileSystem } from './io';
import { Scene } from './scene';
import { Splat } from './splat';
import { serializePly, serializePlyCompressed, SerializeSettings, serializeSog, serializeSplat, serializeViewer, SogSettings, ViewerExportSettings } from './splat-serialize';
import { localize } from './ui/localization';

// ts compiler and vscode find this type, but eslint does not
type FilePickerAcceptType = unknown;

type ExportType = 'ply' | 'splat' | 'sog' | 'viewer';

type FileType = 'ply' | 'compressedPly' | 'splat' | 'sog' | 'htmlViewer' | 'packageViewer';

type ActiveFourDGSPackage = {
    manifest: FourDGSManifest | Native4DGSManifest;
    upAxis: ImportUpAxis;
};

interface SceneExportOptions {
    filename: string;
    splatIdx: 'all' | number;
    serializeSettings: SerializeSettings;

    // ply
    compressedPly?: boolean;

    // sog
    sogIterations?: number;

    // viewer
    viewerExportSettings?: ViewerExportSettings;
}

const filePickerTypes: { [key: string]: FilePickerAcceptType } = {
    'ply': {
        description: 'Gaussian Splat PLY File',
        accept: {
            'application/ply': ['.ply']
        }
    },
    'compressedPly': {
        description: 'Compressed Gaussian Splat PLY File',
        accept: {
            'application/ply': ['.ply']
        }
    },
    'sog': {
        description: 'SOG Scene',
        accept: {
            'application/x-gaussian-splat': ['.json', '.sog'],
            'image/webp': ['.webp']
        }
    },
    'lcc': {
        description: 'LCC Scene',
        accept: {
            'application/json': ['.lcc'],
            'application/octet-stream': ['.bin']
        }
    },
    'splat': {
        description: 'Splat File',
        accept: {
            'application/x-gaussian-splat': ['.splat']
        }
    },
    'ksplat': {
        description: 'KSplat File',
        accept: {
            'application/x-gaussian-splat': ['.ksplat']
        }
    },
    'spz': {
        description: 'SPZ File (Niantic)',
        accept: {
            'application/x-gaussian-splat': ['.spz']
        }
    },
    'indexTxt': {
        description: 'Colmap Poses (Images.txt)',
        accept: {
            'text/plain': ['.txt']
        }
    },
    'htmlViewer': {
        description: 'Viewer HTML',
        accept: {
            'text/html': ['.html']
        }
    },
    'packageViewer': {
        description: 'Viewer ZIP',
        accept: {
            'application/zip': ['.zip']
        }
    },
    'fourDGSSession': {
        description: '4DGS Viewer Session',
        accept: {
            'application/json': ['.json']
        }
    }
};

const allImportTypes = {
    description: 'Supported Files',
    accept: {
        'application/ply': ['.ply'],
        'application/x-gaussian-splat': ['.json', '.sog', '.splat', '.ksplat', '.spz'],
        'image/webp': ['.webp'],
        'application/json': ['.lcc'],
        'application/octet-stream': ['.bin'],
        'text/plain': ['.txt']
    }
};

// determine if all files share a common filename prefix followed by
// a frame number, e.g. "frame0001.ply", "frame0002.ply", etc.
const isPlySequence = (filenames: string[]) => {
    if (filenames.length < 2) {
        return false;
    }

    // eslint-disable-next-line regexp/no-super-linear-backtracking
    const regex = /(.*?)(\d+)(?:\.compressed)?\.ply$/;
    const baseMatch = filenames[0].match(regex);
    if (!baseMatch) {
        return false;
    }

    for (let i = 1; i < filenames.length; i++) {
        const thisMatch = filenames[i].match(regex);
        if (!thisMatch || thisMatch[1] !== baseMatch[1]) {
            return false;
        }
    }

    return true;
};

// sog comprises a single meta.json file and zero or more .webp files
const isSog = (filenames: string[]) => {
    const count = (extension: string) => filenames.reduce((sum, f) => sum + (f.endsWith(extension) ? 1 : 0), 0);
    return count('meta.json') === 1;
};

// The LCC file contains meta.lcc, index.bin, data.bin and shcoef.bin (optional)
const isLcc = (filenames: string[]) => {
    const count = (extension: string) => filenames.reduce((sum, f) => sum + (f.endsWith(extension) ? 1 : 0), 0);
    return count('.lcc') === 1;
};

const isManifestFilename = (filename: string) => {
    const normalized = filename.replace(/\\/g, '/').toLowerCase();
    return normalized === 'manifest.json' || normalized.endsWith('/manifest.json');
};

type ImportFile = {
    filename: string;
    url?: string;
    contents?: File;
    handle?: FileSystemFileHandle;
};

type ImportOptions = {
    addToScene?: boolean;
    visible?: boolean;
};

const vec = new Vec3();

const getRelativeFilename = (file: File) => {
    return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
};

const filesFromFileList = (fileList: FileList): ImportFile[] => {
    const files: ImportFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        files.push({
            filename: getRelativeFilename(file),
            contents: file
        });
    }
    return files;
};

// load inria camera poses from json file
const loadCameraPoses = async (file: ImportFile, events: Events) => {
    const response = new Response(file.contents);
    const json = await response.json();

    if (json.length > 0) {
        // sort entries by trailing number if it exists
        const sorter = (a: any, b: any) => {
            const avalue = a.id ?? a.img_name?.match(/\d*$/)?.[0];
            const bvalue = b.id ?? b.img_name?.match(/\d*$/)?.[0];
            return (avalue && bvalue) ? parseInt(avalue, 10) - parseInt(bvalue, 10) : 0;
        };

        json.sort(sorter).forEach((pose: any, i: number) => {
            if (pose.hasOwnProperty('position') && pose.hasOwnProperty('rotation')) {
                const p = new Vec3(pose.position);
                const z = new Vec3(pose.rotation[0][2], pose.rotation[1][2], pose.rotation[2][2]);

                // Use fixed offset along Z-axis direction instead of variable dot product
                vec.copy(z).mulScalar(10).add(p);

                // compute max FOV from intrinsics (vertical or horizontal, whichever is larger)
                let fov = 60;
                if (pose.fx && pose.fy && pose.width && pose.height) {
                    const fovX = 2 * Math.atan(pose.width / (2 * pose.fx)) * (180 / Math.PI);
                    const fovY = 2 * Math.atan(pose.height / (2 * pose.fy)) * (180 / Math.PI);
                    fov = Math.max(fovX, fovY);
                }

                events.fire('camera.addPose', {
                    name: pose.img_name ?? `${file.filename}_${i}`,
                    frame: i,
                    position: new Vec3(-p.x, -p.y, p.z),
                    target: new Vec3(-vec.x, -vec.y, vec.z),
                    fov
                });
            }
        });
    }
};

const removeExtension = (filename: string) => {
    return filename.substring(0, filename.length - path.getExtension(filename).length);
};

// https://colmap.github.io/format.html#images-txt
const loadImagesTxt = async (file: ImportFile, events: Events) => {
    const response = new Response(file.contents);
    const text = await response.text();

    // split into lines, remove comments and empty lines
    const poses = text.split('\n')
    .map(line => line.trim())
    .filter(line => !line.startsWith('#'))      // remove comments
    .filter((_, i) => i % 2 === 0)              // remove every second line
    .map((line, i) => {
        const parts = line.split(' ');
        if (parts.length !== 10) {
            return null;
        }
        const name = parts[9];
        const order = parseInt(removeExtension(name).match(/\d+$/)?.[0], 10);
        return {
            w: parseFloat(parts[1]),
            x: parseFloat(parts[2]),
            y: parseFloat(parts[3]),
            z: parseFloat(parts[4]),
            tx: parseFloat(parts[5]),
            ty: parseFloat(parts[6]),
            tz: parseFloat(parts[7]),
            name: name ?? `${file.filename}_${i}`,
            order: isFinite(order) ? order : i
        };
    })
    .filter(entry => !!entry)
    .sort((a, b) => (a.order < b.order ? -1 : 1));

    const q = new Quat();
    const t = new Vec3();

    poses.forEach((pose, i) => {
        const { w, x, y, z, tx, ty, tz } = pose;

        q.set(x, y, z, w).normalize().invert();
        t.set(-tx, -ty, -tz);
        q.transformVector(t, t);

        q.transformVector(Vec3.BACK, vec);
        vec.mulScalar(10).add(t);

        events.fire('camera.addPose', {
            name: pose.name,
            frame: i,
            position: new Vec3(-t.x, -t.y, t.z),
            target: new Vec3(-vec.x, -vec.y, vec.z)
        });
    });
};

const collectDirectoryFiles = async (handle: FileSystemDirectoryHandle, prefix = ''): Promise<ImportFile[]> => {
    const files: ImportFile[] = [];

    for await (const [name, value] of handle.entries()) {
        const filename = prefix ? `${prefix}/${name}` : name;
        if (value.kind === 'file') {
            files.push({
                filename,
                contents: await value.getFile()
            });
        } else {
            files.push(...await collectDirectoryFiles(value, filename));
        }
    }

    return files;
};

const fileHasPlyContents = (file: ImportFile): file is ImportFile & { contents: File } => {
    return !!file.contents && file.filename.toLowerCase().endsWith('.ply');
};

const downloadTextFile = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
};

const writeTextFile = async (filename: string, text: string, stream?: FileSystemWritableFileStream) => {
    if (stream) {
        await stream.write(text);
        await stream.close();
    } else {
        downloadTextFile(filename, text);
    }
};

// initialize file handler events
const initFileHandler = (scene: Scene, events: Events, dropTarget: HTMLElement) => {
    let activeFourDGSPackage: ActiveFourDGSPackage | null = null;

    const showLoadError = async (message: string, filename: string) => {
        await events.invoke('showPopup', {
            type: 'error',
            header: localize('popup.error-loading'),
            message: `${message} while loading '${filename}'`
        });
    };

    const chooseImportUpAxis = async (): Promise<ImportUpAxis> => {
        const response = await events.invoke('showPopup', {
            type: 'yesno',
            header: 'Import Up Axis',
            message: 'Choose the model up axis. Y-up keeps the current orientation; Z-up rotates the model into viewer coordinates.',
            yesText: 'Y axis up',
            noText: 'Z axis up'
        });

        return response?.action === 'no' ? 'z' : 'y';
    };

    const saveFourDGSSession = async () => {
        if (!activeFourDGSPackage) {
            await events.invoke('showPopup', {
                type: 'info',
                header: 'Save 4DGS Session',
                message: 'There is no imported 4DGS package to save.'
            });
            return;
        }

        const timeline = events.invoke('docSerialize.timeline');
        const session = buildFourDGSSession({
            manifest: activeFourDGSPackage.manifest,
            upAxis: activeFourDGSPackage.upAxis,
            frame: events.invoke('timeline.frame') ?? 0,
            timeline,
            camera: scene.camera.docSerialize()
        });
        const filename = sessionFilename(session.sceneName);
        const text = `${JSON.stringify(session, null, 2)}\n`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    id: 'SuperSplat4DGSSessionSave',
                    types: [filePickerTypes.fourDGSSession],
                    suggestedName: filename
                });
                await writeTextFile(filename, text, await handle.createWritable());
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(error);
                }
            }
        } else {
            await writeTextFile(filename, text);
        }
    };

    events.function('4dgs.package.active', () => {
        return activeFourDGSPackage;
    });

    // import splat model(s) - handles single files, SOG, and LCC formats
    const createSplatFileSystem = (files: ImportFile[]) => {
        const filenames = files.map(f => f.filename.toLowerCase());

        let mainIndex: number;
        if (filenames.some(f => f === 'meta.json')) {
            mainIndex = filenames.findIndex(f => f === 'meta.json');
        } else if (filenames.some(f => f.endsWith('.lcc'))) {
            mainIndex = filenames.findIndex(f => f.endsWith('.lcc'));
        } else {
            mainIndex = 0;
        }

        const mainFile = files[mainIndex];
        const baseUrl = mainFile.url ? new URL('.', new URL(mainFile.url, window.location.href)).href : undefined;
        const fileSystem = new MappedReadFileSystem(baseUrl);
        files.forEach((f) => {
            if (f.contents) fileSystem.addFile(f.filename, f.contents);
        });

        const filename = (files.length === 1 && !mainFile.contents && mainFile.url) ?
            mainFile.url :
            mainFile.filename;

        return { filename, fileSystem };
    };

    const importSplatAsset = async (files: ImportFile[], animationFrame: boolean) => {
        try {
            const { filename, fileSystem } = createSplatFileSystem(files);
            return await scene.assetLoader.loadAsset(filename, fileSystem, animationFrame, false);
        } catch (error) {
            const displayName = files[0]?.filename ?? 'unknown';
            await showLoadError(error.message ?? error, displayName);
        }
    };

    const importSplatModel = async (files: ImportFile[], animationFrame: boolean, upAxis: ImportUpAxis, options: ImportOptions = {}) => {
        try {
            const { filename, fileSystem } = createSplatFileSystem(files);
            const model = await scene.assetLoader.load(filename, fileSystem, animationFrame, false, upAxis);
            model.visible = options.visible ?? true;
            if (options.addToScene !== false) {
                await scene.add(model);
            }
            return model;
        } catch (error) {
            const displayName = files[0]?.filename ?? 'unknown';
            await showLoadError(error.message ?? error, displayName);
        }
    };

    const collectNativeSources = (files: ImportFile[], manifestFile: ImportFile, manifest: Native4DGSManifest): Native4DGSSources => {
        if (!manifestFile.contents) {
            return createNative4DGSUrlSources(manifestFile.url, manifest);
        }

        return collectNative4DGSLocalSources(files, manifestFile, manifest);
    };

    // figure out what the set of files are (ply sequence, document, sog set, ply) and then import them
    const importFiles = async (files: ImportFile[], animationFrame = false, upAxis?: ImportUpAxis, options: ImportOptions = {}) => {
        const filenames = files.map(f => f.filename.toLowerCase());

        const result: Splat[] = [];

        let chosenUpAxis: ImportUpAxis;
        const getUpAxis = async () => {
            if (!chosenUpAxis) {
                chosenUpAxis = upAxis ? normalizeImportUpAxis(upAxis) : (animationFrame ? 'y' : await chooseImportUpAxis());
            }
            return chosenUpAxis;
        };

        const manifestFile = files.find(file => isManifestFilename(file.filename));
        if (manifestFile) {
            try {
                const manifestData = manifestFile.contents ?
                    await new Response(manifestFile.contents).json() :
                    await (await fetch(manifestFile.url)).json();
                if (isNative4DGSFormat(manifestData?.format)) {
                    const manifest = parseNative4DGSManifest(manifestData) as Native4DGSManifest;
                    const packageUpAxis = await getUpAxis();
                    events.fire('timeline.setPlaying', false);
                    await events.invoke('native4dgs.load', {
                        manifest,
                        sources: collectNativeSources(files, manifestFile, manifest),
                        upAxis: packageUpAxis
                    });
                    activeFourDGSPackage = {
                        manifest,
                        upAxis: packageUpAxis
                    };
                    return result;
                }

                const manifest = parseFourDGSManifest(manifestData) as FourDGSManifest;
                const frames = manifestFile.contents ?
                    collectFourDGSFrameSources(
                        files
                        .filter((file): file is ImportFile & { contents: File } => !!file.contents)
                        .map(file => ({
                            filename: file.filename,
                            file: file.contents
                        })),
                        manifest
                    ) :
                    createFourDGSFrameUrlSources(manifestFile.url, manifest);

                const packageUpAxis = await getUpAxis();
                activeFourDGSPackage = {
                    manifest,
                    upAxis: packageUpAxis
                };
                events.fire('timeline.setPlaying', false);
                events.fire('plysequence.setFrames', frames, packageUpAxis);
                events.fire('timeline.setFrameRate', manifest.frameRate);
                events.fire('timeline.setFrame', 0);
                events.fire('timeline.frame', 0);
                events.fire('4dgs.package', manifest, packageUpAxis);
                return result;
            } catch (error) {
                await showLoadError(error.message ?? error, manifestFile.filename);
                return result;
            }
        }

        if (isPlySequence(filenames)) {
            // handle ply sequence
            events.fire('plysequence.setFrames', files.map(f => f.contents), await getUpAxis());
            events.fire('timeline.frame', 0);
        } else if (isSog(filenames) || isLcc(filenames)) {
            if (isLcc(filenames)) {
                const response = await events.invoke('showPopup', {
                    type: 'okcancel',
                    header: 'LCC',
                    message: localize('popup.lcc-upload-warning'),
                    link: `${window.location.origin}/upload`
                });
                if (response.action === 'cancel') {
                    return result;
                }
            }
            const model = await importSplatModel(files, animationFrame, await getUpAxis(), options);
            if (model) result.push(model);
        } else {
            // check for unrecognized file types
            for (let i = 0; i < filenames.length; i++) {
                const filename = filenames[i].toLowerCase();
                if (['.ssproj', '.ply', '.splat', '.sog', '.webp', 'images.txt', '.json', '.ksplat', '.spz'].every(ext => !filename.endsWith(ext))) {
                    await showLoadError('Unrecognized file type', filename);
                    return;
                }
            }

            // handle multiple files as independent imports
            for (let i = 0; i < files.length; i++) {
                const filename = filenames[i].toLowerCase();

                if (filename.endsWith('.ssproj')) {
                    // load ssproj document
                    await events.invoke('doc.load', files[i].contents ?? (await fetch(files[i].url)).arrayBuffer(), files[i].handle);
                } else if (['.ply', '.splat', '.sog', '.ksplat', '.spz'].some(ext => filename.endsWith(ext))) {
                    // load gaussian splat model
                    const model = await importSplatModel([files[i]], animationFrame, await getUpAxis(), options);
                    if (model) result.push(model);
                } else if (filename.endsWith('images.txt')) {
                    // load colmap frames
                    await loadImagesTxt(files[i], events);
                } else if (filename.endsWith('.json')) {
                    // load inria camera poses
                    await loadCameraPoses(files[i], events);
                }
            }
        }

        return result;
    };

    events.function('import', (files: ImportFile[], animationFrame = false, upAxis?: ImportUpAxis, options?: ImportOptions) => {
        return importFiles(files, animationFrame, upAxis, options);
    });

    events.function('import.gsplatAsset', (files: ImportFile[], animationFrame = false) => {
        return importSplatAsset(files, animationFrame);
    });

    events.function('scene.addElement', async (element: any) => {
        await scene.add(element);
    });

    // create a file selector element as fallback when showOpenFilePicker isn't available
    let fileSelector: HTMLInputElement;
    if (!window.showOpenFilePicker) {
        fileSelector = document.createElement('input');
        fileSelector.setAttribute('id', 'file-selector');
        fileSelector.setAttribute('type', 'file');
        fileSelector.setAttribute('accept', '.ply,.splat,meta.json,.json,.webp,.ssproj,.sog,.lcc,.bin,.txt,.ksplat,.spz');
        fileSelector.setAttribute('multiple', 'true');

        fileSelector.onchange = () => {
            importFiles(filesFromFileList(fileSelector.files));
            fileSelector.value = '';
        };
        document.body.append(fileSelector);
    }

    const selectDirectoryFallback = () => {
        return new Promise<ImportFile[] | null>((resolve) => {
            const selector = document.createElement('input');
            selector.setAttribute('type', 'file');
            selector.setAttribute('multiple', 'true');
            selector.setAttribute('webkitdirectory', 'true');
            selector.style.display = 'none';

            selector.onchange = () => {
                const files = selector.files?.length ? filesFromFileList(selector.files) : null;
                selector.remove();
                resolve(files);
            };

            document.body.append(selector);
            selector.click();
        });
    };

    const selectDirectoryFiles = async () => {
        if (!window.showDirectoryPicker) {
            return selectDirectoryFallback();
        }

        const handle = await window.showDirectoryPicker({
            id: 'SuperSplatFileOpenAnimation',
            mode: 'readwrite'
        });

        return handle ? collectDirectoryFiles(handle) : null;
    };

    const selectSessionFileFallback = () => {
        return new Promise<File | null>((resolve) => {
            const selector = document.createElement('input');
            selector.setAttribute('type', 'file');
            selector.setAttribute('accept', '.json,.4dgs-viewer.json');
            selector.style.display = 'none';

            selector.onchange = () => {
                const file = selector.files?.[0] ?? null;
                selector.remove();
                resolve(file);
            };

            document.body.append(selector);
            selector.click();
        });
    };

    const selectSessionFile = async () => {
        if (!window.showOpenFilePicker) {
            return selectSessionFileFallback();
        }

        const handles = await window.showOpenFilePicker({
            id: 'SuperSplat4DGSSessionOpen',
            multiple: false,
            excludeAcceptAllOption: false,
            types: [filePickerTypes.fourDGSSession]
        });

        return handles[0]?.getFile() ?? null;
    };

    const openFourDGSSession = async () => {
        try {
            const sessionFile = await selectSessionFile();
            if (!sessionFile) {
                return;
            }

            const session = parseFourDGSSession(await new Response(sessionFile).json()) as FourDGSSession;
            await events.invoke('showPopup', {
                type: 'info',
                header: 'Open 4DGS Session',
                message: `Select the matching 4DGS package folder: ${session.packageName}`
            });

            const files = await selectDirectoryFiles();
            if (!files) {
                return;
            }

            await importFiles(files, false, session.upAxis);
            events.fire('timeline.setFrameRate', session.frameRate);
            if (session.timeline) {
                events.invoke('docDeserialize.timeline', {
                    ...(session.timeline as object),
                    frameRate: session.frameRate,
                    frames: session.frameCount,
                    frame: session.frame
                });
            } else {
                events.fire('timeline.setFrame', session.frame);
            }
            if (events.invoke('native4dgs.active')) {
                events.fire('timeline.setFrame', session.frame);
            } else {
                await events.invoke('plysequence.setFrameAsync', session.frame);
            }
            if (session.camera) {
                scene.camera.docDeserialize(session.camera);
                scene.forceRender = true;
            }
            events.fire('timeline.setFrame', session.frame);
            events.fire('timeline.frame', session.frame);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error(error);
                await events.invoke('showPopup', {
                    type: 'error',
                    header: 'Open 4DGS Session Failed',
                    message: `${error.message ?? error}`
                });
            }
        }
    };

    const importDirectoryFiles = async (files: ImportFile[]) => {
        if (files.some(file => isManifestFilename(file.filename))) {
            await importFiles(files);
        } else {
            const frames = files.filter(fileHasPlyContents).map(file => file.contents);
            events.fire('plysequence.setFrames', frames, await chooseImportUpAxis());
            events.fire('timeline.frame', 0);
        }
    };

    // create the file drag & drop handler
    CreateDropHandler(dropTarget, (entries, shift) => {
        importFiles(entries.map((e) => {
            return {
                filename: e.filename,
                contents: e.file,
                handle: e.handle
            };
        }));
    });

    // get the list of visible splats containing gaussians
    const getSplats = () => {
        return (scene.getElementsByType(ElementType.splat) as Splat[])
        .filter(splat => splat.visible)
        .filter(splat => splat.numSplats > 0);
    };

    events.function('scene.allSplats', () => {
        return (scene.getElementsByType(ElementType.splat) as Splat[]);
    });

    events.function('scene.splats', () => {
        return getSplats();
    });

    events.function('scene.empty', () => {
        return getSplats().length === 0;
    });

    events.function('4dgs.session.canSave', () => {
        return !!activeFourDGSPackage;
    });

    events.function('4dgs.session.save', async () => {
        await saveFourDGSSession();
    });

    events.function('4dgs.session.open', async () => {
        await openFourDGSSession();
    });

    events.function('scene.import', async () => {
        if (fileSelector) {
            fileSelector.click();
        } else {
            try {
                const handles = await window.showOpenFilePicker({
                    id: 'SuperSplatFileImport',
                    multiple: true,
                    excludeAcceptAllOption: false,
                    types: [
                        allImportTypes,
                        filePickerTypes.ply,
                        filePickerTypes.compressedPly,
                        filePickerTypes.splat,
                        filePickerTypes.sog,
                        filePickerTypes.lcc,
                        filePickerTypes.ksplat,
                        filePickerTypes.spz,
                        filePickerTypes.indexTxt
                    ]
                });

                const files = [];
                for (let i = 0; i < handles.length; i++) {
                    files.push({
                        filename: handles[i].name,
                        contents: await handles[i].getFile()
                    });
                }

                importFiles(files);

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(error);
                }
            }
        }
    });

    // open a folder
    events.function('scene.openAnimation', async () => {
        try {
            const files = await selectDirectoryFiles();
            if (files) {
                await importDirectoryFiles(files);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error(error);
            }
        }
    });

    events.function('scene.export', async (exportType: ExportType) => {
        const splats = getSplats();

        const hasFilePicker = !!window.showSaveFilePicker;

        // show viewer export options
        const options = await events.invoke('show.exportPopup', exportType, splats.map(s => s.name), !hasFilePicker) as SceneExportOptions;

        // return if user cancelled
        if (!options) {
            return;
        }

        const fileType: FileType =
            (exportType === 'viewer') ? (options.viewerExportSettings!.type === 'zip' ? 'packageViewer' : 'htmlViewer') :
                (exportType === 'ply') ? (options.compressedPly ? 'compressedPly' : 'ply') :
                    (exportType === 'sog') ? 'sog' : 'splat';

        if (hasFilePicker) {
            try {
                const fileHandle = await window.showSaveFilePicker({
                    id: 'SuperSplatFileExport',
                    types: [filePickerTypes[fileType]],
                    suggestedName: options.filename
                });
                await events.invoke('scene.write', fileType, options, await fileHandle.createWritable());
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(error);
                }
            }
        } else {
            await events.invoke('scene.write', fileType, options);
        }
    });

    events.function('scene.write', async (fileType: FileType, options: SceneExportOptions, stream?: FileSystemWritableFileStream) => {
        // SOG and viewer exports have their own progress UI, other formats use spinner
        const useSpinner = fileType !== 'sog' && fileType !== 'htmlViewer' && fileType !== 'packageViewer';

        if (useSpinner) {
            events.fire('startSpinner');
        }

        try {
            // setTimeout so spinner/progress has a chance to activate
            await new Promise<void>((resolve) => {
                setTimeout(resolve);
            });

            const { filename, splatIdx, serializeSettings, viewerExportSettings } = options;

            // Create FileSystem for output
            const fs = new BrowserFileSystem(filename, stream);

            const splats = splatIdx === 'all' ? getSplats() : [getSplats()[splatIdx]];

            switch (fileType) {
                case 'ply':
                    await serializePly(splats, serializeSettings, fs);
                    break;
                case 'compressedPly':
                    serializeSettings.minOpacity = 1 / 255;
                    serializeSettings.removeInvalid = true;
                    await serializePlyCompressed(splats, serializeSettings, fs);
                    break;
                case 'splat':
                    await serializeSplat(splats, serializeSettings, fs);
                    break;
                case 'sog': {
                    const sogSettings: SogSettings = {
                        ...serializeSettings,
                        minOpacity: 1 / 255,
                        removeInvalid: true,
                        iterations: options.sogIterations ?? 10,
                        events
                    };
                    await serializeSog(splats, sogSettings, fs);
                    break;
                }
                case 'htmlViewer':
                case 'packageViewer':
                    await serializeViewer(splats, serializeSettings, { ...viewerExportSettings!, events }, fs);
                    break;
            }

        } catch (error) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('popup.error-loading'),
                message: `${error.message ?? error} while saving file`
            });
        } finally {
            if (useSpinner) {
                events.fire('stopSpinner');
            }
        }
    });
};

export { initFileHandler, ExportType, SceneExportOptions };
