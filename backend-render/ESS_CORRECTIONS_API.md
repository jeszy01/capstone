# ESS → PBMS Payroll Corrections API

An employee who finds a mistake in a payslip requests a correction from ESS. ESS sends it to PBMS (Payroll & Benefits)
and reads its status back to show the employee. PBMS never calls ESS.

## Process

1. The employee requests a correction in ESS → ESS sends it (`POST /integrations/ess/corrections`) → **Pending**.
2. Finance approves it (**Approved**) or rejects it with a comment (**Rejected**, closed).
3. Payroll pays an approved correction as a separate payment, manually and outside the system, then marks it
   **Completed**. A correction is never added to the next payroll run.
4. ESS shows the employee their corrections and statuses (`GET /integrations/ess/corrections?employee_no=…`).

Every step is recorded in PBMS Logs & Audits.

## Authentication

Same as the claims API: the shared key in the `X-API-Key` header (`ESS_API_KEY` on Render). Server-to-server only.

## Request a correction

`POST https://<pbms-render-host>/integrations/ess/corrections`

```json
{
  "employee_no": "EMP-0001",
  "run_id": "c386ed75-…",
  "request": "Overtime on Oct 20 (2 hours) is missing from my Oct 30 payslip.",
  "amount": 450.50,
  "ess_reference": "ESS-COR-1042"
}
```

| Field | Required | Notes |
|---|---|---|
| `employee_no` | Yes | The employee number as in PBMS Employees. |
| `run_id` | Yes | The payroll run of the payslip (the payslip's `runId`). It must be approved and include the employee. |
| `request` | Yes | What is wrong, 5–1,000 characters. |
| `amount` | Yes | The amount the employee asks for: more than 0, at most 1,000,000, up to 2 decimals. |
| `ess_reference` | Recommended | ESS's own id. Sending the same reference again returns the correction already received (no duplicate). |

Returns `201 Created` (or `200` for a repeated `ess_reference`) with the correction, including its PBMS
`correction_number` (`COR-2026-0001`).

## The employee's corrections

`GET https://<pbms-render-host>/integrations/ess/corrections?employee_no=EMP-0001`, newest first:

```json
{ "data": [ {
  "id": "…", "correction_number": "COR-2026-0001", "employee_no": "EMP-0001", "employee_name": "Juan Dela Cruz",
  "run_id": "c386ed75-…", "period": "2026-10-10 to 2026-10-25", "request": "…", "amount": 450.5,
  "status": "Rejected", "decision_comment": "The overtime was paid in the Oct 15 run.", "decided_by": "Finance User",
  "decided_at": "2026-10-27T02:10:00.000Z", "completed_by": null, "completed_at": null, "completion_note": null,
  "submitted_at": "2026-10-26T01:00:00.000Z", "ess_reference": "ESS-COR-1042"
} ] }
```

`status`: `Pending`, `Approved`, `Rejected` or `Completed`.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing or invalid; `message` says which. |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong. |
| 404 | `EMPLOYEE_NOT_FOUND` | `employee_no` is not a PBMS employee. |
| 503 | `ESS_NOT_CONFIGURED` | `ESS_API_KEY` is not set on the PBMS server. |
