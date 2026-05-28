const Point = require("../models/Point");
const Site = require("../models/Site");
const { fetchPointValues } = require("../connectors/eboAlarmConnector");
const configuredSites = require("../config/sites");

async function collectPoints() {
  if (process.env.ENABLE_POINT_COLLECTION !== "true") {
    return;
  }

  console.log(`[Point Collector] Running at ${new Date().toISOString()}`);

  const sites = await getPointPollingSites();

  for (const site of sites) {
    if (!site.enabled || site.pollingEnabled === false || !site.pointDefinitions?.length) {
      continue;
    }

    try {
      const points = await fetchPointValues(site);
      await Point.insertMany(points, { ordered: false });
      console.log(`[${site.siteName}] Saved ${points.length} point samples`);
    } catch (error) {
      console.error(`[${site.siteName}] Failed to save point samples:`, error.message);
    }
  }
}

async function getPointPollingSites() {
  const dbSites = await Site.find({
    enabled: true,
    pollingEnabled: true
  }).lean();

  return dbSites.length ? dbSites : configuredSites;
}

module.exports = {
  collectPoints
};
