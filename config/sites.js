module.exports = [
  {
    siteId: "pilot-site-001",
    clientName: "Pilot Client",
    siteName: "Main Building",
    connectionType: "SmartConnectorREST",
    enabled: true,

    // Replace this with the actual SmartConnector REST/EWS Gateway URL.
    baseUrl: "https://client-smartconnector-server/api",

    username: "triton_api_reader",
    password: "CHANGE_ME",

    alarmPriorityFilter: ["Critical", "High"],

    pointDefinitions: [
      {
        equipmentName: "CHW Plant",
        pointName: "CHW Supply Temperature",
        sourcePath: "/CHW Plant/CHWS Temp",
        unit: "F"
      },
      {
        equipmentName: "AHU-1",
        pointName: "Discharge Air Temperature",
        sourcePath: "/AHU-1/DAT",
        unit: "F"
      }
    ]
  }
];
