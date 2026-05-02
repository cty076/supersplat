import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const splatSource = readFileSync('src/splat.ts', 'utf8');
const transformPaletteSource = readFileSync('src/transform-palette.ts', 'utf8');

assert.match(
    transformPaletteSource,
    /destroy:\s*\(\)\s*=>\s*void/,
    'TransformPalette should expose an explicit destroy method for its GPU texture'
);

assert.match(
    transformPaletteSource,
    /texture\?\.destroy\(\)/,
    'TransformPalette.destroy should release its backing texture'
);

assert.match(
    splatSource,
    /this\.stateTexture\?\.destroy\(\)/,
    'Splat.destroy should release the state texture allocated per frame'
);

assert.match(
    splatSource,
    /this\.transformTexture\?\.destroy\(\)/,
    'Splat.destroy should release the transform index texture allocated per frame'
);

assert.match(
    splatSource,
    /this\.transformPalette\?\.destroy\(\)/,
    'Splat.destroy should release the transform palette texture allocated per frame'
);

assert.match(
    splatSource,
    /this\.scene\?\.events\.fire\('splat\.name', this\)/,
    'Splat.name should not access scene.events before the splat has been added to a scene'
);

console.log('Splat resource lifecycle checks passed');
