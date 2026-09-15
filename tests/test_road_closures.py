from datetime import datetime, timezone

import geopandas as gpd
from shapely.geometry import Point

from src.sources import filter_road_closures, normalise_qldtraffic_road_closures


def test_filter_road_closures_keeps_active_closed_and_conditional_only():
    gdf = gpd.GeoDataFrame(
        [
            {
                "status_norm": "active",
                "passability_norm": "impassable",
                "geometry": Point(153.0, -27.0),
            },
            {
                "status_norm": "active",
                "passability_norm": "passable_with_conditions",
                "geometry": Point(153.1, -27.0),
            },
            {
                "status_norm": "active",
                "passability_norm": "unknown",
                "geometry": Point(153.2, -27.0),
            },
            {
                "status_norm": "inactive",
                "passability_norm": "impassable",
                "geometry": Point(153.3, -27.0),
            },
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )

    filtered = filter_road_closures(gdf)

    assert len(filtered) == 2
    assert set(filtered["passability_norm"]) == {
        "impassable",
        "passable_with_conditions",
    }


def test_normalise_qldtraffic_excludes_future_events_and_area_alert_polygons():
    now = datetime(2026, 9, 15, 3, 0, tzinfo=timezone.utc)
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[153.0, -27.0], [153.1, -27.1]],
                },
                "properties": {
                    "id": 1,
                    "status": "Published",
                    "area_alert": False,
                    "duration": {
                        "start": "2026-09-15T12:00:00+10:00",
                        "end": "2026-09-15T15:00:00+10:00",
                    },
                    "impact": {
                        "impact_type": "Closures",
                        "impact_subtype": "Road closed to all traffic",
                    },
                    "road_summary": {"road_name": "Current Road", "locality": "Example"},
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[153.2, -27.0], [153.3, -27.1]],
                },
                "properties": {
                    "id": 2,
                    "status": "Published",
                    "area_alert": False,
                    "duration": {
                        "start": "2026-09-16T12:00:00+10:00",
                        "end": "2026-09-16T15:00:00+10:00",
                    },
                    "impact": {
                        "impact_type": "Closures",
                        "impact_subtype": "Road closed to all traffic",
                    },
                    "road_summary": {"road_name": "Future Road", "locality": "Example"},
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [152.9, -27.2],
                        [153.4, -27.2],
                        [153.4, -26.8],
                        [152.9, -26.8],
                        [152.9, -27.2],
                    ]],
                },
                "properties": {
                    "id": 3,
                    "status": "Published",
                    "area_alert": True,
                    "duration": {},
                    "impact": {
                        "impact_type": "Closures",
                        "impact_subtype": "Road closed to all traffic",
                    },
                    "road_summary": {"road_name": "Area Alert", "locality": "Example"},
                },
            },
        ],
    }

    gdf = normalise_qldtraffic_road_closures(payload, now=now)

    assert len(gdf) == 1
    assert gdf.iloc[0]["road_name"] == "Current Road"
    assert gdf.iloc[0]["passability_norm"] == "impassable"
