# eProvider backend boundary

This directory contains the staged PBMS backend boundary for the active eProvider project. It uses project-scoped MCP from server-side Edge Functions, keeps tenant data inside the project schema, and contains no credentials.

## Gmail OTP integration

The login flow generates a six-digit OTP with Web Crypto, stores only a SHA-256 hash in `otp_challenges`, and sends the code through the eProvider email service at `https://api.eprovider.site/api/send-otp`. The email service API key is read only from the eProvider project secret `EPROVIDER_OTP_KEY` and is sent as the server-side `x-api-key` header. The browser never receives this key.

The `send-otp` Edge Function is authenticated and shares the same server-only sender module as `auth-login`; login invokes the sender directly after creating a challenge. `auth-verify-otp` validates the challenge, expiry, hash, and one-time consumption.

## Verification order

1. Run `migration_preflight` against the ordered SQL files.
2. Review and apply the new OTP migration from the eProvider Migrations UI.
3. Configure `EPROVIDER_OTP_API_URL` and the email provider's API key as `EPROVIDER_OTP_KEY` through eProvider secret cloud.
4. Apply migration `0019_app_data.sql` to enable cross-device synchronization for browser-backed module data.
5. Create/deploy the updated `auth-login`, `auth-verify-otp`, `send-otp`, and `app-data` functions.
6. Invoke valid, invalid, expired, reused, provider-401, and provider-429 cases.

## Admin user management

The Account Settings screen uses the authenticated `users` Edge Function. Apply migration `0018_user_name.sql` and deploy `functions/users`. Only admins can list, create, or delete users. Creation accepts an email, password, employee ID, name, and role; the password is stored only as a server-side PBKDF2 hash, and a one-time onboarding OTP is sent to the new email address. Deletion uses a `POST /users` request with `{ "action": "delete", "id": "..." }` because the function-invocation gateway does not allow browser `DELETE` requests. An admin cannot delete their own account.

Runtime secrets expected by functions: `EPROVIDER_API_URL`, `EPROVIDER_PROJECT_ID`, `EPROVIDER_SCHEMA`, `EPROVIDER_SERVICE_ROLE_KEY`, `EPROVIDER_OTP_API_URL`, `EPROVIDER_OTP_KEY`, `PBMS_JWT_SECRET`, and `PBMS_OTP_SECRET`.

## Cross-device application data

The frontend synchronizes shared browser-backed module data through the authenticated `app-data` Edge Function. Apply migration `0019_app_data.sql` before deploying that function. The function stores namespaced JSON values in `app_data` and supports `GET`, `POST`, and `DELETE`; it requires an active PBMS session and an `admin` or `hr_staff` role. The frontend hydrates from the server after login and publishes local changes with a short debounce.
