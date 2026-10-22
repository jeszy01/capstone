# PBMS → Finance Payroll API (read-only)

Finance reads every payroll run HR submits in PBMS: its figures, the Admin's decision, the funding confirmation and
each employee's payout status. Approval and funding confirmation happen in PBMS (by the PBMS Admin), so this API
only reads. PBMS never calls Finance, so no Finance URL is needed.

## Process

1. HR creates and computes a run, then submits it → **pending**.
2. The PBMS Admin approves it → **approved**, returns it to HR with a comment → **returned**, or rejects it with a
   comment → **rejected** (closed). HR can never approve their own run.
3. The Admin confirms the payroll account is funded by uploading the bank transfer receipt → **funded**.
4. HR exports the bank, e-wallet and cash payout files → **exported**, then marks each employee Paid or Failed.
   Failed payouts are corrected and exported again.
5. When every employee is Paid → **paid**. HR generates payslips and releases them to every department → **closed**.

Runs HR is still preparing (Draft, Computed) are not listed.

## Authentication

```
X-API-Key: <shared key>
```

PBMS sets the key as `FINANCE_API_KEY` on Render (at least 32 characters; generate with `openssl rand -hex 32`). Share
it with the Finance team privately and keep it on the Finance server only. Server-to-server only.

## Endpoints

### List runs

`GET https://<pbms-render-host>/integrations/finance/payroll-runs?status=funded`

`status` (optional): `pending`, `returned`, `rejected`, `approved`, `funded`, `exported`, `paid`, `closed`. Newest first.

```json
{ "data": [ {
  "id": "5f1c…", "run_type": "regular", "period_from": "2026-10-01", "period_to": "2026-10-15", "pay_date": "2026-10-15",
  "status": "exported", "employees": 42,
  "totals": { "gross": 1250000.00, "deductions": 210500.50, "net": 1039499.50, "withholding_tax": 85210.25 },
  "prepared_by": "HR User", "submitted_at": "2026-10-13T02:10:00.000Z",
  "decided_by": "Admin User", "decided_at": "2026-10-13T05:00:00.000Z", "decision_comment": null,
  "funded_at": "2026-10-14T01:00:00.000Z", "funding_amount": 1039499.50,
  "funding_receipt": { "file_name": "bdo-transfer.pdf", "mime_type": "application/pdf", "size_bytes": 182340, "uploaded_by": "Admin User", "uploaded_at": "2026-10-14T01:00:00.000Z" },
  "payouts": { "pending": 0, "exported": 40, "paid": 1, "failed": 1 },
  "paid_at": null, "closed_at": null
} ] }
```

`run_type` is `regular` or `thirteenth-month`. `decision_comment` is the Admin's comment on a returned or rejected run.

### One run with its employees

`GET https://<pbms-render-host>/integrations/finance/payroll-runs/{id}`

The same fields plus `rows`: `employee_no`, `name`, `gross`, `deductions`, `net`, `withholding_tax`, `sss`,
`philhealth`, `pagibig`, `employer_sss`, `employer_philhealth`, `employer_pagibig`, `payout_method` (`Bank`,
`E-wallet` or `Cash`), `payout_status` (`Pending`, `Exported`, `Paid` or `Failed`) and `payout_failure_reason`.

### Funding receipt

`GET https://<pbms-render-host>/integrations/finance/payroll-runs/{id}/funding-receipt`

The bank transfer receipt the Admin uploaded (JPG, PNG or PDF), shown inline; add `?download=1` to download it.
Returns `404 RECEIPT_NOT_FOUND` when the run has none.

### Decisions (removed)

`POST …/payroll-runs/{id}/decision` now returns `410 DECISIONS_IN_PBMS`: payroll is approved in PBMS by the Admin.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid `status`. |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong. |
| 404 | `PAYROLL_RUN_NOT_FOUND` | No submitted run with that id. |
| 410 | `DECISIONS_IN_PBMS` | Decisions are made in PBMS. |
| 503 | `FINANCE_NOT_CONFIGURED` | PBMS has not set `FINANCE_API_KEY` yet. |
