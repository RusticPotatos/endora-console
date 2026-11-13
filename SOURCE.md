# Where the screens come from

`web/` is Endora's console at `RusticPotatos/Endora` commit
`98e3c127ae4f` (branch `feat/core-console-contract`) (`app/node/src/web`, the map-first HQ), copied
with three small edits (below), two files left out and one added:

- left out: `49-sound.js` and `49b-sound-live.js` (speakers and live sound), which are Endora
  Audio's own page.
- kept, with its music player replaced: `45-lab.js` (the home lab, media and smart home, through
  the contract's home area). Music is played from the Spotify app (the owner, MU1 = b); Console's
  Music screen shows Audio's status and links to it.
- added: `web/js/48-console.js`, Console's own part (see its header).

`scripts/check-console.mjs` is Endora's check at the same commit, with the blocks for the
screens left out removed, its paths pointed at `web/`, its request check held to the Core
contract instead of the node's router, and Console's own block added.

Three edits to the copied files, so that every call a screen makes is a route in the contract
(the Director's ruling of 9 Nov; `test/ui-routes.test.mjs` holds them to it). Reapply them, or
make the same change in Endora, whenever the files are copied again:

- `47-hq.js`: HQ's event poll and the Activity log's older pages read `/v1/events` (was
  `/v1/hq/events`; same `{events: [{id, at, kind, data}]}`, and the poll's reply adds `cursor`,
  `gap`, `more`); a desk answer calls `consoleDecide` (48-console.js), which posts
  `/v1/decisions/{id}` (was `/v1/hq/desk/{id}` with `{decision, answer}`; now `{choice, words,
  request, channel}`).
- `10-core.js`: the `EventSource` on `/v1/activity/stream?token=` is removed; the live refresh is
  `subscribeToActivity` in 48-console.js (`/v1/events/stream`, signed in a header).
- `45-lab.js`: the music player is removed (the Spotify token borrow, the Spotify Web API calls,
  `/v1/sound` and the speaker wiring). Music is `viewMusic` in 48-console.js.

Until the cutover, HQ screen changes land in Endora first and are copied here (the screen
freeze). To copy them: replace the files under `web/` (but `48-console.js`), reapply the three
edits above, run `npm test` and `npm run check`, and record the new commit above.

## Ported ahead of the copy: the owner's acceptance (Core's ADR 0149)

Core's `feat/reviewed-completion` (commits `73610b7` and `a83116d`) adds `accept` and `send_back` on a
`ready_to_read` card, the closure `accepted_by_owner`, and a per-project `acceptance` policy. Its screen
change is hand-ported here to `web/js/47-hq.js` and `web/js/47f-hq-studio.js`, because the copied
screens predate it; a later copy from Endora replaces them with the same behavior. Beyond Core's own
change, Console also keeps an acceptance out of the "closed as met its criteria after a problem"
recovery sign, and names it apart from met criteria in the week's list. The contract is unchanged:
`docs/api/console-v1.json` is byte for byte what it was (only its prose, `console-v1.md`, grew), so
`contract/` is not re-pinned. The project form sends no `solo`, so it sends no `acceptance` either.

## Ported ahead of the copy: the runner-down chip (Core's runner visibility)

Core commit `49156bf` (branch `feat/runner-visibility`) makes HQ's snapshot (`GET /v1/hq`, already in
the contract) carry `runner: {state: up|stale|never, last_poll_secs, waiting}`, and its screen change is
hand-ported here to `web/js/47-hq.js`: `hqQuiet`, `hqRunnerChip` and one `chips.push(hqRunnerChip(s.runner))`
line in `hqChips`, with Core's check block in `scripts/check-console.mjs` ("The runner's state"). No
chip while the runner is up, says nothing or is null (an older HQ, the demo); a red chip, with how long,
when it is stale; `never` is quiet unless turns wait. Several runners share one token, so they count as
one (until they name themselves: the next section). The contract is unchanged, so `contract/` is not re-pinned. The next full copy from Endora carries
the same change and replaces these lines.

## Ported ahead of the copy: which runner went quiet (Core's `feat/runner-identity`)

Runners share one token, so each says its name and HQ's snapshot (`GET /v1/hq`, already in the
contract) now also carries `runners: [{name, state: up|stale, last_poll_secs}]`, the quietest first.
Hand-ported to `web/js/47-hq.js`: `hqRunnerChip(r, runners)` (one more argument in the
`chips.push(hqRunnerChip(s.runner, s.runners))` line of `hqChips`), with Core's check block in
`scripts/check-console.mjs` ("Which runner"). Any listed runner that is stale is a loud chip naming it
("Runner runner-a quiet for 5 min"; several: the first and "+N more"), even beside one that is up; all up is
quiet; with no `runners`, or one `unnamed` entry (an older runner), it reads `runner` exactly as above.
A runner stopped on purpose stays listed as stale until HQ restarts. The contract is unchanged, so
`contract/` is not re-pinned. The next full copy from Endora carries the same change and replaces
these lines.

## Ported ahead of the copy: the desk cards' clarity (Core's `feat/desk-card-clarity`)

Core commit `42588d5` makes two JS-only changes to `47-hq.js`, hand-ported here with its check blocks in
`scripts/check-console.mjs`: the `ready_to_read` card shows its task's done-criteria and what was cited
for each (`hqCriteriaBrief`, reusing the `task.evidence` the snapshot carries for open work, with
`HQ_STAGE` hoisted out of `hqEvidence`), and the `needs_owner` card's buttons read "I've set it" (`seen`)
and "Not needed" (`dismiss`), with its help line saying what each does. The decisions sent are unchanged
and the contract is not touched. The card's sentence from the node ("then mark this seen") is Core's
and is unchanged. The map's row budget in the density check went from 46 to 49 for the fixture's
criteria. Separately, and Console only (`server/app.mjs` has no Core counterpart): `originRefusal` makes
the 403 for a change from another address name the address the Console expects and the one the change
came from. The next full copy from Endora carries the `47-hq.js` change and replaces these lines.

## For Endora's ADR 0145, to apply there later

The owner decided MU1 on 7 Nov, after ADR 0145 was written on Endora's step-2 branch. Its
Music row in "Where each owner function goes" changes from "Needs owner decision …" to:

> | Music | now playing; play, pause, next, previous; like; volume; choose a device; play on the Endora receiver; search; play a find or a playlist; discover | **The Spotify app** (owner, MU1 = b, 7 Nov; council of 3 unanimous): Spotify Connect already sees Endora's receiver, and Console's Music shows Audio's status and a plain link to open the Spotify app. Console makes no Spotify call and never holds the token. **Parked, recorded as such:** a Console music panel later, only if missed, controlling playback only through Audio's authorized API, with the Spotify token staying in Audio; Console never holds the token. |

and the sentence above the table, "one has no destination yet and waits for the owner", in
decision 6 becomes "each has a destination".
