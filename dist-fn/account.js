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

// Eprovider/lib/jwt.ts
var encoder2 = new TextEncoder();

// Eprovider/lib/sessions.ts
var sessionActive = (session, userId, now = Date.now()) => Boolean(session && session.user_id === userId && !session.revoked_at && Date.parse(session.expires_at) > now);

// Eprovider/lib/auth.ts
var enc = new TextEncoder();

// Eprovider/lib/function.ts
var ALLOWED_ORIGINS = ["https://payrollbenefits.eprovider.site", "http://localhost:5173"];
var ALLOW_HEADERS = "authorization, content-type, apikey, x-client-info";
var ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
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
var normalizePbmsRole = (value) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");
async function verifiedContext(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in to access employee records.");
  const claims = await verifyPbmsSession(match[1], Deno.env.get("PBMS_JWT_SECRET") ?? "", Deno.env.get("EPROVIDER_PROJECT_ID") ?? "");
  const users = await mcp("select_rows", { table: "users", filter: { id: claims.sub }, limit: 1 });
  const user = users[0];
  if (!user || user.employee_id !== claims.employee_id || user.status?.toLowerCase() !== "active") throw new HttpError(401, "INVALID_SESSION", "Your account or session is inactive. Please sign in again.");
  const role = normalizePbmsRole(user.role ?? "");
  if (role !== "admin" && role !== "hr_staff") throw new HttpError(403, "FORBIDDEN", "Insufficient permissions");
  if (claims.sid) {
    const session = (await mcp("select_rows", { table: "user_sessions", filter: { id: claims.sid }, limit: 1 }))[0];
    if (!sessionActive(session, user.id)) throw new HttpError(401, "SESSION_ENDED", "This device was signed out. Please sign in again.");
    if (Date.now() - Date.parse(session.last_active_at) > 5 * 6e4) await mcp("update_rows", { table: "user_sessions", pk: { id: session.id }, values: { last_active_at: (/* @__PURE__ */ new Date()).toISOString() } }).catch(() => void 0);
  }
  return { request, role: "authenticated", userId: user.id, pbmsRole: role, sessionId: claims.sid };
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

// Eprovider/lib/database.ts
var listRows = (table, filter = {}) => mcp("select_rows", { table, filter, limit: 1e3 });
var insertRow = (table, values) => mcp("insert_row", { table, values });
var updateRows = (table, pk, values) => mcp("update_rows", { table, pk, values });

// Eprovider/lib/audit.ts
async function audit(action, actorId, entity, entityId, metadata = {}) {
  await insertRow("audit_logs", { action, actor_id: actorId ?? null, entity, entity_id: entityId ?? null, metadata, created_at: (/* @__PURE__ */ new Date()).toISOString() });
}

// Eprovider/lib/otp.ts
var otpEnabled = () => !["false", "0", "off", "disabled"].includes((Deno.env.get("PBMS_OTP_ENABLED") ?? "true").trim().toLowerCase());

// Eprovider/lib/password.ts
var ITERATIONS = 21e4;
var encoder3 = new TextEncoder();
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function derive(password, salt, iterations = ITERATIONS) {
  const key2 = await crypto.subtle.importKey("raw", encoder3.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key2, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt);
  return `pbkdf2_sha256$${ITERATIONS}$${base64Url(salt)}$${base64Url(digest)}`;
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
function passwordProblems(password) {
  const problems = [];
  if (password.length < 8 || password.length > 128) problems.push("Password must be 8 to 128 characters.");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) problems.push("Password must include upper-case and lower-case letters.");
  if (!/\d/.test(password)) problems.push("Password must include a number.");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("Password must include a symbol.");
  return problems;
}

// Eprovider/functions/account/index.ts
var PASSKEY_MAX_ATTEMPTS = 5;
var PASSKEY_LOCK_MINUTES = 15;
async function currentUser(ctx) {
  const user = (await listRows("users", { id: ctx.userId }))[0];
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "Your account was not found.");
  return user;
}
async function activeSessions(userId) {
  try {
    return (await listRows("user_sessions", { user_id: userId })).filter((session) => sessionActive(session, userId)).sort((a, b) => String(b.last_active_at).localeCompare(String(a.last_active_at)));
  } catch {
    return [];
  }
}
async function confirmPassword(user, password) {
  if (typeof password !== "string" || !password || !user.password_hash || !await verifyPassword(password, user.password_hash)) throw new HttpError(400, "INVALID_PASSWORD", "Current password is incorrect.");
}
var revoke = (id) => updateRows("user_sessions", { id }, { revoked_at: (/* @__PURE__ */ new Date()).toISOString() });
var lockedUntil = (user, now = Date.now()) => user.passkey_locked_until && Date.parse(user.passkey_locked_until) > now ? user.passkey_locked_until : null;
async function newPasskey(user, value) {
  const passkey = typeof value === "string" ? value : "";
  if (passkey.length < 6 || passkey.length > 64) throw new HttpError(400, "WEAK_PASSKEY", "Passkey must be 6 to 64 characters.");
  if (user.password_hash && await verifyPassword(passkey, user.password_hash)) throw new HttpError(400, "PASSKEY_MATCHES_PASSWORD", "Passkey must be different from your login password.");
  return hashPassword(passkey);
}
var savePasskey = (user, hash) => updateRows("users", { id: user.id }, { passkey_hash: hash, passkey_failed_attempts: 0, passkey_locked_until: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
async function checkPasskey(user, value, purpose, detail) {
  if (!user.passkey_hash) return { verified: false, reason: "not_set" };
  const locked = lockedUntil(user);
  if (locked) return { verified: false, reason: "locked", locked_until: locked };
  const previous = user.passkey_locked_until ? 0 : Number(user.passkey_failed_attempts ?? 0);
  if (typeof value === "string" && value && await verifyPassword(value, user.passkey_hash)) {
    if (previous || user.passkey_locked_until) await updateRows("users", { id: user.id }, { passkey_failed_attempts: 0, passkey_locked_until: null });
    return { verified: true };
  }
  const attempts = previous + 1;
  const lock = attempts >= PASSKEY_MAX_ATTEMPTS ? new Date(Date.now() + PASSKEY_LOCK_MINUTES * 6e4).toISOString() : null;
  await updateRows("users", { id: user.id }, { passkey_failed_attempts: lock ? 0 : attempts, passkey_locked_until: lock });
  await audit("account.passkey.failed", user.id, "users", user.id, { purpose, detail, attempts, locked: Boolean(lock) });
  return lock ? { verified: false, reason: "locked", locked_until: lock } : { verified: false, reason: "invalid", attempts_left: PASSKEY_MAX_ATTEMPTS - attempts };
}
async function overview(ctx) {
  const user = await currentUser(ctx);
  const sessions = await activeSessions(user.id);
  return { otp_enabled: user.otp_enabled !== false, otp_available: otpEnabled(), passkey_set: Boolean(user.passkey_hash), passkey_locked_until: lockedUntil(user), current_session_id: ctx.sessionId ?? null, sessions: sessions.map((session) => ({ id: session.id, device: session.device, browser: session.browser, created_at: session.created_at, last_active_at: session.last_active_at, current: session.id === ctx.sessionId })) };
}
var account_default = verifiedEdge(async (ctx) => {
  if (ctx.request.method === "GET") return ok(await overview(ctx));
  if (ctx.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const input = await body(ctx.request);
  const action = required(input.action, "action");
  const user = await currentUser(ctx);
  if (action === "sign_out") {
    if (ctx.sessionId) await revoke(ctx.sessionId).catch(() => void 0);
    await audit("account.session.signed_out", user.id, "user_sessions", ctx.sessionId);
    return ok({ signed_out: true });
  }
  if (action === "verify_passkey") {
    const purpose = input.purpose === "release" ? "release" : input.purpose === "export" ? "export" : null;
    if (!purpose) throw new HttpError(400, "INVALID_PURPOSE", "Purpose must be export or release.");
    const detail = String(input.detail ?? "").slice(0, 200);
    const result = await checkPasskey(user, input.passkey, purpose, detail);
    if (result.verified) await audit(purpose === "export" ? "account.passkey.export" : "account.passkey.release", user.id, "users", user.id, { detail });
    return ok(result);
  }
  if (action === "change_passkey") {
    const check = await checkPasskey(user, input.current_passkey, "change", "Change passkey");
    if (!check.verified) {
      if (check.reason === "not_set") throw new HttpError(409, "PASSKEY_NOT_SET", "Set a passkey first.");
      if (check.reason === "locked") throw new HttpError(423, "PASSKEY_LOCKED", `Passkey is locked until ${check.locked_until}.`);
      throw new HttpError(400, "INVALID_PASSKEY", `Current passkey is incorrect. ${check.attempts_left} attempt${check.attempts_left === 1 ? "" : "s"} left.`);
    }
    if (typeof input.new_passkey === "string" && await verifyPassword(input.new_passkey, String(user.passkey_hash))) throw new HttpError(400, "PASSKEY_UNCHANGED", "The new passkey must be different from the current passkey.");
    await savePasskey(user, await newPasskey(user, input.new_passkey));
    await audit("account.passkey.changed", user.id, "users", user.id);
    return ok(await overview(ctx));
  }
  await confirmPassword(user, input.current_password);
  if (action === "set_passkey" || action === "reset_passkey") {
    if (action === "set_passkey" && user.passkey_hash) throw new HttpError(409, "PASSKEY_ALREADY_SET", "A passkey is already set. Use Change Passkey.");
    await savePasskey(user, await newPasskey(user, input.new_passkey));
    await audit(action === "set_passkey" ? "account.passkey.set" : "account.passkey.reset", user.id, "users", user.id);
    return ok(await overview(ctx));
  }
  if (action === "change_password") {
    const next = typeof input.new_password === "string" ? input.new_password : "";
    if (!next) throw new HttpError(400, "VALIDATION_ERROR", "new_password is required");
    const problems = passwordProblems(next);
    if (problems.length) throw new HttpError(400, "WEAK_PASSWORD", problems.join(" "));
    if (await verifyPassword(next, String(user.password_hash))) throw new HttpError(400, "PASSWORD_UNCHANGED", "The new password must be different from the current password.");
    await updateRows("users", { id: user.id }, { password_hash: await hashPassword(next), updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    const others = (await activeSessions(user.id)).filter((session) => session.id !== ctx.sessionId);
    for (const session of others) await revoke(session.id);
    await audit("account.password.changed", user.id, "users", user.id, { other_sessions_signed_out: others.length });
    return ok(await overview(ctx));
  }
  if (action === "set_otp") {
    if (typeof input.enabled !== "boolean") throw new HttpError(400, "INVALID_OTP_SETTING", "Enabled must be true or false.");
    await updateRows("users", { id: user.id }, { otp_enabled: input.enabled, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    await audit(input.enabled ? "account.otp.enabled" : "account.otp.disabled", user.id, "users", user.id, { previous: user.otp_enabled !== false, next: input.enabled });
    return ok(await overview(ctx));
  }
  if (action === "revoke_session") {
    const id = required(input.session_id, "session_id");
    if (id === ctx.sessionId) throw new HttpError(400, "CURRENT_SESSION", "Use Sign out to end the session on this device.");
    const session = (await activeSessions(user.id)).find((item) => item.id === id);
    if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "That session is no longer active.");
    await revoke(session.id);
    await audit("account.session.revoked", user.id, "user_sessions", session.id, { device: session.device, browser: session.browser });
    return ok(await overview(ctx));
  }
  if (action === "revoke_other_sessions") {
    const others = (await activeSessions(user.id)).filter((session) => session.id !== ctx.sessionId);
    for (const session of others) await revoke(session.id);
    await audit("account.session.revoked_others", user.id, "user_sessions", ctx.sessionId, { count: others.length });
    return ok(await overview(ctx));
  }
  throw new HttpError(400, "UNKNOWN_ACTION", "Unsupported account action.");
});
export {
  account_default as default
};
