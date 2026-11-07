# Where the screens come from

`web/` is Endora's console at `RusticPotatos/Endora` commit
`98e3c127ae4f` (branch `feat/core-console-contract`) (`app/node/src/web`, the map-first HQ), copied
unchanged, with two files left out and one added:

- left out: `49-sound.js` and `49b-sound-live.js` (speakers and live sound), which are Endora
  Audio's own page.
- kept, with its music player replaced: `45-lab.js` (the home lab, media and smart home, through
  the contract's home area). The Spotify player needs the token that moves to Audio, and where
  it goes is waiting on the owner (Endora ADR 0145).
- added: `web/js/48-console.js`, Console's own part (see its header).

`scripts/check-console.mjs` is Endora's check at the same commit, with the blocks for the
screens left out removed, its paths pointed at `web/`, its request check held to the Core
contract instead of the node's router, and Console's own block added.

Until the cutover, HQ screen changes land in Endora first and are copied here (the screen
freeze). To copy them: replace the files under `web/` (but `48-console.js`), run
`node scripts/check-console.mjs`, and record the new commit above.
