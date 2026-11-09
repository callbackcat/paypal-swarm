// node inspect.cjs <runId> <toolName>  -> the failing calls of that tool: who called, with what input, what came back
const [id, tool] = process.argv.slice(2);
(async () => {
  const r = await fetch("http://localhost:8787/runs/" + id + "/events.json?since=0&limit=5000").then((x) => x.json()).catch(() => null);
  const ev = (r && r.events) || [];
  const calls = ev.filter((e) => (e.type === "tool.call" || e.type === "tool.result" || e.type === "paypal.error") && JSON.stringify(e.payload).includes(tool));
  let n = 0;
  for (const e of calls) {
    if (e.type !== "paypal.error" && e.type !== "tool.call") continue;
    if (n++ > 9) break;
    console.log(e.type, "|", e.actor, e.actorClass, "| simT", Math.round(e.simT), "|", JSON.stringify(e.payload).slice(0, 330));
  }
  console.log("events:", ev.length, "matching:", calls.length);
})();
