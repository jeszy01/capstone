# ESS → PBMS Expense Claims API

Employees submit expense claims from ESS. ESS sends each claim to PBMS (Payroll & Benefits), where HR reviews,
approves and pays it, and ESS reads the claim's status back to show the employee. PBMS never calls ESS.

## Process

1. The employee submits a claim in ESS → ESS sends it (`POST /integrations/ess/claims`) → **Pending Approval**.
2. HR reviews it in PBMS and decides:
   - **Approved** → HR pays it separately (**Reimbursed**) or adds it to payroll (**Included in Payroll**);
   - **Returned** → the employee corrects it in ESS and resubmits it (`PUT /integrations/ess/claims/{claim_number}`);
   - **Rejected** → closed. Returned and rejected claims carry HR's reason in `notes`.
3. ESS shows the employee their claims and statuses (`GET /integrations/ess/claims?employee_no=…`).

## Authentication

```
X-API-Key: <shared key>
```

PBMS sets the key as `ESS_API_KEY` on Render (at least 32 characters; generate with `openssl rand -hex 32`). Share it
with the ESS team privately and keep it on the ESS server only. Server-to-server only.

## Submit a claim

`POST https://<pbms-render-host>/integrations/ess/claims`

```json
{
  "employee_no": "EMP-0001",
  "claim_type": "Transportation",
  "amount": 450.50,
  "date": "2026-10-20",
  "business_purpose": "Taxi to the Makati client site for the site inspection.",
  "project_site": "Makati Tower",
  "receipt": { "name": "taxi-receipt.jpg", "mime_type": "image/jpeg", "data": "<base64>" },
  "certified": true,
  "ess_reference": "ESS-CLM-88412"
}
```

| Field | Required | Notes |
|---|---|---|
| `employee_no` | Yes | The employee number as in PBMS Employees. |
| `claim_type` | Yes | `Food`, `Transportation` or `Office Supplies`. |
| `amount` | Yes | More than 0, at most 1,000,000, up to 2 decimals. |
| `date` | Yes | `YYYY-MM-DD`, not in the future (Philippine time). |
| `business_purpose` | Yes | 5–1,000 characters. |
| `project_site` | No | Up to 200 characters. |
| `receipt` | Yes | `name`, `mime_type` (`image/jpeg`, `image/png` or `application/pdf`) and `data` (base64, at most 3 MB). |
| `certified` | Yes | Must be `true`: the employee confirms it is a business expense, not personal. |
| `ess_reference` | Recommended | ESS's own id. Sending the same reference again returns the claim already received (no duplicate). |

Returns `201 Created` (or `200` for a repeated `ess_reference`) with the claim, including its PBMS `claim_number`.

## Resubmit a returned claim

`PUT https://<pbms-render-host>/integrations/ess/claims/{claim_number}` with the same body (all fields again).
Only a claim with status **Returned** and the same `employee_no` can be resubmitted; it goes back to **Pending Approval**.

## The employee's claims

`GET https://<pbms-render-host>/integrations/ess/claims?employee_no=EMP-0001` — newest first:

```json
{ "data": [ {
  "claim_number": "CLM-2026-0042", "claim_type": "Transportation", "amount": 450.5, "date": "2026-10-20",
  "business_purpose": "…", "project_site": "Makati Tower", "receipt_name": "taxi-receipt.jpg",
  "status": "Returned", "notes": "The receipt is unreadable; attach a clearer photo.",
  "payment_method": null, "payment_date": null,
  "submitted_at": "2026-10-20T03:12:00.000Z", "updated_at": "2026-10-21T01:05:00.000Z", "ess_reference": "ESS-CLM-88412"
} ] }
```

`status`: `Pending Approval`, `Returned`, `Rejected`, `Approved`, `Reimbursed` or `Included in Payroll`.
`payment_method`: `Paid Separately` or `Include in Payroll` once HR sets it.

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing or invalid; the message says which. |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong. |
| 404 | `EMPLOYEE_NOT_FOUND` / `CLAIM_NOT_FOUND` | Unknown `employee_no`, or no such claim for that employee. |
| 409 | `CLAIM_NOT_RETURNED` | Only returned claims can be resubmitted. |
| 413 | — | The request is larger than 5 MB. |
| 503 | `ESS_NOT_CONFIGURED` | PBMS has not set `ESS_API_KEY` yet. |

Every submission and resubmission is written to PBMS Logs & Audit and notifies HR.

## Example (Laravel)

```php
use Illuminate\Support\Facades\Http;

$pbms = Http::withHeaders(['X-API-Key' => config('services.pbms.ess_key')])->acceptJson()->baseUrl(config('services.pbms.url'));

$claim = $pbms->post('/integrations/ess/claims', [
    'employee_no' => $employee->employee_no,
    'claim_type' => 'Transportation',
    'amount' => 450.50,
    'date' => '2026-10-20',
    'business_purpose' => $request->business_purpose,
    'receipt' => ['name' => $file->getClientOriginalName(), 'mime_type' => $file->getMimeType(), 'data' => base64_encode($file->get())],
    'certified' => true,
    'ess_reference' => $essClaim->id,
])->throw()->json('data');

$claims = $pbms->get('/integrations/ess/claims', ['employee_no' => $employee->employee_no])->throw()->json('data');
```
