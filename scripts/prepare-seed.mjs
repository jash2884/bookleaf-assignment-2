// Precomputes every record (and derived field) loaded into Bubble, so the
// import can be verified field-by-field afterwards.
import { readFileSync, writeFileSync } from "node:fs";

const TODAY = new Date(process.argv[2] ?? new Date().toISOString().slice(0, 10));
const DAY = 86_400_000;
const daysAgo = (d) => Math.floor((TODAY - new Date(d)) / DAY);
const stageOf = (s) => (s.startsWith("Published") ? "Published & Live" : s.replace("In Production - ", ""));

// Royalty status rule from the brief (A2): Green paid up, Yellow pending within cycle,
// Red if pending and (last payout > 90 days ago, or never paid and published > 90 days ago).
function bookStatus(b) {
  if (!b.status.startsWith("Published")) return "In production";
  if (b.royalty_pending <= 0) return "Paid up";
  if (b.last_royalty_payout_date) return daysAgo(b.last_royalty_payout_date) > 90 ? "Overdue" : "Pending";
  return b.publication_date && daysAgo(b.publication_date) > 90 ? "Overdue" : "Pending";
}

const { authors } = JSON.parse(readFileSync("data/bookleaf_sample_data.json", "utf8"));
const out = authors.map((a) => {
  const books = a.books.map((b) => ({ ...b, stage: stageOf(b.status), royalty_status: bookStatus(b) }));
  const sum = (k) => books.reduce((s, b) => s + (b[k] ?? 0), 0);
  const statuses = books.map((b) => b.royalty_status);
  const payout_status = statuses.includes("Overdue") ? "Overdue" : statuses.includes("Pending") ? "Pending" : "Paid up";
  // Author-level "last payout" used by the status filter: the oldest last-payout among books
  // that still have a pending balance (empty if such a book was never paid).
  const pendingBooks = books.filter((b) => b.royalty_pending > 0);
  const lastPayout = pendingBooks.length
    ? pendingBooks.some((b) => !b.last_royalty_payout_date) ? null : pendingBooks.map((b) => b.last_royalty_payout_date).sort()[0]
    : books.map((b) => b.last_royalty_payout_date).filter(Boolean).sort().at(-1) ?? null;
  return {
    ...a,
    books,
    total_books: books.length,
    total_earned: sum("total_royalty_earned"),
    total_paid: sum("royalty_paid"),
    total_pending: sum("royalty_pending"),
    payout_status,
    last_payout_date: lastPayout,
  };
});
writeFileSync("data/seed-computed.json", JSON.stringify(out, null, 2));
for (const a of out) {
  console.log(`${a.author_id} ${a.name.padEnd(16)} ${a.city.padEnd(10)} books=${a.total_books} earned=${a.total_earned} paid=${a.total_paid} pending=${a.total_pending} ${a.payout_status} last=${a.last_payout_date}`);
  for (const b of a.books) console.log(`   ${b.book_id} ${b.title.padEnd(26)} ${b.stage.padEnd(16)} pending=${b.royalty_pending} last=${b.last_royalty_payout_date} -> ${b.royalty_status}`);
}
