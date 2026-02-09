import argparse
import os
import sys
import urllib.request


def download(url: str, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    filename = os.path.basename(url.split("?")[0])
    dest = os.path.join(out_dir, filename)

    with urllib.request.urlopen(url) as resp, open(dest, "wb") as f:
        total = resp.length or 0
        downloaded = 0
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = int(downloaded * 100 / total)
                print(f"{filename}: {pct}%", end="\r", flush=True)
    print(f"{filename}: done -> {dest}")
    return dest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="models/piper")
    parser.add_argument("--url", action="append", required=True, help="Model URL (.onnx or .json). Can be repeated.")
    args = parser.parse_args()

    for url in args.url:
        download(url, args.out_dir)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
