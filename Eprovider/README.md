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

New employee loans accept only `Company Loan` and `Other Loan` (plus the cash-advance types); SSS and Pag-IBIG loans are recorded as government loans. Existing `SSS Loan` and `Pag-IBIG Loan` records still settle as before.

## Keeping employee and government loans separate in payroll
Both loan types appear under Payroll Management → Deductions → Loans & Cash Advances, in the Employee Loans & Cash Advances and Government Loans subtabs. Payroll rows keep employee loans in `sssLoan`, `pagibigLoan`, `companyLoan` and `cashAdvance`, and government loans in `govSssLoan` and `govPagibigLoan`. Rows built before that split carried government amounts inside `sssLoan` and `pagibigLoan`; both settle functions still accept them. Both `POST /loans/settle` and `POST /government-loans/settle` take `"validate_only": true` to run every check without writing. When a run is paid, the browser validates both settlements before posting either, so a failure on one never leaves the other's balances changed. Deploy the updated `functions/loans` and `dist-fn/government-loans.js` together with the frontend, and redeploy the Render backup, which serves the same behavior.

## Government loans (SSS and Pag-IBIG)
Apply migration `0028_government_loans.sql`, then deploy `functions/government-loans` with its `config.json` (single-file build: `dist-fn/government-loans.js`). The agency has already approved these loans; HR records the notice (Pending), and Verify only confirms the encoding matches the attached notice (Active). `GET /government-loans/schedule` returns Active loans whose start date is on or before the cutoff end and that still have a balance; payroll deducts min(monthly amortization ÷ pay periods per month, balance, available net pay). `POST /government-loans/settle` (Admin only) posts a run's deductions once per run and loan, only after the run is released (approved, paid and synchronized under `payroll:runs`); a loan whose balance reaches zero becomes Closed. Every line is checked before anything is written (loan active, employee and loan type match, amount within the remaining balance, `govSssLoan`/`govPagibigLoan` match the lines), so a run posts completely or not at all. Balances follow the transaction ledger (total amount less posted deductions); a retry repairs a balance that was not updated after its deduction was recorded. The Render backup serves the same endpoints with the same request and response shapes.

## Salary Structure
Salary grades are edited with `update_grade` (assignments keep their salary snapshot, so pay does not change) and removed with `delete_grade`, which refuses grades referenced by an employee, assignment, or proposal; there is no deactivation. Salary change proposals select a salary grade; the server takes the proposed salary from that grade and copies the grade to the approved, effective-dated assignment. Daily rates use the working-days-per-month payroll setting (`payroll:rates` in `app_data`, default 22). Apply migration `0024_proposal_salary_grade.sql`, then deploy the updated `functions/compensation` function together with the frontend.

## Allowances, incentives and bonuses
`compensation_rewards` holds allowances (allowance type, Per Cutoff/Monthly frequency, taxable flag chosen per allowance, Active/Inactive) and incentives & bonuses (cutoff, reason, taxable flag, Pending/Approved/Rejected). The function supports `create_reward`, `update_reward` (an edited incentive or bonus returns to Pending), `delete_reward` and `review_reward` (approve or reject; `approve_reward` remains as an alias). Apply migration `0025_compensation_reward_details.sql`, which converts existing Allowance/Adjustment rows to allowances and Planned bonuses to Pending, then deploy the updated `functions/compensation`. Allowance types are synchronized under `compensation:allowance-types` in `app_data`; the 13th-month/other-benefits ceiling is stored on the withholding rules (`payroll:withholding-tax-rules`).

## Payroll Settings
Payroll Settings is the single source of payroll rates and rules. Values synchronize through `app_data` under `payroll:` keys: `payroll:rates` (working time, pay schedule, holiday multipliers, contributions), `payroll:time-settings` (shift, night differential window, overtime rounding), `payroll:holidays`, `payroll:withholding-tax-rules` (tax tables, benefits exemption) and `payroll:thirteenth-month-rules` (read with a fallback to the earlier `compensation:thirteenth-month-rules`). The `payroll` function reads `payroll:rates` and returns 409 until Payroll Settings has been saved; the `compensation` function falls back to 22 working days only when `payroll:rates` has never been saved. Payroll runs store the settings snapshot used to generate them.

## Settings & Privacy
Apply migration `0026_account_security.sql` (per-user `users.otp_enabled` and the `user_sessions` table), then deploy `functions/account` with its `config.json` and redeploy every function that uses `verifiedEdge` together with `auth-login` and `auth-verify-otp`. Sign-in records a device session and puts its id (`sid`) in the token; `verifiedEdge` rejects tokens whose session was signed out or expired. If the sessions table is unavailable, sign-in still succeeds with a token without `sid`. The `account` function acts only on the signed-in user: `GET` returns the two-factor setting and active sessions; `POST` supports `change_password`, `set_otp`, `revoke_session` and `revoke_other_sessions` (each requires `current_password`) and `sign_out`. A password change signs out the user's other devices. The server-wide `PBMS_OTP_ENABLED=false` switch still disables OTP for everyone.

### Passkey
Apply migration `0027_user_passkey.sql`. The `account` function also supports `set_passkey` and `reset_passkey` (login password required), `change_passkey` (current passkey required) and `verify_passkey` (`purpose` export or release). Only a PBKDF2 hash of the passkey is stored; it is never returned or logged. Five wrong passkeys lock it for 15 minutes. The browser asks for the passkey before every CSV export and before releasing payroll to Finance. The deployable single-file build of the function is `dist-fn/account.js`; paste it into the eProvider function editor as `account` with `functions/account/config.json`.

## User roles
Admins change a user's role with the Edit action in Settings & Privacy > Account Settings (`users` function, `{"action":"update_role","id":"...","role":"admin"|"hr_staff"}`). The last active Admin cannot be changed to HR. Server functions read the role from the `users` table on every request, so a change applies on the user's next request; the browser re-reads it from `current-user` (deploy `dist-fn/current-user.js` with its `config.json`) and reloads when it changes. `current-user` returns only public fields.
