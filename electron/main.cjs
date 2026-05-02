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
    const result = await win.webContents.executeJavaScript(`
        (async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitForEvents = async () => {
                for (let i = 0; i < 200; i++) {
                    if (window.scene?.events) {
                        return window.scene.events;
                    }
                    await delay(50);
                }
                throw new Error('Scene events were not exposed');
            };

            const events = await waitForEvents();
            const isPackageActive = () => events.invoke('4dgs.package.active') || events.invoke('native4dgs.active');
            for (let i = 0; i < 300; i++) {
                if (isPackageActive()) {
                    break;
                }
                await delay(100);
            }

            if (!isPackageActive()) {
                throw new Error('4DGS package did not become active');
            }

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

            let playbackFrame = currentFrame();
            for (let i = 0; i < 300; i++) {
                if (playbackFrame > 1) {
                    break;
                }
                await delay(100);
                playbackFrame = currentFrame();
            }
            events.fire('timeline.setPlaying', false);

            const selection = events.invoke('selection');
            if (!selection?.entity) {
                throw new Error('4DGS selection is missing an entity after load');
            }
            events.fire('tool.move');
            await delay(100);
            const pivot = events.invoke('pivot');
            pivot.start();
            const movedPosition = pivot.transform.position.clone();
            movedPosition.x += 0.02;
            pivot.moveTRS(movedPosition, pivot.transform.rotation, pivot.transform.scale);
            pivot.end();
            await delay(200);
            window.scene.camera.setAzimElev(window.scene.camera.azim + 15, window.scene.camera.elevation + 5, 0);
            window.scene.forceRender = true;
            await delay(200);

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
    const image = await win.webContents.capturePage(canvasRect);
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

    if (process.env.ELECTRON_SMOKE_TEST === '1') {
        const smokeWatchdog = setTimeout(() => {
            console.error('Electron smoke watchdog timed out');
            app.exit(1);
        }, 60000);

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
