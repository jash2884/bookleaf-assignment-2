// n8n Code node: "Validate payload"
// Bubble sends the author's full royalty data in the webhook body (the free
// plan blocks incoming API calls, so n8n can't fetch it from Bubble's Data API).
const body = $input.first().json.body ?? {};
const errors = [];

if (!body.request_id) errors.push("request_id is required");
if (!body.author || !body.author.name) errors.push("author.name is required");
if (!body.author || !body.author.code) errors.push("author.code is required");

let books = body.books;
// Bubble builds the list as a JSON string; accept either form.
if (typeof books === "string") {
  try {
    books = JSON.parse(books.trim().startsWith("[") ? books : `[${books}]`);
  } catch (e) {
    errors.push(`books is not valid JSON: ${e.message}`);
  }
}
if (!Array.isArray(books)) errors.push("books must be a list");

const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
// Platforms arrive as a list or a comma-separated string; normalise to a list.
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);

return [
  {
    json: {
      valid: errors.length === 0,
      error_message: errors.join("; "),
      request_id: body.request_id ?? null,
      triggered_by: body.triggered_by ?? null,
      author: body.author ?? {},
      books: (Array.isArray(books) ? books : []).map((b) => ({
        code: b.code,
        title: b.title,
        stage: b.stage,
        publication_date: b.publication_date || null,
        mrp: num(b.mrp),
        copies_sold: num(b.copies_sold),
        royalty_earned: num(b.royalty_earned),
        royalty_paid: num(b.royalty_paid),
        royalty_pending: num(b.royalty_pending),
        last_payout_date: b.last_payout_date || null,
        available_on: list(b.available_on),
      })),
    },
  },
];
