const { app, BrowserWindow, dialog, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://4dgs-viewer/';
const LOCAL_PACKAGE_PREFIX = '__local_4dgs_package__';

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

const getDistDir = () => path.resolve(app.getAppPath(), 'dist');
const getSmokePackageRoot = () => {
    const value = process.env.ELECTRON_SMOKE_TEST_PACKAGE;
    return value ? path.resolve(value) : null;
};
const getSmokeTestTimeoutMs = () => {
    const value = Number.parseInt(process.env.ELECTRON_SMOKE_TEST_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(value) && value >= 30000 ? value : 180000;
};

const registerAppProtocol = () => {
    const distDir = getDistDir();
    const packageRoot = getSmokePackageRoot();

    protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';

        if (packageRoot && (relativePath === LOCAL_PACKAGE_PREFIX || relativePath.startsWith(`${LOCAL_PACKAGE_PREFIX}/`))) {
            const packageRelativePath = relativePath.slice(LOCAL_PACKAGE_PREFIX.length).replace(/^\/+/, '') || 'manifest.json';
            const filePath = path.resolve(packageRoot, packageRelativePath);
            const insidePackage = filePath === packageRoot || filePath.startsWith(`${packageRoot}${path.sep}`);

            if (!insidePackage || !fs.existsSync(filePath)) {
                return new Response('Not found', { status: 404 });
            }

            return net.fetch(pathToFileURL(filePath).toString());
        }

        const filePath = path.resolve(distDir, relativePath);
        const insideDist = filePath === distDir || filePath.startsWith(`${distDir}${path.sep}`);

        if (!insideDist || !fs.existsSync(filePath)) {
            return new Response('Not found', { status: 404 });
        }

        return net.fetch(pathToFileURL(filePath).toString());
    });
};

const createAppUrl = () => {
    const url = new URL(APP_ORIGIN);
    url.searchParams.set('lng', 'zh-CN');

    if (getSmokePackageRoot()) {
        url.searchParams.set('load', `${APP_ORIGIN}${LOCAL_PACKAGE_PREFIX}/manifest.json`);
        url.searchParams.set('filename', 'manifest.json');
        url.searchParams.set('upAxis', 'y');
    }

    return url.toString();
};

const runFourDGSSmokeTest = async (win) => {
    console.log('Electron smoke phase: renderer checks starting');
    const result = await win.webContents.executeJavaScript(`
        (async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitForEvents = async () => {
                console.info('Electron smoke phase: waiting for events');
                for (let i = 0; i < 200; i++) {
                    if (window.scene?.events) {
                        console.info('Electron smoke phase: events ready');
                        return window.scene.events;
                    }
                    await delay(50);
                }
                throw new Error('Scene events were not exposed');
            };

            const events = await waitForEvents();
            const isPackageActive = () => events.invoke('4dgs.package.active') || events.invoke('native4dgs.active');
            console.info('Electron smoke phase: waiting for package active');
            for (let i = 0; i < 300; i++) {
                if (isPackageActive()) {
                    break;
                }
                await delay(100);
            }

            if (!isPackageActive()) {
                throw new Error('4DGS package did not become active');
            }

            console.info('Electron smoke phase: package active');
            const nativePackage = events.invoke('native4dgs.active');
            const currentFrame = () => nativePackage ? events.invoke('native4dgs.currentFrame') : events.invoke('plysequence.currentFrame');
            if (nativePackage) {
                events.fire('timeline.setFrame', 0);
                events.fire('timeline.setFrame', 1);
            } else {
                await events.invoke('plysequence.setFrameAsync', 0);
                await events.invoke('plysequence.setFrameAsync', 1);
                events.fire('timeline.setFrame', 1);
            }
            events.fire('timeline.setPlaying', true);

            console.info('Electron smoke phase: waiting for playback frame');
            let playbackFrame = currentFrame();
            for (let i = 0; i < 300; i++) {
                if (playbackFrame > 1) {
                    break;
                }
                await delay(100);
                playbackFrame = currentFrame();
            }
            events.fire('timeline.setPlaying', false);
            console.info('Electron smoke phase: playback checked ' + playbackFrame);

            const selection = events.invoke('selection');
            if (!selection?.entity) {
                throw new Error('4DGS selection is missing an entity after load');
            }
            console.info('Electron smoke phase: moving selection');
            events.fire('tool.move');
            await delay(100);
            const pivot = events.invoke('pivot');
            pivot.start();
            const movedPosition = pivot.transform.position.clone();
            movedPosition.x += 0.02;
            pivot.moveTRS(movedPosition, pivot.transform.rotation, pivot.transform.scale);
            pivot.end();
            await delay(200);
            console.info('Electron smoke phase: moving camera');
            window.scene.camera.setAzimElev(window.scene.camera.azim + 15, window.scene.camera.elevation + 5, 0);
            window.scene.forceRender = true;
            await delay(200);
            console.info('Electron smoke phase: renderer checks complete');

            return {
                frame: events.invoke('timeline.frame'),
                sequenceFrame: currentFrame(),
                nativePackage,
                playbackFrame,
                movedX: selection.entity.getLocalPosition().x,
                visibleSplats: events.invoke('scene.splats')?.length ?? 0,
                allSplats: events.invoke('scene.allSplats')?.length ?? 0
            };
        })();
    `, true);
    console.log(`Electron smoke phase: renderer checks result ${JSON.stringify(result)}`);

    console.log('Electron smoke phase: capture canvas rect');
    const canvasRect = await win.webContents.executeJavaScript(`
        (() => {
            const canvas = document.querySelector('canvas');
            const rect = canvas.getBoundingClientRect();
            return {
                x: Math.max(0, Math.floor(rect.left)),
                y: Math.max(0, Math.floor(rect.top)),
                width: Math.max(1, Math.floor(rect.width)),
                height: Math.max(1, Math.floor(rect.height))
            };
        })();
    `, true);
    console.log(`Electron smoke phase: capturePage ${JSON.stringify(canvasRect)}`);
    const image = await win.webContents.capturePage(canvasRect);
    console.log('Electron smoke phase: analyzing capture');
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const centerX0 = Math.floor(size.width * 0.25);
    const centerX1 = Math.floor(size.width * 0.75);
    const centerY0 = Math.floor(size.height * 0.25);
    const centerY1 = Math.floor(size.height * 0.75);
    const sampleStep = 8;
    let variedPixels = 0;
    let samples = 0;
    const base = {
        b: bitmap[0],
        g: bitmap[1],
        r: bitmap[2]
    };

    for (let y = centerY0; y < centerY1; y += sampleStep) {
        for (let x = centerX0; x < centerX1; x += sampleStep) {
            const offset = (y * size.width + x) * 4;
            const diff = Math.abs(bitmap[offset] - base.b) +
                Math.abs(bitmap[offset + 1] - base.g) +
                Math.abs(bitmap[offset + 2] - base.r);
            if (diff > 24) {
                variedPixels++;
            }
            samples++;
        }
    }
    result.canvasVariedPixels = variedPixels;
    result.canvasSamples = samples;

    console.log(`Electron 4DGS smoke loaded frames: ${JSON.stringify(result)}`);

    if (result.playbackFrame <= 1 || result.visibleSplats < 1 || result.canvasVariedPixels < 20) {
        throw new Error(`Unexpected 4DGS smoke result: ${JSON.stringify(result)}`);
    }
};

const createWindow = async () => {
    const distDir = getDistDir();

    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        dialog.showErrorBox(
            '4DGS Viewer',
            'Missing dist/index.html. Run "npm run build" before launching the desktop client.'
        );
        app.quit();
        return;
    }

    const win = new BrowserWindow({
        title: '4DGS Viewer',
        width: 1440,
        height: 960,
        minWidth: 960,
        minHeight: 640,
        backgroundColor: '#1f2228',
        autoHideMenuBar: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webgl: true
        }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(APP_ORIGIN)) {
            return { action: 'allow' };
        }

        shell.openExternal(url);
        return { action: 'deny' };
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        dialog.showErrorBox('4DGS Viewer failed to load', `${errorCode}: ${errorDescription}`);
    });
    win.webContents.on('console-message', (event) => {
        if (process.env.ELECTRON_SMOKE_TEST === '1') {
            console.log(`Renderer console[${event.level}] ${event.sourceId}:${event.lineNumber} ${event.message}`);
        }
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error(`Renderer process gone: ${JSON.stringify(details)}`);
    });

    if (process.env.ELECTRON_SMOKE_TEST === '1') {
        const smokeTimeoutMs = getSmokeTestTimeoutMs();
        const smokeWatchdog = setTimeout(() => {
            console.error(`Electron smoke watchdog timed out after ${smokeTimeoutMs}ms`);
            app.exit(1);
        }, smokeTimeoutMs);

        win.webContents.once('did-finish-load', async () => {
            console.log(`Electron smoke loaded: ${win.webContents.getURL()}`);
            try {
                if (getSmokePackageRoot()) {
                    await runFourDGSSmokeTest(win);
                }
                clearTimeout(smokeWatchdog);
                setTimeout(() => app.exit(0), 500);
            } catch (error) {
                clearTimeout(smokeWatchdog);
                console.error('Electron smoke failed:', error);
                app.exit(1);
            }
        });
    }

    await win.loadURL(createAppUrl());

    if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
        win.webContents.openDevTools({ mode: 'detach' });
    }
};

app.whenReady().then(async () => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('local.supersplat.4dgs');
    }

    registerAppProtocol();
    await createWindow();

    if (process.env.ELECTRON_LOG_GPU_STATUS === '1' || process.env.ELECTRON_SMOKE_TEST === '1') {
        const gpuStatus = app.getGPUFeatureStatus();
        console.log('GPU feature status:', JSON.stringify(gpuStatus));
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
