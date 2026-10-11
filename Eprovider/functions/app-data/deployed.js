var HttpError = class extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
};
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function publicError(error) {
  const e = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_ERROR", "Internal server error");
  return json({ error: { code: e.code, message: e.message } }, e.status);
}
function context(request) {
  const auth = request.headers.get("authorization") ?? "";
  const role = auth.startsWith("Bearer ") ? "authenticated" : "anon";
  return { request, role, userId: request.headers.get("x-pbms-user-id") ?? void 0, pbmsRole: request.headers.get("x-pbms-role") };
}
function requirePbmsRole(ctx, roles) {
  if (ctx.role !== "authenticated" && ctx.role !== "service_role") throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required");
  if (!ctx.pbmsRole || !roles.includes(ctx.pbmsRole)) throw new HttpError(403, "FORBIDDEN", "Insufficient permissions");
}
var edge = (handler) => async (request) => {
  try { return await handler(context(request)); } catch (error) { return publicError(error); }
};
var ok = (data, meta = {}) => json({ data, meta });
var noContent = () => new Response(null, { status: 204 });
var url = () => {
  const v = Deno.env.get("EPROVIDER_API_URL");
  if (!v) throw new HttpError(500, "CONFIGURATION_ERROR", "EPROVIDER_API_URL is not configured");
  return v.replace(/\/$/, "");
};
var project = () => Deno.env.get("EPROVIDER_PROJECT_ID") ?? "";
var skey = () => Deno.env.get("EPROVIDER_SERVICE_ROLE_KEY") ?? "";
async function mcp(name, arguments_) {
  if (!project() || !skey()) throw new HttpError(500, "CONFIGURATION_ERROR", "eProvider server secrets are not configured");
  const response = await fetch(`${url()}/projects/${project()}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${skey()}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: arguments_ } }) });
 if (!response.ok) throw new HttpError(502, "EPROVIDER_ERROR", "eProvider request failed");
  const payload = await response.json();
  if (payload.error) throw new HttpError(502, "EPROVIDER_ERROR", "eProvider tool failed");
  return JSON.parse(payload.result?.content?.[0]?.text ?? "{}");
}
var listRows = (table, filter = {}) => mcp("select_rows", { table, filter, limit: 1e3 });
// VERIFY: tool name below ("insert_row") - copy the real one from a function that inserts rows
var insertRow = (table, values) => mcp("insert_row", { table, values });

var PREFIXES = ["compensation:", "attendance:", "payroll:", "benefits:", "claims:", "hmo:", "reimbursement:"];
var allowed = (key) => typeof key === "string" && key.length <= 120 && PREFIXES.some((p) => key.startsWith(p));
async function save(key, fields) {
  const existing = rowsOf(await mcp("select_rows", { table: "app_data", filter: { key }, limit: 1 }));
const values = { ...fields, value: JSON.stringify(fields.value), updated_by: null, updated_at: new Date().toISOString() };
  if (existing[0]) await mcp("update_rows", { table: "app_data", pk: { key }, values });
  else await insertRow("app_data", { key, ...values });
}
var rowsOf = (r) => {
  if (r && r.error) throw new HttpError(502, "EPROVIDER_ERROR", String(r.error.message || r.error));
  return Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : Array.isArray(r?.data) ? r.data : [];
};
var app_data_default = edge(async (ctx) => {
  requirePbmsRole(ctx, ["admin", "hr_staff"]);
  const method = ctx.request.method;
  if (method === "GET") {
  const rows = rowsOf(await listRows("app_data"));
    return ok(rows.map((r) => {
  let v = r.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch {} }
  return { key: r.key, value: v, deleted: !!r.deleted };
}));
  }
  if (method === "POST") {
    const input = await ctx.request.json().catch(() => ({}));
    if (!allowed(input.key)) throw new HttpError(400, "INVALID_KEY", "Unsupported key");
    if (input.value === void 0) throw new HttpError(400, "VALIDATION_ERROR", "value is required");
    await save(input.key, { value: input.value, deleted: false });
    return ok({ saved: true, key: input.key });
  }
  if (method === "DELETE") {
    const key = new URL(ctx.request.url).searchParams.get("key");
    if (!allowed(key)) throw new HttpError(400, "INVALID_KEY", "Unsupported key");
    await save(key, { value: {}, deleted: true });
    return noContent();
  }
  return new Response("Method Not Allowed", { status: 405 });
});
export { app_data_default as default };