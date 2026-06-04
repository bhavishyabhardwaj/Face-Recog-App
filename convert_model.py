#!/usr/bin/env python3
"""
Convert a MobileFaceNet / ArcFace-lite model to a mobile TFLite file.

This script CONVERTS an existing trained model; it does not train one.
Get a pretrained MobileFaceNet first, e.g.:
  - https://github.com/sirius-ai/MobileFaceNet_TF  (TF SavedModel / ckpt)
  - https://github.com/deepinsight/insightface     (export to ONNX -> SavedModel)
Then point --saved_model at it.

Default output is FLOAT16 quantized: ~2 MB, float32 I/O, simple + accurate, and
well under the 20 MB target. Use --int8 for the smallest model (note: then feed
uint8 input and dequantize the output — adjust config.ts + faceRecognition.ts).

Usage:
  python convert_model.py --saved_model ./mobilefacenet_savedmodel \
                          --out ../src/assets/models/mobilefacenet.tflite
  python convert_model.py --saved_model ./m --int8 --rep_dir ./calib_faces --out model.tflite
"""
import argparse
import glob
import os

import numpy as np
import tensorflow as tf

INPUT_SIZE = 112  # MobileFaceNet standard


def representative_dataset(rep_dir):
    """Yield ~100 calibration samples for full INT8 quantization."""
    paths = glob.glob(os.path.join(rep_dir, "*"))[:100]
    if not paths:
        # Fall back to random noise so conversion still succeeds (lower accuracy).
        for _ in range(100):
            yield [np.random.rand(1, INPUT_SIZE, INPUT_SIZE, 3).astype(np.float32)]
        return
    for p in paths:
        raw = tf.io.read_file(p)
        img = tf.image.decode_image(raw, channels=3, expand_animations=False)
        img = tf.image.resize(img, [INPUT_SIZE, INPUT_SIZE])
        img = (tf.cast(img, tf.float32) - 127.5) / 128.0
        yield [tf.expand_dims(img, 0).numpy()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saved_model", required=True, help="Path to TF SavedModel dir or .h5")
    ap.add_argument("--out", required=True, help="Output .tflite path")
    ap.add_argument("--int8", action="store_true", help="Full INT8 (smallest; needs rep data)")
    ap.add_argument("--rep_dir", default="", help="Folder of calibration face images for --int8")
    args = ap.parse_args()

    if args.saved_model.endswith(".h5"):
        model = tf.keras.models.load_model(args.saved_model, compile=False)
        converter = tf.lite.TFLiteConverter.from_keras_model(model)
    else:
        converter = tf.lite.TFLiteConverter.from_saved_model(args.saved_model)

    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    if args.int8:
        converter.representative_dataset = lambda: representative_dataset(args.rep_dir)
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        converter.inference_input_type = tf.uint8
        converter.inference_output_type = tf.uint8
        print("[mode] full INT8 (uint8 I/O)")
    else:
        converter.target_spec.supported_types = [tf.float16]
        print("[mode] float16 (float32 I/O)")

    tflite = converter.convert()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(tflite)

    size_mb = os.path.getsize(args.out) / (1024 * 1024)
    print(f"[ok] wrote {args.out}  ({size_mb:.2f} MB)")

    # Report I/O so you can reconcile config.ts.
    interp = tf.lite.Interpreter(model_path=args.out)
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    print(f"[input ] shape={inp['shape']} dtype={inp['dtype']}")
    print(f"[output] shape={out['shape']} dtype={out['dtype']}")
    print("Set MODEL.inputSize / MODEL.embeddingDim in src/config.ts to match the above.")


if __name__ == "__main__":
    main()
