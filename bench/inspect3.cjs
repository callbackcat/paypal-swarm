// Counts ok / failed results of the tracking read and update tools across every recorded run.
const fs = require("fs");
const rows = fs.readFileSync(__dirname + "/results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
(async () => {
  const c = {};
  for (const row of rows) {
    const r = await fetch("http://localhost:8787/runs/" + row.id + "/events.json?since=0&limit=5000&type=tool.result").then((x) => x.json()).catch(() => ({ events: [] }));
    for (const e of r.events || []) {
      const p = e.payload || {};
      if (!/^(get|update|create)_shipment_tracking$/.test(p.tool || "")) continue;
      const k = p.tool + " " + (p.ok ? "ok" : "fail " + p.status);
      c[k] = (c[k] || 0) + 1;
    }
  }
  console.log(c);
})();
