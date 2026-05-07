# 4DGS Compression Benchmark Design

## Goal

Build a local benchmark suite for comparing 4D Gaussian Splatting packages across three formats:

1. Raw `PLY`
2. Compressed `PLY`
3. Native `4DGS` packages (`manifest.json`, `base.ply`, `motion.bin`)

The benchmark should produce repeatable, scene-level comparisons for file size, image quality, playback speed, and loading behavior.

## Non-Goals

- Training new 4DGS models
- Rewriting the renderer itself
- Adding new compression algorithms in the first pass
- Benchmarking arbitrary external viewers

## Proposed Structure

### 1. Package Catalog

Each benchmark target is described by a manifest entry with:

- display name
- format type
- source path
- scene name
- frame range or keyframe metadata if available
- notes for special handling

This keeps the benchmark runner format-agnostic.

### 2. Render Adapter Layer

A small adapter layer loads each package type through the existing runtime path:

- raw `PLY` -> current viewer path
- compressed `PLY` -> current viewer path
- native `4DGS` -> native runtime path

All adapters must emit the same reference frame sequence for the same scene and camera path.

### 3. Metrics Collector

Collect the following per package:

- package size on disk
- load time
- first-frame render time
- average FPS during playback
- frame-by-frame PSNR
- frame-by-frame SSIM
- optional visual failure flags such as missing frames or visible flicker

### 4. Result Export

Export benchmark results as:

- human-readable markdown summary
- machine-readable JSON
- optional CSV for plotting

## Benchmark Flow

1. Select a scene and reference frame set.
2. Register all package variants for that scene.
3. Render each package through the same camera path and playback schedule.
4. Compare rendered frames to the reference frames.
5. Record timing and quality metrics.
6. Emit a combined report for all variants.

## Comparison Rules

- Use identical frame names for reference and rendered outputs.
- Use the same resolution for all variants.
- Use the same camera path and frame count per scene.
- If a package cannot render a frame, record the failure explicitly instead of skipping it silently.

## Implementation Phases

### Phase 1: Core Harness

- Package manifest format
- Runner CLI
- Metric aggregation
- JSON and markdown output

### Phase 2: Scene Adapters

- Adapter for raw `PLY`
- Adapter for compressed `PLY`
- Adapter for native `4DGS`

### Phase 3: Convenience Tools

- Preset benchmark sets
- Batch run script
- Result comparison table

## Risks

- Different package types may not share identical camera compatibility.
- Some quality differences will come from format limitations rather than compression quality alone.
- FPS numbers can vary with hardware and should be treated as local machine measurements, not universal constants.

## Success Criteria

- One command can benchmark all supported package types for a scene.
- The output clearly shows the trade-off between size and quality.
- Results are stable enough to compare different compression settings over time.

