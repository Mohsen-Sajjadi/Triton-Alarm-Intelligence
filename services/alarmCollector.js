const Alarm = require("../models/Alarm");
const Site = require("../models/Site");
const { fetchActiveAlarms } = require("../connectors/eboAlarmConnector");
const configuredSites = require("../config/sites");
const { classifyAlarm } = require("./alarmClassifier");
const { notifyCriticalAlarm } = require("./notificationService");

async function collectAlarms() {
  console.log(`[Alarm Collector] Running at ${new Date().toISOString()}`);

  const sites = await getPollingSites();
  const now = new Date();

  for (const site of sites) {
    if (!site.enabled || site.pollingEnabled === false) continue;
    if (!shouldPollSiteNow(site, now)) continue;

    const alarms = await fetchActiveAlarms(site);
    await updatePollStatus(site, true, `Fetched ${alarms.length} alarms`, alarms.length);
    await reconcileActiveAlarms(site, alarms);

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

function shouldPollSiteNow(site, now = new Date()) {
  if (site.pollingEnabled === false) return false;

  const days = Array.isArray(site.pollDays) && site.pollDays.length
    ? site.pollDays.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];

  if (!days.includes(now.getDay())) return false;

  if (!isTimeWithinWindow(now, site.pollStartTime || "00:00", site.pollEndTime || "23:59")) {
    return false;
  }

  const intervalMinutes = Math.max(Number(site.pollIntervalMinutes || 5), 1);
  if (!site.lastAlarmPollAt) return true;

  const lastPollAt = new Date(site.lastAlarmPollAt).getTime();
  if (Number.isNaN(lastPollAt)) return true;

  return now.getTime() - lastPollAt >= intervalMinutes * 60 * 1000;
}

function isTimeWithinWindow(now, startTime, endTime) {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeToMinutes(startTime, 0);
  const end = parseTimeToMinutes(endTime, 23 * 60 + 59);

  if (start <= end) {
    return current >= start && current <= end;
  }

  return current >= start || current <= end;
}

function parseTimeToMinutes(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;

  return hours * 60 + minutes;
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

async function reconcileActiveAlarms(site, currentAlarms) {
  if (!site?.siteId) return { returnedToNormal: 0 };

  const currentKeys = new Set(currentAlarms.map(getAlarmKey));
  const activeAlarms = await Alarm.find({
    siteId: site.siteId,
    state: { $in: ["Active", "Acknowledged"] }
  });

  let returnedToNormal = 0;
  for (const alarm of activeAlarms) {
    if (currentKeys.has(getAlarmKey(alarm))) continue;

    alarm.state = "ReturnedToNormal";
    alarm.returnedToNormalAt = new Date();
    await alarm.save();
    returnedToNormal += 1;
  }

  return { returnedToNormal };
}

function getAlarmKey(alarm) {
  const occurredAt = alarm.occurredAt ? new Date(alarm.occurredAt).getTime() : "";
  return [
    alarm.siteId || "",
    alarm.sourcePath || "",
    alarm.alarmName || "",
    Number.isNaN(occurredAt) ? "" : occurredAt
  ].join("|");
}

module.exports = {
  collectAlarms,
  getPollingSites,
  shouldPollSiteNow,
  upsertAlarm,
  reconcileActiveAlarms
};
