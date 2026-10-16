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
  const text2 = payload.result?.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text2);
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
var created = (data) => json({ data }, 201);

// Eprovider/lib/database.ts
var listRows = (table, filter = {}) => mcp("select_rows", { table, filter, limit: 1e3 });
var insertRow = (table, values) => mcp("insert_row", { table, values });
var updateRows = (table, pk, values) => mcp("update_rows", { table, pk, values });

// Eprovider/lib/audit.ts
async function audit(action, actorId, entity, entityId, metadata = {}) {
  await insertRow("audit_logs", { action, actor_id: actorId ?? null, entity, entity_id: entityId ?? null, metadata, created_at: (/* @__PURE__ */ new Date()).toISOString() });
}

// Eprovider/functions/government-loans/index.ts
var LOAN_TYPES = ["SSS", "Pag-IBIG"];
var MAX_NOTICE_LENGTH = 42e5;
var text = (v) => typeof v === "string" ? v.trim() : "";
var cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
var money = (v, field) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, "INVALID_LOAN_AMOUNT", `${field} must be greater than zero.`);
  return cents(n);
};
var dateValue = (v, field) => {
  const s = text(v);
  const d = /* @__PURE__ */ new Date(`${s}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, "INVALID_LOAN_DATE", `${field} must be a valid ISO date.`);
  return s;
};
var first = async (table, filter) => (await listRows(table, filter))[0];
var parseJson = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
var asArray = (v) => Array.isArray(v) ? v : [];
var employeeName = (e) => [e.first_name, e.middle_name, e.last_name].map(text).filter(Boolean).join(" ");
var day = (v) => v ? String(v).slice(0, 10) : "";
function format(loan, employee) {
  return {
    id: String(loan.id),
    employeeId: String(loan.employee_id),
    employeeNumber: text(employee?.employee_number),
    employeeName: employee ? employeeName(employee) : "Employee unavailable",
    department: text(employee?.department),
    loanType: loan.loan_type,
    referenceNo: loan.reference_no,
    totalAmount: Number(loan.total_amount),
    monthlyAmortization: Number(loan.monthly_amortization),
    startDate: day(loan.start_date),
    outstandingBalance: Number(loan.outstanding_balance),
    status: loan.status,
    noticeName: text(loan.notice_name),
    remarks: text(loan.remarks),
    rejectionRemarks: text(loan.rejection_remarks) || null,
    verifiedBy: text(loan.verified_by) || null,
    verifiedAt: text(loan.verified_at) || null,
    rejectedAt: text(loan.rejected_at) || null,
    closedAt: text(loan.closed_at) || null,
    createdBy: text(loan.created_by) || null,
    createdAt: String(loan.created_at),
    updatedAt: String(loan.updated_at)
  };
}
var formatTransaction = (t) => ({ id: String(t.id), loanId: String(t.loan_id), payrollRunId: text(t.payroll_run_id), periodStart: day(t.period_start), periodEnd: day(t.period_end), amount: Number(t.amount), balanceAfter: Number(t.balance_after), postedBy: text(t.posted_by) || null, createdAt: String(t.created_at) });
async function withEmployee(loan) {
  return format(loan, await first("employees", { id: String(loan.employee_id) }));
}
async function loanFields(input, current) {
  const employeeId = required(input.employee_id, "employee_id");
  const employee = await first("employees", { id: employeeId });
  if (!employee || employee.deleted_at) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "The selected employee was not found in Employee Records.");
  const loanType = text(input.loan_type);
  if (!LOAN_TYPES.includes(loanType)) throw new HttpError(400, "INVALID_LOAN_TYPE", "Loan type must be SSS or Pag-IBIG.");
  const referenceNo = required(input.reference_no, "reference_no");
  if (referenceNo.length > 100) throw new HttpError(400, "INVALID_REFERENCE", "Agency reference no. must not exceed 100 characters.");
  const duplicate = (await listRows("government_loans")).find((row) => row.status !== "Rejected" && String(row.id) !== String(current?.id ?? "") && text(row.reference_no).toLowerCase() === referenceNo.toLowerCase());
  if (duplicate) throw new HttpError(409, "DUPLICATE_REFERENCE", "A loan with this agency reference no. already exists.");
  const totalAmount = money(input.total_amount, "total_amount");
  const monthlyAmortization = money(input.monthly_amortization, "monthly_amortization");
  if (monthlyAmortization > totalAmount) throw new HttpError(400, "INVALID_AMORTIZATION", "Monthly amortization cannot exceed the total amount.");
  const startDate = dateValue(input.start_date, "start_date");
  const remarks = text(input.remarks).slice(0, 1e3);
  return { employee, values: { employee_id: employeeId, loan_type: loanType, reference_no: referenceNo, total_amount: totalAmount, monthly_amortization: monthlyAmortization, start_date: startDate, outstanding_balance: totalAmount, remarks } };
}
function noticeFields(input, requiredNotice) {
  const name = text(input.notice_name), data = typeof input.notice_data === "string" ? input.notice_data : "";
  if (!name && !data) {
    if (requiredNotice) throw new HttpError(400, "NOTICE_REQUIRED", "Attach the agency notice.");
    return null;
  }
  if (!name || !/^data:(application\/pdf|image\/(png|jpe?g));base64,/.test(data)) throw new HttpError(400, "INVALID_NOTICE", "The notice must be a PDF, PNG or JPG file.");
  if (data.length > MAX_NOTICE_LENGTH) throw new HttpError(400, "NOTICE_TOO_LARGE", "The notice must be 3 MB or smaller.");
  return { name: name.slice(0, 255), data };
}
async function saveNotice(loanId, notice) {
  const values = { file_name: notice.name, data: notice.data, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (await first("government_loan_notices", { loan_id: loanId })) await updateRows("government_loan_notices", { loan_id: loanId }, values);
  else await insertRow("government_loan_notices", { loan_id: loanId, ...values });
}
async function schedule(periodStart, periodEnd) {
  const [loans, employees, transactions] = await Promise.all([listRows("government_loans", { status: "Active" }), listRows("employees"), listRows("government_loan_transactions")]);
  const employeeById = new Map(employees.map((e) => [String(e.id), e]));
  const deductedThisCutoff = new Set(transactions.filter((t) => day(t.period_start) === periodStart && day(t.period_end) === periodEnd).map((t) => String(t.loan_id)));
  return loans.filter((loan) => day(loan.start_date) <= periodEnd && Number(loan.outstanding_balance) > 0 && !deductedThisCutoff.has(String(loan.id))).map((loan) => {
    const employee = employeeById.get(String(loan.employee_id));
    return {
      loanId: String(loan.id),
      employeeId: String(loan.employee_id),
      employeeNumber: text(employee?.employee_number),
      employeeName: employee ? employeeName(employee) : "Employee unavailable",
      loanType: loan.loan_type,
      referenceNo: loan.reference_no,
      monthlyAmortization: Number(loan.monthly_amortization),
      outstandingBalance: Number(loan.outstanding_balance)
    };
  });
}
async function settle(payrollRunId, actorId) {
  const appData = await first("app_data", { key: "payroll:runs" });
  if (!appData || appData.deleted === true) throw new HttpError(409, "PAYROLL_RUN_NOT_FOUND", "The released payroll run is not synchronized to the database.");
  const run = asArray(parseJson(appData.value)).map((x) => x).find((item) => String(item.id) === payrollRunId);
  if (!run) throw new HttpError(404, "PAYROLL_RUN_NOT_FOUND", "The payroll run was not found in synchronized payroll data.");
  if (run.status !== "Approved" || !text(run.paidAt)) throw new HttpError(409, "PAYROLL_NOT_RELEASED", "Only a released payroll run may reduce government loan balances.");
  const periodStart = dateValue(run.from, "payroll.from"), periodEnd = dateValue(run.to, "payroll.to");
  const lines = asArray(run.rows).flatMap((row) => asArray(row.governmentLoans)).map((x) => x).map((line) => ({ loanId: required(line.loanId, "governmentLoans.loanId"), amount: money(line.amount, "governmentLoans.amount") }));
  if (new Set(lines.map((line) => line.loanId)).size !== lines.length) throw new HttpError(400, "DUPLICATE_LOAN_DEDUCTION", "A payroll run contains the same government loan twice.");
  let count = 0, totalAmount = 0;
  for (const line of lines) {
    if (await first("government_loan_transactions", { payroll_run_id: payrollRunId, loan_id: line.loanId })) continue;
    const loan = await first("government_loans", { id: line.loanId });
    if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND", "A government loan in this payroll run was not found.");
    if (loan.status === "Closed") continue;
    if (loan.status !== "Active") throw new HttpError(409, "LOAN_NOT_ACTIVE", "Only active government loans may be deducted.");
    const amount = cents(Math.min(line.amount, Number(loan.outstanding_balance)));
    if (amount <= 0) continue;
    const balance = cents(Number(loan.outstanding_balance) - amount), now = (/* @__PURE__ */ new Date()).toISOString();
    await insertRow("government_loan_transactions", { loan_id: line.loanId, payroll_run_id: payrollRunId, period_start: periodStart, period_end: periodEnd, amount, balance_after: balance, posted_by: actorId ?? null, created_at: now });
    await updateRows("government_loans", { id: line.loanId }, { outstanding_balance: balance, ...balance === 0 ? { status: "Closed", closed_at: now } : {}, updated_at: now });
    await audit("government_loan.deduction", actorId, "government_loans", line.loanId, { payrollRunId, periodStart, periodEnd, amount, balanceAfter: balance, closed: balance === 0 });
    count++;
    totalAmount = cents(totalAmount + amount);
  }
  return { posted: true, count, totalAmount, idempotent: count === 0 && lines.length > 0 };
}
var government_loans_default = verifiedEdge(async (ctx) => {
  requirePbmsRole(ctx, ["admin", "hr_staff"]);
  const url2 = new URL(ctx.request.url);
  const parts = url2.pathname.split("/").filter(Boolean);
  const tail = parts.at(-1) ?? "government-loans";
  if (ctx.request.method === "GET") {
    if (tail === "schedule") {
      const periodStart = dateValue(url2.searchParams.get("period_start"), "period_start"), periodEnd = dateValue(url2.searchParams.get("period_end"), "period_end");
      if (periodEnd < periodStart) throw new HttpError(400, "INVALID_PAYROLL_PERIOD", "period_end must be on or after period_start.");
      return ok(await schedule(periodStart, periodEnd));
    }
    if (tail === "notice") {
      const notice = await first("government_loan_notices", { loan_id: required(parts.at(-2), "id") });
      if (!notice) throw new HttpError(404, "NOTICE_NOT_FOUND", "No notice is attached to this loan.");
      return ok({ name: notice.file_name, data: notice.data });
    }
    if (tail !== "government-loans") return new Response("Not Found", { status: 404 });
    const [loans, employees, transactions] = await Promise.all([listRows("government_loans"), listRows("employees"), listRows("government_loan_transactions")]);
    const employeeById = new Map(employees.map((e) => [String(e.id), e]));
    return ok({ loans: loans.map((loan) => format(loan, employeeById.get(String(loan.employee_id)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), transactions: transactions.map(formatTransaction).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (ctx.request.method === "POST") {
    const input = await body(ctx.request);
    if (tail === "settle") return ok(await settle(required(input.payroll_run_id, "payroll_run_id"), ctx.userId));
    if (tail !== "government-loans") return new Response("Not Found", { status: 404 });
    const notice = noticeFields(input, true);
    const { values } = await loanFields(input);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await insertRow("government_loans", { ...values, status: "Pending", notice_name: notice.name, created_by: ctx.userId ?? null, created_at: now, updated_at: now });
    await saveNotice(String(row.id), notice);
    await audit("government_loan.created", ctx.userId, "government_loans", String(row.id), { loanType: values.loan_type, referenceNo: values.reference_no, totalAmount: values.total_amount });
    return created(await withEmployee(row));
  }
  if (ctx.request.method === "PATCH") {
    const id = parts.at(-1);
    if (!id || id === "government-loans") throw new HttpError(400, "LOAN_ID_REQUIRED", "Loan record ID is required.");
    const input = await body(ctx.request);
    const action = text(input.action);
    const previous = await first("government_loans", { id });
    if (!previous) throw new HttpError(404, "LOAN_NOT_FOUND", "Government loan record was not found.");
    if (previous.status !== "Pending") throw new HttpError(409, "LOAN_NOT_PENDING", "Only pending government loans can be edited, verified or rejected.");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (action === "update") {
      const { values } = await loanFields(input, previous);
      const notice = noticeFields(input, false);
      await updateRows("government_loans", { id }, { ...values, ...notice ? { notice_name: notice.name } : {}, updated_at: now });
      if (notice) await saveNotice(id, notice);
      await audit("government_loan.updated", ctx.userId, "government_loans", id, { previous: { loanType: previous.loan_type, referenceNo: previous.reference_no, totalAmount: Number(previous.total_amount), monthlyAmortization: Number(previous.monthly_amortization), startDate: day(previous.start_date) }, next: { loanType: values.loan_type, referenceNo: values.reference_no, totalAmount: values.total_amount, monthlyAmortization: values.monthly_amortization, startDate: values.start_date }, noticeReplaced: Boolean(notice) });
    } else if (action === "verify") {
      await updateRows("government_loans", { id }, { status: "Active", verified_by: ctx.userId ?? null, verified_at: now, updated_at: now });
      await audit("government_loan.verified", ctx.userId, "government_loans", id, { referenceNo: previous.reference_no });
    } else if (action === "reject") {
      const remarks = required(input.remarks, "remarks");
      if (remarks.length > 1e3) throw new HttpError(400, "INVALID_REMARKS", "Remarks must not exceed 1,000 characters.");
      await updateRows("government_loans", { id }, { status: "Rejected", rejection_remarks: remarks, rejected_by: ctx.userId ?? null, rejected_at: now, updated_at: now });
      await audit("government_loan.rejected", ctx.userId, "government_loans", id, { referenceNo: previous.reference_no, remarks });
    } else throw new HttpError(400, "LOAN_ACTION_NOT_SUPPORTED", "Action must be update, verify or reject.");
    return ok(await withEmployee(await first("government_loans", { id }) ?? { ...previous, id }));
  }
  return new Response("Method Not Allowed", { status: 405 });
});
export {
  government_loans_default as default
};
