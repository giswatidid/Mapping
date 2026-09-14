from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

import requests
from PIL import Image
from io import BytesIO

BASE = "https://mapping.psba.qld.gov.au/AAMGeoservices/rest/services/BOMWMSv2/MapServer"
OUT = Path("diagnostics/psba")
TIMEOUT = 45
HEADERS = {
    "User-Agent": "QueenslandSevereThunderstormMapping/psba-check",
    "Accept": "application/json,image/png,image/*,*/*",
}


def fetch_json(url: str) -> dict[str, Any]:
    r = requests.get(url, params={"f": "pjson"}, timeout=TIMEOUT, headers=HEADERS)
    print(f"GET {r.url} -> HTTP {r.status_code} {r.headers.get('Content-Type','')}")
    r.raise_for_status()
    payload = r.json()
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(f"ArcGIS error: {payload['error']}")
    return payload


def export_layer(layer_id: int, name: str) -> dict[str, Any]:
    # Southeast Queensland test extent.
    params = {
        "bbox": "151.5,-28.6,153.9,-26.2",
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": "1200,1200",
        "dpi": "96",
        "format": "png32",
        "transparent": "true",
        "layers": f"show:{layer_id}",
        "f": "image",
    }
    url = f"{BASE}/export"
    r = requests.get(url, params=params, timeout=TIMEOUT, headers=HEADERS)
    content_type = r.headers.get("Content-Type", "")
    print(f"EXPORT layer {layer_id} -> HTTP {r.status_code} {content_type} bytes={len(r.content)}")
    r.raise_for_status()

    if "image" not in content_type.lower():
        preview = r.text[:1000] if r.text else ""
        raise RuntimeError(f"Layer {layer_id} export was not an image: {preview}")

    image = Image.open(BytesIO(r.content)).convert("RGBA")
    path = OUT / f"{name}.png"
    image.save(path)

    alpha = image.getchannel("A")
    extrema = alpha.getextrema()
    bbox = alpha.getbbox()
    nontransparent = 0
    if bbox is not None:
        histogram = alpha.histogram()
        nontransparent = sum(histogram[1:])

    result = {
        "layer_id": layer_id,
        "http_status": r.status_code,
        "content_type": content_type,
        "bytes": len(r.content),
        "image_size": list(image.size),
        "alpha_extrema": list(extrema),
        "alpha_bbox": list(bbox) if bbox else None,
        "nontransparent_pixels": nontransparent,
        "file": str(path),
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "base": BASE,
        "service": None,
        "layers": {},
        "exports": {},
        "errors": [],
    }

    checks = [
        ("service", BASE),
        ("37", f"{BASE}/37"),
        ("58", f"{BASE}/58"),
    ]

    for key, url in checks:
        try:
            payload = fetch_json(url)
            (OUT / f"{key}.json").write_text(
                json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            if key == "service":
                summary["service"] = {
                    "currentVersion": payload.get("currentVersion"),
                    "serviceDescription": payload.get("serviceDescription"),
                    "mapName": payload.get("mapName"),
                    "supportsDynamicLayers": payload.get("supportsDynamicLayers"),
                    "capabilities": payload.get("capabilities"),
                    "layer_count": len(payload.get("layers") or []),
                }
            else:
                summary["layers"][key] = {
                    "name": payload.get("name"),
                    "type": payload.get("type"),
                    "description": payload.get("description"),
                    "capabilities": payload.get("capabilities"),
                    "minScale": payload.get("minScale"),
                    "maxScale": payload.get("maxScale"),
                    "defaultVisibility": payload.get("defaultVisibility"),
                    "parentLayer": payload.get("parentLayer"),
                    "subLayers": payload.get("subLayers"),
                    "supportsStatistics": payload.get("supportsStatistics"),
                    "supportsAdvancedQueries": payload.get("supportsAdvancedQueries"),
                    "extent": payload.get("extent"),
                }
        except Exception as exc:
            message = f"{key}: {type(exc).__name__}: {exc}"
            summary["errors"].append(message)
            print(message, file=sys.stderr)

    for layer_id, name in [(37, "radar-rain-rate"), (58, "severe-thunderstorm-warning")]:
        try:
            summary["exports"][str(layer_id)] = export_layer(layer_id, name)
        except Exception as exc:
            message = f"export {layer_id}: {type(exc).__name__}: {exc}"
            summary["errors"].append(message)
            print(message, file=sys.stderr)

    (OUT / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print("\nSUMMARY")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    # This diagnostic should fail only if the service itself is unreachable.
    if summary["service"] is None:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
