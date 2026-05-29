const crypto = require("crypto");
const https = require("https");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const EWS_NAMESPACE = "http://www.schneider-electric.com/common/dataexchange/2011/05";
const GET_ALARM_EVENTS_ACTION = `${EWS_NAMESPACE}/GetAlarmEventsRequest`;
const GET_WEB_SERVICE_INFORMATION_ACTION = `${EWS_NAMESPACE}/GetWebServiceInformationRequest`;

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
      const response = await postGetAlarmEvents(endpointUrl, site, moreDataRef);
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

async function fetchEwsWebServiceInformation(site) {
  const endpointUrl = getEwsEndpointUrl(site);
  const attempts = [
    { soapVersion: "1.2" },
    { soapVersion: "1.1" }
  ];
  let lastError;

  for (const attempt of attempts) {
    const envelope = buildGetWebServiceInformationEnvelope({
      soapVersion: attempt.soapVersion,
      endpointUrl
    });

    try {
      const response = await postWithDigestAuth(endpointUrl, envelope, site, {
        soapAction: GET_WEB_SERVICE_INFORMATION_ACTION,
        soapVersion: attempt.soapVersion
      });

      return {
        endpointUrl,
        soapVersion: attempt.soapVersion,
        information: parseWebServiceInformationResponse(response.data),
        rawResponse: typeof response.data === "string"
          ? response.data.slice(0, 1500)
          : response.data
      };
    } catch (error) {
      if (error.response?.status !== 400) {
        throw buildEwsConnectorError(error, site);
      }
      lastError = error;
    }
  }

  throw buildEwsConnectorError(lastError, site);
}

async function postGetAlarmEvents(endpointUrl, site, moreDataRef) {
  const attempts = [
    { soapVersion: "1.2", includePriorityFilter: true },
    { soapVersion: "1.2", includePriorityFilter: false },
    { soapVersion: "1.1", includePriorityFilter: true },
    { soapVersion: "1.1", includePriorityFilter: false }
  ];
  let lastError;

  for (const attempt of attempts) {
    const envelope = buildGetAlarmEventsEnvelope(site, moreDataRef, {
      ...attempt,
      endpointUrl
    });

    try {
      return await postWithDigestAuth(endpointUrl, envelope, site, {
        soapAction: GET_ALARM_EVENTS_ACTION,
        soapVersion: attempt.soapVersion
      });
    } catch (error) {
      if (error.response?.status !== 400) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
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
  const headers = buildSoapHeaders(options);

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

function buildSoapHeaders(options = {}) {
  if (options.soapVersion === "1.1") {
    return {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${options.soapAction}"`,
      Accept: "text/xml, application/soap+xml"
    };
  }

  return {
    "Content-Type": `application/soap+xml; charset=utf-8; action="${options.soapAction}"`,
    Accept: "application/soap+xml, text/xml"
  };
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

function buildGetAlarmEventsEnvelope(site, moreDataRef, options = {}) {
  const soapVersion = options.soapVersion || "1.2";
  const includePriorityFilter = options.includePriorityFilter !== false;
  const endpointUrl = options.endpointUrl || getEwsEndpointUrl(site);
  const { priorityFrom, priorityTo } = getPriorityRange(site.alarmPriorityFilter);
  const parameterXml = moreDataRef
    ? `<GetAlarmEventsParameter><MoreDataRef>${escapeXml(moreDataRef)}</MoreDataRef></GetAlarmEventsParameter>`
    : "<GetAlarmEventsParameter />";
  const filterXml = includePriorityFilter
    ? `<GetAlarmEventsFilter>
        <PriorityFrom>${priorityFrom}</PriorityFrom>
        <PriorityTo>${priorityTo}</PriorityTo>
      </GetAlarmEventsFilter>`
    : "<GetAlarmEventsFilter />";
  const soapPrefix = soapVersion === "1.1" ? "soap" : "soap12";
  const soapNamespace = soapVersion === "1.1"
    ? "http://schemas.xmlsoap.org/soap/envelope/"
    : "http://www.w3.org/2003/05/soap-envelope";

  return `<?xml version="1.0" encoding="utf-8"?>
<${soapPrefix}:Envelope xmlns:${soapPrefix}="${soapNamespace}">
  ${buildSoapAddressingHeader(soapPrefix, GET_ALARM_EVENTS_ACTION, endpointUrl)}
  <${soapPrefix}:Body>
    <GetAlarmEventsRequest xmlns="${EWS_NAMESPACE}">
      ${parameterXml}
      ${filterXml}
    </GetAlarmEventsRequest>
  </${soapPrefix}:Body>
</${soapPrefix}:Envelope>`;
}

function buildGetWebServiceInformationEnvelope(options = {}) {
  const soapVersion = options.soapVersion || "1.2";
  const endpointUrl = options.endpointUrl || "";
  const soapPrefix = soapVersion === "1.1" ? "soap" : "soap12";
  const soapNamespace = soapVersion === "1.1"
    ? "http://schemas.xmlsoap.org/soap/envelope/"
    : "http://www.w3.org/2003/05/soap-envelope";

  return `<?xml version="1.0" encoding="utf-8"?>
<${soapPrefix}:Envelope xmlns:${soapPrefix}="${soapNamespace}">
  ${buildSoapAddressingHeader(soapPrefix, GET_WEB_SERVICE_INFORMATION_ACTION, endpointUrl)}
  <${soapPrefix}:Body>
    <GetWebServiceInformationRequest xmlns="${EWS_NAMESPACE}" />
  </${soapPrefix}:Body>
</${soapPrefix}:Envelope>`;
}

function buildSoapAddressingHeader(soapPrefix, action, endpointUrl) {
  return `<${soapPrefix}:Header>
    <wsa:Action xmlns:wsa="http://www.w3.org/2005/08/addressing">${escapeXml(action)}</wsa:Action>
    <wsa:To xmlns:wsa="http://www.w3.org/2005/08/addressing">${escapeXml(endpointUrl)}</wsa:To>
  </${soapPrefix}:Header>`;
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

  if (!values.length || values.includes("all") || values.includes("low")) return { priorityFrom: 0, priorityTo: 500 };
  if (values.includes("medium")) return { priorityFrom: 0, priorityTo: 500 };
  if (values.includes("high")) return { priorityFrom: 0, priorityTo: 100 };
  return { priorityFrom: 0, priorityTo: 50 };
}

function parseAlarmEvents(xml) {
  return parseAlarmEventsResponse(xml).alarms;
}

function parseWebServiceInformationResponse(xml) {
  const parsed = xmlParser.parse(xml);
  const body = parsed.Envelope?.Body || parsed.Body;
  const response = body?.GetWebServiceInformationResponse || {};
  const version = response.GetWebServiceInformationVersion || {};
  const operations = response.GetWebServiceInformationSupportedOperations?.Operation || [];

  return {
    version,
    operations: Array.isArray(operations) ? operations : [operations].filter(Boolean)
  };
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
  if (priority <= 500) return "Medium";
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
  if (statusCode === 400) return "EWS rejected the SOAP envelope, SOAP action, request version, or endpoint URL.";
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
  if (statusCode === 400) return "Open the EWS URL in a browser to confirm it is the DataExchange endpoint, then check whether this EBO version expects SOAP 1.1/1.2 or a different GetAlarmEvents request shape.";
  if (axiosCode === "ECONNABORTED") return "Confirm VPN stays connected and EBO responds from this machine.";
  return "Check VPN, EBO EWS Server Configuration, account permissions, and the EWS URL.";
}

module.exports = {
  fetchEwsAlarmEvents,
  fetchEwsWebServiceInformation,
  buildDigestAuthorizationHeader,
  buildGetAlarmEventsEnvelope,
  parseAlarmEvents,
  parseAlarmEventsResponse
};
