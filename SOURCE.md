# Where the screens come from

`web/` is Endora's console at `RusticPotatos/Endora` commit
`98e3c127ae4f` (branch `feat/core-console-contract`) (`app/node/src/web`, the map-first HQ), copied
unchanged, with two files left out and one added:

- left out: `49-sound.js` and `49b-sound-live.js` (speakers and live sound), which are Endora
  Audio's own page.
- kept, with its music player replaced: `45-lab.js` (the home lab, media and smart home, through
  the contract's home area). Music is played from the Spotify app (the owner, MU1 = b); Console's
  Music screen shows Audio's status and links to it.
- added: `web/js/48-console.js`, Console's own part (see its header).

`scripts/check-console.mjs` is Endora's check at the same commit, with the blocks for the
screens left out removed, its paths pointed at `web/`, its request check held to the Core
contract instead of the node's router, and Console's own block added.

Until the cutover, HQ screen changes land in Endora first and are copied here (the screen
freeze). To copy them: replace the files under `web/` (but `48-console.js`), run
`node scripts/check-console.mjs`, and record the new commit above.

## For Endora's ADR 0145, to apply there later

The owner decided MU1 on 7 Nov, after ADR 0145 was written on Endora's step-2 branch. Its
Music row in "Where each owner function goes" changes from "Needs owner decision …" to:

> | Music | now playing; play, pause, next, previous; like; volume; choose a device; play on the Endora receiver; search; play a find or a playlist; discover | **The Spotify app** (owner, MU1 = b, 7 Nov; council of 3 unanimous): Spotify Connect already sees Endora's receiver, and Console's Music shows Audio's status and a plain link to open the Spotify app. Console makes no Spotify call and never holds the token. **Parked, recorded as such:** a Console music panel later, only if missed, controlling playback only through Audio's authorized API, with the Spotify token staying in Audio; Console never holds the token. |

and the sentence above the table, "one has no destination yet and waits for the owner", in
decision 6 becomes "each has a destination".
