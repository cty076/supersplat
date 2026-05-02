import { ReadFileSystem } from '@playcanvas/splat-transform';
import { AppBase, Asset, GSplatResource } from 'playcanvas';

import { Events } from './events';
import { getImportOrientation, normalizeImportUpAxis, type ImportUpAxis } from './import-orientation';
import { loadGSplatData, validateGSplatData } from './io';
import { Splat } from './splat';

// handles loading gsplat assets using splat-transform
class AssetLoader {
    app: AppBase;
    events: Events;

    constructor(app: AppBase, events: Events) {
        this.app = app;
        this.events = events;
    }

    async loadAsset(filename: string, fileSystem: ReadFileSystem, animationFrame?: boolean, skipReorder?: boolean) {
        if (!animationFrame) {
            this.events.fire('startSpinner');
        }

        try {
            // Skip reordering for animation frames (speed) or when explicitly requested (already ordered)
            const gsplatData = await loadGSplatData(filename, fileSystem, skipReorder || animationFrame);
            validateGSplatData(gsplatData);

            const asset = new Asset(filename, 'gsplat', { url: `local-asset-${Date.now()}`, filename });
            this.app.assets.add(asset);
            asset.resource = new GSplatResource(this.app.graphicsDevice, gsplatData);

            return asset;
        } finally {
            if (!animationFrame) {
                this.events.fire('stopSpinner');
            }
        }
    }

    async load(filename: string, fileSystem: ReadFileSystem, animationFrame?: boolean, skipReorder?: boolean, upAxis?: ImportUpAxis) {
        const asset = await this.loadAsset(filename, fileSystem, animationFrame, skipReorder);
        return new Splat(asset, getImportOrientation(filename, normalizeImportUpAxis(upAxis)));
    }
}

export { AssetLoader };
