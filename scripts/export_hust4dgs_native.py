from __future__ import annotations

import argparse
import json
import shutil
import sys
from argparse import Namespace
from pathlib import Path

import numpy as np
import torch


def load_cfg_args(model_path: Path) -> Namespace:
    cfg_path = model_path / "cfg_args"
    if not cfg_path.exists():
        raise FileNotFoundError(f"Missing cfg_args: {cfg_path}")
    text = cfg_path.read_text(encoding="utf-8")
    return eval(text, {"Namespace": Namespace})


def find_iteration_dir(model_path: Path, iteration: int | None) -> tuple[Path, int]:
    point_cloud_root = model_path / "point_cloud"
    if iteration is not None:
        directory = point_cloud_root / f"iteration_{iteration}"
        if not directory.exists():
            raise FileNotFoundError(f"Iteration directory not found: {directory}")
        return directory, iteration

    candidates = []
    for child in point_cloud_root.glob("iteration_*"):
        if child.is_dir():
            try:
                candidates.append((int(child.name.split("_", 1)[1]), child))
            except (IndexError, ValueError):
                pass
    if not candidates:
        raise FileNotFoundError(f"No iteration_* directories under {point_cloud_root}")
    iteration_value, directory = max(candidates, key=lambda item: item[0])
    return directory, iteration_value


CHANNEL_SIZES = {
    "xyz": 3,
    "scale": 3,
    "rotation": 4,
}


@torch.no_grad()
def sample_motion(gaussians, times: torch.Tensor, batch_size: int, channels: list[str]) -> np.ndarray:
    xyz = gaussians.get_xyz
    scales = gaussians._scaling
    rotations = gaussians._rotation
    opacity = gaussians._opacity
    shs = gaussians.get_features
    chunks = []

    for time_value in times:
        frame_chunks = []
        for start in range(0, xyz.shape[0], batch_size):
            end = min(xyz.shape[0], start + batch_size)
            time = time_value.repeat(end - start, 1)
            points, scales_final, rotations_final, _opacity, _shs = gaussians._deformation(
                xyz[start:end],
                scales[start:end],
                rotations[start:end],
                opacity[start:end],
                shs[start:end],
                time,
            )
            channel_tensors = []
            for channel in channels:
                if channel == "xyz":
                    channel_tensors.append(points)
                elif channel == "scale":
                    channel_tensors.append(scales_final)
                elif channel == "rotation":
                    channel_tensors.append(rotations_final)
                else:
                    raise ValueError(f"Unsupported channel: {channel}")
            frame_chunks.append(torch.cat(channel_tensors, dim=1).detach().cpu().numpy().astype(np.float32, copy=False))
        chunks.append(np.concatenate(frame_chunks, axis=0))

    return np.stack(chunks, axis=0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export HUST 4DGaussians checkpoint to 4dgs-native-trajectory package.")
    parser.add_argument("--repo", type=Path, default=Path("D:/research/4DGS/baselines/4DGaussians"), help="Path to HUST 4DGaussians repo.")
    parser.add_argument("--model-path", type=Path, required=True, help="Path to a trained 4DGaussians scene directory containing cfg_args.")
    parser.add_argument("--iteration", type=int, default=None, help="Iteration to export. Defaults to the largest iteration_* directory.")
    parser.add_argument("--output", type=Path, required=True, help="Output package directory.")
    parser.add_argument("--keyframes", type=int, default=48, help="Number of sampled motion keyframes.")
    parser.add_argument("--frame-count", type=int, default=160, help="Timeline frame count exposed to the viewer.")
    parser.add_argument("--frame-rate", type=float, default=30.0, help="Timeline frame rate exposed to the viewer.")
    parser.add_argument("--scene-name", type=str, default=None, help="Optional scene name. Defaults to model directory name.")
    parser.add_argument("--batch-size", type=int, default=65536, help="Point batch size for deformation sampling.")
    parser.add_argument("--channels", type=str, default="xyz,scale,rotation", help="Comma-separated motion channels. Supported: xyz,scale,rotation.")
    args = parser.parse_args()

    if args.keyframes < 2:
        raise ValueError("--keyframes must be at least 2")
    channels = [value.strip() for value in args.channels.split(",") if value.strip()]
    if not channels or channels[0] != "xyz":
        raise ValueError("--channels must start with xyz")
    if len(set(channels)) != len(channels):
        raise ValueError("--channels must not contain duplicates")
    unsupported = [channel for channel in channels if channel not in CHANNEL_SIZES]
    if unsupported:
        raise ValueError(f"Unsupported channels: {unsupported}")

    repo = args.repo.resolve()
    model_path = args.model_path.resolve()
    output = args.output.resolve()
    sys.path.insert(0, str(repo))

    from scene.gaussian_model import GaussianModel  # noqa: PLC0415

    cfg_args = load_cfg_args(model_path)
    iteration_dir, iteration = find_iteration_dir(model_path, args.iteration)
    point_cloud = iteration_dir / "point_cloud.ply"
    if not point_cloud.exists():
        raise FileNotFoundError(point_cloud)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise RuntimeError("This exporter currently uses the original HUST CUDA model loader; CUDA is required.")

    gaussians = GaussianModel(cfg_args.sh_degree, cfg_args)
    gaussians.load_ply(str(point_cloud))
    gaussians.load_model(str(iteration_dir))
    gaussians._deformation.eval()

    times = torch.linspace(0.0, 1.0, args.keyframes, device=device).reshape(-1, 1)
    motion = sample_motion(gaussians, times, args.batch_size, channels)

    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(point_cloud, output / "base.ply")
    motion.astype("<f4", copy=False).tofile(output / "motion.bin")

    manifest = {
        "format": "4dgs-native-trajectory",
        "version": 1,
        "sceneName": args.scene_name or model_path.name,
        "pointCount": int(motion.shape[1]),
        "keyframeCount": int(motion.shape[0]),
        "frameCount": int(args.frame_count),
        "frameRate": float(args.frame_rate),
        "timeMin": 0.0,
        "timeMax": 1.0,
        "baseFile": "base.ply",
        "motionFile": "motion.bin",
        "motion": {
            "encoding": "float32-le",
            "layout": "keyframes-points-xyz" if channels == ["xyz"] else "keyframes-points-channels",
            "channels": channels,
        },
        "source": {
            "method": "hustvl/4DGaussians sampled trajectory",
            "iteration": int(iteration),
            "modelPath": str(model_path),
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "output": str(output),
        "pointCount": manifest["pointCount"],
        "keyframeCount": manifest["keyframeCount"],
        "channels": channels,
        "motionBytes": int((output / "motion.bin").stat().st_size),
    }, indent=2))


if __name__ == "__main__":
    main()
