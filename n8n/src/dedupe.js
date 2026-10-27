// n8n Code node: "Deduplicate"
// Second line of defence against double clicks (Bubble also blocks a second
// trigger while one is Processing). Remembers the last request per author in
// workflow static data; a different request for the same author within the
// window is rejected. Static data persists between production executions.
const WINDOW_SECONDS = 120;
const item = $input.first().json;
const store = $getWorkflowStaticData("global");
store.recent = store.recent ?? {};

const now = Date.now();
// Forget old entries so the store doesn't grow forever.
for (const [key, entry] of Object.entries(store.recent)) {
  if (now - entry.at > WINDOW_SECONDS * 1000) delete store.recent[key];
}

const key = item.author.code;
const previous = store.recent[key];
const duplicate = Boolean(previous && previous.request_id !== item.request_id);

if (!duplicate) store.recent[key] = { request_id: item.request_id, at: now };

return [
  {
    json: {
      ...item,
      duplicate,
      error_message: duplicate
        ? `Duplicate request ignored: a summary for ${item.author.name} was started ${Math.round((now - previous.at) / 1000)}s ago (request ${previous.request_id}).`
        : "",
    },
  },
];
