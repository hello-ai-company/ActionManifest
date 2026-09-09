# CI status (ENG-20260909-001)

First PR run `34309041700` **failed** at `pnpm/action-setup@v4`:

> Multiple versions of pnpm specified: Action `version: 10` vs package.json `packageManager: pnpm@10.14.0`

Fix in this revision: drop `version` from the workflow so pnpm/action-setup uses `packageManager` only.

Local quality gates in `quality-gates.log` were re-run after the fix. GitHub Actions re-run is expected on push of this commit. This agent does **not** merge the PR.
