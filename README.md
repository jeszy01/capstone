# Payroll & Benefits Frontend

A clean React + TypeScript + Vite implementation of the reference payroll and benefits frontend.

## Architecture

UI components use feature hooks/services, feature services use repositories, and repositories can switch between local development persistence and the centralized `/api/...` client. Browser code has no privileged credentials. Frontend API calls use the configured eProvider function endpoint; no build-time API URL or privileged key is required.

## Commands

- `npm run typecheck` — strict TypeScript audit
- `npm run build` — production build
- `npm test` — payroll calculation tests
- `npm run dev` — local development server

## Server contract

The client is prepared for `/api/auth/login`, `/api/auth/verify-otp`, `/api/employees`, `/api/payroll`, `/api/attendance`, `/api/benefits`, `/api/claims`, `/api/payslips`, and `/api/analytics/dashboard`. Development repositories persist to browser storage until the future server is available.
