from __future__ import annotations

import importlib.util
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EVALUATOR = ROOT / "scripts" / "evaluate_4dgs_images.py"

spec = importlib.util.spec_from_file_location("evaluate_4dgs_images", EVALUATOR)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def write_png(path: Path, values: np.ndarray) -> None:
    Image.fromarray(values.astype(np.uint8), mode="RGB").save(path)


identical_a = np.full((8, 8, 3), 64, dtype=np.uint8)
identical_b = np.full((8, 8, 3), 64, dtype=np.uint8)
metrics = module.compute_image_metrics(identical_a, identical_b)
assert metrics.mse == 0
assert math.isinf(metrics.psnr)
assert metrics.ssim == 1

shifted = np.full((8, 8, 3), 96, dtype=np.uint8)
shifted_metrics = module.compute_image_metrics(identical_a, shifted)
assert shifted_metrics.mse > 0
assert shifted_metrics.psnr < 25
assert shifted_metrics.ssim < 1

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    refs = root / "refs"
    renders = root / "renders"
    refs.mkdir()
    renders.mkdir()

    write_png(refs / "frame_000.png", identical_a)
    write_png(renders / "frame_000.png", identical_b)
    write_png(refs / "frame_001.png", identical_a)
    write_png(renders / "frame_001.png", shifted)

    pairs = module.collect_image_pairs(refs, renders)
    assert [pair.reference.name for pair in pairs] == ["frame_000.png", "frame_001.png"]

    report = module.evaluate_image_directories(refs, renders)
    assert report.frame_count == 2
    assert report.average_mse > 0
    assert report.average_psnr < float("inf")
    assert report.average_ssim < 1

print("4DGS image evaluation tests passed")
