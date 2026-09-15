import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.geometry import Point, Polygon

from src.render import _affected_customers, _draw_outages


def test_affected_customers_reads_normalised_field():
    assert _affected_customers(
        {"affected_customers": 49, "affected_customers_known": True}
    ) == 49


def test_affected_customers_respects_unknown_flag():
    assert _affected_customers(
        {"affected_customers": 49, "affected_customers_known": False}
    ) is None


def test_draw_outages_uses_polygon_geometry_and_customer_totals():
    outages = gpd.GeoDataFrame(
        [
            {
                "affected_customers": 49,
                "affected_customers_known": True,
                "geometry": Polygon(
                    [
                        (153.00, -27.70),
                        (153.05, -27.70),
                        (153.05, -27.65),
                        (153.00, -27.65),
                        (153.00, -27.70),
                    ]
                ),
            },
            {
                "affected_customers": 9,
                "affected_customers_known": True,
                "geometry": Point(153.10, -27.67),
            },
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )

    fig, ax = plt.subplots()
    try:
        info = _draw_outages(
            ax,
            outages,
            (152.95, -27.75, 153.15, -27.60),
        )
    finally:
        plt.close(fig)

    assert info["outages_in_extent"] == 2
    assert info["outage_polygons"] == 1
    assert info["outage_points"] == 1
    assert info["customers_affected"] == 58
    assert info["customers_known_outages"] == 2
    assert info["customer_labels_shown"] == 2
