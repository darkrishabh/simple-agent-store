const PAGE_SIZE = 10;
const state = {
  results: [], selected: null, page: 1, formMode: "create", deleteKey: null,
  serverPaged: false, nextCursor: null, totalCount: 0, cursors: [null],
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  databaseName: $("#database-name"), statTotal: $("#stat-total"), statKinds: $("#stat-kinds"),
  statSources: $("#stat-sources"), statScheduled: $("#stat-scheduled"), objectSummary: $("#object-summary"),
  tableBody: $("#object-table-body"), emptyState: $("#empty-state"), emptyTitle: $("#empty-title"),
  emptyMessage: $("#empty-message"), loadingState: $("#loading-state"), pageSummary: $("#page-summary"),
  pageIndicator: $("#page-indicator"), previousPage: $("#previous-page"), nextPage: $("#next-page"),
  searchForm: $("#search-form"), query: $("#query"), kindFilter: $("#kind-filter"),
  sourceFilter: $("#source-filter"), sortFilter: $("#sort-filter"), refreshButton: $("#refresh-button"),
  newObjectButton: $("#new-object-button"), emptyCreateButton: $("#empty-create-button"),
  drawer: $("#detail-drawer"), drawerBackdrop: $("#drawer-backdrop"), closeDrawer: $("#close-drawer"),
  detailKey: $("#detail-key"), detailMetadata: $("#detail-metadata"), detailLabels: $("#detail-labels"),
  detailSearchableText: $("#detail-searchable-text"), detailJson: $("#detail-json"), copyJson: $("#copy-json"),
  editObjectButton: $("#edit-object-button"), detailDeleteButton: $("#detail-delete-button"),
  objectDialog: $("#object-dialog"), objectForm: $("#object-form"), formTitle: $("#form-title"),
  formEyebrow: $("#form-eyebrow"), saveObjectButton: $("#save-object-button"), formError: $("#form-error"),
  closeDialog: $("#close-dialog"), cancelDialog: $("#cancel-dialog"), deleteDialog: $("#delete-dialog"),
  deleteKey: $("#delete-key"), cancelDelete: $("#cancel-delete"), confirmDelete: $("#confirm-delete"), toast: $("#toast"),
};

bindEvents();
await refreshAll();

function bindEvents() {
  elements.searchForm.addEventListener("submit", (event) => { event.preventDefault(); resetPaging(); search(); });
  elements.query.addEventListener("input", debounce(() => { resetPaging(); search(); }, 250));
  for (const control of [elements.kindFilter, elements.sourceFilter, elements.sortFilter]) {
    control.addEventListener("change", () => { resetPaging(); search(); });
  }
  elements.refreshButton.addEventListener("click", refreshAll);
  elements.newObjectButton.addEventListener("click", openCreateForm);
  elements.emptyCreateButton.addEventListener("click", openCreateForm);
  elements.closeDialog.addEventListener("click", () => elements.objectDialog.close());
  elements.cancelDialog.addEventListener("click", () => elements.objectDialog.close());
  elements.objectForm.addEventListener("submit", saveObject);
  elements.closeDrawer.addEventListener("click", closeDrawer);
  elements.drawerBackdrop.addEventListener("click", closeDrawer);
  elements.editObjectButton.addEventListener("click", openEditForm);
  elements.detailDeleteButton.addEventListener("click", () => requestDelete(state.selected?.key));
  elements.copyJson.addEventListener("click", copyJson);
  elements.cancelDelete.addEventListener("click", () => elements.deleteDialog.close());
  elements.confirmDelete.addEventListener("click", deleteObject);
  elements.previousPage.addEventListener("click", async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    if (state.serverPaged) await search(); else renderTable();
  });
  elements.nextPage.addEventListener("click", async () => {
    if (state.serverPaged && state.nextCursor) {
      state.cursors[state.page] = state.nextCursor;
      state.page += 1;
      await search();
    } else if (!state.serverPaged && state.page < totalPages()) {
      state.page += 1;
      renderTable();
    }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && elements.drawer.classList.contains("open")) closeDrawer(); });
}

async function refreshAll() {
  resetPaging();
  elements.loadingState.classList.remove("hidden");
  elements.emptyState.classList.add("hidden");
  await Promise.all([loadStats(), search()]);
}

async function loadStats() {
  const stats = await api("/api/stats");
  elements.databaseName.textContent = stats.database;
  elements.statTotal.textContent = stats.total;
  elements.statKinds.textContent = Object.values(stats.byKind).filter((count) => count > 0).length;
  elements.statSources.textContent = stats.sourceCount;
  elements.statScheduled.textContent = stats.scheduled;
  const selectedSource = elements.sourceFilter.value;
  elements.sourceFilter.replaceChildren(option("", "All sources"), ...stats.sources.map((source) => option(source, titleCase(source))));
  elements.sourceFilter.value = selectedSource;
}

async function search() {
  try {
    const query = elements.query.value.trim();
    const browseMode = !query && ["created_desc", "relevance"].includes(elements.sortFilter.value);
    let response;
    if (browseMode) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (elements.kindFilter.value) params.append("kind", elements.kindFilter.value);
      if (elements.sourceFilter.value) params.append("source_client", elements.sourceFilter.value);
      const cursor = state.cursors[state.page - 1];
      if (cursor) params.set("cursor", cursor);
      response = await api(`/api/objects?${params}`);
      state.serverPaged = true;
      state.nextCursor = response.nextCursor;
      state.totalCount = response.totalCount;
    } else {
      response = await api("/api/search", {
        method: "POST",
        body: JSON.stringify({
          query: query || undefined,
          kind: elements.kindFilter.value ? [elements.kindFilter.value] : undefined,
          sourceClient: elements.sourceFilter.value ? [elements.sourceFilter.value] : undefined,
          sort: elements.sortFilter.value,
          limit: 50,
        }),
      });
      state.serverPaged = false;
      state.nextCursor = null;
      state.totalCount = response.count;
    }
    state.results = response.results;
    if (!state.serverPaged) {
      const pages = totalPages();
      if (state.page > pages) state.page = pages;
    }
    renderTable();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.loadingState.classList.add("hidden");
  }
}

function renderTable() {
  elements.tableBody.replaceChildren();
  const query = elements.query.value.trim();
  const filtered = Boolean(query || elements.kindFilter.value || elements.sourceFilter.value);
  elements.emptyState.classList.toggle("hidden", state.results.length > 0);
  elements.emptyTitle.textContent = filtered ? "No matching objects" : "No objects yet";
  elements.emptyMessage.textContent = filtered
    ? "Try a different search term or remove one of the active filters."
    : "Create your first object here or store one through the SimpleAgentStore MCP tools.";

  const start = state.serverPaged ? 0 : (state.page - 1) * PAGE_SIZE;
  const visibleResults = state.serverPaged ? state.results : state.results.slice(start, start + PAGE_SIZE);
  for (const object of visibleResults) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.addEventListener("click", () => inspectObject(object.key));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") inspectObject(object.key); });

    const objectCell = document.createElement("td");
    objectCell.className = "object-cell";
    objectCell.append(text("strong", object.key), text("span", object.description || object.match?.snippet || "No description"));
    row.append(objectCell);
    row.append(cell(badge(object.kind, `kind-badge kind-${object.kind}`)));
    row.append(cell(text("span", object.sourceClient ? titleCase(object.sourceClient) : "—", object.sourceClient ? "source-cell" : "muted-dash")));

    const labels = document.createElement("div");
    labels.className = "tag-list";
    if (object.labels.length) object.labels.slice(0, 3).forEach((label) => labels.append(badge(label, "tag")));
    else labels.append(text("span", "—", "muted-dash"));
    row.append(cell(labels));
    row.append(cell(text("span", relativeDate(object.updatedAt))));
    row.append(cell(text("span", `v${object.version}`, "version")));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(actionButton("View", "›", () => inspectObject(object.key)), actionButton("Edit", "✎", () => editFromKey(object.key)), actionButton("Delete", "×", () => requestDelete(object.key), true));
    row.append(cell(actions));
    elements.tableBody.append(row);
  }

  const first = state.results.length ? (state.serverPaged ? (state.page - 1) * PAGE_SIZE + 1 : start + 1) : 0;
  const last = state.serverPaged ? first + state.results.length - 1 : Math.min(start + PAGE_SIZE, state.results.length);
  elements.objectSummary.textContent = state.serverPaged
    ? `${state.totalCount} object${state.totalCount === 1 ? "" : "s"} in this view`
    : `${state.results.length} object${state.results.length === 1 ? "" : "s"} in this search`;
  elements.pageSummary.textContent = state.results.length
    ? `Showing ${first}–${last} of ${state.serverPaged ? state.totalCount : state.results.length}`
    : "0 objects";
  elements.pageIndicator.textContent = state.serverPaged
    ? `Page ${state.page} of ${Math.max(1, Math.ceil(state.totalCount / PAGE_SIZE))}`
    : `Page ${state.page} of ${totalPages()}`;
  elements.previousPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.serverPaged ? !state.nextCursor : state.page >= totalPages();
}

async function inspectObject(key) {
  try {
    const response = await api(`/api/objects/${encodeURIComponent(key)}`);
    state.selected = response.object;
    renderDetails();
    elements.drawer.classList.add("open");
    elements.drawer.setAttribute("aria-hidden", "false");
    elements.drawerBackdrop.classList.remove("hidden");
  } catch (error) { showToast(error.message, true); }
}

function renderDetails() {
  const object = state.selected;
  elements.detailKey.textContent = object.key;
  elements.detailMetadata.replaceChildren();
  const metadata = [
    ["Kind", titleCase(object.kind)], ["Version", `v${object.version}`], ["Source", object.sourceClient ? titleCase(object.sourceClient) : "—"],
    ["Completed", object.completed == null ? "Not applicable" : object.completed ? "Yes" : "No"], ["Created", formatDate(object.createdAt)],
    ["Updated", formatDate(object.updatedAt)], ["Due", object.dueAt ? formatDate(object.dueAt) : "—"],
    ["Starts", object.startAt ? formatDate(object.startAt) : "—"], ["Ends", object.endAt ? formatDate(object.endAt) : "—"],
    ["Expires", object.expiresAt ? formatDate(object.expiresAt) : "—"],
  ];
  for (const [term, description] of metadata) {
    const wrapper = document.createElement("div");
    wrapper.append(text("dt", term), text("dd", description));
    elements.detailMetadata.append(wrapper);
  }
  elements.detailLabels.replaceChildren(...(object.labels.length ? object.labels.map((label) => badge(label, "tag")) : [text("span", "No labels", "muted-dash")]));
  elements.detailSearchableText.textContent = object.searchableText;
  elements.detailJson.textContent = JSON.stringify(object.value, null, 2);
}

function closeDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawerBackdrop.classList.add("hidden");
}

function openCreateForm() {
  state.formMode = "create";
  elements.objectForm.reset();
  elements.objectForm.elements.key.disabled = false;
  elements.objectForm.elements.value.value = '{\n  "text": ""\n}';
  elements.formTitle.textContent = "New object";
  elements.formEyebrow.textContent = "CREATE";
  elements.saveObjectButton.textContent = "Create object";
  elements.formError.textContent = "";
  elements.objectDialog.showModal();
}

async function editFromKey(key) {
  if (!state.selected || state.selected.key !== key) await inspectObject(key);
  openEditForm();
}

function openEditForm() {
  if (!state.selected) return;
  state.formMode = "edit";
  const form = elements.objectForm.elements;
  form.key.disabled = false;
  form.key.value = state.selected.key;
  form.key.disabled = true;
  form.kind.value = state.selected.kind;
  form.sourceClient.value = state.selected.sourceClient || "";
  form.description.value = state.selected.description || "";
  form.labels.value = state.selected.labels.join(", ");
  form.searchableText.value = state.selected.searchableText;
  form.value.value = JSON.stringify(state.selected.value, null, 2);
  form.dueAt.value = toLocalInput(state.selected.dueAt);
  form.startAt.value = toLocalInput(state.selected.startAt);
  form.endAt.value = toLocalInput(state.selected.endAt);
  form.expiresAt.value = toLocalInput(state.selected.expiresAt);
  form.completed.value = state.selected.completed == null ? "" : String(state.selected.completed);
  elements.formTitle.textContent = "Edit object";
  elements.formEyebrow.textContent = "UPDATE";
  elements.saveObjectButton.textContent = "Save changes";
  elements.formError.textContent = "";
  elements.objectDialog.showModal();
}

async function saveObject(event) {
  event.preventDefault();
  elements.formError.textContent = "";
  const raw = new FormData(elements.objectForm);
  try {
    const completed = raw.get("completed");
    const body = {
      key: state.formMode === "edit" ? state.selected.key : raw.get("key"),
      kind: raw.get("kind"),
      sourceClient: valueOrUndefined(raw.get("sourceClient")),
      description: valueOrUndefined(raw.get("description")),
      labels: String(raw.get("labels") || "").split(",").map((item) => item.trim()).filter(Boolean),
      searchableText: raw.get("searchableText"),
      value: JSON.parse(String(raw.get("value"))),
      dueAt: dateOrUndefined(raw.get("dueAt")), startAt: dateOrUndefined(raw.get("startAt")),
      endAt: dateOrUndefined(raw.get("endAt")), expiresAt: dateOrUndefined(raw.get("expiresAt")),
      completed: completed === "" ? null : completed === "true",
    };
    const response = await api("/api/objects", { method: "POST", body: JSON.stringify(body) });
    elements.objectDialog.close();
    await refreshAll();
    await inspectObject(response.object.key);
    showToast(state.formMode === "edit" ? "Object updated" : "Object created");
  } catch (error) { elements.formError.textContent = error.message; }
}

function requestDelete(key) {
  if (!key) return;
  state.deleteKey = key;
  elements.deleteKey.textContent = key;
  elements.deleteDialog.showModal();
}

async function deleteObject() {
  try {
    await api(`/api/objects/${encodeURIComponent(state.deleteKey)}`, { method: "DELETE" });
    const deleted = state.deleteKey;
    state.deleteKey = null;
    elements.deleteDialog.close();
    if (state.selected?.key === deleted) { state.selected = null; closeDrawer(); }
    await refreshAll();
    showToast("Object deleted");
  } catch (error) { showToast(error.message, true); }
}

async function copyJson() {
  await navigator.clipboard.writeText(elements.detailJson.textContent);
  showToast("JSON copied");
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function totalPages() { return Math.max(1, Math.ceil(state.results.length / PAGE_SIZE)); }
function resetPaging() { state.page = 1; state.serverPaged = false; state.nextCursor = null; state.totalCount = 0; state.cursors = [null]; }
function valueOrUndefined(value) { const clean = String(value || "").trim(); return clean || undefined; }
function dateOrUndefined(value) { return value ? new Date(String(value)).toISOString() : undefined; }
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
function text(tag, content, className) { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; }
function badge(content, className) { return text("span", content, className); }
function cell(content) { const td = document.createElement("td"); td.append(content); return td; }
function actionButton(label, symbol, handler, danger = false) {
  const button = text("button", symbol, `row-action${danger ? " delete" : ""}`);
  button.type = "button"; button.title = label; button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => { event.stopPropagation(); handler(); });
  return button;
}
function titleCase(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : ""; }
function relativeDate(value) {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function debounce(callback, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); }; }
let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.style.borderColor = error ? "#efcaca" : "#cfe7d9";
  elements.toast.style.background = error ? "#fff1f0" : "#f1fbf5";
  elements.toast.style.color = error ? "#a42b2b" : "#17663f";
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2300);
}
