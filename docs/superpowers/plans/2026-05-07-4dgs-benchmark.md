# 4DGS Benchmark 套件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个本地 benchmark 套件，统一比较原始 `PLY`、压缩 `PLY` 和原生 `4DGS` 包的体积、加载、渲染速度与图像质量。

**Architecture:** 共享的 TypeScript 模块负责配置、类型、报告和指标计算；Electron 负责在现有 viewer 渲染路径里执行批量帧采样；外层 Node CLI 负责按包批量启动 benchmark、收集结果并导出汇总。参考图通过自定义协议从本地目录读取，保证同一套评测逻辑可以覆盖三种格式。

**Tech Stack:** TypeScript, Node.js, Electron, 现有 `render.offscreen` 事件, `app://` 协议, JSON/Markdown 输出

---

### Task 1: 建立 benchmark 共享模块与测试基线

**Files:**
- Create: `src/4dgs-benchmark.ts`
- Create: `scripts/test-4dgs-benchmark.mjs`
- Modify: `package.json`

- [ ] **Step 1: 先写共享模块的最小测试**

```ts
// scripts/test-4dgs-benchmark.mjs
import assert from 'node:assert/strict';
import { formatBenchmarkSummary } from '../src/4dgs-benchmark.ts';

const report = formatBenchmarkSummary({
  sceneName: 'lego',
  packages: [{
    name: 'native-half',
    format: '4dgs-native',
    sizeBytes: 106100000,
    loadMs: 1200,
    firstFrameMs: 18.2,
    averageFps: 54.3,
    averagePsnr: 31.8,
    averageSsim: 0.9421
  }]
});

assert.match(report, /lego/);
assert.match(report, /native-half/);
assert.match(report, /4dgs-native/);
```

- [ ] **Step 2: 运行测试确认当前会失败**

Run: `node scripts/test-4dgs-benchmark.mjs`
Expected: fail because `src/4dgs-benchmark.ts` and the formatter do not exist yet

- [ ] **Step 3: 实现最小共享模块**

```ts
export type BenchmarkPackageFormat = 'ply' | 'compressed-ply' | '4dgs-native';

export type BenchmarkPackageReport = {
  name: string;
  format: BenchmarkPackageFormat;
  sizeBytes: number;
  loadMs: number;
  firstFrameMs: number;
  averageFps: number;
  averagePsnr: number;
  averageSsim: number;
};

export type BenchmarkSceneReport = {
  sceneName: string;
  packages: BenchmarkPackageReport[];
};

export const formatBenchmarkSummary = (report: BenchmarkSceneReport) => {
  return [
    `Scene: ${report.sceneName}`,
    ...report.packages.map((pkg) => {
      return `${pkg.name} | ${pkg.format} | ${(pkg.sizeBytes / 1024 / 1024).toFixed(2)} MB | PSNR ${pkg.averagePsnr.toFixed(2)} | SSIM ${pkg.averageSsim.toFixed(4)} | FPS ${pkg.averageFps.toFixed(1)}`;
    })
  ].join('\n');
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test-4dgs-benchmark.mjs`
Expected: PASS

- [ ] **Step 5: 把 benchmark 命令接到 `package.json`**

Add scripts:

```json
{
  "scripts": {
    "test:4dgs-benchmark": "node scripts/test-4dgs-benchmark.mjs",
    "benchmark:4dgs": "node scripts/run-4dgs-benchmark.mjs"
  }
}
```

- [ ] **Step 6: 提交**

```bash
git add src/4dgs-benchmark.ts scripts/test-4dgs-benchmark.mjs package.json
git commit -m "feat: add 4DGS benchmark shared module"
```

### Task 2: 给 Electron 增加 benchmark 模式和参考图协议

**Files:**
- Modify: `electron/main.cjs`
- Create: `scripts/test-electron-benchmark-mode.mjs`

- [ ] **Step 1: 先写一个只检查源码特征的测试**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('electron/main.cjs', 'utf8');
assert.match(source, /ELECTRON_BENCHMARK_SPEC/);
assert.match(source, /ELECTRON_BENCHMARK_REFERENCE_ROOT/);
assert.match(source, /runFourDGSBenchmark/);
assert.match(source, /__benchmark_reference__/);
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node scripts/test-electron-benchmark-mode.mjs`
Expected: fail because benchmark mode is not present yet

- [ ] **Step 3: 实现 benchmark 启动与结果导出**

```js
// 关键行为：
// 1. 新增 benchmark 协议根目录映射
// 2. 新增 runFourDGSBenchmark(win)：
//    - 等待 window.scene.events
//    - 等待 native 4DGS / ply sequence 就绪
//    - 按 frame list 调用 timeline.setFrame 或 plysequence.setFrameAsync
//    - 调用 render.offscreen(width, height)
//    - 读取参考图，计算 MSE / PSNR / SSIM
//    - 写出 JSON 报告到 EGRESS 路径
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node scripts/test-electron-benchmark-mode.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/main.cjs scripts/test-electron-benchmark-mode.mjs
git commit -m "feat: add Electron 4DGS benchmark mode"
```

### Task 3: 实现批量 runner 和报告导出

**Files:**
- Create: `scripts/run-4dgs-benchmark.mjs`
- Create: `benchmarks/4dgs-benchmark.sample.json`
- Modify: `package.json`

- [ ] **Step 1: 先写 runner 测试，验证 manifest 解析和报告路径拼接**

```js
import assert from 'node:assert/strict';
import { resolveBenchmarkOutputName } from '../scripts/run-4dgs-benchmark.mjs';
assert.equal(resolveBenchmarkOutputName('lego-native-half.4dgs-native'), 'lego-native-half');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/test-4dgs-benchmark-runner.mjs`
Expected: fail because the runner helper does not exist yet

- [ ] **Step 3: 实现 runner**

```js
// 关键行为：
// - 读取 benchmark manifest
// - 逐个 package 启动 Electron
// - 传入：
//   ELECTRON_BENCHMARK_SPEC
//   ELECTRON_BENCHMARK_REFERENCE_ROOT
//   ELECTRON_BENCHMARK_OUTPUT
// - 汇总每个 package 的 JSON 报告
// - 生成 markdown summary 和 overall JSON
```

- [ ] **Step 4: 运行 sample manifest**

Run: `npm run benchmark:4dgs -- benchmarks/4dgs-benchmark.sample.json`
Expected: 生成每个包的结果文件和总报告

- [ ] **Step 5: 提交**

```bash
git add scripts/run-4dgs-benchmark.mjs benchmarks/4dgs-benchmark.sample.json package.json
git commit -m "feat: add 4DGS benchmark runner"
```

### Task 4: 增加结果对比与最终验证

**Files:**
- Modify: `src/4dgs-benchmark.ts`
- Modify: `scripts/test-4dgs-benchmark.mjs`
- Create: `scripts/test-4dgs-benchmark-report.mjs`

- [ ] **Step 1: 补一组报告格式测试**

```ts
assert.match(formatBenchmarkSummary(report), /MB/);
assert.match(formatBenchmarkSummary(report), /PSNR/);
assert.match(formatBenchmarkSummary(report), /SSIM/);
assert.match(formatBenchmarkSummary(report), /FPS/);
```

- [ ] **Step 2: 运行单测和 lint**

Run: `npm run test:4dgs-benchmark && npm run lint`
Expected: both pass

- [ ] **Step 3: 跑一次真实 package smoke benchmark**

Run:

```bash
npm run benchmark:4dgs -- benchmarks/4dgs-benchmark.sample.json
```

Expected:
- 输出 JSON
- 输出 markdown 汇总
- 每个包都记录 size / load / firstFrame / FPS / PSNR / SSIM

- [ ] **Step 4: 提交**

```bash
git add src/4dgs-benchmark.ts scripts/run-4dgs-benchmark.mjs scripts/test-4dgs-benchmark*.mjs
git commit -m "test: verify 4DGS benchmark reports"
```

