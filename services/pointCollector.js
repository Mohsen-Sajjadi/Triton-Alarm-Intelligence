const Point = require("../models/Point");
const { fetchPointValues } = require("../connectors/eboAlarmConnector");
const sites = require("../config/sites");

async function collectPoints() {
  if (process.env.ENABLE_POINT_COLLECTION !== "true") {
    return;
  }

  console.log(`[Point Collector] Running at ${new Date().toISOString()}`);

  for (const site of sites) {
    if (!site.enabled || !site.pointDefinitions?.length) continue;

    try {
      const points = await fetchPointValues(site);
      await Point.insertMany(points, { ordered: false });
      console.log(`[${site.siteName}] Saved ${points.length} point samples`);
    } catch (error) {
      console.error(`[${site.siteName}] Failed to save point samples:`, error.message);
    }
  }
}

module.exports = {
  collectPoints
};
