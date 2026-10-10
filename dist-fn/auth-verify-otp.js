// Eprovider/lib/errors.ts
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function publicError(error) {
  const e = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_ERROR", "Internal server error");
  return json({ error: { code: e.code, message: e.message } }, e.status);
}
function json(body2, status = 200, headers = {}) {
  return new Response(JSON.stringify(body2), { status, headers: { "content-type": "application/json", ...headers } });
}

// Eprovider/lib/auth.ts
function context(request) {
  const auth = request.headers.get("authorization") ?? "";
  const apiKey = request.headers.get("apikey");
  const role = auth.startsWith("Bearer ") ? apiKey ? "authenticated" : "authenticated" : apiKey ? "anon" : "anon";
  const userId = request.headers.get("x-pbms-user-id") ?? void 0;
  const pbmsRole = request.headers.get("x-pbms-role");
  return { request, role, userId, pbmsRole };
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
function edge(handler) {
  return async (request) => {
    if (request.method === "OPTIONS") return corsPreflight(request);
    try {
      return corsResponse(request, await handler(context(request)));
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
  if (!response.ok) throw new HttpError(502, "EPROVIDER_ERROR", "eProvider request failed");
  const payload = await response.json();
  if (payload.error) throw new HttpError(502, "EPROVIDER_ERROR", payload.error.message ?? "eProvider tool failed");
  const text = payload.result?.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed.row !== void 0) return parsed.row;
  return parsed;
}

// Eprovider/lib/otp.ts
async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
var hashOtp = (otp) => digest(otp);

// Eprovider/lib/jwt.ts
var encoder = new TextEncoder();
function base64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function createSessionToken(userId, employeeId, role) {
  const secret = Deno.env.get("PBMS_JWT_SECRET");
  if (!secret) throw new HttpError(500, "CONFIGURATION_ERROR", "PBMS_JWT_SECRET is not configured");
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: userId, employee_id: employeeId, role, iat: Math.floor(Date.now() / 1e3), exp: Math.floor(Date.now() / 1e3) + 8 * 60 * 60 }));
  const key2 = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key2, encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(signature)}`;
}

// Eprovider/functions/auth-verify-otp/index.ts
var auth_verify_otp_default = edge(async (ctx) => {
  const input = await body(ctx.request);
  const employee_id = required(input.employee_id, "employee_id");
  const code = required(input.code, "code");
  const challenge_id = required(input.challenge_id, "challenge_id");
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "INVALID_OTP", "Invalid verification code");
  const rows = await mcp("select_rows", { table: "otp_challenges", filter: { id: challenge_id, employee_id }, limit: 1 });
  const challenge = rows[0];
  if (!challenge || challenge.consumed_at || Date.parse(String(challenge.expires_at)) < Date.now() || challenge.otp_hash !== await hashOtp(code)) throw new HttpError(401, "INVALID_OTP", "Invalid or expired verification code");
  const users = await mcp("select_rows", { table: "users", filter: { employee_id }, limit: 1 });
  const user = users[0];
  if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials");
  await mcp("update_rows", { table: "otp_challenges", pk: { id: challenge_id }, values: { consumed_at: (/* @__PURE__ */ new Date()).toISOString() } });
  const role = String(user.role ?? "employee");
  const sessionUser = { id: String(user.id), employeeId: employee_id, name: String(user.name ?? user.email ?? employee_id), role: role.toLowerCase() === "admin" ? "Admin" : "HR Staff" };
  const token = await createSessionToken(String(user.id), employee_id, role);
  return ok({ token, user: sessionUser });
});
export {
  auth_verify_otp_default as default
};
