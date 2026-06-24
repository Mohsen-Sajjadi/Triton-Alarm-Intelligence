# Triton AI Alarm Insights

Small Node.js integration platform for collecting Schneider EBO / SmartConnector alarm and point data into MongoDB, then exposing it through Triton-owned APIs for alarm insights, analytics, ServiceSync, and future AI workflows.

## Architecture

```text
Schneider EBO / Enterprise Server / AS-P
        -> EWS / SmartConnector RESTful EWS Gateway
        -> Triton AI Alarm Insights
        -> MongoDB
        -> Triton API
        -> Client Portal / Analytics / AI
```

The portal and analytics app should read from this API/database layer, not directly from EBO.

## Runtime Stack

- Node.js
- Express
- MongoDB
- Mongoose
- Axios
- NSSM or PM2 for Windows service hosting

## Install

```powershell
npm install
```

## Configure

Update `.env`:

```env
PORT=3010
MONGO_URI=mongodb://127.0.0.1:27017/triton_alarm_bridge
POLL_INTERVAL_SECONDS=30
POINT_POLL_INTERVAL_SECONDS=300
ENABLE_POINT_COLLECTION=false
ENABLE_NOTIFICATIONS=false
ENABLE_SERVICE_TICKETS=false
TRITON_TEAM_EMAIL=service@triton-concepts.com
AI_PROVIDER=openai
AI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=low
OPENAI_API_KEY=your_openai_api_key_here
```

Update `config/sites.js` with the pilot SmartConnector / EWS Gateway details.

For production, move site credentials into encrypted secrets instead of storing passwords directly in config.

## Run

Double-click `Start-Triton-Alarm-Bridge.bat` to start the bridge on Windows.
Double-click `Stop-Triton-Alarm-Bridge.bat` to stop the bridge and release port `3010`.

The launcher opens a terminal, installs dependencies if `node_modules` is missing, and runs:

```powershell
npm start
```

For development with auto-restart:

```powershell
npm run dev
```

## Demo Gateway

For local testing without a live SmartConnector server, create a site in the admin page with:

```text
Gateway Base URL: http://localhost:3010/demo-gateway
Alarm Endpoint Path: /alarms/active
Username: demo
Password: demo
Alarm Priorities: Critical,High,Medium
```

Then click `Test Connection` and `Fetch And Save Alarms`.

For a live EBO/SmartConnector VM, set `Gateway Base URL` to the reachable scheme, host, and port, then set `Alarm Endpoint Path` to the actual REST alarm endpoint exposed by that gateway.

## EBO EWS SOAP

For a live EcoStruxure Building Operation EWS connection, use:

```text
Connection Type: EBO EWS SOAP
Gateway Base URL: https://10.0.11.158
EBO EWS SOAP URL: https://10.0.11.158/EcoStruxure/DataExchange
Username: your EWS user
Password: your EWS password
Alarm Priorities: Critical,High,Medium
```

Keep `Poll automatically` off for the first live test, then click `Test Connection`.

## Seed Test Data

After MongoDB is running:

```powershell
npm run seed:test-alarm
```

This creates a pilot site, one critical alarm, and one point sample.

## API

Health:

- `GET /api/health`

Alarms:

- `GET /api/alarms`
- `GET /api/alarms/active`
- `GET /api/alarms/critical`
- `GET /api/alarms/client/:clientName`
- `GET /api/alarms/site/:siteName`
- `POST /api/alarms/create-service-ticket`
- `PATCH /api/alarms/:id/return-to-normal`

Points:

- `GET /api/points/latest`
- `GET /api/points/client/:clientName`
- `GET /api/points/equipment/:equipmentName`

Sites:

- `GET /api/sites`
- `POST /api/sites`
- `PATCH /api/sites/:siteId`

Analytics:

- `GET /api/analytics/top-alarms`
- `GET /api/analytics/repeated-alarms`
- `GET /api/analytics/alarm-duration`
- `GET /api/analytics/equipment-health`

AI preparation:

- `POST /api/ai/summarize-alarm`
- `POST /api/ai/recommend-action`
- `POST /api/ai/monthly-report`
- `POST /api/ai/root-cause-analysis`

OpenAI mode is enabled when `AI_PROVIDER=openai` and `OPENAI_API_KEY` is set.
If OpenAI is not configured or the request fails, alarm analysis falls back to the local rule-based analyzer.

Service issues:

- `GET /api/service-issues`
- `PATCH /api/service-issues/:id`

## SmartConnector Endpoints

The current connector uses placeholder paths:

```text
{site.baseUrl}/alarms/active
{site.baseUrl}/points/read
```

Replace those paths in `connectors/eboAlarmConnector.js` after confirming the exact SmartConnector RESTful EWS Gateway alarm and point endpoint formats for the pilot site.

## V1 Scope

Start with:

- One pilot site
- Active critical/high alarms only
- Polling every 30 seconds
- MongoDB storage
- Internal dashboard/API
- Manual or semi-automatic internal service issue creation
- No automatic client notification

Point collection exists behind `ENABLE_POINT_COLLECTION=false` so it can be turned on after the alarm path is stable.

## Automatic Polling Schedule

Each site can control automatic alarm polling from the admin Site Setup modal:

- `Poll automatically`: enables background polling for that site.
- `Poll Every`: per-site interval in minutes.
- `Active Days`: days when background polling is allowed.
- `Start Time` / `End Time`: daily polling window using the server's local time.

Manual actions such as `Fetch Selected Site` and `Fetch Polling Sites` still run immediately. The schedule only controls background automatic polling.

## NSSM Example

```powershell
nssm install TritonDataBridge
```

Set:

- Path: `C:\Program Files\nodejs\node.exe`
- Startup directory: this project folder
- Arguments: `server.js`

Then:

```powershell
nssm start TritonDataBridge
```

## Pilot Checklist

Confirm these items before switching from the placeholder connector path to the real SmartConnector endpoint:

- EBO version.
- Enterprise Server is present.
- AS-Ps are connected under the Enterprise Server.
- EWS is licensed/enabled.
- SmartConnector RESTful EWS Gateway is installed or available.
- A read-only EBO user exists, for example `triton_api_reader`.
- Triton server can reach EBO/SmartConnector through VPN, Neeve, or another secure route.
- Alarm priorities are configured correctly.
- Returned-to-normal and acknowledged alarm fields are available in the response.
- Cybersecurity/client approval is complete where required.
