import geopandas as gpd
from shapely.geometry import Point

from src.sources import filter_road_closures


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
