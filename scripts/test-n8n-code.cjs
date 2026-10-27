// Runs the n8n Code-node scripts locally with stubbed n8n globals, then calls
// Gemini with the generated request, to test prompt + guardrails end to end.
const fs = require("fs");
const { SYSTEM_PROMPT } = require("../n8n/src/prompt.js");
const run = (file, input, extra = {}) => {
  let code = fs.readFileSync(`n8n/src/${file}`, "utf8").replace("__SYSTEM_PROMPT__", JSON.stringify(SYSTEM_PROMPT));
  const fn = new Function("$input", "$getWorkflowStaticData", "$", code);
  const store = {};
  return fn({ first: () => ({ json: input }) }, () => store, extra.$ ?? (() => ({ first: () => ({ json: {} }) })))[0].json;
};
const data = JSON.parse(fs.readFileSync("data/seed-computed.json", "utf8"));
const payloadFor = (a) => ({ body: {
  request_id: "test-" + a.author_id, author: { code: a.author_id, name: a.name, email: a.email },
  books: JSON.stringify(a.books.map((b) => ({ code: b.book_id, title: b.title, stage: b.stage, publication_date: b.publication_date, mrp: b.mrp, copies_sold: b.total_copies_sold, royalty_earned: b.total_royalty_earned, royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending, last_payout_date: b.last_royalty_payout_date, available_on: b.available_on }))).slice(1, -1),
}});
(async () => {
  // Usage: GEMINI_API_KEY=<your key> node scripts/test-n8n-code.cjs AUTH002 AUTH008
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY to your own Gemini API key");
  for (const code of process.argv.slice(2)) {
    const a = data.find((x) => x.author_id === code);
    const v = run("validate.js", payloadFor(a));
    if (!v.valid) { console.log("INVALID", v.error_message); continue; }
    const f = run("facts.js", v);
    for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(f.gemini_request) });
      const res = await r.json();
      if (!r.ok) { console.log(`--- ${code} ${model} HTTP ${r.status} ${res.error?.status}`); continue; }
      const p = run("parse.js", res, { $: () => ({ first: () => ({ json: f }) }) });
      console.log(`\n=========== ${code} via ${model} ok=${p.ok} ${p.error_message}\nSUBJECT: ${p.subject}\n${p.body}`);
      break;
    }
  }
})();
