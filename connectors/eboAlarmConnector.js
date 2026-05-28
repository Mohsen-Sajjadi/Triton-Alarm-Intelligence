const https = require("https");
const axios = require("axios");
const { fetchEwsAlarmEvents } = require("./eboEwsSoapConnector");

const insecureTestAgent = new https.Agent({
  rejectUnauthorized: false
});

async function fetchActiveAlarms(site, options = {}) {
  if (site.connectionType === "EBO EWS SOAP") {
    return fetchEwsAlarmEvents(site, options);
  }

  try {
    /*
      Replace "/alarms/active" with the actual SmartConnector RESTful EWS
      Gateway alarm endpoint after the installed configuration is confirmed.
    */
    const baseUrl = site.baseUrl || site.serverUrl;

    if (!baseUrl) {
      throw new Error("Site baseUrl or serverUrl is required");
    }

    const url = buildEndpointUrl(baseUrl, site.alarmEndpointPath || "/alarms/active");
    const response = await axios.get(url, {
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
    const connectorError = buildConnectorError(error, site, "alarms");
    console.error(`[${site.siteName}] Failed to fetch alarms:`, connectorError.message);
    if (options.throwOnError) {
      throw connectorError;
    }
    return [];
  }
}

async function fetchPointValues(site, options = {}) {
  const pointDefinitions = site.pointDefinitions || [];

  if (!pointDefinitions.length) {
    return [];
  }

  try {
    /*
      Replace this placeholder path with the actual SmartConnector RESTful EWS
      point endpoint when the site configuration is confirmed.
    */
    const baseUrl = site.baseUrl || site.serverUrl;

    if (!baseUrl) {
      throw new Error("Site baseUrl or serverUrl is required");
    }

    const url = buildEndpointUrl(baseUrl, site.pointEndpointPath || "/points/read");
    const response = await axios.post(
      url,
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
    const connectorError = buildConnectorError(error, site, "points");
    console.error(`[${site.siteName}] Failed to fetch points:`, connectorError.message);
    if (options.throwOnError) {
      throw connectorError;
    }
    return [];
  }
}

function buildConnectorError(error, site, resourceType) {
  const baseUrl = site.baseUrl || site.serverUrl;
  const path =
    resourceType === "points"
      ? site.pointEndpointPath || "/points/read"
      : site.alarmEndpointPath || "/alarms/active";
  const testedUrl = baseUrl ? buildEndpointUrl(baseUrl, path) : path;
  const statusCode = error.response?.status;
  const responseBody =
    typeof error.response?.data === "string"
      ? error.response.data.slice(0, 500)
      : error.response?.data;

  const diagnostic = {
    siteId: site.siteId,
    siteName: site.siteName,
    baseUrl,
    testedUrl,
    statusCode,
    axiosCode: error.code,
    responseBody,
    likelyCause: getLikelyCause(statusCode, error.code),
    nextStep: getNextStep(statusCode, error.code, resourceType)
  };

  const connectorError = new Error(
    statusCode
      ? `Request failed with status code ${statusCode}`
      : error.message
  );
  connectorError.statusCode = statusCode;
  connectorError.diagnostic = diagnostic;
  return connectorError;
}

function buildEndpointUrl(baseUrl, endpointPath) {
  const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
  const normalizedPath = String(endpointPath || "").replace(/^\/?/, "/");
  return `${normalizedBase}${normalizedPath}`;
}

function getLikelyCause(statusCode, axiosCode) {
  if (statusCode === 400) return "The gateway rejected the request format.";
  if (statusCode === 401) return "The server requires authentication or the username/password is incorrect.";
  if (statusCode === 403) return "The account authenticated but does not have permission for this endpoint.";
  if (statusCode === 404) {
    return "The server is reachable, but this alarm endpoint path does not exist on that server.";
  }
  if (statusCode >= 500) return "The remote BMS/gateway server returned an internal error.";
  if (axiosCode === "ECONNABORTED") return "The request timed out.";
  if (axiosCode === "ENOTFOUND") return "The hostname could not be resolved.";
  if (axiosCode === "ECONNREFUSED") return "The host was reached but the port refused the connection.";
  if (axiosCode === "CERT_HAS_EXPIRED" || axiosCode === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return "The HTTPS certificate is not trusted by Node.js.";
  }
  return "The connection failed before alarm data could be read.";
}

function getNextStep(statusCode, axiosCode, resourceType) {
  if (statusCode === 404) {
    return resourceType === "alarms"
      ? "Confirm the real SmartConnector REST/EWS alarm endpoint. A WebStation page URL is not enough; this app currently tests /alarms/active."
      : "Confirm the real point read endpoint. This app currently tests /points/read.";
  }
  if (statusCode === 401 || statusCode === 403) {
    return "Verify the account, password, and read permissions in EBO/SmartConnector.";
  }
  if (axiosCode === "ECONNABORTED") {
    return "Confirm BrinkAgent/Neeve is connected and the host is reachable from the server running Alarm Bridge.";
  }
  if (axiosCode === "ENOTFOUND") {
    return "Use the IP address or verify DNS resolution from this server.";
  }
  return "Check the base URL, port, VPN/Neeve connection, and SmartConnector/EWS service status.";
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
  fetchPointValues,
  buildConnectorError,
  buildEndpointUrl
};
