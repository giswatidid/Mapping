import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.geometry import LineString, Point, Polygon

from src.render import _affected_customers, _draw_outages, statewide_bounds


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


def test_statewide_bounds_combines_coastline_and_interstate_border():
    # Coastline reaches Cape York; interstate border reaches farther south/west.
    coastline = gpd.GeoDataFrame(
        [{"geometry": LineString([(142.0, -28.0), (153.5, -9.2)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )
    state_border = gpd.GeoDataFrame(
        [{"geometry": LineString([(138.0, -29.2), (141.0, -16.2)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )
    lgas = gpd.GeoDataFrame(
        [{"geometry": Polygon([(137.5, -29.5), (154.0, -29.5), (154.0, -8.5), (137.5, -8.5)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )

    bounds = statewide_bounds(
        lgas,
        state_border=state_border,
        coastline=coastline,
        fraction=0.0,
    )

    assert bounds == (138.0, -29.2, 153.5, -9.2)


def test_statewide_bounds_prefers_full_state_border_over_distant_coastline_features():
    state_border = gpd.GeoDataFrame(
        [{"geometry": LineString([(138.0, -29.2), (154.0, -9.0)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )
    coastline = gpd.GeoDataFrame(
        [{"geometry": LineString([(142.0, -28.0), (155.5, -9.2)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )
    lgas = gpd.GeoDataFrame(
        [{"geometry": Polygon([(137.5, -29.5), (154.0, -29.5), (154.0, -8.5), (137.5, -8.5)])}],
        geometry="geometry",
        crs="EPSG:4326",
    )

    bounds = statewide_bounds(
        lgas,
        state_border=state_border,
        coastline=coastline,
        fraction=0.0,
    )

    assert bounds == (138.0, -29.2, 154.0, -9.0)
