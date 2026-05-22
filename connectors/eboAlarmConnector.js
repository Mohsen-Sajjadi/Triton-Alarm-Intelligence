const https = require("https");
const axios = require("axios");

const insecureTestAgent = new https.Agent({
  rejectUnauthorized: false
});

async function fetchActiveAlarms(site) {
  try {
    /*
      Replace "/alarms/active" with the actual SmartConnector RESTful EWS
      Gateway alarm endpoint after the installed configuration is confirmed.
    */
    const response = await axios.get(`${site.baseUrl}/alarms/active`, {
      auth: {
        username: site.username,
        password: site.password
      },
      timeout: 15000,
      // Testing only. Use trusted certificates in production.
      httpsAgent: insecureTestAgent
    });

    const alarms = response.data?.alarms || response.data || [];

    if (!Array.isArray(alarms)) {
      console.error(
        `[${site.siteName}] Unexpected alarm response shape from SmartConnector`
      );
      return [];
    }

    return alarms.map((alarm) => normalizeAlarm(alarm, site));
  } catch (error) {
    console.error(`[${site.siteName}] Failed to fetch alarms:`, error.message);
    return [];
  }
}

async function fetchPointValues(site) {
  const pointDefinitions = site.pointDefinitions || [];

  if (!pointDefinitions.length) {
    return [];
  }

  try {
    /*
      Replace this placeholder path with the actual SmartConnector RESTful EWS
      point endpoint when the site configuration is confirmed.
    */
    const response = await axios.post(
      `${site.baseUrl}/points/read`,
      {
        points: pointDefinitions.map((point) => point.sourcePath)
      },
      {
        auth: {
          username: site.username,
          password: site.password
        },
        timeout: 15000,
        httpsAgent: insecureTestAgent
      }
    );

    const values = response.data?.points || response.data || [];

    if (!Array.isArray(values)) {
      console.error(`[${site.siteName}] Unexpected point response shape`);
      return [];
    }

    return pointDefinitions.map((definition) => {
      const valueRecord = values.find(
        (point) =>
          point.sourcePath === definition.sourcePath ||
          point.path === definition.sourcePath ||
          point.Source === definition.sourcePath
      );

      return normalizePoint(valueRecord || {}, definition, site);
    });
  } catch (error) {
    console.error(`[${site.siteName}] Failed to fetch points:`, error.message);
    return [];
  }
}

function normalizeAlarm(alarm, site) {
  const sourcePath =
    alarm.sourcePath || alarm.path || alarm.objectPath || alarm.Source || "Unknown";

  const eboPriority =
    alarm.eboPriority || alarm.priorityNumber || alarm.PriorityNumber || null;

  return {
    siteId: site.siteId,
    clientName: site.clientName,
    siteName: site.siteName,

    sourcePath,

    alarmName:
      alarm.alarmName ||
      alarm.name ||
      alarm.message ||
      alarm.Name ||
      "Unknown Alarm",

    equipmentName: alarm.equipmentName || extractEquipmentName(sourcePath),

    priority: alarm.priority || alarm.Priority || mapPriority(eboPriority),

    eboPriority,

    state: normalizeState(alarm.state || alarm.State || "Active"),

    acknowledged: alarm.acknowledged || alarm.Acknowledged || false,

    message: alarm.message || alarm.Message || "",

    occurredAt: alarm.occurredAt || alarm.timestamp || alarm.TimeStamp || new Date(),

    returnedToNormalAt: alarm.returnedToNormalAt || null,

    rawData: alarm
  };
}

function normalizeState(state) {
  if (!state) return "Unknown";

  const normalized = String(state).replace(/\s+/g, "").toLowerCase();

  if (normalized === "active") return "Active";
  if (normalized === "acknowledged" || normalized === "acknowledge") {
    return "Acknowledged";
  }
  if (
    normalized === "returnedtonormal" ||
    normalized === "normal" ||
    normalized === "inactive"
  ) {
    return "ReturnedToNormal";
  }

  return "Unknown";
}

function mapPriority(priorityNumber) {
  if (!priorityNumber && priorityNumber !== 0) return "Unknown";

  if (priorityNumber <= 50) return "Critical";
  if (priorityNumber <= 100) return "High";
  if (priorityNumber <= 200) return "Medium";
  return "Low";
}

function extractEquipmentName(path) {
  if (!path) return "Unknown";
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "Unknown";
}

function normalizePoint(point, definition, site) {
  return {
    siteId: site.siteId,
    clientName: site.clientName,
    siteName: site.siteName,
    equipmentName: definition.equipmentName,
    pointName: definition.pointName,
    sourcePath: definition.sourcePath,
    value: point.value ?? point.Value ?? point.presentValue ?? null,
    unit: point.unit || point.Unit || definition.unit,
    timestamp: point.timestamp || point.TimeStamp || new Date(),
    rawData: point
  };
}

module.exports = {
  fetchActiveAlarms,
  fetchPointValues
};
