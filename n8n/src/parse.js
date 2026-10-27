// n8n Code node: "Parse & check AI output"
// Validates the model's JSON and runs cheap guardrails before anything is
// emailed: the author's name and the exact pending total must appear.
const ctx = $("Compute royalty facts").first().json;
const res = $input.first().json;

let email = null;
let problem = "";
try {
  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const finish = res.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") throw new Error(`model stopped early (${finish})`);
  email = JSON.parse(text);
  if (!email.subject || !email.body) throw new Error("missing subject or body");
  if (!email.body.includes(ctx.facts.author_first_name)) throw new Error("email does not greet the author by name");
  if (!email.body.includes(ctx.expected_pending_text)) throw new Error(`email does not state the pending total ${ctx.expected_pending_text}`);
  // Platform check: any store the email names must be one the author's books are actually sold on.
  const allowed = ctx.allowed_platforms ?? [];
  const mailText = `${email.subject}\n${email.body}`;
  for (const p of ["Flipkart", "Amazon US", "Amazon UK", "Amazon India", "BookLeaf Store"]) {
    if (mailText.includes(p) && !allowed.includes(p)) throw new Error(`email names platform "${p}", which this author's books are not sold on`);
  }
  if (/\bAmazon\b/.test(mailText) && !allowed.some((p) => p.startsWith("Amazon"))) throw new Error('email names "Amazon", which this author\'s books are not sold on');
} catch (e) {
  problem = `AI output rejected: ${e.message}`;
}

const footer = `\n\n—\nDemo note: this message was addressed to ${ctx.intended_recipient} and redirected to a test inbox.`;

return [
  {
    json: {
      ok: !problem,
      error_message: problem,
      request_id: ctx.request_id,
      author_code: ctx.author.code,
      subject: email?.subject ?? "",
      body: email?.body ?? "",
      email_text: email ? email.body + footer : "",
      recipient_email: ctx.recipient_email,
      intended_recipient: ctx.intended_recipient,
      model: res.modelVersion ?? ctx.model,
    },
  },
];
