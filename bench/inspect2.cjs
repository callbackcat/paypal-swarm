// node inspect2.cjs <runId>  -> every shipment tracking call in order, with the outcome status
const id = process.argv[2];
(async () => {
  const r = await fetch("http://localhost:8787/runs/" + id + "/events.json?since=0&limit=5000").then((x) => x.json());
  for (const e of r.events) {
    const p = e.payload || {};
    if (!/shipment_tracking/.test(p.tool || "")) continue;
    if (e.type === "tool.call") console.log(Math.round(e.simT), "CALL  ", p.tool, JSON.stringify(p.input).slice(0, 150));
    if (e.type === "tool.result") console.log(Math.round(e.simT), "RESULT", p.tool, "ok=" + p.ok, "status=" + p.status, JSON.stringify(p.output || "").slice(0, 120));
  }
})();
