const Alarm = require("../models/Alarm");
const Site = require("../models/Site");
const { fetchActiveAlarms } = require("../connectors/eboAlarmConnector");
const configuredSites = require("../config/sites");
const { classifyAlarm } = require("./alarmClassifier");
const { notifyCriticalAlarm } = require("./notificationService");

async function collectAlarms() {
  console.log(`[Alarm Collector] Running at ${new Date().toISOString()}`);

  const sites = await getPollingSites();

  for (const site of sites) {
    if (!site.enabled || site.pollingEnabled === false) continue;

    const alarms = await fetchActiveAlarms(site);
    await updatePollStatus(site, true, `Fetched ${alarms.length} alarms`, alarms.length);

    for (const alarm of alarms) {
      const allowedPriority =
        !site.alarmPriorityFilter || site.alarmPriorityFilter.includes(alarm.priority);

      if (!allowedPriority) continue;

      try {
        await upsertAlarm(alarm);
      } catch (error) {
        console.error(`[${site.siteName}] Failed to save alarm:`, error.message);
        await updatePollStatus(site, false, error.message);
      }
    }
  }
}

async function getPollingSites() {
  const dbSites = await Site.find({
    enabled: true,
    pollingEnabled: true
  }).lean();

  return dbSites.length ? dbSites : configuredSites;
}

async function updatePollStatus(site, ok, message, alarmCount) {
  if (!site._id && !site.siteId) return;

  try {
    await Site.findOneAndUpdate(
      { siteId: site.siteId },
      {
        lastAlarmPollAt: new Date(),
        lastAlarmPollOk: ok,
        lastAlarmPollMessage: message,
        ...(typeof alarmCount === "number" ? { lastAlarmCount: alarmCount } : {})
      }
    );
  } catch (error) {
    console.error(`[${site.siteName}] Failed to update poll status:`, error.message);
  }
}

async function upsertAlarm(alarmData) {
  alarmData.category = alarmData.category || classifyAlarm(alarmData);

  const existingAlarm = await Alarm.findOne({
    siteId: alarmData.siteId,
    sourcePath: alarmData.sourcePath,
    alarmName: alarmData.alarmName,
    occurredAt: alarmData.occurredAt
  });

  if (existingAlarm) {
    existingAlarm.priority = alarmData.priority;
    existingAlarm.eboPriority = alarmData.eboPriority;
    existingAlarm.state = alarmData.state;
    existingAlarm.acknowledged = alarmData.acknowledged;
    existingAlarm.message = alarmData.message;
    existingAlarm.category = alarmData.category;
    existingAlarm.rawData = alarmData.rawData;

    if (alarmData.state === "ReturnedToNormal" && !existingAlarm.returnedToNormalAt) {
      existingAlarm.returnedToNormalAt = alarmData.returnedToNormalAt || new Date();
    }

    await existingAlarm.save();

    console.log(`Updated alarm: ${alarmData.alarmName}`);
    return existingAlarm;
  }

  const newAlarm = await Alarm.create(alarmData);
  console.log(`Created new alarm: ${newAlarm.alarmName}`);

  if (newAlarm.priority === "Critical") {
    await notifyCriticalAlarm(newAlarm);
  }

  return newAlarm;
}

module.exports = {
  collectAlarms,
  getPollingSites,
  upsertAlarm
};
