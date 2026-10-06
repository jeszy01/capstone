# eProvider backend boundary

This directory contains the staged PBMS backend boundary for the active eProvider project. It uses project-scoped MCP from server-side Edge Functions, keeps tenant data inside the project schema, and contains no credentials.

## Verification order

1. Run `migration_preflight` against the ordered SQL files.
2. Review the preflight result and propose the migration draft.
3. Apply migrations from the eProvider Migrations UI.
4. Verify `migration_history` and `list_tables`.
5. Create/deploy functions one at a time, beginning with auth and employees.
6. Configure runtime secrets through eProvider secret cloud only after the service credential has been rotated.
7. Invoke each function with valid, unauthenticated, unauthorized, invalid, missing-record, duplicate, and upstream-failure cases.

Runtime secrets expected by functions: `EPROVIDER_API_URL`, `EPROVIDER_PROJECT_ID`, `EPROVIDER_SCHEMA`, `EPROVIDER_SERVICE_ROLE_KEY`, `PBMS_JWT_SECRET`, and `PBMS_OTP_SECRET`.
