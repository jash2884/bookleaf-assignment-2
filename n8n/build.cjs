// Builds n8n/bookleaf-royalty-summary.workflow.json from the readable sources in n8n/src.
// Run: node n8n/build.cjs
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const src = (f) => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
const { SYSTEM_PROMPT } = require("./src/prompt.js");
const id = (name) => crypto.createHash("md5").update(name).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

const GEMINI = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// Credentials are referenced by id/name only; secrets live in n8n, never in this file.
const geminiCred = { httpHeaderAuth: { id: "KfYElxVGoPjOKs9R", name: "Header Auth account 2" } };

// Every outcome answers Bubble with the same JSON shape so its API Connector can
// parse one response type: { status: "Success" | "Failed", ... }.
const respond = (name, position, bodyExpr) => ({
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position,
  parameters: { respondWith: "json", responseBody: `={{ JSON.stringify(${bodyExpr}) }}`, options: {} },
});

const failedBody = (msgExpr, extra = "") =>
  `{ status: "Failed", request_id: $('Validate payload').first().json.request_id, error_message: ${msgExpr}, subject: "", body: "", recipient_email: "", completed_at: new Date().toISOString()${extra} }`;

const nodes = [
  {
    name: "Bubble webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-80, 176],
    webhookId: id("bookleaf-royalty-summary"),
    parameters: {
      httpMethod: "POST",
      path: "bookleaf-royalty-summary",
      authentication: "headerAuth",
      responseMode: "responseNode",
      options: {},
    },
    credentials: { httpHeaderAuth: { id: "ZsTZXH8divRl91vN", name: "Header Auth account" } },
  },
  { name: "Validate payload", type: "n8n-nodes-base.code", typeVersion: 2, position: [144, 176], parameters: { jsCode: src("validate.js") } },
  {
    name: "Payload valid?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [368, 176],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: id("valid"), leftValue: "={{ $json.valid }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      options: {},
    },
  },
  respond("Respond: invalid payload", [592, 272], failedBody("$json.error_message")),
  { name: "Deduplicate", type: "n8n-nodes-base.code", typeVersion: 2, position: [592, 80], parameters: { jsCode: src("dedupe.js") } },
  {
    name: "Duplicate request?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [816, 80],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: id("dup"), leftValue: "={{ $json.duplicate }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      options: {},
    },
  },
  respond("Respond: duplicate", [1040, -16], failedBody("$json.error_message", ", duplicate: true")),
  {
    name: "Compute royalty facts",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1040, 176],
    parameters: { jsCode: src("facts.js").replace("__SYSTEM_PROMPT__", JSON.stringify(SYSTEM_PROMPT)) },
  },
  {
    name: "Gemini: write email",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1264, 176],
    // No retry: on overload/timeout go straight to the fallback model so the
    // whole run stays inside Bubble's API-call timeout.
    retryOnFail: false,
    onError: "continueErrorOutput",
    parameters: {
      method: "POST",
      url: GEMINI("gemini-3.5-flash"),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.gemini_request) }}",
      options: { timeout: 20000 },
    },
    credentials: geminiCred,
  },
  {
    name: "Gemini: fallback model",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1488, 256],
    onError: "continueErrorOutput",
    parameters: {
      method: "POST",
      url: GEMINI("gemini-3.5-flash-lite"),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($('Compute royalty facts').first().json.gemini_request) }}",
      options: { timeout: 20000 },
    },
    credentials: geminiCred,
  },
  respond(
    "Respond: AI unavailable",
    [1712, 304],
    failedBody(`"AI service unavailable (primary and fallback model failed): " + ($json.error?.message ?? JSON.stringify($json.error ?? $json)).slice(0, 300)`),
  ),
  { name: "Parse & check AI output", type: "n8n-nodes-base.code", typeVersion: 2, position: [1712, 80], parameters: { jsCode: src("parse.js") } },
  {
    name: "AI output OK?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1936, 80],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: id("ok"), leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      options: {},
    },
  },
  respond("Respond: AI output rejected", [2160, 176], failedBody("$json.error_message")),
  {
    // Gmail API via OAuth (Google no longer offers app passwords on this account, so no SMTP password is stored anywhere).
    name: "Send email (Gmail)",
    type: "n8n-nodes-base.gmail",
    typeVersion: 2.1,
    position: [2160, -16],
    webhookId: "2ccfb128-8894-4846-bfd7-a66c48ba8d31",
    onError: "continueErrorOutput",
    parameters: {
      sendTo: "={{ $json.recipient_email }}",
      subject: "={{ $json.subject }}",
      emailType: "text",
      message: "={{ $json.email_text }}",
      options: { appendAttribution: false, senderName: "BookLeaf Author Support" },
    },
    credentials: { gmailOAuth2: { id: "2vQ5KwPAzOzp60Ie", name: "Gmail account" } },
  },
  respond(
    "Respond: success",
    [2384, -112],
    `{ status: "Success", request_id: $('Parse & check AI output').first().json.request_id, subject: $('Parse & check AI output').first().json.subject, body: $('Parse & check AI output').first().json.body, recipient_email: $('Parse & check AI output').first().json.recipient_email, intended_recipient: $('Parse & check AI output').first().json.intended_recipient, model: $('Parse & check AI output').first().json.model, error_message: "", completed_at: new Date().toISOString() }`,
  ),
  respond(
    "Respond: email failed",
    [2384, 80],
    `{ status: "Failed", request_id: $('Parse & check AI output').first().json.request_id, subject: $('Parse & check AI output').first().json.subject, body: $('Parse & check AI output').first().json.body, recipient_email: $('Parse & check AI output').first().json.recipient_email, error_message: "Email generated but delivery failed: " + String($json.error?.message ?? "SMTP error").slice(0, 300), completed_at: new Date().toISOString() }`,
  ),
];

const sticky = (name, position, width, height, content) => ({
  name,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position,
  parameters: { content, width, height },
});
nodes.push(
  sticky("Note: intake", [-112, -304], 1100, 220, "## 1 · Intake & safety\nWebhook protected by **Header Auth** (`X-BookLeaf-Secret`, stored as an n8n credential).\nPayload validated, then **deduplicated**: a second request for the same author within 120 s is rejected (Bubble also blocks double clicks)."),
  sticky("Note: ai", [1008, -304], 900, 220, "## 2 · Facts → AI\nAll money/date maths happens in code (next payout = quarter end + 45 days, ₹1,000 rollover, 90-day overdue rule).\nGemini writes the prose from those facts with a JSON schema; on any failure (overload, rate limit, 20 s timeout) it switches straight to a **fallback model**, keeping the whole run well inside Bubble's request timeout. Output is checked (name + exact pending total) before sending."),
  sticky("Note: out", [1936, -304], 640, 220, "## 3 · Deliver & report back\nEmail sent via the Gmail API (OAuth, no password stored) (redirected to a test inbox; intended recipient noted).\nEvery path answers the webhook with `{ status: Success | Failed, … }`, which Bubble writes into the Notification Log."),
);

for (const n of nodes) n.id = id(n.name);

const main = (...targets) => targets.map((t) => (t ? [{ node: t, type: "main", index: 0 }] : []));
const connections = {
  "Bubble webhook": { main: main("Validate payload") },
  "Validate payload": { main: main("Payload valid?") },
  "Payload valid?": { main: main("Deduplicate", "Respond: invalid payload") },
  Deduplicate: { main: main("Duplicate request?") },
  "Duplicate request?": { main: main("Respond: duplicate", "Compute royalty facts") },
  "Compute royalty facts": { main: main("Gemini: write email") },
  "Gemini: write email": { main: main("Parse & check AI output", "Gemini: fallback model") },
  "Gemini: fallback model": { main: main("Parse & check AI output", "Respond: AI unavailable") },
  "Parse & check AI output": { main: main("AI output OK?") },
  "AI output OK?": { main: main("Send email (Gmail)", "Respond: AI output rejected") },
  "Send email (Gmail)": { main: main("Respond: success", "Respond: email failed") },
};

const workflow = {
  name: "BookLeaf – AI Royalty Summary",
  nodes,
  connections,
  settings: { executionOrder: "v1", binaryMode: "separate" },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};

const out = path.join(__dirname, "bookleaf-royalty-summary.workflow.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${out} (${nodes.length} nodes)`);
