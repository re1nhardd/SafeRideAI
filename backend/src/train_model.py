"""Optional fine-tuning. Supply a real, labeled YOLO dataset; no dataset is bundled."""

import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        required=True,
        type=Path,
        help="YOLO dataset YAML with train/val splits",
    )
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--device", default="cpu", help="cpu, 0, etc.")
    args = parser.parse_args()
    if not args.data.is_file():
        parser.error(
            "Dataset YAML does not exist. Supply a labeled training/validation dataset."
        )
    from ultralytics import YOLO

    model = YOLO(args.model)
    result = model.train(
        data=str(args.data.resolve()), epochs=args.epochs, imgsz=640, device=args.device
    )
    print(f"Weights: {result.save_dir}/weights/best.pt")
    print(
        "Set SAFERIDE_YOLO_MODEL to the absolute weights path to use them. Class names must match cell phone/book/laptop."
    )


if __name__ == "__main__":
    main()
