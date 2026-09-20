window.MAPPING_CONFIG = {
  arcgis: {
    // Public OAuth client identifier for the generic external Mapping Viewer app.
    // This is not a client secret. Organisation-specific values are entered at runtime.
    clientId: "PoEOYlSa1Jm7IaeQ",
    redirectUri: "https://giswatidid.github.io/Mapping/",
    warningProfiles: {
      thunderstorm: {
        key: "thunderstorm",
        label: "Severe Thunderstorm",
        outputTitle: "Severe Thunderstorm Warning",
        detectionSublayerTitles: ["Severe Thunderstorm Warning | Australia"],
        renderSublayerTitles: ["Severe Thunderstorm Warning | Australia"],
        supportsTracking: true,
        trackingSublayerTitles: [
          "Severe Thunderstorm Warning Storm Direction | Australia",
          "Severe Thunderstorm Warning Storm Cell | Australia"
        ],
        legendLabel: "Severe thunderstorm warning",
        filenamePrefix: "warning",
        activeScopeLabel: "severe-thunderstorm warning"
      },
      severeWeather: {
        key: "severeWeather",
        label: "Severe Weather",
        outputTitle: "Severe Weather Warning",
        detectionSublayerTitles: ["Severe Weather Warning | Australia"],
        renderSublayerTitles: ["Severe Weather Warning | Australia"],
        supportsTracking: false,
        trackingSublayerTitles: [],
        legendLabel: "Severe weather warning",
        filenamePrefix: "severe-weather-warning",
        activeScopeLabel: "severe-weather warning"
      },
      flooding: {
        key: "flooding",
        label: "Flooding",
        outputTitle: "Flood Warning / Watch",
        detectionSublayerTitles: [
          "Flood Warning | Australia",
          "Flood Watch | Australia"
        ],
        renderSublayerTitles: [
          "Flood Warning | Australia",
          "Flood Watch | Australia"
        ],
        floodWarningSublayerTitle: "Flood Warning | Australia",
        floodWarningLabelSublayerTitle: "Flood Warning Catchment Name | Australia",
        floodWatchSublayerTitle: "Flood Watch | Australia",
        floodWatchLabelSublayerTitle: "Flood Watch Catchment Name | Australia",
        supportsTracking: false,
        trackingSublayerTitles: [],
        legendLabel: "Flood warning / watch",
        filenamePrefix: "flood-warning",
        activeScopeLabel: "selected flood warning/watch"
      }
    },
    administrativeLayers: {
      localGovernment: {
        leafTitle: "Local government",
        pathHints: [
          "Portfolio Admin",
          "Boundaries",
          "Administrative Boundaries",
          "Local government"
        ]
      },
      disasterDistricts: {
        leafTitle: "Queensland Disaster District Management Groups",
        pathHints: [
          "Portfolio Admin",
          "Boundaries",
          "Administrative Boundaries",
          "Queensland Disaster District Management Groups"
        ]
      }
    },
    standardSources: {
      warning: {
        itemTitle: "BoM Severe Weather Warning WMS APIM PRD",
        itemType: "WMS",
        // Severe thunderstorm remains the primary verification sublayer because
        // it is the established known-working route for this registered item.
        sublayerTitle: "Severe Thunderstorm Warning | Australia",
        wmsLayerName: "IDZ20006",
        trackingSublayerTitles: [
          "Severe Thunderstorm Warning Storm Direction | Australia",
          "Severe Thunderstorm Warning Storm Cell | Australia"
        ],
        wmsLayerNames: {
          "Severe Weather Warning | Australia": "IDZ20005",
          "Severe Thunderstorm Warning | Australia": "IDZ20006",
          "Severe Thunderstorm Warning Storm Direction | Australia": "IDZ20007_track",
          "Severe Thunderstorm Warning Storm Cell | Australia": "IDZ20007",
          "Flood Warning | Australia": "IDZ20013",
          "Flood Warning Catchment Name | Australia": "IDZ20013_label",
          "Flood Watch | Australia": "IDZ20016",
          "Flood Watch Catchment Name | Australia": "IDZ20016_label"
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
    majorRoads: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/FoundationData/FeatureServer/23",
    bomFloodWatchCatchments: "https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/flood/National_Flood_Gauge_Network/FeatureServer/0",
    bomFloodWarningCatchments: "https://hosting.wsapi.cloud.bom.gov.au/arcgis/rest/services/flood/National_Flood_Gauge_Network/FeatureServer/1"
  },
  rendering: {
    basemapStyle: "arcgis/topographic",
    outputSpatialReference: 3857,
    qldExtent: [137.7, -29.3, 154.2, -9.0],
    warningDetectionSize: [720, 900],
    maxOutputWidth: 1500,
    minOutputWidth: 1100
  }
};
