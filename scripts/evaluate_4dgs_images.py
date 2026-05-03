from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass(frozen=True)
class ImagePair:
    reference: Path
    rendered: Path


@dataclass(frozen=True)
class ImageMetrics:
    mse: float
    psnr: float
    ssim: float


@dataclass(frozen=True)
class FrameReport:
    filename: str
    mse: float
    psnr: float
    ssim: float


@dataclass(frozen=True)
class EvaluationReport:
    frame_count: int
    average_mse: float
    average_psnr: float
    average_ssim: float
    frames: list[FrameReport]


def load_rgb_image(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float32)


def compute_image_metrics(reference: np.ndarray, rendered: np.ndarray) -> ImageMetrics:
    if reference.shape != rendered.shape:
        raise ValueError(f"Image shapes differ: reference {reference.shape}, rendered {rendered.shape}")

    reference_f = reference.astype(np.float64, copy=False)
    rendered_f = rendered.astype(np.float64, copy=False)
    diff = reference_f - rendered_f
    mse = float(np.mean(diff * diff))
    psnr = math.inf if mse == 0 else float(20.0 * math.log10(255.0 / math.sqrt(mse)))

    mean_ref = float(np.mean(reference_f))
    mean_rendered = float(np.mean(rendered_f))
    var_ref = float(np.mean((reference_f - mean_ref) ** 2))
    var_rendered = float(np.mean((rendered_f - mean_rendered) ** 2))
    covariance = float(np.mean((reference_f - mean_ref) * (rendered_f - mean_rendered)))
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2
    ssim = ((2 * mean_ref * mean_rendered + c1) * (2 * covariance + c2)) / (
        (mean_ref ** 2 + mean_rendered ** 2 + c1) * (var_ref + var_rendered + c2)
    )

    return ImageMetrics(mse=mse, psnr=psnr, ssim=float(ssim))


def collect_image_pairs(reference_dir: Path, rendered_dir: Path) -> list[ImagePair]:
    reference_files = {
        path.name: path
        for path in reference_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    }
    rendered_files = {
        path.name: path
        for path in rendered_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    }

    missing_renders = sorted(set(reference_files) - set(rendered_files))
    missing_references = sorted(set(rendered_files) - set(reference_files))
    if missing_renders or missing_references:
        details = []
        if missing_renders:
            details.append(f"missing rendered frames: {', '.join(missing_renders[:5])}")
        if missing_references:
            details.append(f"missing reference frames: {', '.join(missing_references[:5])}")
        raise ValueError("; ".join(details))

    names = sorted(reference_files)
    if not names:
        raise ValueError("No matching image frames found")

    return [ImagePair(reference_files[name], rendered_files[name]) for name in names]


def evaluate_image_directories(reference_dir: Path, rendered_dir: Path) -> EvaluationReport:
    pairs = collect_image_pairs(reference_dir, rendered_dir)
    frames: list[FrameReport] = []

    for pair in pairs:
        metrics = compute_image_metrics(load_rgb_image(pair.reference), load_rgb_image(pair.rendered))
        frames.append(FrameReport(
            filename=pair.reference.name,
            mse=metrics.mse,
            psnr=metrics.psnr,
            ssim=metrics.ssim
        ))

    finite_psnr = [frame.psnr for frame in frames if math.isfinite(frame.psnr)]
    average_psnr = float(np.mean(finite_psnr)) if finite_psnr else math.inf

    return EvaluationReport(
        frame_count=len(frames),
        average_mse=float(np.mean([frame.mse for frame in frames])),
        average_psnr=average_psnr,
        average_ssim=float(np.mean([frame.ssim for frame in frames])),
        frames=frames
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate rendered 4DGS frames against reference images.")
    parser.add_argument("reference_dir", type=Path, help="Directory containing reference frames.")
    parser.add_argument("rendered_dir", type=Path, help="Directory containing rendered frames with matching filenames.")
    parser.add_argument("--json", action="store_true", help="Print the full report as JSON.")
    args = parser.parse_args()

    report = evaluate_image_directories(args.reference_dir, args.rendered_dir)
    if args.json:
        print(json.dumps(asdict(report), indent=2, allow_nan=True))
    else:
        print(f"Frames: {report.frame_count}")
        print(f"Average MSE: {report.average_mse:.6f}")
        psnr = "inf" if math.isinf(report.average_psnr) else f"{report.average_psnr:.4f}"
        print(f"Average PSNR: {psnr} dB")
        print(f"Average SSIM: {report.average_ssim:.6f}")


if __name__ == "__main__":
    main()
