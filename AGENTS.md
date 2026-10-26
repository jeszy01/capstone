# OpenCode Project Instructions

## Project scope
This repository contains the Payroll & Benefits Management System (PBMS), including a React + TypeScript + Vite frontend and eProvider Edge Functions.

## Working rules
- Inspect the current branch, working-tree status, relevant files, package scripts, and existing tests before changing code.
- Diagnose the root cause before implementing a fix.
- Make the smallest focused change that solves the problem; avoid unrelated refactors.
- Follow existing React, TypeScript, service/repository, API, and Edge Function conventions.
- Keep privileged credentials server-side. Never expose, print, commit, or hard-code secrets, service-role keys, database URLs, or `.env` contents.
- Do not claim checks passed unless you actually ran them and observed the result.
- After edits, run the relevant available typecheck, tests, lint, and production build; report commands and outcomes.
- Review the final diff and list changed files, behavior changes, test results, and remaining risks.
- Ask before destructive operations, database migrations or writes, secret changes/rotation, production configuration changes, commits, pushes, or deployments.
- Never force-push or rewrite Git history.
- Do not deploy automatically after a successful build.

## Suggested verification
Check `package.json` for the actual scripts before running commands. The README documents `npm run typecheck`, `npm run build`, and `npm test`; verify that the scripts exist before running them.

If a documented command is missing or fails because of environment setup, report that accurately instead of silently substituting a different check.
