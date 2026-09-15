from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable
from datetime import datetime
from zoneinfo import ZoneInfo
import textwrap

import geopandas as gpd
from shapely.geometry import box
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


def statewide_bounds(
    lgas: gpd.GeoDataFrame,
    state_border: gpd.GeoDataFrame | None = None,
    coastline: gpd.GeoDataFrame | None = None,
    fraction: float = 0.025,
) -> tuple[float, float, float, float]:
    """Return a stable whole-of-Queensland map extent.

    Prefer the true Queensland border/coastline rather than LGA polygons because
    several coastal LGAs extend offshore and otherwise make the state look wider
    than its actual land/coastline outline.
    """
    # The FoundationData Queensland Border layer contains the full state
    # outline and is the preferred statewide extent. Older/interstate-only
    # border layers do not reach Cape York, so only trust a border whose span
    # is clearly statewide.
    if state_border is not None and not state_border.empty:
        try:
            minx, miny, maxx, maxy = [float(v) for v in state_border.total_bounds]
            if (maxy - miny) >= 15.0 and (maxx - minx) >= 10.0:
                dx = maxx - minx
                dy = maxy - miny
                return (
                    minx - dx * fraction,
                    miny - dy * fraction,
                    maxx + dx * fraction,
                    maxy + dy * fraction,
                )
        except Exception:
            pass

    # Fallback for installations still configured with separate coastline and
    # interstate-border layers.
    outline_bounds: list[tuple[float, float, float, float]] = []
    for candidate in (coastline, state_border):
        if candidate is None or candidate.empty:
            continue
        try:
            values = tuple(float(v) for v in candidate.total_bounds)
            if values[2] > values[0] and values[3] > values[1]:
                outline_bounds.append(values)
        except Exception:
            continue

    if outline_bounds:
        minx = min(item[0] for item in outline_bounds)
        miny = min(item[1] for item in outline_bounds)
        maxx = max(item[2] for item in outline_bounds)
        maxy = max(item[3] for item in outline_bounds)
        dx = maxx - minx
        dy = maxy - miny
        return (
            minx - dx * fraction,
            miny - dy * fraction,
            maxx + dx * fraction,
            maxy + dy * fraction,
        )

    if lgas is not None and not lgas.empty:
        try:
            minx, miny, maxx, maxy = [float(v) for v in lgas.total_bounds]
            dx = maxx - minx
            dy = maxy - miny
            return (
                minx - dx * fraction,
                miny - dy * fraction,
                maxx + dx * fraction,
                maxy + dy * fraction,
            )
        except Exception:
            pass

    return (137.5, -29.6, 154.0, -8.8)


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
    show_labels: bool = True,
    land_mask: gpd.GeoDataFrame | None = None,
    radar_background: bool = False,
) -> None:
    visible = clip_to_bounds(lgas, bounds)
    if visible.empty:
        return

    # Statewide LGA polygons include marine administration areas. On quiet-day
    # statewide maps, clip them to the Queensland mainland so those offshore
    # straight-line boundaries do not masquerade as a coastline.
    if land_mask is not None and not land_mask.empty:
        try:
            mask_geometry = land_mask.geometry.unary_union
            visible = visible.copy()
            visible["geometry"] = visible.geometry.intersection(mask_geometry)
            visible = visible[~visible.geometry.is_empty].copy()
        except Exception:
            pass

    line_color = "white" if radar_background else "#7a8790"
    line_alpha = 0.72 if radar_background else 0.68
    visible.boundary.plot(
        ax=ax,
        color=line_color,
        linewidth=0.55,
        alpha=line_alpha,
        zorder=3 if radar_background else 2,
    )

    if not show_labels:
        return

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


def _draw_qld_outline(
    ax: Any,
    coastline: gpd.GeoDataFrame | None,
    state_border: gpd.GeoDataFrame | None,
    bounds: tuple[float, float, float, float],
    *,
    radar_background: bool = False,
) -> None:
    """Draw the true coastline/state border above LGA boundaries."""
    layers = []
    if coastline is not None and not coastline.empty:
        layers.append(clip_to_bounds(coastline, bounds))
    if state_border is not None and not state_border.empty:
        layers.append(clip_to_bounds(state_border, bounds))

    for layer in layers:
        if layer.empty:
            continue
        if radar_background:
            # White casing makes the outline survive strong radar colours.
            layer.plot(
                ax=ax,
                color="white",
                linewidth=2.4,
                alpha=0.95,
                zorder=5,
            )
            layer.plot(
                ax=ax,
                color="#263238",
                linewidth=1.15,
                alpha=0.98,
                zorder=5.1,
            )
        else:
            layer.plot(
                ax=ax,
                color="#344054",
                linewidth=1.45,
                alpha=0.98,
                zorder=5,
            )


def _place_legend(
    fig: Any,
    handles: list[Any],
    *,
    fontsize: float = 8.2,
) -> None:
    """Place map keys below the map frame rather than over data."""
    if not handles:
        return

    columns = min(3, max(1, len(handles)))
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.047),
        ncol=columns,
        framealpha=0.96,
        fontsize=fontsize,
        borderaxespad=0.0,
        handlelength=2.4,
        columnspacing=1.4,
    )


def _draw_warning(
    ax: Any,
    warnings: gpd.GeoDataFrame,
    *,
    radar_background: bool = False,
) -> None:
    """Draw warnings so they remain visible without obscuring outages/radar."""
    if warnings is None or warnings.empty:
        return

    # Warning fill stays underneath outage areas. On radar maps it is made very
    # faint so reflectivity remains readable; the strong amber outline carries
    # the warning geometry.
    warnings.plot(
        ax=ax,
        facecolor="#ffd43b",
        edgecolor="none",
        alpha=0.05 if radar_background else 0.16,
        zorder=4,
    )
    warnings.boundary.plot(
        ax=ax,
        color="#b45309",
        linewidth=2.4 if radar_background else 2.2,
        alpha=0.98,
        linestyle="--" if radar_background else "-",
        zorder=9,
    )


_CUSTOMER_FIELDS = (
    "affected_customers",
    "customers_affected",
    "customers",
    "customer_count",
    "cust_affected",
    "n_customers",
)


def _affected_customers(row: Any) -> int | None:
    if not hasattr(row, "get"):
        return None

    known = row.get("affected_customers_known")
    if known is False or str(known).strip().lower() in {"false", "no", "0"}:
        return None

    for field in _CUSTOMER_FIELDS:
        value = row.get(field)
        if value is None or value == "":
            continue
        try:
            number = int(round(float(value)))
            if number >= 0:
                return number
        except (TypeError, ValueError):
            continue
    return None


def _outage_size(row: Any) -> float:
    customers = _affected_customers(row)
    if customers is None:
        return 34.0
    return min(220.0, 24.0 + customers ** 0.5 * 4.0)


def _label_limit(bounds: tuple[float, float, float, float]) -> int:
    minx, miny, maxx, maxy = bounds
    span = max(maxx - minx, maxy - miny)
    if span >= 10:
        return 12
    if span >= 5:
        return 18
    return 30


def _draw_customer_labels(
    ax: Any,
    candidates: list[tuple[int, Any]],
    bounds: tuple[float, float, float, float],
) -> int:
    """Draw highest-impact customer labels while suppressing collisions."""
    if not candidates:
        return 0

    minx, miny, maxx, maxy = bounds
    candidates = sorted(candidates, key=lambda item: item[0], reverse=True)
    limit = _label_limit(bounds)

    # Ensure transforms and text metrics are available before collision checks.
    ax.figure.canvas.draw()
    renderer = ax.figure.canvas.get_renderer()
    accepted: list[Any] = []
    shown = 0

    for customers, point in candidates:
        if shown >= limit:
            break
        if not (minx <= point.x <= maxx and miny <= point.y <= maxy):
            continue

        text = ax.text(
            point.x,
            point.y,
            f"{customers:,}",
            ha="center",
            va="center",
            fontsize=7.0,
            fontweight="bold",
            color="#7f1d1d",
            zorder=12,
            clip_on=True,
            bbox={
                "boxstyle": "round,pad=0.18",
                "facecolor": "white",
                "edgecolor": "#991b1b",
                "linewidth": 0.7,
                "alpha": 0.90,
            },
        )
        bbox = text.get_window_extent(renderer=renderer).expanded(1.08, 1.18)

        if any(bbox.overlaps(existing) for existing in accepted):
            text.remove()
            continue

        accepted.append(bbox)
        shown += 1

    return shown


def _draw_outages(
    ax: Any,
    outages: gpd.GeoDataFrame,
    bounds: tuple[float, float, float, float],
    *,
    radar_background: bool = False,
) -> dict[str, int]:
    """Draw true outage geometry and customer labels.

    Draw order is deliberate:
      radar/base -> LGAs -> warning fill -> outage areas -> warning outline ->
      customer labels.
    """
    visible = clip_to_bounds(outages, bounds)
    if visible.empty:
        return {
            "outages_in_extent": 0,
            "outage_polygons": 0,
            "outage_points": 0,
            "customers_affected": 0,
            "customers_known_outages": 0,
            "customer_labels_shown": 0,
        }

    minx, miny, maxx, maxy = bounds
    polygon_indices: list[Any] = []
    point_rows: list[tuple[float, float, float]] = []
    label_candidates: list[tuple[int, Any]] = []
    feature_count = 0
    polygon_count = 0
    point_count = 0
    customers_total = 0
    customers_known = 0

    for index, row in visible.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        if not geom.intersects(box(minx, miny, maxx, maxy)):
            continue

        feature_count += 1
        geom_type = geom.geom_type

        if geom_type in {"Polygon", "MultiPolygon"}:
            polygon_indices.append(index)
            polygon_count += 1
            label_point = geom.representative_point()
        elif geom_type == "Point":
            point_rows.append((geom.x, geom.y, _outage_size(row)))
            point_count += 1
            label_point = geom
        else:
            point = geom.representative_point()
            point_rows.append((point.x, point.y, _outage_size(row)))
            point_count += 1
            label_point = point

        customers = _affected_customers(row)
        if customers is not None:
            customers_total += customers
            customers_known += 1
            label_candidates.append((customers, label_point))

    if polygon_indices:
        polygon_gdf = visible.loc[polygon_indices]
        polygon_gdf.plot(
            ax=ax,
            facecolor="#ef4444",
            edgecolor="#991b1b",
            linewidth=1.55,
            alpha=0.24 if radar_background else 0.30,
            zorder=6,
        )
        polygon_gdf.boundary.plot(
            ax=ax,
            color="#7f1d1d",
            linewidth=1.45,
            alpha=0.96,
            zorder=7,
        )

    if point_rows:
        xs = [item[0] for item in point_rows]
        ys = [item[1] for item in point_rows]
        sizes = [item[2] for item in point_rows]
        ax.scatter(
            xs,
            ys,
            s=sizes,
            c="#dc2626",
            edgecolors="white",
            linewidths=0.8,
            alpha=0.95,
            zorder=10.8,
        )

    labels_shown = _draw_customer_labels(ax, label_candidates, bounds)

    return {
        "outages_in_extent": feature_count,
        "outage_polygons": polygon_count,
        "outage_points": point_count,
        "customers_affected": customers_total,
        "customers_known_outages": customers_known,
        "customer_labels_shown": labels_shown,
    }



def _iter_geometry_parts(geom: Any) -> Iterable[Any]:
    if geom is None or geom.is_empty:
        return
    if geom.geom_type in {"GeometryCollection", "MultiLineString", "MultiPoint", "MultiPolygon"}:
        for part in geom.geoms:
            yield from _iter_geometry_parts(part)
        return
    yield geom


def _road_label_point(geom: Any) -> Any:
    if geom.geom_type in {"LineString", "LinearRing"}:
        try:
            return geom.interpolate(0.5, normalized=True)
        except Exception:
            return geom.representative_point()
    return geom.representative_point()


def _draw_road_labels(
    ax: Any,
    candidates: list[tuple[int, str, Any]],
    bounds: tuple[float, float, float, float],
) -> int:
    minx, miny, maxx, maxy = bounds
    span = max(maxx - minx, maxy - miny)
    if span > 6.0 or not candidates:
        return 0

    # Closed roads are priority 0, conditional restrictions priority 1.
    candidates = sorted(candidates, key=lambda item: (item[0], item[1]))
    limit = 18 if span <= 3.5 else 12

    ax.figure.canvas.draw()
    renderer = ax.figure.canvas.get_renderer()
    accepted: list[Any] = []
    shown = 0

    for priority, label, point in candidates:
        if shown >= limit:
            break
        if not label or not (minx <= point.x <= maxx and miny <= point.y <= maxy):
            continue

        text = ax.text(
            point.x,
            point.y,
            label,
            fontsize=6.5,
            fontweight="bold" if priority == 0 else "normal",
            color="#7f1d1d" if priority == 0 else "#7c4a03",
            ha="center",
            va="center",
            zorder=12,
            clip_on=True,
            bbox={
                "boxstyle": "round,pad=0.18",
                "facecolor": "white",
                "edgecolor": "#991b1b" if priority == 0 else "#d97706",
                "linewidth": 0.65,
                "alpha": 0.90,
            },
        )
        bbox = text.get_window_extent(renderer=renderer).expanded(1.08, 1.18)
        if any(bbox.overlaps(existing) for existing in accepted):
            text.remove()
            continue
        accepted.append(bbox)
        shown += 1

    return shown


def _draw_road_closures(
    ax: Any,
    closures: gpd.GeoDataFrame,
    bounds: tuple[float, float, float, float],
    *,
    qld_mask: gpd.GeoDataFrame | None = None,
) -> dict[str, int]:
    visible = clip_to_bounds(closures, bounds)
    if visible.empty:
        return {
            "road_events_in_extent": 0,
            "roads_closed": 0,
            "roads_restricted": 0,
            "road_labels_shown": 0,
        }

    # The QLD Traffic feed can contain nearby interstate events. Restrict this
    # product to geometry intersecting Queensland's LGA coverage.
    if qld_mask is not None and not qld_mask.empty:
        try:
            qld_geometry = qld_mask.geometry.unary_union
            visible = visible[visible.geometry.intersects(qld_geometry)].copy()
        except Exception:
            pass

    closed_lines: list[Any] = []
    restricted_lines: list[Any] = []
    closed_points: list[Any] = []
    restricted_points: list[Any] = []
    closed_polygons: list[Any] = []
    restricted_polygons: list[Any] = []
    label_candidates: list[tuple[int, str, Any]] = []

    closed_count = 0
    restricted_count = 0

    for _, row in visible.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        passability = str(row.get("passability_norm") or "").strip().lower()
        is_closed = passability == "impassable"
        if not is_closed and passability != "passable_with_conditions":
            continue

        if is_closed:
            closed_count += 1
        else:
            restricted_count += 1

        road_name = str(row.get("road_name") or "").strip()
        locality = str(row.get("locality") or "").strip()
        title = str(row.get("title") or "").strip()
        label = road_name or title
        if label and locality and locality.lower() not in label.lower():
            label = f"{label}\n{locality}"

        try:
            label_point = _road_label_point(geom)
            if label:
                label_candidates.append((0 if is_closed else 1, label, label_point))
        except Exception:
            pass

        for part in _iter_geometry_parts(geom):
            if part.geom_type in {"LineString", "LinearRing"}:
                target = closed_lines if is_closed else restricted_lines
                target.append(part)
            elif part.geom_type == "Point":
                target = closed_points if is_closed else restricted_points
                target.append(part)
            elif part.geom_type == "Polygon":
                target = closed_polygons if is_closed else restricted_polygons
                target.append(part)

    def draw_lines(parts: list[Any], colour: str, width: float, zorder: float) -> None:
        if not parts:
            return
        series = gpd.GeoSeries(parts, crs=closures.crs)
        series.plot(ax=ax, color="white", linewidth=width + 2.0, alpha=0.92, zorder=zorder)
        series.plot(ax=ax, color=colour, linewidth=width, alpha=0.98, zorder=zorder + 0.1)

    def draw_polygons(parts: list[Any], face: str, edge: str, zorder: float) -> None:
        if not parts:
            return
        series = gpd.GeoSeries(parts, crs=closures.crs)
        series.plot(
            ax=ax,
            facecolor=face,
            edgecolor=edge,
            linewidth=1.5,
            alpha=0.22,
            zorder=zorder,
        )

    draw_polygons(restricted_polygons, "#f59e0b", "#b45309", 6.0)
    draw_polygons(closed_polygons, "#ef4444", "#991b1b", 6.3)
    # Road status is the primary information on this product, so closure lines
    # sit above the warning outline. The warning fill remains underneath.
    draw_lines(restricted_lines, "#f59e0b", 1.9, 10.0)
    draw_lines(closed_lines, "#dc2626", 2.7, 10.4)

    if restricted_points:
        ax.scatter(
            [p.x for p in restricted_points],
            [p.y for p in restricted_points],
            s=32,
            marker="o",
            c="#f59e0b",
            edgecolors="white",
            linewidths=0.8,
            zorder=8,
        )
    if closed_points:
        ax.scatter(
            [p.x for p in closed_points],
            [p.y for p in closed_points],
            s=44,
            marker="X",
            c="#dc2626",
            edgecolors="white",
            linewidths=0.8,
            zorder=11.0,
        )

    labels_shown = _draw_road_labels(ax, label_candidates, bounds)
    return {
        "road_events_in_extent": closed_count + restricted_count,
        "roads_closed": closed_count,
        "roads_restricted": restricted_count,
        "road_labels_shown": labels_shown,
    }


def render_road_closure_map(
    warning_gdf: gpd.GeoDataFrame | None,
    closures: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
    bounds_override: tuple[float, float, float, float] | None = None,
    coastline: gpd.GeoDataFrame | None = None,
    state_border: gpd.GeoDataFrame | None = None,
    mainland: gpd.GeoDataFrame | None = None,
) -> dict[str, Any]:
    has_warning = warning_gdf is not None and not warning_gdf.empty
    bounds = (
        bounds_override
        if bounds_override is not None
        else (
            padded_bounds(warning_gdf)
            if has_warning
            else statewide_bounds(lgas, state_border=state_border, coastline=coastline)
        )
    )

    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#f8fafc")

    _draw_lgas(
        ax,
        lgas,
        bounds,
        focus_gdf=warning_gdf if has_warning else None,
        show_labels=has_warning,
        land_mask=mainland if not has_warning else None,
    )
    _draw_qld_outline(ax, coastline, state_border, bounds)

    if has_warning:
        _draw_warning(ax, warning_gdf)

    road_info = _draw_road_closures(
        ax,
        closures,
        bounds,
        qld_mask=lgas,
    )
    _set_extent(ax, bounds)
    _figure_title(fig, title)

    legend = [
        Line2D([0], [0], color="#344054", lw=1.6, label="Queensland coastline / state border"),
        Line2D([0], [0], color="#7a8790", lw=0.8, label="Local government area boundary"),
        Line2D([0], [0], color="#dc2626", lw=2.7, label="Road closed / impassable"),
        Line2D([0], [0], color="#f59e0b", lw=2.0, label="Road restricted / conditional access"),
    ]
    if has_warning:
        legend.insert(
            0,
            Patch(
                facecolor="#ffd43b",
                edgecolor="#b45309",
                alpha=0.25,
                label="BOM severe thunderstorm warning area",
            ),
        )
    _place_legend(fig, legend, fontsize=7.8)

    footer = [f"Generated {_display_time(generated_at)}"]
    if warning_time:
        footer.append(f"Warning issued {_display_time(warning_time)}")
    if not has_warning:
        footer.append("No active Queensland severe thunderstorm warnings")
    footer.append(f"{road_info['roads_closed']} closed")
    footer.append(f"{road_info['roads_restricted']} restricted / conditional")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.03, 0.13, 0.97, 0.90))
    fig.savefig(output_path, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)

    return {"bounds": list(bounds), **road_info}


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
    warning_gdf: gpd.GeoDataFrame | None,
    outages: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
    bounds_override: tuple[float, float, float, float] | None = None,
    show_lga_labels: bool = True,
    coastline: gpd.GeoDataFrame | None = None,
    state_border: gpd.GeoDataFrame | None = None,
    mainland: gpd.GeoDataFrame | None = None,
) -> dict[str, Any]:
    has_warning = warning_gdf is not None and not warning_gdf.empty
    bounds = (
        bounds_override
        if bounds_override is not None
        else (
            padded_bounds(warning_gdf)
            if has_warning
            else statewide_bounds(lgas, state_border=state_border, coastline=coastline)
        )
    )

    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#f8fafc")

    _draw_lgas(
        ax,
        lgas,
        bounds,
        focus_gdf=warning_gdf if has_warning else None,
        show_labels=show_lga_labels,
        land_mask=mainland if not has_warning else None,
    )
    _draw_qld_outline(ax, coastline, state_border, bounds)

    if has_warning:
        _draw_warning(ax, warning_gdf)

    outage_info = _draw_outages(ax, outages, bounds)
    _set_extent(ax, bounds)

    _figure_title(fig, title)
    legend = [
        Line2D([0], [0], color="#344054", lw=1.6, label="Queensland coastline / state border"),
        Line2D([0], [0], color="#7a8790", lw=0.8, label="Local government area boundary"),
        Patch(
            facecolor="#ef4444",
            edgecolor="#991b1b",
            alpha=0.30,
            label="Current unplanned outage area (label = customers affected)",
        ),
    ]
    if outage_info["outage_points"]:
        legend.append(
            Line2D(
                [0],
                [0],
                marker="o",
                color="w",
                markerfacecolor="#dc2626",
                markeredgecolor="white",
                markersize=8,
                label="Outage location where no area polygon is available",
            )
        )
    if has_warning:
        legend.insert(
            0,
            Patch(
                facecolor="#ffd43b",
                edgecolor="#b45309",
                alpha=0.25,
                label="BOM severe thunderstorm warning area",
            ),
        )
    _place_legend(fig, legend, fontsize=8.1)

    footer = [f"Generated {_display_time(generated_at)}"]
    if warning_time:
        footer.append(f"Warning issued {_display_time(warning_time)}")
    if not has_warning:
        footer.append("No active Queensland severe thunderstorm warnings")
    footer.append(f"{outage_info['outages_in_extent']} unplanned outages shown")
    if outage_info["customers_known_outages"]:
        footer.append(f"{outage_info['customers_affected']:,} customers affected")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.03, 0.13, 0.97, 0.90))
    fig.savefig(output_path, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)

    return {"bounds": list(bounds), **outage_info}


def render_radar_map(
    warning_gdf: gpd.GeoDataFrame | None,
    outages: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
    bounds_override: tuple[float, float, float, float] | None = None,
    coastline: gpd.GeoDataFrame | None = None,
    state_border: gpd.GeoDataFrame | None = None,
    mainland: gpd.GeoDataFrame | None = None,
) -> dict[str, Any]:
    has_warning = warning_gdf is not None and not warning_gdf.empty
    bounds = (
        bounds_override
        if bounds_override is not None
        else (
            padded_bounds(warning_gdf)
            if has_warning
            else statewide_bounds(lgas, state_border=state_border, coastline=coastline)
        )
    )
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

    _draw_lgas(
        ax,
        lgas,
        bounds,
        focus_gdf=None,
        show_labels=False,
        land_mask=mainland if not has_warning else None,
        radar_background=True,
    )
    _draw_qld_outline(
        ax,
        coastline,
        state_border,
        bounds,
        radar_background=True,
    )

    if has_warning:
        _draw_warning(ax, warning_gdf, radar_background=True)

    outage_info = _draw_outages(
        ax,
        outages,
        bounds,
        radar_background=True,
    )

    _set_extent(ax, bounds)
    _figure_title(fig, title)

    context_legend = [
        Line2D([0], [0], color="#263238", lw=1.6, label="Queensland coastline / state border"),
        Line2D([0], [0], color="#98a2b3", lw=0.9, label="Local government area boundary"),
        Patch(
            facecolor="#ef4444",
            edgecolor="#991b1b",
            alpha=0.26,
            label="Current unplanned outage area (label = customers affected)",
        ),
    ]
    if outage_info["outage_points"]:
        context_legend.append(
            Line2D(
                [0],
                [0],
                marker="o",
                color="w",
                markerfacecolor="#dc2626",
                markeredgecolor="white",
                markersize=7,
                label="Outage location",
            )
        )
    if has_warning:
        context_legend.insert(
            0,
            Line2D(
                [0],
                [0],
                color="#b45309",
                lw=2.4,
                linestyle="--",
                label="BOM severe thunderstorm warning boundary",
            ),
        )
    _place_legend(fig, context_legend, fontsize=7.7)

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
        f"{outage_info['outages_in_extent']} unplanned outages",
    ]
    if outage_info["customers_known_outages"]:
        footer.append(f"{outage_info['customers_affected']:,} customers affected")
    if warning_time:
        footer.append(f"Warning issued {_display_time(warning_time)}")
    if not has_warning:
        footer.append("No active Queensland severe thunderstorm warnings")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.03, 0.13, 0.97, 0.90))
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
        **outage_info,
    }
