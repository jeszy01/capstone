# eProvider backend boundary

This directory contains the staged PBMS backend boundary for the active eProvider project. It uses project-scoped MCP from server-side Edge Functions, keeps tenant data inside the project schema, and contains no credentials.

## Gmail OTP integration

The login flow generates a six-digit OTP with Web Crypto, stores only a SHA-256 hash in `otp_challenges`, and sends the code through the eProvider email service at `https://api.eprovider.site/api/send-otp`. The email service API key is read only from the eProvider project secret `EPROVIDER_OTP_KEY` and is sent as the server-side `x-api-key` header. The browser never receives this key.

The `send-otp` Edge Function is authenticated and shares the same server-only sender module as `auth-login`; login invokes the sender directly after creating a challenge. `auth-verify-otp` validates the challenge, expiry, hash, and one-time consumption.

OTP can be temporarily disabled across login, onboarding, verification, and the standalone sender by setting the server-side eProvider variable `PBMS_OTP_ENABLED=false`. OTP remains enabled by default when the variable is missing; set it to `true` or remove it to restore OTP. The switch does not delete challenges, tables, or provider secrets, so they remain available when OTP is restored. Deploy the compatible backend and frontend code before changing this variable.

## Verification order

1. Run `migration_preflight` against the ordered SQL files.
2. Review and apply the new OTP migration from the eProvider Migrations UI.
3. Configure `EPROVIDER_OTP_API_URL` and the email provider's API key as `EPROVIDER_OTP_KEY` through eProvider secret cloud.
4. Apply migration `0020_app_data.sql` to enable cross-device synchronization for browser-backed module data.
5. Create/deploy the updated `auth-login`, `auth-verify-otp`, `send-otp`, and `app-data` functions.
6. Invoke valid, invalid, expired, reused, provider-401, and provider-429 cases.

## Admin user management

The Account Settings screen uses the authenticated `users` Edge Function. Apply migration `0018_user_name.sql` and deploy `functions/users`. Only admins can list, create, or delete users. Creation accepts an email, password, employee ID, name, and role; the password is stored only as a server-side PBKDF2 hash, and a one-time onboarding OTP is sent to the new email address. Deletion uses a `POST /users` request with `{ "action": "delete", "id": "..." }` because the function-invocation gateway does not allow browser `DELETE` requests. An admin cannot delete their own account.

Runtime secrets expected by functions: `EPROVIDER_API_URL`, `EPROVIDER_PROJECT_ID`, `EPROVIDER_SCHEMA`, `EPROVIDER_SERVICE_ROLE_KEY`, `EPROVIDER_OTP_API_URL`, `EPROVIDER_OTP_KEY`, `PBMS_JWT_SECRET`, and `PBMS_OTP_SECRET`.

## Cross-device application data

The frontend synchronizes shared browser-backed module data through the `app-data` Edge Function. Deploy its `config.json` with `required_role: "anon"`: this allows the eProvider gateway to pass requests through so the function can validate the PBMS session itself. Apply migration `0020_app_data.sql` before deploying the function. The function stores namespaced JSON values in `app_data`; `GET` reads values, `POST` writes values, and `POST` with `{ "key": "...", "deleted": true }` writes a deletion tombstone because the function gateway does not allow browser `DELETE` requests. It requires an active PBMS session and an `admin` or `hr_staff` role. The frontend hydrates from the server after login and publishes local changes with a short debounce.

## Compensation allowances and adjustments
The Compensation Planning Allowances & Incentives section supports `Allowance` and `Adjustment` entries in addition to legacy `Bonus` and `Incentive` records. Apply migration `0022_compensation_reward_types.sql` before creating the new entry types, then deploy the updated `functions/compensation` function.

## Employee loans and cash advances
Apply migration `0023_employee_loans.sql`, then deploy `functions/loans` with its `config.json`. The API uses the active Employee Management database records, records new loans/advances as pending HR approval, and supplies due installments to payroll review. It does not seed loan data. Actual repayments are posted as one immutable database batch only after the corresponding approved payroll run is marked paid and synchronized under `payroll:runs` in `app_data`; the batch is unique per run and pay period. Outstanding balances are derived from the original principal less posted payroll repayments. Keep the migration and function deployment paired with the frontend release; if the API is unavailable, payroll review must not silently omit a scheduled loan deduction.

## Salary Structure
Salary grades are edited with `update_grade` (assignments keep their salary snapshot, so pay does not change) and removed with `delete_grade`, which refuses grades referenced by an employee, assignment, or proposal; there is no deactivation. Salary change proposals select a salary grade; the server takes the proposed salary from that grade and copies the grade to the approved, effective-dated assignment. Daily rates use the working-days-per-month payroll setting (`payroll:rates` in `app_data`, default 22). Apply migration `0024_proposal_salary_grade.sql`, then deploy the updated `functions/compensation` function together with the frontend.
