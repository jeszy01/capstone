// Eprovider/lib/errors.ts
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function publicError(error) {
  console.error("ERR", error instanceof Error ? error.message : error);
  const e = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_ERROR", "Internal server error");
  return json({ error: { code: e.code, message: e.message } }, e.status === 502 ? 500 : e.status);
}
function json(body2, status = 200, headers = {}) {
  return new Response(JSON.stringify(body2), { status, headers: { "content-type": "application/json", ...headers } });
}

// Eprovider/lib/eprovider.ts
var url = () => {
  const v = Deno.env.get("EPROVIDER_API_URL");
  if (!v) throw new HttpError(500, "CONFIGURATION_ERROR", "EPROVIDER_API_URL is not configured");
  return v.replace(/\/$/, "");
};
var project = () => Deno.env.get("EPROVIDER_PROJECT_ID") ?? "";
var key = () => Deno.env.get("EPROVIDER_SERVICE_ROLE_KEY") ?? "";
async function mcp(name, arguments_) {
  if (!project() || !key()) throw new HttpError(500, "CONFIGURATION_ERROR", "eProvider server secrets are not configured");
  const response = await fetch(`${url()}/projects/${project()}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${key()}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: arguments_ } }) });
  if (!response.ok) throw new HttpError(500, "EPROVIDER_ERROR", "eProvider " + response.status + " " + (await response.clone().text()).slice(0, 150));
  const payload = await response.json();
  if (payload.error) throw new HttpError(502, "EPROVIDER_ERROR", payload.error.message ?? "eProvider tool failed");
  const text = payload.result?.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed.row !== void 0) return parsed.row;
  return parsed;
}

// Eprovider/lib/session-verification.ts
var encoder = new TextEncoder();
var invalid = () => new HttpError(401, "INVALID_SESSION", "Your session is invalid or expired. Please sign in again.");
function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw invalid();
  try {
    return Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  } catch {
    throw invalid();
  }
}
async function verifyPbmsSession(token, secret, projectId, now = Math.floor(Date.now() / 1e3)) {
  if (!secret || !projectId) throw new HttpError(500, "CONFIGURATION_ERROR", "Session verification is not configured");
  if (!token || token.length > 8192) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid();
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  } catch {
    throw invalid();
  }
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") throw invalid();
  const signature = decode(parts[2]);
  if (signature.length !== 32) throw invalid();
  const key2 = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key2, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid || !claims || typeof claims.sub !== "string" || !claims.sub || typeof claims.employee_id !== "string" || !claims.employee_id || typeof claims.role !== "string" || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= now || claims.iat > now + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > 8 * 60 * 60) throw invalid();
  if (claims.project_id !== void 0 && claims.project_id !== projectId) throw invalid();
  return claims;
}

// Eprovider/lib/auth.ts
function requireAuth(ctx) {
  if (ctx.role !== "authenticated" && ctx.role !== "service_role") throw new HttpError(401, "UNAUTHENTICATED", "Authentication is required");
}
function requirePbmsRole(ctx, roles) {
  requireAuth(ctx);
  if (!ctx.pbmsRole || !roles.includes(ctx.pbmsRole)) throw new HttpError(403, "FORBIDDEN", "Insufficient permissions");
}

// Eprovider/lib/function.ts
var ALLOWED_ORIGINS = ["https://payrollbenefits.eprovider.site", "http://localhost:5173"];
var ALLOW_HEADERS = "authorization, content-type, apikey, x-client-info";
var ALLOW_METHODS = "POST, GET, OPTIONS";
function corsHeaders(request) {
  const requestOrigin = request.headers.get("origin");
  const origin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": ALLOW_HEADERS, "Access-Control-Allow-Methods": ALLOW_METHODS, "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}
function corsResponse(request, response) {
  const headers = new Headers(response.headers);
  for (const [key2, value] of Object.entries(corsHeaders(request))) headers.set(key2, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function corsPreflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// Eprovider/lib/verified-function.ts
async function verifiedContext(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to access employee records.");
  const claims = await verifyPbmsSession(match[1], Deno.env.get("PBMS_JWT_SECRET") ?? "", Deno.env.get("EPROVIDER_PROJECT_ID") ?? "");
  const users = await mcp("select_rows", { table: "users", filter: { id: claims.sub }, limit: 1 });
  const user = users[0];
  if (!user || user.employee_id !== claims.employee_id || user.status?.toLowerCase() !== "active") throw new HttpError(401, "INVALID_SESSION", "Your account or session is inactive. Please sign in again.");
  const role = user.role?.toLowerCase();
  if (role !== "admin" && role !== "hr_staff") throw new HttpError(403, "FORBIDDEN", "Insufficient permissions");
  return { request, role: "authenticated", userId: user.id, pbmsRole: role };
}
function verifiedEdge(handler) {
  return async (request) => {
    if (request.method === "OPTIONS") return corsPreflight(request);
    try {
      return corsResponse(request, await handler(await verifiedContext(request)));
    } catch (error) {
      return corsResponse(request, publicError(error));
    }
  };
}

// Eprovider/lib/validation.ts
function body(request) {
  return request.json().catch(() => {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  });
}
function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "VALIDATION_ERROR", `${name} is required`);
  return value.trim();
}

// Eprovider/lib/response.ts
var ok = (data, meta = {}) => json({ data, meta });
var created = (data) => json({ data }, 201);
var noContent = () => new Response(null, { status: 204 });

// Eprovider/lib/database.ts
var listRows = (table, filter = {}) => mcp("select_rows", { table, filter, limit: 1e3 });
var insertRow = (table, values) => mcp("insert_row", { table, values });
var updateRows = (table, pk, values) => mcp("update_rows", { table, pk, values });
var deleteRows = (table, pk) => mcp("delete_rows", { table, pk });

// Eprovider/lib/audit.ts
async function audit(action, actorId, entity, entityId, metadata = {}) {
  await insertRow("audit_logs", { action, actor_id: actorId ?? null, entity, entity_id: entityId ?? null, metadata, created_at: (/* @__PURE__ */ new Date()).toISOString() });
}

// Eprovider/functions/employees/index.ts
var employees_default = verifiedEdge(async (ctx) => {
  requirePbmsRole(ctx, ["admin", "hr_staff"]);
  const method = ctx.request.method;
  if (method === "GET") return ok(await listRows("employees"));
  if (method === "POST") {
    const input = await body(ctx.request);
    const employee_number = required(input.employee_number, "employee_number");
    const row = await insertRow("employees", { ...input, employee_number, created_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    await audit("employee.created", ctx.userId, "employees", row.id);
    return created(row);
  }
  const id = required(ctx.request.url.split("/").pop(), "id");
  if (method === "PATCH" || method === "PUT") {
    const input = await body(ctx.request);
    await updateRows("employees", { id }, { ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    await audit("employee.updated", ctx.userId, "employees", id);
    return ok({ id });
  }
  if (method === "DELETE") {
    await deleteRows("employees", { id });
    await audit("employee.deleted", ctx.userId, "employees", id);
    return noContent();
  }
  return new Response("Method Not Allowed", { status: 405 });
});
export {
  employees_default as default
};
