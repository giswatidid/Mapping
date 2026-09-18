window.MAPPING_CONFIG = {
  arcgis: {
    // Public OAuth client identifier for the generic external Mapping Viewer app.
    // This is not a client secret. Organisation-specific values are entered at runtime.
    clientId: "PoEOYlSa1Jm7IaeQ",
    redirectUri: "https://giswatidid.github.io/Mapping/",
    standardSources: {
      warning: {
        itemTitle: "BoM Severe Weather Warning WMS APIM PRD",
        itemType: "WMS",
        sublayerTitle: "Severe Thunderstorm Warning | Australia",
        wmsLayerName: "IDZ20006",
        trackingSublayerTitles: [
          "Severe Thunderstorm Warning Storm Direction | Australia",
          "Severe Thunderstorm Warning Storm Cell | Australia"
        ],
        wmsLayerNames: {
          "Severe Thunderstorm Warning | Australia": "IDZ20006",
          "Severe Thunderstorm Warning Storm Direction | Australia": "IDZ20007_track",
          "Severe Thunderstorm Warning Storm Cell | Australia": "IDZ20007"
        }
      },
      radar: {
        itemTitle: "BoM Radar WMS APIM PRD",
        itemType: "WMS",
        sublayerTitle: "Radar Rain Rate | Australia | raster",
        wmsLayerName: "IDR00010"
      }
    }
  },
  publicSources: {
    powerOutages: "https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson",
    roadConditions: "https://data.qldtraffic.qld.gov.au/events_v2.geojson",
    lga: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdminBoundariesFramework/FeatureServer/11",
    coastline: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/55",
    stateBorder: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/5",
    mainland: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/GeographicalFeatures/FeatureServer/90",
    populationCentres: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/Places/FeatureServer/20",
    majorRoads: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/23"
  },
  rendering: {
    qldExtent: [137.7, -29.3, 154.2, -9.0],
    warningDetectionSize: [720, 900],
    maxOutputWidth: 1500,
    minOutputWidth: 1100
  }
};
