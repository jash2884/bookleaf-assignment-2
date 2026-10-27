// n8n Code node: "Compute royalty facts & build prompt"
// All arithmetic and dates are computed here, deterministically, and handed to
// the model as facts. The model writes prose; it never does calendar maths.
const SYSTEM_PROMPT = __SYSTEM_PROMPT__;
const MODEL = "gemini-3.5-flash";
const PAYOUT_THRESHOLD = 1000;
const PAYOUT_WINDOW_DAYS = 45;
const OVERDUE_DAYS = 90; // brief A2: overdue if last payout > 90 days ago (or never paid, published > 90 days ago)
// Dataset emails are real-looking addresses on a public provider, so every email
// is redirected to a safe inbox. The intended recipient is kept in the log/email.
const SAFE_RECIPIENT = "jash2884@gmail.com";

const item = $input.first().json;
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const DAY = 86400000;
const daysSince = (d) => Math.floor((today - new Date(d + "T00:00:00Z")) / DAY);
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Next payout: the previous quarter's deadline (quarter end + 45 days) if it hasn't passed, else this quarter's.
const quarterEnd = (d) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3 + 3, 0));
const thisQEnd = quarterEnd(today);
const prevQEnd = new Date(Date.UTC(thisQEnd.getUTCFullYear(), thisQEnd.getUTCMonth() - 2, 0));
const deadline = (q) => new Date(q.getTime() + PAYOUT_WINDOW_DAYS * DAY);
const settles = today <= deadline(prevQEnd) ? prevQEnd : thisQEnd;
const quarterName = (q) => `Q${Math.floor(q.getUTCMonth() / 3) + 1} ${q.getUTCFullYear()}`;

const STAGES = ["Manuscript Received", "Editing", "Cover Design", "Typesetting", "Proofreading", "ISBN Assignment", "Printing", "Distribution Setup", "Published & Live"];

const books = item.books.map((b) => {
  const published = b.stage === "Published & Live";
  if (!published) {
    const i = STAGES.indexOf(b.stage);
    return { title: b.title, status: "In production", current_stage: b.stage, next_stages: i >= 0 ? STAGES.slice(i + 1).join(" → ") : "" };
  }
  let royalty_status = "Paid up";
  if (b.royalty_pending > 0) {
    const ref = b.last_payout_date ?? b.publication_date;
    royalty_status = ref && daysSince(ref) > OVERDUE_DAYS ? "Overdue" : "Pending";
  }
  return {
    title: b.title,
    status: "Published & Live",
    published_on: b.publication_date ? fmt(b.publication_date) : null,
    copies_sold: b.copies_sold,
    royalty_earned: inr(b.royalty_earned),
    royalty_paid: inr(b.royalty_paid),
    royalty_pending: inr(b.royalty_pending),
    last_payout: b.last_payout_date ? fmt(b.last_payout_date) : "never paid yet",
    available_on: b.available_on ?? [],
    royalty_status,
  };
});

const sum = (k) => item.books.reduce((s, b) => s + (b[k] || 0), 0);
const pending = sum("royalty_pending");
// Policy beats the 90-day heuristic: an account total under ₹1,000 isn't overdue, it rolls over.
if (pending > 0 && pending < PAYOUT_THRESHOLD) {
  for (const b of books) if (b.royalty_status === "Overdue" || b.royalty_status === "Pending") b.royalty_status = "Below ₹1,000 threshold — rolls over";
}
const facts = {
  author_first_name: String(item.author.name).split(" ")[0],
  author_name: item.author.name,
  today: fmt(today),
  books,
  totals: { earned: inr(sum("royalty_earned")), paid: inr(sum("royalty_paid")), pending: inr(pending) },
  fully_paid_up: pending === 0,
  below_threshold: pending > 0 && pending < PAYOUT_THRESHOLD,
  any_overdue: books.some((b) => b.royalty_status === "Overdue"),
  next_payout_by: fmt(deadline(settles)),
  next_payout_covers: quarterName(settles),
  payout_threshold: inr(PAYOUT_THRESHOLD),
};
// Every platform any of the author's published books is sold on (for the platform guardrail).
const platforms = [...new Set(books.flatMap((b) => b.available_on ?? []))];

const user = `<royalty_facts>\n${JSON.stringify(facts, null, 2)}\n</royalty_facts>\n\nWrite the royalty summary email for ${facts.author_name}.`;

const gemini_request = {
  systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
  contents: [{ role: "user", parts: [{ text: user }] }],
  generationConfig: {
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Plain-text email body" },
      },
      required: ["subject", "body"],
    },
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingLevel: "LOW" },
  },
};

return [
  {
    json: {
      ...item,
      facts,
      model: MODEL,
      gemini_request,
      recipient_email: SAFE_RECIPIENT,
      intended_recipient: item.author.email,
      expected_pending_text: inr(pending),
      allowed_platforms: platforms,
    },
  },
];
