const rules = [
  {
    category: "Plant",
    keywords: ["chw", "chiller", "pump", "boiler", "tower", "condenser"]
  },
  {
    category: "AHU",
    keywords: ["ahu", "air handler", "supply fan", "return fan", "dat", "discharge air"]
  },
  {
    category: "VAV",
    keywords: ["vav", "box", "reheat"]
  },
  {
    category: "Network",
    keywords: ["offline", "network", "controller offline", "device offline"]
  },
  {
    category: "Communication",
    keywords: ["communication", "comm fail", "bacnet", "mstp"]
  },
  {
    category: "Sensor",
    keywords: ["sensor", "temp sensor", "humidity sensor", "co2 sensor"]
  },
  {
    category: "Safety",
    keywords: ["smoke", "fire", "freeze", "safety", "life safety"]
  },
  {
    category: "Energy",
    keywords: ["economizer", "simultaneous", "energy", "demand"]
  },
  {
    category: "Comfort",
    keywords: ["zone temp", "too hot", "too cold", "comfort"]
  }
];

function classifyAlarm(alarm) {
  const text = [
    alarm.alarmName,
    alarm.equipmentName,
    alarm.sourcePath,
    alarm.message
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const match = rules.find((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword))
  );

  return match?.category || "Unknown";
}

module.exports = {
  classifyAlarm
};
