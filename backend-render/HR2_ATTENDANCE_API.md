# HR2 → PBMS Attendance API

HR2 sends daily attendance to PBMS (Payroll & Benefits) with this endpoint. PBMS uses it for Time & Attendance,
Deductions and payroll. A payroll cutoff can be submitted only after HR2 has sent attendance up to the cutoff's last day.

## Endpoint

```
POST https://<pbms-render-host>/integrations/hr2/attendance
Content-Type: application/json
X-API-Key: <shared key>
```

- The key is a shared secret. PBMS sets it as the `HR2_API_KEY` environment variable on Render. It must be at least 32
  characters; generate it with `openssl rand -hex 32`. Send it to the HR2 team privately, never by chat or email in
  plain text, and keep it on the HR2 server only (never in browser code).
- This is a server-to-server call. Browsers cannot call it.

## Request body

```json
{
  "synced_through": "2026-10-15",
  "records": [
    {
      "employee_no": "EMP-0001",
      "date": "2026-10-01",
      "time_in": "08:12",
      "time_out": "17:30",
      "worked_hours": 8.3,
      "late_min": 12,
      "undertime_min": 0,
      "ot_min": 30,
      "status": "Present",
      "leave_type": null,
      "ot_status": "Approved"
    }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `synced_through` | `YYYY-MM-DD` | Recommended | The last date HR2 has finished sending. PBMS treats every date up to it as complete. It never moves backwards. If omitted, the latest record date is used. |
| `records` | array | Yes | At most 5,000 per request; send larger periods in several requests. |
| `employee_no` | string | Yes | The employee number exactly as in PBMS Employees (for example `EMP-0001`). Case and surrounding spaces are ignored. |
| `date` | `YYYY-MM-DD` | Yes | The attendance date. |
| `status` | string | Yes | `Present`, `Absent`, `On Leave` or `Day Off`. |
| `time_in`, `time_out` | `HH:MM` (24-hour) or `null` | For `Present` | A `Present` day without both times is **not paid**; PBMS shows it as incomplete in Review Payroll. |
| `worked_hours` | number 0–24 or `null` | No | |
| `late_min`, `undertime_min`, `ot_min` | whole minutes 0–1440 | No (default 0) | Computed by HR2. PBMS uses them as received and does not recompute them. |
| `ot_status` | `Approved`, `Pending`, `Rejected` or `null` | When `ot_min` > 0 | Only `Approved` overtime is paid. |
| `leave_type` | string or `null` | No | For `On Leave` days, for example `Vacation Leave`. |

### Rules

- **One record per employee per date.** Sending the same employee and date again replaces the earlier record, so
  corrections are made by sending the corrected record.
- **Send every work day**, including `Absent` and `Day Off`. A work day (Monday to Friday, except non-working
  holidays) with no record is not paid; PBMS shows it as missing in Review Payroll.
- Leave filed and approved in PBMS replaces HR2's record for that day, except an HR2 `Day Off`.
- Send attendance at least once before each payroll cutoff closes (the 15th and the end of the month), with
  `synced_through` set to the cutoff's last day.

## Responses

`200 OK`

```json
{
  "data": {
    "received": 118,
    "rejected": [
      { "index": 7, "employee_no": "EMP-9999", "date": "2026-10-03", "reason": "employee_no is not a PBMS employee" }
    ],
    "synced_through": "2026-10-15",
    "total_records": 2240
  }
}
```

Valid records are saved even when others in the same request are rejected. Fix the rejected ones (by `index` in
your `records` array) and send them again.

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `records` is not an array, or `synced_through` is not a date. |
| 401 | `INVALID_API_KEY` | The `X-API-Key` header is missing or wrong. |
| 413 | `TOO_MANY_RECORDS` | More than 5,000 records in one request. |
| 503 | `HR2_NOT_CONFIGURED` | PBMS has not set `HR2_API_KEY` yet. |

Each accepted request is written to PBMS Logs & Audit ("Received N attendance records from HR2").

## Examples

### curl

```bash
curl -X POST "https://<pbms-render-host>/integrations/hr2/attendance" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $PBMS_HR2_API_KEY" \
  -d '{"synced_through":"2026-10-15","records":[{"employee_no":"EMP-0001","date":"2026-10-01","time_in":"08:12","time_out":"17:30","worked_hours":8.3,"late_min":12,"undertime_min":0,"ot_min":30,"status":"Present","leave_type":null,"ot_status":"Approved"}]}'
```

### Laravel (HTTP client)

```php
use Illuminate\Support\Facades\Http;

$response = Http::withHeaders(['X-API-Key' => config('services.pbms.hr2_key')])
    ->acceptJson()
    ->post(config('services.pbms.url') . '/integrations/hr2/attendance', [
        'synced_through' => '2026-10-15',
        'records' => $records, // each item shaped as in the table above
    ]);

$response->throw();
$rejected = $response->json('data.rejected');
```

### Plain PHP (cURL)

```php
$ch = curl_init('https://<pbms-render-host>/integrations/hr2/attendance');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-API-Key: ' . getenv('PBMS_HR2_API_KEY')],
    CURLOPT_POSTFIELDS => json_encode(['synced_through' => '2026-10-15', 'records' => $records]),
]);
$body = json_decode(curl_exec($ch), true);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
```
