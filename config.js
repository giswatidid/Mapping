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
        sublayerTitle: "Severe Thunderstorm Warning | Australia"
      },
      radar: {
        itemTitle: "BoM Radar WMS APIM PRD",
        itemType: "WMS",
        sublayerTitle: "Radar Rain Rate | Australia | raster"
      }
    }
  },
  publicSources: {
    powerOutages: "https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson",
    roadConditions: "https://data.qldtraffic.qld.gov.au/events_v2.geojson"
  }
};
