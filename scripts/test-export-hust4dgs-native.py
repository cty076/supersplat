from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
EXPORTER = ROOT / "scripts" / "export_hust4dgs_native.py"

spec = importlib.util.spec_from_file_location("export_hust4dgs_native", EXPORTER)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

motion = np.array([0.0, 1.0, -2.0, 0.5], dtype=np.float32)

encoded_f32 = module.encode_motion_array(motion, "float32-le")
assert encoded_f32.dtype == np.dtype("<f4")
assert encoded_f32.nbytes == 16
np.testing.assert_allclose(encoded_f32, motion)

encoded_f16 = module.encode_motion_array(motion, "float16-le")
assert encoded_f16.dtype == np.dtype("<f2")
assert encoded_f16.nbytes == 8
np.testing.assert_allclose(encoded_f16.astype(np.float32), motion, rtol=1e-3, atol=1e-3)

try:
    module.encode_motion_array(motion, "bad")
except ValueError as error:
    assert "Unsupported motion encoding" in str(error)
else:
    raise AssertionError("unsupported motion encoding should raise")

print("HUST 4DGS native exporter encoding tests passed")
