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

// Eprovider/lib/database.ts
var listRows = (table, filter = {}) => mcp("select_rows", { table, filter, limit: 1e3 });
var insertRow = (table, values) => mcp("insert_row", { table, values });
var updateRows = (table, pk, values) => mcp("update_rows", { table, pk, values });

// Eprovider/lib/audit.ts
async function audit(action, actorId, entity, entityId, metadata = {}) {
  await insertRow("audit_logs", { action, actor_id: actorId ?? null, entity, entity_id: entityId ?? null, metadata, created_at: (/* @__PURE__ */ new Date()).toISOString() });
}

// Eprovider/functions/compensation/index.ts
var MONTHLY_WORK_DAYS = 22;
var roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
var amount = (value, name, allowZero = false) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : Number.EPSILON)) throw new HttpError(400, "INVALID_AMOUNT", `${name} must be a ${allowZero ? "non-negative" : "positive"} number.`);
  return roundMoney(parsed);
};
var isoDate = (value, name = "effective_date") => {
  const date = required(value, name);
  const parsed = /* @__PURE__ */ new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new HttpError(400, "INVALID_DATE", `${name} must be a valid YYYY-MM-DD date.`);
  return date;
};
var uuid = (value, name) => {
  const id = required(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, "INVALID_ID", `${name} must be a UUID.`);
  return id;
};
var isUuidValue = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
var normalizeLegacyGradeCode = (value) => value.trim().toUpperCase() === "SG-01" ? "SG-001" : value.trim();
var gradeCodeKey = (value) => normalizeLegacyGradeCode(value).toLowerCase();
var actorName = async (userId) => {
  const rows = await listRows("users", { id: userId });
  const user = rows[0];
  return String(user?.name ?? user?.email ?? user?.employee_id ?? "Authorized user");
};
var latestOnOrBefore = (rows, employeeId, date) => rows.filter((row) => row.employee_id === employeeId && String(row.effective_date) <= date).sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)))[0];
async function recordHistory(values) {
  return insertRow("compensation_history", values);
}
async function syncCurrentEmployeeCompensation(assignments) {
  const asOf = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const employees = await listRows("employees");
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const latest = /* @__PURE__ */ new Map();
  for (const row of assignments) {
    if (String(row.effective_date) > asOf) continue;
    const prior = latest.get(row.employee_id);
    if (!prior || String(prior.effective_date) < String(row.effective_date)) latest.set(row.employee_id, row);
  }
  for (const [employeeId, assignment] of latest) {
    const employee = employeeById.get(employeeId);
    if (!employee) continue;
    const salary = Number(assignment.basic_salary), rate = Number(assignment.daily_rate);
    if (Number(employee.basic_salary) !== salary || Number(employee.position_rate) !== rate || String(employee.salary_grade_id ?? "") !== String(assignment.salary_grade_id ?? "")) {
      await updateRows("employees", { id: employeeId }, { basic_salary: salary, position_rate: rate, salary_grade_id: assignment.salary_grade_id ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    }
  }
}
async function loadBundle() {
  const [salaryGrades, assignments, proposals, history, rewards, imports] = await Promise.all([
    listRows("salary_grades"),
    listRows("employee_compensation"),
    listRows("compensation_proposals"),
    listRows("compensation_history"),
    listRows("compensation_rewards"),
    listRows("compensation_legacy_imports", { id: "browser-compensation-v1" })
  ]);
  await syncCurrentEmployeeCompensation(assignments);
  return { salary_grades: salaryGrades, assignments, proposals, history, rewards, legacy_import_complete: imports.length > 0, legacy_import_counts: imports[0]?.counts ?? null };
}
async function createGrade(input, ctx) {
  const position = required(input.position, "position").trim();
  const basicSalary = amount(input.basic_salary, "basic_salary");
  const status = String(input.status ?? "Active");
  if (status !== "Active" && status !== "Inactive") throw new HttpError(400, "INVALID_GRADE_STATUS", "Salary grade status must be Active or Inactive.");
  const generatorReady = await listRows("compensation_legacy_imports", { id: "salary-grade-code-generation-v1" });
  if (!generatorReady[0]) throw new HttpError(503, "SALARY_GRADE_GENERATOR_NOT_READY", "Apply the salary-grade code-generation migration before creating grades.");
  const imported = await listRows("compensation_legacy_imports", { id: "browser-compensation-v1" });
  if (!imported[0]) throw new HttpError(409, "LEGACY_COMPENSATION_IMPORT_REQUIRED", "Refresh Compensation Planning to import existing salary grades before creating a new grade.");
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const row = await insertRow("salary_grades", { grade: "", position, monthly_salary: basicSalary, daily_rate: roundMoney(basicSalary / MONTHLY_WORK_DAYS), status, created_at: createdAt, updated_at: createdAt });
  const code = String(row.grade ?? "");
  if (!/^SG-\d{3,}$/i.test(code)) throw new HttpError(500, "SALARY_GRADE_CODE_GENERATION_FAILED", "The database did not return an automatically generated salary-grade code.");
  await audit("compensation.grade.created", ctx.userId, "salary_grades", String(row.id ?? code));
  return row;
}
async function deactivateGrade(input, ctx) {
  const id = uuid(input.id, "id");
  const grades = await listRows("salary_grades", { id });
  if (!grades[0]) throw new HttpError(404, "SALARY_GRADE_NOT_FOUND", "Salary grade was not found.");
  await updateRows("salary_grades", { id }, { status: "Inactive", updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  await audit("compensation.grade.deactivated", ctx.userId, "salary_grades", id);
  return { id, status: "Inactive" };
}
async function createInitialAssignment(input, ctx) {
  const employeeId = uuid(input.employee_id, "employee_id");
  const salary = amount(input.basic_salary, "basic_salary");
  const effectiveDate = isoDate(input.effective_date);
  const employee = (await listRows("employees", { id: employeeId }))[0];
  if (!employee) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "Employee was not found.");
  const assignments = await listRows("employee_compensation", { employee_id: employeeId });
  if (assignments.length) throw new HttpError(409, "COMPENSATION_ALREADY_ASSIGNED", "This employee already has compensation history. Submit a compensation proposal for salary changes.");
  let salaryGradeId = null;
  const salaryCode = String(input.salary_code ?? "").trim();
  if (salaryCode) {
    const grades = await listRows("salary_grades");
    const grade = grades.find((row) => String(row.grade ?? "").toLowerCase() === salaryCode.toLowerCase() && row.status !== "Inactive");
    if (!grade) throw new HttpError(400, "INVALID_SALARY_GRADE", "Select an active salary grade or leave the grade blank.");
    salaryGradeId = String(grade.id);
  }
  const dailyRate = roundMoney(salary / MONTHLY_WORK_DAYS);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const assignment = await insertRow("employee_compensation", {
    employee_id: employeeId,
    salary_grade_id: salaryGradeId,
    salary_code: salaryCode,
    position: String(employee.position ?? ""),
    basic_salary: salary,
    daily_rate: dailyRate,
    effective_date: effectiveDate,
    source: "Initial Assignment",
    created_by: ctx.userId,
    created_at: createdAt
  });
  const asOf = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const actor = await actorName(ctx.userId ?? "");
  await recordHistory({ employee_id: employeeId, source: "Employee Compensation", event_type: "Initial Assignment", previous_salary: Number(employee.basic_salary ?? 0), new_salary: salary, adjustment_amount: salary - Number(employee.basic_salary ?? 0), reason: "Initial compensation assignment", effective_date: effectiveDate, status: effectiveDate <= asOf ? "Applied" : "Scheduled", recorded_at: createdAt, applied_at: effectiveDate <= asOf ? effectiveDate : null, actor_id: ctx.userId, actor_name: actor, assignment_id: assignment?.id ?? null });
  if (effectiveDate <= asOf) await updateRows("employees", { id: employeeId }, { basic_salary: salary, position_rate: dailyRate, salary_grade_id: salaryGradeId, updated_at: createdAt });
  await audit("compensation.assignment.created", ctx.userId, "employees", employeeId, { effective_date: effectiveDate });
  return assignment;
}
async function createProposal(input, ctx) {
  const employeeId = uuid(input.employee_id, "employee_id");
  const type = required(input.proposal_type, "proposal_type");
  if (!["Salary Adjustment", "Merit Increase", "Promotion Increase"].includes(type)) throw new HttpError(400, "INVALID_PROPOSAL_TYPE", "Unsupported compensation proposal type.");
  const effectiveDate = isoDate(input.effective_date);
  const rows = await listRows("employee_compensation", { employee_id: employeeId });
  const current = latestOnOrBefore(rows, employeeId, (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  if (!current) throw new HttpError(409, "COMPENSATION_NOT_ASSIGNED", "Assign an initial salary before proposing a change.");
  const newSalary = amount(input.new_salary, "new_salary");
  if (newSalary === Number(current.basic_salary)) throw new HttpError(400, "UNCHANGED_SALARY", "The proposed salary must differ from the current salary.");
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const proposal = await insertRow("compensation_proposals", {
    employee_id: employeeId,
    proposal_type: type,
    previous_salary: Number(current.basic_salary),
    new_salary: newSalary,
    effective_date: effectiveDate,
    notes: String(input.notes ?? "").trim(),
    status: "Pending HR Review",
    created_by: ctx.userId,
    created_at: createdAt
  });
  await audit("compensation.proposal.submitted", ctx.userId, "compensation_proposals", String(proposal?.id ?? ""));
  return proposal;
}
async function reviewProposal(input, ctx) {
  const id = uuid(input.id, "id");
  const decision = required(input.decision, "decision");
  if (decision !== "approve" && decision !== "reject") throw new HttpError(400, "INVALID_DECISION", "Decision must be approve or reject.");
  const proposal = (await listRows("compensation_proposals", { id }))[0];
  if (!proposal) throw new HttpError(404, "PROPOSAL_NOT_FOUND", "Compensation proposal was not found.");
  if (proposal.status !== "Pending HR Review") throw new HttpError(409, "PROPOSAL_ALREADY_REVIEWED", "Only pending proposals can be reviewed.");
  const reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
  const asOf = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const actor = await actorName(ctx.userId ?? "");
  if (decision === "reject") {
    const reason = required(input.rejection_reason, "rejection_reason").trim();
    const next2 = { status: "Rejected", rejection_reason: reason, reviewed_by: ctx.userId, reviewed_at: reviewedAt };
    await updateRows("compensation_proposals", { id }, next2);
    await recordHistory({ employee_id: proposal.employee_id, source: "Compensation Proposal", event_type: "Rejected", previous_salary: Number(proposal.previous_salary), new_salary: Number(proposal.new_salary), adjustment_amount: Number(proposal.new_salary) - Number(proposal.previous_salary), reason, effective_date: proposal.effective_date, status: "Rejected", recorded_at: reviewedAt, actor_id: ctx.userId, actor_name: actor, proposal_id: id });
    await audit("compensation.proposal.rejected", ctx.userId, "compensation_proposals", id);
    return { id, ...next2 };
  }
  const allAssignments = await listRows("employee_compensation", { employee_id: proposal.employee_id });
  const existing = (await listRows("employee_compensation", { proposal_id: id }))[0];
  let assignment = existing;
  if (!assignment) {
    const prior = latestOnOrBefore(allAssignments, proposal.employee_id, String(proposal.effective_date));
    if (!prior) throw new HttpError(409, "COMPENSATION_NOT_ASSIGNED", "No salary assignment exists before the proposal effective date.");
    const newSalary = Number(proposal.new_salary);
    assignment = await insertRow("employee_compensation", {
      employee_id: proposal.employee_id,
      salary_grade_id: prior.salary_grade_id ?? null,
      salary_code: String(prior.salary_code ?? ""),
      position: String(prior.position ?? ""),
      basic_salary: newSalary,
      daily_rate: roundMoney(newSalary / MONTHLY_WORK_DAYS),
      effective_date: proposal.effective_date,
      source: "Approved Proposal",
      proposal_id: id,
      created_by: ctx.userId,
      created_at: reviewedAt
    });
  }
  const next = { status: "Approved", rejection_reason: null, reviewed_by: ctx.userId, reviewed_at: reviewedAt };
  await updateRows("compensation_proposals", { id }, next);
  await recordHistory({ employee_id: proposal.employee_id, source: "Compensation Proposal", event_type: "Approved", previous_salary: Number(proposal.previous_salary), new_salary: Number(proposal.new_salary), adjustment_amount: Number(proposal.new_salary) - Number(proposal.previous_salary), reason: String(proposal.notes ?? ""), effective_date: proposal.effective_date, status: String(proposal.effective_date) <= asOf ? "Applied" : "Scheduled", recorded_at: reviewedAt, applied_at: String(proposal.effective_date) <= asOf ? proposal.effective_date : null, actor_id: ctx.userId, actor_name: actor, proposal_id: id, assignment_id: assignment.id });
  if (String(proposal.effective_date) <= asOf) {
    await updateRows("employees", { id: proposal.employee_id }, { basic_salary: Number(proposal.new_salary), position_rate: roundMoney(Number(proposal.new_salary) / MONTHLY_WORK_DAYS), salary_grade_id: assignment.salary_grade_id ?? null, updated_at: reviewedAt });
  }
  await audit("compensation.proposal.approved", ctx.userId, "compensation_proposals", id, { effective_date: proposal.effective_date });
  return { id, ...next, assignment };
}
async function createReward(input, ctx) {
  const employeeId = uuid(input.employee_id, "employee_id");
  const type = required(input.reward_type, "reward_type");
  if (type !== "Bonus" && type !== "Incentive") throw new HttpError(400, "INVALID_REWARD_TYPE", "Reward type must be Bonus or Incentive.");
  if (!(await listRows("employees", { id: employeeId }))[0]) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "Employee was not found.");
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const row = await insertRow("compensation_rewards", { employee_id: employeeId, reward_type: type, amount: amount(input.amount, "amount"), effective_date: isoDate(input.effective_date), notes: String(input.notes ?? "").trim(), status: "Planned", created_by: ctx.userId, created_at: createdAt });
  await audit("compensation.reward.created", ctx.userId, "compensation_rewards", String(row?.id ?? ""));
  return row;
}
async function reviewReward(input, ctx) {
  const id = uuid(input.id, "id");
  const rows = await listRows("compensation_rewards", { id });
  const reward = rows[0];
  if (!reward) throw new HttpError(404, "REWARD_NOT_FOUND", "Bonus or incentive was not found.");
  if (reward.status !== "Planned") throw new HttpError(409, "REWARD_ALREADY_REVIEWED", "Only planned rewards can be approved.");
  const next = { status: "Approved", approved_by: ctx.userId, approved_at: (/* @__PURE__ */ new Date()).toISOString() };
  await updateRows("compensation_rewards", { id }, next);
  await audit("compensation.reward.approved", ctx.userId, "compensation_rewards", id);
  return { id, ...next };
}
var legacyRows = (data, key2) => Array.isArray(data[key2]) ? data[key2].filter((value) => Boolean(value) && typeof value === "object") : [];
var legacyMoney = (value, name, allowZero = false) => amount(value, name, allowZero);
var legacyDate = (value) => isoDate(value);
var legacyTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
async function importLegacy(input, ctx) {
  const importId = "browser-compensation-v1";
  const prior = await listRows("compensation_legacy_imports", { id: importId });
  if (prior[0]) return { alreadyImported: true, counts: prior[0].counts };
  const data = input.legacy_data && typeof input.legacy_data === "object" ? input.legacy_data : {};
  const legacyGradeRows = legacyRows(data, "compensation:salary-grades");
  const grades = await listRows("salary_grades");
  const gradeIdByCode = new Map(grades.map((row) => [gradeCodeKey(String(row.grade ?? "")), String(row.id)]));
  const gradeById = new Map(grades.map((row) => [String(row.id), row]));
  const seenLegacyCodes = /* @__PURE__ */ new Set();
  for (const row of legacyGradeRows) {
    const code = normalizeLegacyGradeCode(required(row.code, "code"));
    const codeKey = code.toLowerCase();
    if (seenLegacyCodes.has(codeKey)) throw new HttpError(409, "LEGACY_SALARY_GRADE_CODE_COLLISION", `Legacy salary-grade codes collide after normalization: ${code}.`);
    seenLegacyCodes.add(codeKey);
    const legacyId = isUuidValue(row.id) ? row.id : void 0;
    const existingId = gradeIdByCode.get(codeKey);
    if (existingId !== void 0 && existingId !== legacyId) throw new HttpError(409, "LEGACY_SALARY_GRADE_CODE_COLLISION", `Salary-grade code ${code} already belongs to a different record.`);
    const existingById = legacyId ? gradeById.get(legacyId) : void 0;
    if (existingById && gradeCodeKey(String(existingById.grade ?? "")) !== codeKey) throw new HttpError(409, "LEGACY_SALARY_GRADE_ID_COLLISION", `Legacy salary-grade ID ${legacyId} already belongs to a different code.`);
  }
  const employees = await listRows("employees");
  const users = await listRows("users");
  const userByReference = /* @__PURE__ */ new Map();
  for (const user of users) for (const value of [user.id, user.name, user.email, user.employee_id]) if (value !== null && value !== void 0) userByReference.set(String(value), user);
  const legacyUser = (value) => value === null || value === void 0 ? void 0 : userByReference.get(String(value));
  const employeeByReference = /* @__PURE__ */ new Map();
  for (const employee of employees) {
    for (const value of [employee.id, employee.employee_number, employee.employee_no]) if (value !== null && value !== void 0) employeeByReference.set(String(value), employee);
  }
  const counts = { grades: 0, grade_codes_normalized: 0, assignments: 0, proposals: 0, history: 0, rewards: 0, skipped: 0 };
  for (const row of legacyGradeRows) try {
    const originalCode = required(row.code, "code").trim();
    const code = normalizeLegacyGradeCode(originalCode);
    const codeKey = code.toLowerCase();
    const legacyId = isUuidValue(row.id) ? row.id : void 0;
    if (gradeIdByCode.has(codeKey)) continue;
    const salary = legacyMoney(row.fixedSalary, "fixedSalary");
    const createdAt = typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt : (/* @__PURE__ */ new Date()).toISOString();
    const inserted = await insertRow("salary_grades", { ...legacyId ? { id: legacyId } : {}, grade: code, position: String(row.position ?? ""), monthly_salary: salary, daily_rate: legacyMoney(row.dailyRate ?? roundMoney(salary / MONTHLY_WORK_DAYS), "dailyRate"), status: row.status === "Inactive" ? "Inactive" : "Active", created_at: createdAt, updated_at: createdAt });
    gradeIdByCode.set(codeKey, String(inserted.id));
    if (legacyId) gradeById.set(legacyId, inserted);
    counts.grades++;
    if (code !== originalCode) counts.grade_codes_normalized++;
  } catch {
    counts.skipped++;
  }
  const importedProposals = /* @__PURE__ */ new Map();
  const oldProposals = legacyRows(data, "compensation:proposals");
  for (const row of oldProposals.length ? oldProposals : legacyRows(data, "compensation:salary-adjustments")) try {
    const employee = employeeByReference.get(String(row.employeeId ?? ""));
    if (!employee) throw new Error("unknown employee");
    const type = String(row.type ?? "");
    if (!["Salary Adjustment", "Merit Increase", "Promotion Increase"].includes(type)) throw new Error("invalid proposal type");
    const oldId = String(row.id ?? "");
    if (oldId && (await listRows("compensation_proposals", { legacy_id: oldId }))[0]) continue;
    const previous = legacyMoney(row.previousSalary, "previousSalary", true), next = legacyMoney(row.newSalary, "newSalary");
    const status = ["Approved", "Rejected"].includes(String(row.status)) ? String(row.status) : "Pending HR Review";
    const reviewer = legacyUser(row.reviewedBy ?? row.approvedBy);
    const rejectionReason = String(row.rejectionReason ?? "").trim() || null;
    const proposal = await insertRow("compensation_proposals", { employee_id: employee.id, proposal_type: type, previous_salary: previous, new_salary: next, effective_date: legacyDate(row.effectiveDate), notes: String(row.notes ?? ""), status, rejection_reason: rejectionReason, created_by: legacyUser(row.createdBy)?.id ?? null, created_at: legacyTimestamp(row.createdAt) ?? (/* @__PURE__ */ new Date()).toISOString(), reviewed_by: reviewer?.id ?? null, reviewed_at: status === "Pending HR Review" ? null : legacyTimestamp(row.reviewedAt), legacy_id: oldId || null });
    if (oldId) importedProposals.set(oldId, String(proposal.id));
    counts.proposals++;
  } catch {
    counts.skipped++;
  }
  for (const row of legacyRows(data, "compensation:employee-assignments")) try {
    const employee = employeeByReference.get(String(row.employeeId ?? ""));
    if (!employee) throw new Error("unknown employee");
    const oldId = String(row.id ?? "");
    if (oldId && (await listRows("employee_compensation", { legacy_id: oldId }))[0]) continue;
    const salary = legacyMoney(row.fixedSalary, "fixedSalary");
    const salaryCode = String(row.salaryCode ?? "");
    const linkedProposalId = oldId.startsWith("proposal:") ? importedProposals.get(oldId.slice("proposal:".length)) : void 0;
    const gradeId = gradeIdByCode.get(salaryCode.toLowerCase()) ?? null;
    const source = linkedProposalId || oldId.startsWith("proposal:") ? "Approved Proposal" : "Initial Assignment";
    await insertRow("employee_compensation", { employee_id: employee.id, salary_grade_id: gradeId, salary_code: salaryCode, position: String(row.position ?? employee.position ?? ""), basic_salary: salary, daily_rate: legacyMoney(row.dailyRate ?? roundMoney(salary / MONTHLY_WORK_DAYS), "dailyRate"), effective_date: legacyDate(row.effectiveDate), source, proposal_id: linkedProposalId ?? null, created_by: null, created_at: typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt : (/* @__PURE__ */ new Date()).toISOString(), legacy_id: oldId || null });
    counts.assignments++;
  } catch {
    counts.skipped++;
  }
  for (const row of legacyRows(data, "compensation:history")) try {
    const employee = employeeByReference.get(String(row.employeeId ?? ""));
    if (!employee) throw new Error("unknown employee");
    const oldId = String(row.id ?? "");
    if (oldId && (await listRows("compensation_history", { legacy_id: oldId }))[0]) continue;
    const proposalId = row.proposalId ? importedProposals.get(String(row.proposalId)) : void 0;
    const legacyActor = legacyUser(row.actorId ?? row.actorName ?? row.approvedBy);
    await recordHistory({ employee_id: employee.id, source: String(row.source ?? "Legacy Compensation"), event_type: String(row.type ?? "Legacy Change"), previous_salary: legacyMoney(row.previousSalary ?? 0, "previousSalary", true), new_salary: legacyMoney(row.newSalary ?? 0, "newSalary", true), adjustment_amount: legacyMoney(row.adjustmentAmount ?? 0, "adjustmentAmount", true), reason: String(row.reason ?? ""), effective_date: legacyDate(row.effectiveDate), status: String(row.status ?? "Imported"), recorded_at: legacyTimestamp(row.recordedAt) ?? (/* @__PURE__ */ new Date()).toISOString(), applied_at: legacyTimestamp(row.appliedAt), actor_id: legacyActor?.id ?? null, actor_name: String(row.actorName ?? row.approvedBy ?? legacyActor?.name ?? "") || null, proposal_id: proposalId ?? null, legacy_id: oldId || null });
    counts.history++;
  } catch {
    counts.skipped++;
  }
  for (const row of legacyRows(data, "compensation:bonuses-incentives")) try {
    const employee = employeeByReference.get(String(row.employeeId ?? ""));
    if (!employee) throw new Error("unknown employee");
    const oldId = String(row.id ?? "");
    if (oldId && (await listRows("compensation_rewards", { legacy_id: oldId }))[0]) continue;
    const type = String(row.type ?? "");
    if (type !== "Bonus" && type !== "Incentive") throw new Error("invalid reward type");
    const status = row.status === "Approved" ? "Approved" : "Planned";
    await insertRow("compensation_rewards", { employee_id: employee.id, reward_type: type, amount: legacyMoney(row.amount, "amount"), effective_date: legacyDate(row.effectiveDate), notes: String(row.notes ?? ""), status, created_by: null, created_at: typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt : (/* @__PURE__ */ new Date()).toISOString(), legacy_id: oldId || null });
    counts.rewards++;
  } catch {
    counts.skipped++;
  }
  await insertRow("compensation_legacy_imports", { id: importId, imported_by: ctx.userId, counts, imported_at: (/* @__PURE__ */ new Date()).toISOString() });
  await audit("compensation.legacy.imported", ctx.userId, "compensation_legacy_imports", importId, counts);
  return { alreadyImported: false, counts };
}
var compensation_default = verifiedEdge(async (ctx) => {
  requirePbmsRole(ctx, ["admin", "hr_staff"]);
  if (ctx.request.method === "GET") return ok(await loadBundle());
  if (ctx.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const input = await body(ctx.request);
  const action = required(input.action, "action");
  if (action === "create_grade") return ok(await createGrade(input, ctx));
  if (action === "deactivate_grade") return ok(await deactivateGrade(input, ctx));
  if (action === "create_initial_assignment") return ok(await createInitialAssignment(input, ctx));
  if (action === "create_proposal") return ok(await createProposal(input, ctx));
  if (action === "review_proposal") return ok(await reviewProposal(input, ctx));
  if (action === "create_reward") return ok(await createReward(input, ctx));
  if (action === "approve_reward") return ok(await reviewReward(input, ctx));
  if (action === "import_legacy") return ok(await importLegacy(input, ctx));
  throw new HttpError(400, "UNKNOWN_ACTION", "Unsupported compensation action.");
});
export {
  compensation_default as default
};
