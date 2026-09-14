from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable
from datetime import datetime
from zoneinfo import ZoneInfo
import textwrap

import geopandas as gpd
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.colors import ListedColormap, BoundaryNorm
from matplotlib.cm import ScalarMappable

from .radar import RAIN_RATE_LEGEND, RAINVIEWER_REFLECTIVITY_LEGEND, fetch_bom_radar


def padded_bounds(gdf: gpd.GeoDataFrame, fraction: float = 0.09, minimum: float = 0.18) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = gdf.total_bounds
    dx = max(maxx - minx, minimum)
    dy = max(maxy - miny, minimum)
    padx = max(dx * fraction, minimum)
    pady = max(dy * fraction, minimum)
    return minx - padx, miny - pady, maxx + padx, maxy + pady


def clip_to_bounds(gdf: gpd.GeoDataFrame, bounds: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    minx, miny, maxx, maxy = bounds
    try:
        return gdf.cx[minx:maxx, miny:maxy]
    except Exception:
        return gdf


def _label_field(lgas: gpd.GeoDataFrame) -> str | None:
    candidates = (
        "LGA",
        "LGA_NAME",
        "LGA_NAME22",
        "LGA_NAME23",
        "LGA_NAME24",
        "LGA_NAME25",
        "LGA_NAME26",
        "NAME",
        "LOCALITY",
    )
    cols_upper = {str(c).upper(): c for c in lgas.columns}
    for candidate in candidates:
        if candidate in lgas.columns:
            return candidate
        if candidate.upper() in cols_upper:
            return cols_upper[candidate.upper()]
    for column in lgas.columns:
        if "name" in str(column).lower() and column != "geometry":
            return column
    return None


def _draw_lgas(
    ax: Any,
    lgas: gpd.GeoDataFrame,
    bounds: tuple[float, float, float, float],
    focus_gdf: gpd.GeoDataFrame | None = None,
) -> None:
    visible = clip_to_bounds(lgas, bounds)
    if visible.empty:
        return

    visible.boundary.plot(ax=ax, color="#5f6b73", linewidth=0.7, alpha=0.85, zorder=2)

    field = _label_field(visible)
    if not field:
        return

    # A combined warning overview can span hundreds of kilometres. Keep the
    # boundaries for context, but leave detailed LGA names to the individual
    # warning maps where they remain readable.
    if focus_gdf is not None and len(focus_gdf) > 1:
        return

    label_rows = visible
    focus_geometry = None
    if focus_gdf is not None and not focus_gdf.empty:
        try:
            focus_geometry = focus_gdf.geometry.unary_union
            label_rows = visible[visible.geometry.intersects(focus_geometry)].copy()
        except Exception:
            label_rows = visible
            focus_geometry = None

    minx, miny, maxx, maxy = bounds
    label_font = 6.2 if len(label_rows) > 12 else 6.8

    for _, row in label_rows.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        point = geom.representative_point()

        # GeoPandas bbox selection can include polygons whose representative point
        # sits outside the plotted frame. Never allow those labels to expand the
        # saved PNG beyond the actual map.
        if not (minx <= point.x <= maxx and miny <= point.y <= maxy):
            continue
        if focus_geometry is not None:
            try:
                if not focus_geometry.covers(point):
                    continue
            except Exception:
                pass

        text = str(row.get(field) or "").strip()
        if not text:
            continue

        ax.text(
            point.x,
            point.y,
            text,
            fontsize=label_font,
            color="#3d474e",
            ha="center",
            va="center",
            zorder=3,
            clip_on=True,
        )


def _draw_warning(ax: Any, warnings: gpd.GeoDataFrame) -> None:
    warnings.plot(
        ax=ax,
        facecolor="#ffd43b",
        edgecolor="#b23a00",
        linewidth=2.2,
        alpha=0.30,
        zorder=5,
    )


def _outage_size(row: Any) -> float:
    for field in ("affected_customers", "customers", "customer_count"):
        value = row.get(field) if hasattr(row, "get") else None
        try:
            customers = max(0.0, float(value))
            return min(220.0, 24.0 + customers ** 0.5 * 4.0)
        except Exception:
            continue
    return 34.0


def _draw_outages(ax: Any, outages: gpd.GeoDataFrame, bounds: tuple[float, float, float, float]) -> int:
    visible = clip_to_bounds(outages, bounds)
    if visible.empty:
        return 0

    xs: list[float] = []
    ys: list[float] = []
    sizes: list[float] = []
    minx, miny, maxx, maxy = bounds

    for _, row in visible.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        p = geom if geom.geom_type == "Point" else geom.centroid
        if not (minx <= p.x <= maxx and miny <= p.y <= maxy):
            continue
        xs.append(p.x)
        ys.append(p.y)
        sizes.append(_outage_size(row))

    if xs:
        ax.scatter(
            xs,
            ys,
            s=sizes,
            c="#dc2626",
            edgecolors="white",
            linewidths=0.7,
            alpha=0.9,
            zorder=8,
        )
    return len(xs)


def _set_extent(ax: Any, bounds: tuple[float, float, float, float]) -> None:
    minx, miny, maxx, maxy = bounds
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.grid(True, linewidth=0.35, alpha=0.22)


def _display_time(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("Australia/Brisbane"))
        local = parsed.astimezone(ZoneInfo("Australia/Brisbane"))
        return local.strftime("%d %b %Y %H:%M AEST")
    except Exception:
        return value


def _footer(ax: Any, lines: Iterable[str]) -> None:
    text = "  |  ".join(line for line in lines if line)
    ax.figure.text(0.5, 0.018, text, ha="center", va="bottom", fontsize=7.5, color="#4b5563")


def _figure_title(fig: Any, title: str) -> None:
    wrapped = textwrap.fill(title, width=72)
    fig.suptitle(
        wrapped,
        fontsize=13.5,
        fontweight="bold",
        x=0.5,
        y=0.975,
        ha="center",
        va="top",
    )


def render_outage_map(
    warning_gdf: gpd.GeoDataFrame,
    outages: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
) -> dict[str, Any]:
    bounds = padded_bounds(warning_gdf)
    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#f8fafc")

    _draw_lgas(ax, lgas, bounds, focus_gdf=warning_gdf)
    _draw_warning(ax, warning_gdf)
    outage_count = _draw_outages(ax, outages, bounds)
    _set_extent(ax, bounds)

    _figure_title(fig, title)
    legend = [
        Patch(facecolor="#ffd43b", edgecolor="#b23a00", alpha=0.35, label="BOM severe thunderstorm warning area"),
        Line2D([0], [0], color="#5f6b73", lw=1.1, label="Local government area boundary"),
        Line2D([0], [0], marker="o", color="w", markerfacecolor="#dc2626", markeredgecolor="white", markersize=9, label="Current unplanned power outage"),
    ]
    ax.legend(handles=legend, loc="lower left", framealpha=0.95, fontsize=9)

    footer = [f"Generated {_display_time(generated_at)}"]
    if warning_time:
        footer.append(f"Warning issued {_display_time(warning_time)}")
    footer.append(f"{outage_count} unplanned outage locations shown in map extent")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.03, 0.05, 0.97, 0.90))
    fig.savefig(output_path, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)

    return {"bounds": list(bounds), "outages_in_extent": outage_count}


def render_radar_map(
    warning_gdf: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
) -> dict[str, Any]:
    bounds = padded_bounds(warning_gdf)
    radar = fetch_bom_radar(bounds)

    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#e8eef2")
    minx, miny, maxx, maxy = bounds
    ax.imshow(
        radar.image,
        extent=(minx, maxx, miny, maxy),
        origin="upper",
        interpolation="bilinear",
        zorder=1,
    )

    visible_lgas = clip_to_bounds(lgas, bounds)
    if not visible_lgas.empty:
        visible_lgas.boundary.plot(
            ax=ax,
            color="white",
            linewidth=0.7,
            alpha=0.82,
            zorder=4,
        )

    warning_gdf.plot(
        ax=ax,
        facecolor="#ffd43b",
        edgecolor="#b42318",
        linewidth=2.6,
        alpha=0.13,
        zorder=7,
    )
    warning_gdf.boundary.plot(ax=ax, color="#b42318", linewidth=2.6, zorder=8)
    _set_extent(ax, bounds)

    _figure_title(fig, title)

    context_legend = [
        Patch(
            facecolor="#ffd43b",
            edgecolor="#b42318",
            alpha=0.28,
            label="BOM severe thunderstorm warning area",
        ),
        Line2D([0], [0], color="white", lw=1.4, label="Local government area boundary"),
    ]
    ax.legend(handles=context_legend, loc="lower left", framealpha=0.92, fontsize=8)

    if radar.legend_kind == "rain_rate":
        legend_spec = RAIN_RATE_LEGEND
        legend_title = "BOM radar rainfall intensity (mm/h)"
    else:
        legend_spec = RAINVIEWER_REFLECTIVITY_LEGEND
        legend_title = "Radar reflectivity (dBZ)"

    colours = [
        tuple(channel / 255 for channel in rgba[:3])
        for _, rgba in legend_spec
    ]
    labels = [label for label, _ in legend_spec]
    cmap = ListedColormap(colours)
    norm = BoundaryNorm(range(len(colours) + 1), cmap.N)
    scalar = ScalarMappable(norm=norm, cmap=cmap)
    scalar.set_array([])
    colorbar = fig.colorbar(
        scalar,
        ax=ax,
        fraction=0.035,
        pad=0.025,
        ticks=[index + 0.5 for index in range(len(labels))],
    )
    colorbar.ax.set_yticklabels(labels, fontsize=6.5)
    colorbar.set_label(legend_title, fontsize=8)

    footer = [
        f"Generated {_display_time(generated_at)}",
        f"Radar {_display_time(radar.timestamp)}" if radar.timestamp else "Latest radar mosaic",
        "Weather radar: RainViewer" if radar.provider == "rainviewer" else "Weather radar: Bureau of Meteorology",
    ]
    if warning_time:
        footer.append(f"Warning issued {_display_time(warning_time)}")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.03, 0.05, 0.97, 0.90))
    fig.savefig(output_path, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)

    return {
        "bounds": list(bounds),
        "radar_time": radar.timestamp,
        "radar_layer": radar.layer,
        "radar_tile_matrix": radar.tile_matrix,
        "radar_tiles": radar.tile_count,
        "radar_provider": radar.provider,
        "radar_legend": radar.legend_kind,
    }
