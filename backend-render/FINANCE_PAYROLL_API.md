# PBMS → Finance Payroll Approval API

Finance approves or rejects every payroll run HR submits in PBMS, and receives the final payment report. Finance's
system reads runs from PBMS and sends its decision back; PBMS never calls Finance, so no Finance URL is needed.

## Process

1. HR submits a payroll run in PBMS → status **pending**.
2. Finance reads pending runs (`GET …/payroll-runs?status=pending`) and each run's employees (`GET …/payroll-runs/{id}`).
3. Finance sends its decision (`POST …/payroll-runs/{id}/decision`). PBMS notifies HR.
   - **approve** → HR pays it and generates payslips (status **paid**), then releases payslips to employees.
   - **reject** → the run is closed; HR corrects the inputs and submits a new run for the cutoff.
4. HR reports the run to Finance → status **reported**. Finance reads the final figures with `GET …/payroll-runs?status=reported`.

## Authentication

```
X-API-Key: <shared key>
```

PBMS sets the key as `FINANCE_API_KEY` on Render (at least 32 characters; generate with `openssl rand -hex 32`). Share
it with the Finance team privately and keep it on the Finance server only. Server-to-server only.

## Endpoints

### List runs

`GET https://<pbms-render-host>/integrations/finance/payroll-runs?status=pending`

`status` (optional): `pending`, `approved`, `rejected`, `paid`, `reported`. Newest first.

```json
{ "data": [ {
  "id": "5f1c…", "run_type": "regular", "period_from": "2026-10-01", "period_to": "2026-10-15", "pay_date": "2026-10-15",
  "status": "pending", "employees": 42,
  "totals": { "gross": 1250000.00, "deductions": 210500.50, "net": 1039499.50, "withholding_tax": 85210.25 },
  "prepared_by": "HR User", "submitted_at": "2026-10-16T02:10:00.000Z",
  "decided_by": null, "decided_at": null, "rejection_reason": null,
  "payment_method": null, "paid_at": null, "reported_at": null
} ] }
```

`run_type` is `regular` or `thirteenth-month`.

### One run with its employees

`GET https://<pbms-render-host>/integrations/finance/payroll-runs/{id}`

The same fields plus `rows`: `employee_no`, `name`, `gross`, `deductions`, `net`, `withholding_tax`, `sss`,
`philhealth`, `pagibig`, `employer_sss`, `employer_philhealth`, `employer_pagibig`.

### Approve or reject

`POST https://<pbms-render-host>/integrations/finance/payroll-runs/{id}/decision`

```json
{ "decision": "approve", "decided_by": "Ana Reyes" }
{ "decision": "reject", "decided_by": "Ana Reyes", "reason": "Overtime for Engineering is not supported by attendance." }
```

| Field | Required | Notes |
|---|---|---|
| `decision` | Yes | `approve` or `reject` |
| `decided_by` | Yes | The Finance approver's name; PBMS shows it as "Ana Reyes (Finance)". |
| `reason` | For `reject` | Shown to HR on the run. |

Returns the run summary. A run can be decided once, only while it is `pending`.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid `decision`, `decided_by`, `reason` or `status`. |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong. |
| 404 | `PAYROLL_RUN_NOT_FOUND` | No run with that id. |
| 409 | `PAYROLL_ALREADY_DECIDED` | The run is no longer pending. |
| 503 | `FINANCE_NOT_CONFIGURED` | PBMS has not set `FINANCE_API_KEY` yet. |

Every decision is written to PBMS Logs & Audit.

## Example (Laravel)

```php
use Illuminate\Support\Facades\Http;

$pbms = Http::withHeaders(['X-API-Key' => config('services.pbms.finance_key')])->acceptJson()->baseUrl(config('services.pbms.url'));

$pending = $pbms->get('/integrations/finance/payroll-runs', ['status' => 'pending'])->throw()->json('data');
$run = $pbms->get("/integrations/finance/payroll-runs/{$pending[0]['id']}")->throw()->json('data');

$pbms->post("/integrations/finance/payroll-runs/{$run['id']}/decision", [
    'decision' => 'approve',
    'decided_by' => auth()->user()->name,
])->throw();
```
