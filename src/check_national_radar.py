from __future__ import annotations

from datetime import datetime, timezone
from ftplib import FTP
from io import BytesIO
import json
from pathlib import Path
import re
import sys

from PIL import Image
import requests


OUT = Path("diagnostics/national-radar")
OUT.mkdir(parents=True, exist_ok=True)

WEB_IMAGE = "https://www.bom.gov.au/radar/IDR00004.jpg"
FTP_HOST = "ftp.bom.gov.au"
RADAR_DIR = "/anon/gen/radar"
COORD_DIR = "/anon/gen/radar_transparencies/coordinates"
TIMEOUT = 45

HEADERS = {
    "User-Agent": "QueenslandSevereThunderstormMapping/IDR00004-test",
    "Accept": "image/jpeg,image/png,image/*,*/*",
}


def inspect_image(data: bytes, filename: str) -> dict:
    image = Image.open(BytesIO(data))
    image.load()
    image.save(OUT / filename)
    return {
        "format": image.format,
        "mode": image.mode,
        "size": list(image.size),
        "bytes": len(data),
    }


def test_web_image() -> dict:
    r = requests.get(WEB_IMAGE, timeout=TIMEOUT, headers=HEADERS)
    result = {
        "url": r.url,
        "status": r.status_code,
        "content_type": r.headers.get("Content-Type"),
        "last_modified": r.headers.get("Last-Modified"),
        "date": r.headers.get("Date"),
        "cache_control": r.headers.get("Cache-Control"),
    }
    print("WEB", json.dumps(result, indent=2))
    r.raise_for_status()
    result["image"] = inspect_image(r.content, "IDR00004-web.jpg")
    return result


def ftp_connect() -> FTP:
    ftp = FTP(timeout=TIMEOUT)
    ftp.connect(FTP_HOST, 21)
    ftp.login()
    ftp.set_pasv(True)
    return ftp


def ftp_list(ftp: FTP, directory: str) -> list[str]:
    ftp.cwd(directory)
    names = ftp.nlst()
    print(f"FTP {directory}: {len(names)} entries")
    return names


def retrieve(ftp: FTP, directory: str, name: str) -> bytes:
    ftp.cwd(directory)
    buffer = BytesIO()
    ftp.retrbinary(f"RETR {name}", buffer.write)
    return buffer.getvalue()


def test_ftp() -> dict:
    ftp = ftp_connect()
    result: dict = {
        "host": FTP_HOST,
        "radar_files": [],
        "coordinate_files": [],
        "latest_file": None,
        "latest_image": None,
        "coordinate_contents": {},
    }
    try:
        radar_names = ftp_list(ftp, RADAR_DIR)
        pattern = re.compile(r"^IDR00004\.T\.(\d{12})\.png$")
        radar_matches = []
        for name in radar_names:
            base = name.rsplit("/", 1)[-1]
            m = pattern.match(base)
            if m:
                radar_matches.append((m.group(1), base))
        radar_matches.sort()
        result["radar_files"] = [name for _, name in radar_matches[-20:]]

        if radar_matches:
            stamp, latest = radar_matches[-1]
            result["latest_file"] = latest
            data = retrieve(ftp, RADAR_DIR, latest)
            result["latest_image"] = inspect_image(data, "IDR00004-latest.png")
            result["latest_timestamp_utc"] = datetime.strptime(
                stamp, "%Y%m%d%H%M"
            ).replace(tzinfo=timezone.utc).isoformat()
            print("Latest national mosaic:", latest)

        coord_names = ftp_list(ftp, COORD_DIR)
        candidates = sorted(
            name.rsplit("/", 1)[-1]
            for name in coord_names
            if "IDR00004" in name.upper() or name.rsplit("/", 1)[-1].upper().startswith("IDR0000")
        )
        result["coordinate_files"] = candidates

        # Retrieve every obvious national-mosaic coordinate candidate, plus a
        # small sample of coordinate files so the file syntax can be inspected.
        chosen = candidates[:]
        if not chosen:
            chosen = sorted(name.rsplit("/", 1)[-1] for name in coord_names if name.endswith(".map"))[:8]

        for name in chosen[:20]:
            try:
                raw = retrieve(ftp, COORD_DIR, name)
                text = raw.decode("utf-8", errors="replace")
                result["coordinate_contents"][name] = text[:10000]
                (OUT / name.replace("/", "_")).write_bytes(raw)
                print(f"Coordinate {name}:")
                print(text[:2000])
            except Exception as exc:
                result["coordinate_contents"][name] = f"ERROR: {type(exc).__name__}: {exc}"
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()

    return result


def main() -> int:
    summary = {"web": None, "ftp": None, "errors": []}

    try:
        summary["web"] = test_web_image()
    except Exception as exc:
        summary["errors"].append(f"web: {type(exc).__name__}: {exc}")
        print(summary["errors"][-1], file=sys.stderr)

    try:
        summary["ftp"] = test_ftp()
    except Exception as exc:
        summary["errors"].append(f"ftp: {type(exc).__name__}: {exc}")
        print(summary["errors"][-1], file=sys.stderr)

    (OUT / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print("\nSUMMARY")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    return 0 if summary["web"] or summary["ftp"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
