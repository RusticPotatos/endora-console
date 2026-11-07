# Working agreements for AI assistants

Endora Console is the screens for Endora Core, as its own deployable (Endora ADR 0145). Read
[README.md](README.md) and [SOURCE.md](SOURCE.md) first.

- **Console holds no authority.** No credential, no session store, no sign-in of its own (ADR
  0146). Core authorizes every request.
- **Only the contract.** The proxy passes exactly `contract/console-v1.json`. A new route is
  added to Core's contract first, in Endora; then the copy here is updated with its new pin.
  Never add a route here that Core's contract does not list, and never call HQ.
- **The screen freeze.** Until the cutover, screen changes land in Endora and are copied here.
  Console's own changes go in `web/js/48-console.js` and `server/`.
- **No dependencies.** Node's own modules only (`scripts/check-independence.mjs`).
- **Test first.** `npm test`, `node scripts/check-console.mjs`,
  `node scripts/check-independence.mjs` and `node scripts/check-nothing-personal.mjs --history`
  pass before every push.
- **The repository is public. Nothing personal** in any file or commit message: `John Doe`,
  `192.168.1.10`, `@example.com`. Generic fixture names only.
- **Disclose AI assistance** in commits and pull requests. Conventional Commits.
