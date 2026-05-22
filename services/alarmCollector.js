const Alarm = require("../models/Alarm");
const { fetchActiveAlarms } = require("../connectors/eboAlarmConnector");
const sites = require("../config/sites");
const { classifyAlarm } = require("./alarmClassifier");
const { notifyCriticalAlarm } = require("./notificationService");

async function collectAlarms() {
  console.log(`[Alarm Collector] Running at ${new Date().toISOString()}`);

  for (const site of sites) {
    if (!site.enabled) continue;

    const alarms = await fetchActiveAlarms(site);

    for (const alarm of alarms) {
      const allowedPriority =
        !site.alarmPriorityFilter || site.alarmPriorityFilter.includes(alarm.priority);

      if (!allowedPriority) continue;

      try {
        await upsertAlarm(alarm);
      } catch (error) {
        console.error(`[${site.siteName}] Failed to save alarm:`, error.message);
      }
    }
  }
}

async function upsertAlarm(alarmData) {
  alarmData.category = alarmData.category || classifyAlarm(alarmData);

  const existingAlarm = await Alarm.findOne({
    siteId: alarmData.siteId,
    sourcePath: alarmData.sourcePath,
    alarmName: alarmData.alarmName,
    state: { $in: ["Active", "Acknowledged"] }
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
  upsertAlarm
};
