---
name: simpleagentstore-routing
description: Route explicit save, remember, todo, note, and later-retrieval requests through an already-connected SimpleAgentStore MCP server. Use when the user asks to store information for later, retrieve saved objects, show all notes or todos, find a saved entity or contact field, or delete a saved object.
---

# SimpleAgentStore Routing

Use SimpleAgentStore as a user-owned object store, not as implicit conversational memory. Natural-language interpretation stays here in the agent; send deterministic fields to the store.

## Save

When the user explicitly asks to save, store, remember, preserve, keep, add a note, or add a todo, call `store_object`. Never say the item was saved unless the tool succeeds.

- Choose a concise stable `key`. Reuse it when the request clearly updates the same object.
- Choose `kind` by behavior: `note`, `todo`, `reminder`, `calendar`, `reference`, or `other`. Contacts normally use `reference`.
- Put the original payload and important details in `value` without inventing fields.
- Preserve useful original wording in `searchable_text`; do not reduce it to labels alone.
- Add a small set of lowercase entity, category, project, and intent labels.
- Set `source_client` to the current client when known.
- Convert explicit dates to absolute ISO-8601 timestamps. Do not fabricate a date from vague language when it materially changes behavior.

## Retrieve

- For an exact known key, call `get_object`.
- For requests asking only how many objects match, use `total_count` from `list_objects`.
- For requests such as "all my notes", "all todos", kinds, completion state, or due dates, call `list_objects` with structured filters. If `next_cursor` is not null, copy its exact value into the next call's `cursor`. Never repeat the same call without a cursor because that repeats page one. Continue until `next_cursor` is null, then summarize or present every returned item.
- For topics, people, projects, contacts, or remembered wording, call `search_objects`, inspect the lightweight candidates, then call `get_object` for the selected keys.
- When the user names an entity plus a field shape, include both in the query. Prefer `Mike phone` over only `phone`.
- If a topical search is empty or clearly thin, retry with a shorter entity/category query or close synonyms inferred from the user's language. Remove overly restrictive filters one at a time. Do not invent matches or move interpretation into the store.
- Do not present search snippets as the complete saved value; retrieve the object first.

## Delete

Resolve an ambiguous description with `search_objects`, identify the exact key, and call `delete_object` only when deletion is the user's intent. Report the tool's actual result.

If SimpleAgentStore tools are unavailable, say that the SimpleAgentStore MCP connection must be enabled. Do not claim persistence through workspace memory or another storage system.
