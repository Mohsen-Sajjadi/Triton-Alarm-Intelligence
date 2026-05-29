const crypto = require("crypto");
const https = require("https");
const axios = require("axios");

const insecureTestAgent = new https.Agent({
  rejectUnauthorized: false
});

const ALARM_RECORDS_PATH = "~/System/Alarms/Alarm Manager/AlarmRecords";
const DEFAULT_PROPERTY_NAMES = [
  "SEQNO",
  "UniqueAlarmId",
  "AlarmState",
  "Count",
  "Priority",
  "TimeStamp",
  "TriggeredTime",
  "SourceName",
  "Source",
  "AlarmText",
  "SystemAlarmId",
  "Category",
  "AcknowledgedBy",
  "AcknowledgeTime",
  "ValueAtChange",
  "BasicEvaluationState",
  "Logging",
  "Hidden",
  "SourceServer"
];
const DEFAULT_RETURNED_PROPERTY_NAMES = [
  "SEQNO",
  "Count",
  "Priority",
  "TimeStamp",
  "SourceServer",
  "Source",
  "AlarmText",
  "AcknowledgedBy",
  "Category",
  "AlarmState",
  "AcknowledgeTime",
  "BasicEvaluationState",
  "Logging",
  "Hidden",
  "UniqueAlarmId",
  "SourceName",
  "SystemAlarmId"
];

async function fetchWebStationAlarms(site, options = {}) {
  try {
    const session = await createWebStationSession(site);
    await getWebStationEntry(session);

    const records = await readActiveAlarmRecords(session, options);
    return records.map((record) => normalizeWebStationAlarm(record, site));
  } catch (error) {
    const connectorError = buildWebStationConnectorError(error, site);
    console.error(`[${site.siteName}] Failed to fetch WebStation alarms:`, connectorError.message);
    if (options.throwOnError) {
      throw connectorError;
    }
    return [];
  }
}

async function testWebStationAccess(site) {
  try {
    const session = await createWebStationSession(site);
    const webEntry = await getWebStationEntry(session);
    const meta = await readArray(session, {
      startSequenceNumber: 0,
      numberOfRequestedRecords: 0
    });

    return {
      ok: true,
      connector: "EBO WebStation",
      baseUrl: session.baseUrl,
      user: webEntry.WebEntryRes?.User
        ? {
            name: webEntry.WebEntryRes.User.name,
            domain: webEntry.WebEntryRes.User.domain,
            groups: webEntry.WebEntryRes.User.groups || []
          }
        : undefined,
      entryServer: webEntry.WebEntryRes?.EntryServer
        ? {
            name: webEntry.WebEntryRes.EntryServer.name,
            version: webEntry.WebEntryRes.EntryServer.version,
            path: webEntry.WebEntryRes.EntryServer.path,
            servers: (webEntry.WebEntryRes.EntryServer.servers || []).map((server) => ({
              path: server.path,
              id: server.id
            }))
          }
        : undefined,
      alarmRecords: meta.METADATA?.[0] || {}
    };
  } catch (error) {
    throw buildWebStationConnectorError(error, site);
  }
}

function getWebStationEntry(session) {
  return session.postJson({
    command: "WebEntry",
    clientLanguage: "en",
    clientLocale: "en-US",
    clientSystemOfMeasurement: 0,
    workstation: false
  });
}

async function createWebStationSession(site) {
  const baseUrl = String(site.baseUrl || site.serverUrl || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("WebStation base URL is required");
  }
  if (!site.username || !site.password) {
    throw new Error("WebStation username and password are required");
  }

  const session = {
    baseUrl,
    csrfToken: "",
    cookies: [],
    async request(config) {
      const response = await axios({
        ...config,
        url: `${baseUrl}${config.url}`,
        httpsAgent: insecureTestAgent,
        timeout: config.timeout || 30000,
        validateStatus: () => true,
        headers: {
          ...(config.headers || {}),
          ...this.authHeaders()
        }
      });
      this.captureCookies(response);
      return response;
    },
    captureCookies(response) {
      for (const cookie of response.headers["set-cookie"] || []) {
        const keyValue = cookie.split(";")[0];
        const name = keyValue.split("=")[0];
        this.cookies = this.cookies.filter((item) => !item.startsWith(`${name}=`));
        this.cookies.push(keyValue);
      }
    },
    authHeaders(extra = {}) {
      return {
        ...extra,
        Cookie: this.cookies.join("; "),
        "X-CSRF-Token": this.csrfToken
      };
    },
    async postJson(payload) {
      const response = await this.request({
        method: "POST",
        url: "/json/POST",
        data: payload,
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (response.status !== 200) {
        throw createHttpError("WebStation JSON request failed", response);
      }
      if (response.data?.ERROR_LOGGED_OUT) {
        throw new Error("WebStation session is logged out");
      }
      if (response.data?.ERROR || response.data?.Status === "false") {
        const message = response.data?.ErrMsg || response.data?.ERROR || "WebStation command failed";
        const error = new Error(message);
        error.response = response;
        throw error;
      }
      return response.data;
    }
  };

  const loginPage = await getLoginPage(session);
  if (loginPage.status !== 200) {
    throw createHttpError("WebStation login page failed", loginPage);
  }
  session.csrfToken = extractCsrfToken(loginPage.data);

  const challengeResponse = await session.request({
    method: "POST",
    url: "/vp/Challenge"
  });
  if (challengeResponse.status !== 200) {
    throw createHttpError("WebStation challenge failed", challengeResponse);
  }

  const challenge = getChallengeValue(challengeResponse.data);
  const domain = site.domain || "";
  const digest = crypto
    .createHash("sha256")
    .update(`${site.username}${domain}${site.password}/webstation/vp/Login${challenge}`)
    .digest("hex");

  const loginResponse = await session.request({
    method: "POST",
    url: "/webstation/vp/Login",
    headers: {
      Authorization: `SxWDigest UID=${encodeURIComponent(site.username)},DOM=${encodeURIComponent(domain)},NV=${challenge},DIG=${digest}`
    }
  });

  if (loginResponse.status !== 200) {
    throw createHttpError("WebStation login failed", loginResponse);
  }
  if (!loginResponse.data?.token) {
    const message = loginResponse.data?.ErrMsg || "WebStation login did not return a session token";
    throw new Error(message);
  }

  session.csrfToken = loginResponse.data.token;
  return session;
}

async function getLoginPage(session) {
  const loginPage = await session.request({ method: "GET", url: "/login.html" });
  if (loginPage.status === 200 && extractCsrfToken(loginPage.data)) {
    return loginPage;
  }
  return session.request({ method: "GET", url: "/" });
}

async function readActiveAlarmRecords(session, options = {}) {
  const meta = await readArray(session, {
    startSequenceNumber: 0,
    numberOfRequestedRecords: 0
  });
  const metadata = meta.METADATA?.[0] || {};
  const firstRecord = Number(metadata.firstRecord || 0);
  const lastRecord = Number(metadata.lastRecord || 0);

  if (!firstRecord || !lastRecord || lastRecord < firstRecord) {
    return [];
  }

  const activeById = new Map();
  let nextRecord = firstRecord;
  let chunks = 0;
  const chunkSize = options.webStationChunkSize || 100;
  const totalRecords = lastRecord - firstRecord + 1;
  const maxChunks =
    options.webStationMaxChunks || Math.max(1, Math.ceil(totalRecords / chunkSize) + 2);

  while (nextRecord <= lastRecord && chunks < maxChunks) {
    const page = await readArray(session, {
      startSequenceNumber: nextRecord,
      numberOfRequestedRecords: chunkSize
    });
    const records = parseReadArrayRecords(page);
    for (const record of records) {
      const alarmKey = String(record.UniqueAlarmId || `${record.Source || ""}:${record.SEQNO || ""}`);
      if (!alarmKey) continue;
      if (isActiveAlarmState(record.AlarmState)) {
        activeById.set(alarmKey, record);
      } else {
        activeById.delete(alarmKey);
      }
    }

    const lastVisited = Number(page.METADATA?.[0]?.lastRecordVisited || 0);
    if (!lastVisited || lastVisited < nextRecord) break;
    nextRecord = lastVisited + 1;
    chunks += 1;
  }

  return Array.from(activeById.values());
}

function readArray(session, { startSequenceNumber, numberOfRequestedRecords }) {
  return session.postJson({
    command: "ReadArray",
    path: ALARM_RECORDS_PATH,
    propertyNames: DEFAULT_PROPERTY_NAMES,
    id: 0,
    handle: 0,
    deliveryType: 0,
    startSequenceNumber,
    numberOfRequestedRecords,
    filter: "",
    serializedFilterObjectInstance: ""
  });
}

function parseReadArrayRecords(page) {
  const records = [];
  const pageLabelsByType = new Map();
  for (const result of page.ReadArrayRes || []) {
    for (const [typeName, propertyNames] of buildLabelsByType(result.Labels)) {
      pageLabelsByType.set(typeName, propertyNames);
    }
  }
  const defaultPageLabels =
    pageLabelsByType.size === 1
      ? Array.from(pageLabelsByType.values())[0]
      : DEFAULT_RETURNED_PROPERTY_NAMES;

  for (const result of page.ReadArrayRes || []) {
    const labelsByType = buildLabelsByType(result.Labels);
    const defaultLabels =
      labelsByType.size === 1 ? Array.from(labelsByType.values())[0] : defaultPageLabels;
    for (const row of result.data || []) {
      const typeName = typeof row[0] === "string" ? row[0] : null;
      const labels = typeName
        ? labelsByType.get(typeName) || pageLabelsByType.get(typeName)
        : defaultLabels;
      if (!labels) continue;
      const offset = typeName ? 1 : 0;
      const record = { recordType: typeName };
      labels.forEach((label, index) => {
        record[label] = row[index + offset];
      });
      records.push(record);
    }
  }
  return records;
}

function isActiveAlarmState(alarmState) {
  const state = Number(alarmState);
  return state === 1 || state === 2;
}

function buildLabelsByType(labels) {
  const labelsByType = new Map();
  for (const group of labels || []) {
    for (const [typeName, propertyNames] of Object.entries(group)) {
      labelsByType.set(typeName, propertyNames || []);
    }
  }
  return labelsByType;
}

function normalizeWebStationAlarm(record, site) {
  const sourcePath = record.Source || record.SourceServer || "Unknown";
  const priorityNumber = toNumber(record.Priority);
  const occurredAt = toDate(record.TriggeredTime || record.TimeStamp) || new Date();
  const acknowledgedBy = String(record.AcknowledgedBy || "");

  return {
    siteId: site.siteId,
    clientName: site.clientName,
    siteName: site.siteName,
    sourcePath,
    alarmName: record.SourceName || record.SystemAlarmId || record.AlarmText || "Unknown Alarm",
    equipmentName: extractEquipmentName(sourcePath),
    priority: mapPriority(priorityNumber),
    eboPriority: priorityNumber,
    state: Number(record.AlarmState || 0) === 2 ? "Acknowledged" : "Active",
    acknowledged: acknowledgedBy.trim().length > 0,
    message: record.AlarmText || record.SystemAlarmId || "",
    occurredAt,
    returnedToNormalAt: null,
    rawData: {
      connector: "EBO WebStation",
      ...record
    }
  };
}

function extractCsrfToken(html) {
  const csrfInput = String(html || "").match(/<input[^>]*id=["']csrf["'][^>]*>/);
  if (!csrfInput) return "";
  return (csrfInput[0].match(/value=["']([^"']*)/) || [])[1] || "";
}

function getChallengeValue(data) {
  if (typeof data === "string") return data;
  return data?.challenge || data?.Value || "";
}

function toDate(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    if (String(value).startsWith("Tx")) {
      const hex = String(value).slice(2, 15);
      return new Date(Number(BigInt(`0x${hex}`) / 1000n));
    }
    return new Date(Number(BigInt(String(value)) / 256000n));
  } catch (error) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapPriority(priorityNumber) {
  if (priorityNumber === null || priorityNumber === undefined) return "Unknown";
  if (priorityNumber <= 50) return "Critical";
  if (priorityNumber <= 100) return "High";
  if (priorityNumber <= 250) return "Medium";
  return "Low";
}

function extractEquipmentName(path) {
  if (!path) return "Unknown";
  const parts = String(path).split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "Unknown";
}

function createHttpError(message, response) {
  const error = new Error(message);
  error.response = response;
  return error;
}

function buildWebStationConnectorError(error, site) {
  const statusCode = error.response?.status;
  const responseBody =
    typeof error.response?.data === "string"
      ? error.response.data.slice(0, 500)
      : error.response?.data;

  const connectorError = new Error(
    statusCode ? `WebStation request failed with status code ${statusCode}` : error.message
  );
  connectorError.statusCode = statusCode;
  connectorError.diagnostic = {
    siteId: site.siteId,
    siteName: site.siteName,
    baseUrl: site.baseUrl || site.serverUrl,
    testedUrl: site.baseUrl || site.serverUrl,
    statusCode,
    axiosCode: error.code,
    responseBody,
    likelyCause: getWebStationLikelyCause(statusCode, error.code),
    nextStep: getWebStationNextStep(statusCode, error.code)
  };
  return connectorError;
}

function getWebStationLikelyCause(statusCode, axiosCode) {
  if (axiosCode === "ETIMEDOUT" || axiosCode === "ECONNABORTED") {
    return "The WebStation host did not respond before the timeout. VPN/Neeve or site routing is likely down.";
  }
  if (axiosCode === "ECONNREFUSED") {
    return "The WebStation host was reached, but HTTPS/443 refused the connection.";
  }
  if (axiosCode === "ENOTFOUND") {
    return "The WebStation hostname could not be resolved.";
  }
  if (statusCode === 401 || statusCode === 403) {
    return "WebStation rejected authentication or the account lacks access.";
  }
  if (statusCode === 404) {
    return "The server is reachable, but this does not look like an EBO WebStation URL.";
  }
  return "WebStation login or alarm record read failed.";
}

function getWebStationNextStep(statusCode, axiosCode) {
  if (axiosCode === "ETIMEDOUT" || axiosCode === "ECONNABORTED") {
    return "Confirm the VPN/Neeve connection is active, then open the WebStation base URL from this machine.";
  }
  if (statusCode === 401 || statusCode === 403) {
    return "Verify the username/password and that the account can open Alarm Manager in WebStation.";
  }
  if (statusCode === 404) {
    return "Use the WebStation base URL, for example https://192.168.10.17, not a graphics page hash URL.";
  }
  return "Confirm the WebStation URL opens over VPN and the account can view Alarm Manager records.";
}

module.exports = {
  fetchWebStationAlarms,
  testWebStationAccess
};
