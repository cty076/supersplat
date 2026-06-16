import { Button, Container, Label } from '@playcanvas/pcui';

import type { FourDGSManifest } from '../4dgs-manifest';
import { formatNative4DGSMotionSummary, type Native4DGSManifest } from '../4dgs-native';
import { Events } from '../events';
import { ShortcutManager } from '../shortcut-manager';
import { Splat } from '../splat';
import { localize, formatInteger } from './localization';
import { Tooltips } from './tooltips';

type FourDGSStatusState =
    | { kind: 'baked'; manifest: FourDGSManifest }
    | { kind: 'native'; manifest: Native4DGSManifest };

class StatusBar extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'status-bar'
        };

        super(args);

        let activePanel = '';

        const timelineButton = new Button({
            class: 'status-bar-toggle',
            text: localize('status-bar.timeline').toUpperCase()
        });

        const splatDataButton = new Button({
            class: 'status-bar-toggle',
            text: localize('status-bar.splat-data').toUpperCase()
        });

        const setActivePanel = (panel: string) => {
            activePanel = panel;
            timelineButton.dom.classList[panel === 'timeline' ? 'add' : 'remove']('active');
            splatDataButton.dom.classList[panel === 'splatData' ? 'add' : 'remove']('active');
            events.fire('statusBar.panelChanged', panel || null);
        };

        timelineButton.on('click', () => {
            setActivePanel(activePanel === 'timeline' ? '' : 'timeline');
        });

        splatDataButton.on('click', () => {
            setActivePanel(activePanel === 'splatData' ? '' : 'splatData');
        });

        const statsContainer = new Container({
            class: 'status-bar-stats'
        });

        const createStat = (labelText: string) => {
            const container = new Container({
                class: 'status-bar-stat'
            });
            const label = new Label({
                class: 'status-bar-stat-label',
                text: labelText
            });
            const value = new Label({
                class: 'status-bar-stat-value',
                text: '0'
            });
            container.append(label);
            container.append(value);
            statsContainer.append(container);
            return value;
        };

        const splatsValue = createStat(localize('status-bar.splats'));
        const selectedValue = createStat(localize('status-bar.selected'));
        const lockedValue = createStat(localize('status-bar.locked'));
        const deletedValue = createStat(localize('status-bar.deleted'));

        const fourDGSStatus = new Container({
            class: 'status-bar-4dgs'
        });
        const fourDGSLabel = new Label({
            class: 'status-bar-4dgs-label',
            text: ''
        });
        fourDGSStatus.append(fourDGSLabel);
        fourDGSStatus.hidden = true;

        this.append(timelineButton);
        this.append(splatDataButton);
        this.append(fourDGSStatus);
        this.append(statsContainer);

        const shortcutManager: ShortcutManager = events.invoke('shortcutManager');
        const tooltip = (localeKey: string, shortcutId?: string) => {
            const text = localize(localeKey);
            if (shortcutId) {
                const shortcut = shortcutManager.formatShortcut(shortcutId);
                if (shortcut) {
                    return `${text} ( ${shortcut} )`;
                }
            }
            return text;
        };

        tooltips.register(timelineButton, tooltip('tooltip.status-bar.timeline', 'timelinePanel.toggle'), 'top');
        tooltips.register(splatDataButton, tooltip('tooltip.status-bar.splat-data', 'dataPanel.toggle'), 'top');

        events.on('dataPanel.toggle', () => {
            setActivePanel(activePanel === 'splatData' ? '' : 'splatData');
        });

        events.on('timelinePanel.toggle', () => {
            setActivePanel(activePanel === 'timeline' ? '' : 'timeline');
        });

        let fourDGSState: FourDGSStatusState | null = null;
        let currentFrame = events.invoke('timeline.frame') as number;

        const formatNativeSummary = (manifest: Native4DGSManifest) => {
            return formatNative4DGSMotionSummary(manifest)
            .replace(`${manifest.pointCount} pts`, `${formatInteger(manifest.pointCount)} 点`)
            .replace(`${manifest.keyframeCount} keys`, `${formatInteger(manifest.keyframeCount)} 关键帧`)
            .replace(`${manifest.propertyRecords?.length ?? 0} props`, `${formatInteger(manifest.propertyRecords?.length ?? 0)} 属性`);
        };

        const updateFourDGSStatus = () => {
            if (!fourDGSState) {
                fourDGSStatus.hidden = true;
                return;
            }

            fourDGSStatus.hidden = false;
            if (fourDGSState.kind === 'native') {
                const nativeManifest = fourDGSState.manifest;
                const frameText = `帧 ${currentFrame + 1} / ${nativeManifest.frameCount}`;
                fourDGSLabel.text = `Native 4DGS ${nativeManifest.sceneName} | ${frameText} | ${formatNativeSummary(nativeManifest)} | ${nativeManifest.frameRate} fps`;
            } else {
                const bakedManifest = fourDGSState.manifest;
                const frameText = `帧 ${currentFrame + 1} / ${bakedManifest.frameCount}`;
                fourDGSLabel.text = `4DGS ${bakedManifest.sceneName} | ${frameText} | ${bakedManifest.frameRate} fps`;
            }
        };

        events.on('4dgs.package', (manifest: FourDGSManifest) => {
            fourDGSState = {
                kind: 'baked',
                manifest
            };
            currentFrame = events.invoke('timeline.frame') as number;
            updateFourDGSStatus();
        });

        events.on('native4dgs.loaded', (_clip: unknown, manifest: Native4DGSManifest) => {
            fourDGSState = {
                kind: 'native',
                manifest
            };
            currentFrame = events.invoke('timeline.frame') as number;
            updateFourDGSStatus();
        });

        events.on('timeline.frame', (frame: number) => {
            currentFrame = frame;
            updateFourDGSStatus();
        });

        events.on('scene.clear', () => {
            fourDGSState = null;
            updateFourDGSStatus();
        });

        let splat: Splat;

        const updateStats = () => {
            if (!splat) return;
            const state = splat.splatData.getProp('state') as Uint8Array;
            if (state) {
                splatsValue.text = formatInteger(state.length - splat.numDeleted);
                selectedValue.text = formatInteger(splat.numSelected);
                lockedValue.text = formatInteger(splat.numLocked);
                deletedValue.text = formatInteger(splat.numDeleted);
            }
        };

        events.on('splat.stateChanged', (splat_: Splat) => {
            splat = splat_;
            updateStats();
        });

        events.on('selection.changed', (selection: Element) => {
            if (selection instanceof Splat) {
                splat = selection;
                updateStats();
            }
        });
    }
}

export { StatusBar };
