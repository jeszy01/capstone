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
var apiUrl = () => (Deno.env.get("EPROVIDER_OTP_API_URL") ?? "https://api.eprovider.site/api").replace(/\/$/, "");
async function sendOtpEmail(email, otp, expiryMinutes = 10) {
  const key2 = Deno.env.get("EPROVIDER_OTP_KEY");
  if (!key2) throw new HttpError(500, "CONFIGURATION_ERROR", "EPROVIDER_OTP_KEY is not configured");
  const response = await fetch(`${apiUrl()}/send-otp`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key2 }, body: JSON.stringify({ email, otp, expiryMinutes }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status === 401 ? 502 : response.status === 429 ? 429 : 502, response.status === 401 ? "OTP_PROVIDER_UNAUTHORIZED" : response.status === 429 ? "OTP_RATE_LIMITED" : "OTP_PROVIDER_ERROR", "Unable to send verification code");
  return data;
}
function generateOtp() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1e6).padStart(6, "0");
}
async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
var hashOtp = (otp) => digest(otp);

// Eprovider/lib/password.ts
var ITERATIONS = 21e4;
var encoder = new TextEncoder();
function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function derive(password, salt, iterations = ITERATIONS) {
  const key2 = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key2, 256));
}
async function verifyPassword(password, stored) {
  const [algorithm, iterationsText, saltText, digestText] = stored.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 1e5 || !saltText || !digestText) return false;
  const expected = fromBase64Url(digestText);
  const actual = await derive(password, fromBase64Url(saltText), iterations);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

// Eprovider/functions/auth-login/index.ts
var auth_login_default = edge(async (ctx) => {
  const input = await body(ctx.request);
  const employee_id = required(input.employee_id, "employee_id");
  const password = required(input.password, "password");
  const users = await mcp("select_rows", { table: "users", filter: { employee_id }, limit: 1 });
  const user = users[0];
  const email = typeof user?.email === "string" ? user.email : "";
  const passwordHash = typeof user?.password_hash === "string" ? user.password_hash : "";
  if (!user || !email || !passwordHash || !await verifyPassword(password, passwordHash)) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials");
  const otp = generateOtp();
  const challenge = await mcp("insert_row", { table: "otp_challenges", values: { employee_id, email, otp_hash: await hashOtp(otp), expires_at: new Date(Date.now() + 10 * 6e4).toISOString() } });
  const emailResult = await sendOtpEmail(email, otp, 10);
  return ok({ otp_required: true, challenge_id: challenge.id, emailId: emailResult.emailId ?? null, message: "Verification code sent" });
});
export {
  auth_login_default as default
};
