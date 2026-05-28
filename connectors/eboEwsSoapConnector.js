const crypto = require("crypto");
const https = require("https");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const EWS_NAMESPACE = "http://www.schneider-electric.com/common/dataexchange/2011/05";
const GET_ALARM_EVENTS_ACTION = `${EWS_NAMESPACE}/GetAlarmEventsIn`;

const insecureTestAgent = new https.Agent({
  rejectUnauthorized: false
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true
});

async function fetchEwsAlarmEvents(site, options = {}) {
  try {
    const endpointUrl = getEwsEndpointUrl(site);
    const alarms = [];
    let moreDataRef;
    let moreDataAvailable = false;
    let pageCount = 0;

    do {
      const envelope = buildGetAlarmEventsEnvelope(site, moreDataRef);
      const response = await postWithDigestAuth(endpointUrl, envelope, site, {
        soapAction: GET_ALARM_EVENTS_ACTION
      });
      const page = parseAlarmEventsResponse(response.data);

      alarms.push(...page.alarms);
      moreDataAvailable = page.moreDataAvailable;
      moreDataRef = page.moreDataRef;
      pageCount += 1;
    } while (moreDataAvailable && moreDataRef && pageCount < 20);

    return alarms.map((alarm) => normalizeEwsAlarm(alarm, site));
  } catch (error) {
    const connectorError = buildEwsConnectorError(error, site);
    console.error(`[${site.siteName}] Failed to fetch EWS alarms:`, connectorError.message);
    if (options.throwOnError) {
      throw connectorError;
    }
    return [];
  }
}

function getEwsEndpointUrl(site) {
  if (site.ewsUrl) return site.ewsUrl;

  const baseUrl = site.baseUrl || site.serverUrl;
  if (!baseUrl) {
    throw new Error("EWS URL or Gateway Base URL is required");
  }

  if (/\/EcoStruxure\/DataExchange\/?$/i.test(baseUrl)) {
    return baseUrl.replace(/\/+$/, "");
  }

  return `${baseUrl.replace(/\/+$/, "")}/EcoStruxure/DataExchange`;
}

async function postWithDigestAuth(url, body, site, options = {}) {
  const headers = {
    "Content-Type": `application/soap+xml; charset=utf-8; action="${options.soapAction}"`,
    Accept: "application/soap+xml, text/xml"
  };

  try {
    return await axios.post(url, body, {
      headers,
      timeout: 20000,
      httpsAgent: insecureTestAgent
    });
  } catch (error) {
    const challenge = error.response?.headers?.["www-authenticate"];
    if (error.response?.status !== 401 || !challenge) {
      throw error;
    }

    const authorization = buildDigestAuthorizationHeader({
      challenge,
      method: "POST",
      url,
      username: site.username,
      password: site.password
    });

    return axios.post(url, body, {
      headers: {
        ...headers,
        Authorization: authorization
      },
      timeout: 20000,
      httpsAgent: insecureTestAgent
    });
  }
}

function buildDigestAuthorizationHeader({ challenge, method, url, username, password }) {
  if (!username || !password) {
    throw new Error("EWS username and password are required");
  }

  const params = parseDigestChallenge(challenge);
  const algorithm = (params.algorithm || "MD5").toUpperCase();
  const qop = params.qop?.split(",").map((value) => value.trim()).includes("auth")
    ? "auth"
    : undefined;
  const nc = "00000001";
  const cnonce = crypto.randomBytes(12).toString("hex");
  const uri = new URL(url).pathname;

  const hash = getDigestHash(algorithm);
  const ha1 = hash(`${username}:${params.realm}:${password}`);
  const ha2 = hash(`${method}:${uri}`);
  const response = qop
    ? hash(`${ha1}:${params.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${params.nonce}:${ha2}`);

  const fields = [
    `username="${escapeDigestValue(username)}"`,
    `realm="${escapeDigestValue(params.realm)}"`,
    `nonce="${escapeDigestValue(params.nonce)}"`,
    `uri="${escapeDigestValue(uri)}"`,
    `response="${response}"`,
    params.opaque ? `opaque="${escapeDigestValue(params.opaque)}"` : null,
    `algorithm=${algorithm}`,
    qop ? `qop=${qop}` : null,
    qop ? `nc=${nc}` : null,
    qop ? `cnonce="${cnonce}"` : null
  ].filter(Boolean);

  return `Digest ${fields.join(", ")}`;
}

function parseDigestChallenge(challenge) {
  const value = challenge.replace(/^Digest\s+/i, "");
  const params = {};
  const pattern = /(\w+)=("([^"]*)"|([^,\s]*))/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    params[match[1]] = match[3] ?? match[4] ?? "";
  }

  if (!params.realm || !params.nonce) {
    throw new Error("Digest authentication challenge did not include realm and nonce");
  }

  return params;
}

function getDigestHash(algorithm) {
  if (algorithm === "SHA-256") {
    return (value) => crypto.createHash("sha256").update(value).digest("hex");
  }

  if (algorithm === "MD5") {
    return (value) => crypto.createHash("md5").update(value).digest("hex");
  }

  throw new Error(`Unsupported Digest algorithm: ${algorithm}`);
}

function escapeDigestValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildGetAlarmEventsEnvelope(site, moreDataRef) {
  const { priorityFrom, priorityTo } = getPriorityRange(site.alarmPriorityFilter);
  const parameterXml = moreDataRef
    ? `<GetAlarmEventsParameter><MoreDataRef>${escapeXml(moreDataRef)}</MoreDataRef></GetAlarmEventsParameter>`
    : "<GetAlarmEventsParameter></GetAlarmEventsParameter>";

  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <GetAlarmEventsRequest xmlns="${EWS_NAMESPACE}" version="1.2">
      ${parameterXml}
      <GetAlarmEventsFilter>
        <PriorityFrom>${priorityFrom}</PriorityFrom>
        <PriorityTo>${priorityTo}</PriorityTo>
      </GetAlarmEventsFilter>
    </GetAlarmEventsRequest>
  </soap12:Body>
</soap12:Envelope>`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getPriorityRange(priorityFilter = []) {
  const values = priorityFilter.map((priority) => String(priority).toLowerCase());

  if (values.includes("low")) return { priorityFrom: 0, priorityTo: 255 };
  if (values.includes("medium")) return { priorityFrom: 0, priorityTo: 200 };
  if (values.includes("high")) return { priorityFrom: 0, priorityTo: 100 };
  return { priorityFrom: 0, priorityTo: 50 };
}

function parseAlarmEvents(xml) {
  return parseAlarmEventsResponse(xml).alarms;
}

function parseAlarmEventsResponse(xml) {
  const parsed = xmlParser.parse(xml);
  const body = parsed.Envelope?.Body || parsed.Body;
  const response = body?.GetAlarmEventsResponse;
  const status = response?.GetAlarmEventsResponseStatus || {};
  const events = response?.GetAlarmEventsAlarmEvents?.AlarmEvent || [];

  return {
    alarms: Array.isArray(events) ? events : [events],
    moreDataAvailable: String(status.MoreDataAvailable).toLowerCase() === "true",
    moreDataRef: status.MoreDataRef || null,
    lastUpdate: status.LastUpdate || null,
    needsRefresh: String(status.NeedsRefresh).toLowerCase() === "true"
  };
}

function normalizeEwsAlarm(alarm, site) {
  const sourcePath = alarm.SourceID || alarm.SourceName || alarm.ID || "Unknown";
  const eboPriority = Number(alarm.Priority);

  return {
    siteId: site.siteId,
    clientName: site.clientName,
    siteName: site.siteName,
    sourcePath,
    alarmName: alarm.SourceName || alarm.Type || alarm.ID || "Unknown EWS Alarm",
    equipmentName: extractEquipmentName(sourcePath),
    priority: mapEwsPriority(eboPriority),
    eboPriority: Number.isFinite(eboPriority) ? eboPriority : null,
    state: mapEwsState(alarm.State),
    acknowledged: Number(alarm.Acknowledgeable) === 0 ? false : mapEwsState(alarm.State) === "Acknowledged",
    message: alarm.Message || "",
    occurredAt: alarm.TimeStampOccurrence || alarm.TimeStampTransition || new Date(),
    returnedToNormalAt: mapEwsState(alarm.State) === "ReturnedToNormal"
      ? alarm.TimeStampTransition || new Date()
      : null,
    rawData: alarm
  };
}

function mapEwsPriority(priority) {
  if (!Number.isFinite(priority)) return "Unknown";
  if (priority <= 50) return "Critical";
  if (priority <= 100) return "High";
  if (priority <= 200) return "Medium";
  return "Low";
}

function mapEwsState(state) {
  const value = Number(state);

  if (value === 1) return "Active";
  if (value === 2) return "Acknowledged";
  if (value === 3) return "ReturnedToNormal";
  if (value === 4) return "ReturnedToNormal";

  const text = String(state || "").toLowerCase();
  if (text.includes("ack")) return "Acknowledged";
  if (text.includes("normal") || text.includes("inactive")) return "ReturnedToNormal";
  if (text.includes("active")) return "Active";

  return "Unknown";
}

function extractEquipmentName(path) {
  if (!path) return "Unknown";
  const parts = String(path).split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "Unknown";
}

function buildEwsConnectorError(error, site) {
  const endpointUrl = (() => {
    try {
      return getEwsEndpointUrl(site);
    } catch {
      return site.ewsUrl || site.baseUrl || site.serverUrl;
    }
  })();
  const statusCode = error.response?.status;
  const responseBody =
    typeof error.response?.data === "string"
      ? error.response.data.slice(0, 1000)
      : error.response?.data;

  const diagnostic = {
    siteId: site.siteId,
    siteName: site.siteName,
    endpointUrl,
    statusCode,
    axiosCode: error.code,
    responseBody,
    likelyCause: getLikelyCause(statusCode, error.code),
    nextStep: getNextStep(statusCode, error.code)
  };

  const connectorError = new Error(
    statusCode
      ? `EWS SOAP request failed with status code ${statusCode}`
      : error.message
  );
  connectorError.statusCode = statusCode;
  connectorError.diagnostic = diagnostic;
  return connectorError;
}

function getLikelyCause(statusCode, axiosCode) {
  if (statusCode === 401) return "EWS rejected the username/password or Digest authorization.";
  if (statusCode === 403) return "The account authenticated but does not have EWS alarm permissions.";
  if (statusCode === 404) return "The EWS endpoint path was not found.";
  if (statusCode >= 500) return "EBO returned a server error while processing the SOAP request.";
  if (axiosCode === "ECONNABORTED") return "The EWS SOAP request timed out.";
  if (axiosCode === "ENOTFOUND") return "The EBO host could not be resolved.";
  if (axiosCode === "ECONNREFUSED") return "The EBO host refused the TCP connection.";
  return "The EWS SOAP request failed before alarm data could be read.";
}

function getNextStep(statusCode, axiosCode) {
  if (statusCode === 401) return "Verify the EWS user credentials. Use the same username format that worked in the browser prompt.";
  if (statusCode === 403) return "Grant the account permission to browse/read EWS alarms in EBO.";
  if (statusCode === 404) return "Use the full EWS URL, for example https://10.0.11.158/EcoStruxure/DataExchange.";
  if (axiosCode === "ECONNABORTED") return "Confirm VPN stays connected and EBO responds from this machine.";
  return "Check VPN, EBO EWS Server Configuration, account permissions, and the EWS URL.";
}

module.exports = {
  fetchEwsAlarmEvents,
  buildDigestAuthorizationHeader,
  buildGetAlarmEventsEnvelope,
  parseAlarmEvents,
  parseAlarmEventsResponse
};
