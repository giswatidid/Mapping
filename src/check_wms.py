from __future__ import annotations

import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import requests

from . import config
from .radar import _fetch_registered_wms


DIAGNOSTICS_DIR = config.ROOT / "diagnostics"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local_name(child.tag) == name and child.text:
            value = child.text.strip()
            if value:
                return value
    return None


def _auth() -> tuple[str, str] | None:
    if config.BOM_RADAR_WMS_USERNAME:
        return (config.BOM_RADAR_WMS_USERNAME, config.BOM_RADAR_WMS_PASSWORD)
    return None


def _get_capabilities() -> tuple[ET.Element, str]:
    if not config.BOM_RADAR_WMS_URL:
        raise RuntimeError(
            "BOM_RADAR_WMS_URL is not configured. Add the registered GIS2Web endpoint as a repository secret."
        )

    response = requests.get(
        config.BOM_RADAR_WMS_URL,
        params={
            "SERVICE": "WMS",
            "REQUEST": "GetCapabilities",
            "VERSION": config.BOM_RADAR_WMS_VERSION or "1.1.1",
        },
        auth=_auth(),
        timeout=config.HTTP_TIMEOUT,
        headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "application/xml,text/xml,*/*",
        },
    )
    response.raise_for_status()
    return ET.fromstring(response.content), response.headers.get("Content-Type", "")


def _layers(root: ET.Element) -> list[dict[str, str | None]]:
    found: list[dict[str, str | None]] = []
    seen: set[str] = set()

    for element in root.iter():
        if _local_name(element.tag) != "Layer":
            continue
        name = _child_text(element, "Name")
        title = _child_text(element, "Title")
        if not name or name in seen:
            continue
        seen.add(name)
        found.append({"name": name, "title": title})

    return found


def _candidate_layers(layers: list[dict[str, str | None]]) -> list[dict[str, str | None]]:
    terms = ("radar", "rain", "rainfall", "precip", "reflect", "intensity")
    result = []
    for layer in layers:
        text = f"{layer.get('name') or ''} {layer.get('title') or ''}".lower()
        if any(term in text for term in terms):
            result.append(layer)
    return result


def main() -> int:
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)

    root, content_type = _get_capabilities()
    layers = _layers(root)
    candidates = _candidate_layers(layers)

    payload = {
        "service": "BOM Registered User GIS2Web WMS",
        "wms_version_requested": config.BOM_RADAR_WMS_VERSION,
        "capabilities_content_type": content_type,
        "layer_count": len(layers),
        "candidate_count": len(candidates),
        "candidate_layers": candidates,
        "configured_layer": config.BOM_RADAR_WMS_LAYER or None,
    }
    (DIAGNOSTICS_DIR / "wms-layers.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"WMS capabilities OK. {len(layers)} named layers advertised.")
    if candidates:
        print("Radar/rain candidates:")
        for layer in candidates:
            title = f" — {layer['title']}" if layer.get("title") else ""
            print(f"  {layer['name']}{title}")
    else:
        print("No radar/rain candidate names were found.")

    if config.BOM_RADAR_WMS_LAYER:
        frame = _fetch_registered_wms((151.6, -28.5, 153.8, -26.3))
        frame.image.save(DIAGNOSTICS_DIR / "wms-preview.png")
        print(
            "Configured layer GetMap OK: "
            f"{frame.layer}; image={frame.image.width}x{frame.image.height}"
        )
    else:
        print("No radar layer is configured yet; use the candidate list above.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"WMS CHECK FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
