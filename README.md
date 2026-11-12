# Endora Console

The screens for [Endora Core](https://github.com/RusticPotatos/Endora): the agents map and
your decisions, open work, projects and the team, health, activity, replays, money and models,
the home lab, media and smart home, and settings. Console is a window onto Core. It holds **no authority of its own**: you sign in
to Core, Core decides every request, and Console only passes on the routes in Core's published
contract.

- **What it may call:** [`contract/console-v1.json`](contract/console-v1.json), a pinned copy
  of Core's `docs/api/console-v1.json` (its commit and SHA-256 are in
  [`contract/SOURCE.json`](contract/SOURCE.json)). Anything else is refused here and never
  reaches Core. Console never calls Core's engine (HQ) directly.
- **Sign-in:** Core's own password and authenticator code. Console keeps no session and no
  credential; your session goes from the browser to Core in the request header.
- **Writes:** only from Console's own page (its origin), as JSON.
- **Endora Audio:** Speakers show Audio's status and a link to Audio's own page. Music is
  played from the Spotify app, which sees Endora's receiver through Spotify Connect; Console
  links to it and never calls Spotify or holds its token.

## Run it

You need a running Endora Core (its node), reachable from where Console runs.

```sh
curl -O https://raw.githubusercontent.com/RusticPotatos/endora-console/main/compose.yaml
CORE_URL=https://endora-node:8443 docker compose up -d
```

Then open `http://<this machine>:8080`. To serve HTTPS directly, put a certificate and key in
`./certs` and set `CONSOLE_TLS_CERT=/certs/cert.pem` and `CONSOLE_TLS_KEY=/certs/key.pem`.

| Variable | What it is |
|---|---|
| `CORE_URL` | Core's origin, such as `https://endora-node:8443` or `http://127.0.0.1:8443`. Required. |
| `CORE_CA_FILE` | Core's certificate, if Core uses its own self-signed one (`tls-cert.pem` beside Core's database), mounted under `/certs`. |
| `CORE_TLS_SERVERNAME` | A name on Core's certificate, when `CORE_URL` reaches it by another name. |
| `CONSOLE_ORIGIN` | The address people open (`https://console.example.com`), when a proxy in front changes it. Comma-separated for several. Without it, writes must come from the address Console is reached at. |
| `CONSOLE_TLS_CERT`, `CONSOLE_TLS_KEY` | Serve HTTPS with this certificate and key. |
| `AUDIO_URL` | Endora Audio's origin, for its status (optional). |
| `AUDIO_PUBLIC_URL` | The link to Audio's page that Console shows (optional). |
| `CONSOLE_PORT` | The host port (default 8080). |
| `CONSOLE_TAG` | The image tag (default `latest`; pin a `sha-…` tag in production). |

The page is served with a Content Security Policy: scripts, data and pictures from Console's
own origin only, the two typefaces from Google Fonts, no framing. It still allows inline scripts,
because six of the copied screens use inline event handlers; that goes when they are replaced
in Endora.

`GET /console/health` says Console is up and whether Core is reachable and speaks a contract
version this Console knows. A Core of another major version is refused with a plain message.

### One origin

Run Console where people already open Endora, in front of Core, so the browser keeps one
origin: your saved session stays valid, and Core can stay off the outside network, reachable
only by Console. Core keeps working with Console stopped (its built-in screens remain until the
cutover).

### Upgrade and roll back

Console keeps no data, so an upgrade is pulling a newer tag and `docker compose up -d`; a
rollback is setting `CONSOLE_TAG` to the previous `sha-…` tag. Core's contract is additive within
v1, so a newer Core works with an older Console. Back up Core, not Console.

### Publish the image

Nothing publishes the image automatically. A push to `main`, a `v*` tag or a pull request
builds and smoke-tests it (`.github/workflows/ci.yml`, job `image`) but never signs in to the
registry or writes a package. The `publish` job runs only when the owner starts the workflow
by hand (Actions → ci → Run workflow, from `main` or a `vX.Y.Z` tag) with `publish` ticked, and
only while the repository variable `ENDORA_CONSOLE_IMAGE_PUBLISH` is `enabled` (it is unset
until the owner sets it). It pushes `sha-<commit>`, and `X.Y.Z` from a version tag; it never
moves `latest`, so pin a `sha-…` tag. `npm test` runs `scripts/test-image-workflow.py`, which
checks these conditions against the workflow.

## Develop

Node 22, no dependencies.

```sh
npm test                               # the server, the allowlist and the proxy
node scripts/check-console.mjs         # every screen renders; every request is in the contract
node scripts/check-independence.mjs    # nothing of Core's source, nothing of HQ's
node scripts/check-nothing-personal.mjs --history
CORE_URL=http://127.0.0.1:18443 npm start
CORE_URL=http://127.0.0.1:18443 node scripts/e2e-against-core.mjs   # against a fresh Core
```

The screens in `web/` are Endora's console, copied (see [SOURCE.md](SOURCE.md)). Until the
cutover, screen changes are made in Endora and copied here; `web/js/48-console.js` is the one
file that is Console's own.

## License

Apache-2.0. The office art in `web/hq-art` carries its own credits and license.
