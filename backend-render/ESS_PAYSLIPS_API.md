# PBMS → ESS Payslips API

HR releases payslips from PBMS (Payroll & Benefits): **Payroll Runs → Release to ESS** on an approved run. Each
employee's payslip is published to PBMS's ESS store, and the employee gets an ESS notification. ESS reads both and
shows them on the employee's Payslips page. PBMS never calls ESS.

## Process

1. HR clicks **Release to ESS (released/total)** on an approved run and confirms.
2. PBMS publishes every payslip of the run that is not yet released and adds one notification per employee. Releasing
   again sends only payslips still unreleased, so nothing is sent twice.
3. ESS reads the employee's payslips (`GET /integrations/ess/payslips?employee_no=…`) and notifications
   (`GET /integrations/ess/notifications?employee_no=…`).

With Strict Mode off (testing), payslips can be released once the run is Approved; with Strict Mode on, only after the
run is Paid. A payroll run that is deleted takes its released payslips and notifications with it.

## Authentication

```
X-API-Key: <shared key>
```

The same `ESS_API_KEY` as the claims API (see `ESS_CLAIMS_API.md`). Server-to-server only.

## Payslips of an employee

`GET https://<pbms-render-host>/integrations/ess/payslips?employee_no=EMP-0001`

Newest release first. Amounts are pesos rounded to 2 decimals, the same figures as the PBMS Payroll Register:
`gross = basic + allowance + bonuses + overtime + holidayLeave`,
`totalDeductions = absences + lateUt + sss + philhealth + pagibig + hmo + tax + loans + other`,
`net = gross - totalDeductions`.

```json
{
  "data": [
    {
      "runId": "4f0c…", "period": "2026-10-01 to 2026-10-15", "from": "2026-10-01", "to": "2026-10-15", "payDate": "2026-10-15",
      "empId": "EMP-0001", "name": "Ana Reyes", "position": "Site Engineer",
      "basic": 15000, "allowance": 500, "bonuses": 0, "overtime": 360.58, "holidayLeave": 0, "gross": 15860.58,
      "absences": 0, "lateUt": 144.23, "sss": 750, "philhealth": 375, "pagibig": 100, "hmo": 250, "tax": 611.15,
      "loans": 0, "other": 0, "totalDeductions": 2230.38, "net": 13630.2,
      "releasedAt": "2026-10-15T08:30:00.000Z"
    }
  ]
}
```

## Notifications of an employee

`GET https://<pbms-render-host>/integrations/ess/notifications?employee_no=EMP-0001`

The latest 100, newest first. `read_at` is null until read (ESS keeps its own read state).

```json
{
  "data": [
    { "id": "9b1e…", "title": "Payslip available", "message": "Your payslip for 2026-10-01 to 2026-10-15 is ready. Net pay ₱13,630.20.",
      "run_id": "4f0c…", "created_at": "2026-10-15T08:30:00.000Z", "read_at": null }
  ]
}
```

## Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `employee_no` is missing |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong |
| 404 | `EMPLOYEE_NOT_FOUND` | `employee_no` is not a PBMS employee |
| 503 | `ESS_NOT_CONFIGURED` | `ESS_API_KEY` is not set on the PBMS server |
