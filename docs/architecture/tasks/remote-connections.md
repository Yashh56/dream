# Dream remote connections implementation plan

Build remote access around the existing Host, Host catalog and Chat run owners.
The first release should let a phone browser pair with a Dream host over
Tailscale, read chats, submit work, answer approvals and recover after suspension.
Then add unattended hosting, multiple routes, managed cloud access, native mobile
clients and a browser that runs on the host.

Status: CONN-01 and CONN-02 implemented; CONN-03 through CONN-11 proposed. Task numbers
below resolve to CONN-01 through CONN-11.

## Delivery order

| Milestone | Tasks | User-visible completion |
| --- | --- | --- |
| 1 Phone browser over Tailscale | 01–05 | Pair from a QR code, work from a phone, reconnect and revoke that phone |
| 2 Reliable unattended access | 06–07 | Keep the host running without its desktop window; reach one host through several routes |
| 3 Dream Connect | 08 | Sign in and reach linked hosts without installing a VPN |
| 4 Native mobile | 09–10 | Install a mobile app and receive notifications while it is suspended |
| 5 Remote browser parity | 11 | Use and observe the host's browser from any client, including while desktop is closed |

Dependency order: 01 → 02 → 03 → 04 → 05. Task 06 follows 03 and 04;
07 follows 05; 08 follows 06 and 07; 09 follows 07; 10 follows 08 and 09;
11 follows 02, 03 and 06. Native mobile UI and the host browser can be developed
independently of the cloud service once their prerequisites are complete.

Ship milestone 1 before taking on cloud operations. It requires no Dream account
or cloud backend. Initially the desktop-hosted machine must keep Dream running;
an existing standalone daemon can also serve the client. Its current idle timeout
must be disabled explicitly for unattended use until task 06 owns that policy.

## Architecture decisions

- Retain HTTP JSON routes, the AI SDK chat stream, host socket channels, the
  scheduler and the single SQLite writer. This is an access and client-lifecycle
  change, not a replacement execution model.
- Give every host installation a durable identity. A client's saved connection
  points to that identity and contains routes; a route is a URL or an SSH launch
  configuration. Tailscale is a way to reach a host, not a separate host type.
- Keep projects, chats, transcripts, provider credentials and execution on the
  host. Keep open tabs, layout, drafts, saved connections and UI preferences in
  each client's workspace. Do not synchronize desktop layouts onto phones.
- Keep the shared connection runtime free of Electron, React and browser globals.
  Inject storage, credentials, network transport and lifecycle signals. Desktop
  owns SSH processes; browser and native clients do not need an SSH implementation.
- Serve the first web client and its API from one HTTPS origin through Tailscale
  Serve. This avoids a hosted HTTPS client depending on a plain HTTP LAN API.
  Tailscale documents Serve as a tailnet reverse proxy with HTTPS support;
  Dream still performs its own pairing and authorization.
  [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- Use a separate remote-facing listener/router with an explicit route policy.
  A tunnel must not expose desktop bootstrap credentials, internal MCP endpoints
  or the desktop's arbitrary SSH proxy routes. Both listeners call the same
  host services; they do not create another catalog or scheduler.
- Target personal-device access first. Pairing grants control of the host under
  its OS user; team tenancy and project-level isolation are separate work. Define
  session scopes now so view-only access and management privileges are explicit.
- Preserve existing SSH connections during migration. Add direct routes first,
  migrate desktop SSH onto the shared runtime, then retire redundant routing.

The model follows T3's separation of identity, reachability and process ownership,
as described in its pinned
[remote architecture](https://github.com/pingdotgg/t3code/blob/9077e818d836ec6e9cc373d7469034cccc593a5a/docs/internals/remote.md).
The milestones below are Dream's proposed implementation, not claims that every
feature in that source is available in a released T3 client.

## CONN-01: Persistent host identity and connection records

Status: implemented (desktop UI walkthrough pending; see Validation)

Problem and trigger: `local` and SSH configuration IDs currently identify routing
choices. The same host added through Tailscale would otherwise appear as another
host, and reconnecting to a reassigned address could target the wrong machine.

Scope: add `electron/host/identity.js` and a public, minimal host descriptor.
Extend `electron/host/protocol.js`, `src/types/ide.ts` and the persisted-state
codec with versioned saved connection/route records. Keep identity stable in the
host data directory across restarts and runtime upgrades. Include a public-key
fingerprint for authenticated identity verification as later routes require it.

Record the distinction between persistent host ID, client connection ID, route
ID, client device ID and authenticated session ID. Preserve current project/chat
IDs; resolve them within a host and audit caches for collisions across catalogs.
Maintain a mapping from legacy `local`/SSH IDs to persistent host IDs rather than
rewriting all rows during startup. Migrate an offline SSH record only after its
first verified connection. Changing a route must never silently change its host.

Completion criteria:

- Restart, runtime upgrade and endpoint change preserve the host identity.
- Concurrent initialization publishes one complete identity; separate data
  directories have separate identities.
- A legacy workspace opens with the same projects and chats. Pairing its host
  through another route does not duplicate those projects.
- A descriptor exposes identity and compatibility, not filesystem paths or
  credentials. An ID match alone is not treated as cryptographic authentication.
- An incompatible protocol produces an actionable error before catalog loading.

Agreed scope (as implemented):

- `electron/host/identity.js` creates `host-identity.json` (0600) in the host
  data directory: `host_<uuid>` plus an Ed25519 key pair. It is published with
  a hard link of a complete temporary file, or an exclusive create where links
  are unsupported, and is never replaced. An unreadable or tampered file stops
  the host with instructions; it is never silently regenerated.
- `createHost` exposes `getHostDescriptor()` (ID, `SHA256:` fingerprint,
  public key, protocol, capabilities, version). `/api/host-info`, daemon
  `ensure`/`status` and the host record name the ID. `/api/catalog` lists the
  descriptor as `host`. Protocol capability `host-identity` was added without
  a protocol version bump. `hostProtocolProblem` in `protocol.js` produces the
  actionable incompatibility message for SSH and for catalog acceptance.
- Saved connections are `hostConnections`, a codec plain persisted field
  (versioned `SavedHostConnection` records with `local`/`ssh` routes;
  `electron/shared/host-connections.js`). Connection IDs remain the legacy
  `local`/SSH IDs, so no workspace, project or chat row is rewritten.
- Before a catalog is applied, `host-catalog-lifecycle.ts` accepts its
  descriptor. A first verified load saves the connection. A saved connection
  that reaches another host, or a host that stops identifying itself, is
  refused, and so is a second connection to an already saved host, an
  incompatible protocol, or project/chat IDs that collide with another host's
  (copied data). A refusal disconnects that SSH host with the reason. The local
  route records rather than refuses. The local identity is recorded after
  hydration, so it is saved.
- The SSH connection pins the expected identity passed from the saved record,
  or the first host it reaches. A different host on connect or reconnect is a
  fatal error, so a reassigned address is never retried into the wrong host.
  Removing an SSH host forgets its saved connection; editing its target keeps
  the pinned identity.

Validation (2026-10-18): `pnpm typecheck`, `pnpm lint` and `pnpm test` (173
files, 1197 passed, 4 skipped) pass. Existing tests updated for the new field
and contract: codec plain-field samples (now compared deeply), save-scheduler
and workspace-save fixtures, the desktop-handler connect payload, the
host-actions connect payload and the daemon capabilities. No new tests were
added. Ad hoc scratch programs outside the checkout passed:
- Eight concurrent processes initializing one directory published one ID.
  Restart reread it; a separate directory got a new ID. A tampered key was
  refused and left in place.
- Acceptance covered: legacy host without identity (still routes, unsaved),
  first verification, repeat, wrong host, same ID with another key, a saved
  host that stops identifying itself, a duplicate SSH connection, an SSH
  connection reaching the local host, protocol 2, and local re-recording.
  The codec dropped unknown record versions and duplicate host IDs.
  Colliding fixture IDs across two catalogs were found; a host's own snapshot
  IDs were not.
- A real daemon (restarted) kept its ID. Its catalog descriptor contained no
  path, PID or token.
- The SSH connection with fake ssh and a real daemon: a reconnect to a daemon
  whose identity changed failed fatally without retry, an expected identity
  refused the other host up front, and a fresh connection accepted it.

Not yet inspected: the running desktop app with copies of real local and SSH
workspaces (Electron main must be restarted to load the host change), and an
SSH host on a real remote machine.

Remaining/deferred: device authorization is CONN-02; route selection,
cryptographic proof of identity over routes that cannot vouch for the host,
and merging several routes into one connection are CONN-07. Unauthenticated
descriptor access belongs to CONN-02's remote route policy.

## CONN-02: Pairing and revocable device sessions

Status: implemented (desktop pairing UI and CLI are CONN-05; see Validation)

Problem and trigger: the current launch token and one-time socket tickets do not
provide independent device credentials, session management or remote permissions.

Scope: add `electron/host/auth/` for pairing challenges, session storage and
authorization; integrate with `electron/api/app.js`, shared socket tickets and
socket connection ownership. Store records through the existing writer.
Retain desktop bootstrap as a local-only mechanism.

Use expiring, single-use pairing links/QR codes minted by a locally authorized
operator. Carry the secret in a URL fragment and remove it after exchange;
provide a rate-limited short-code alternative with host-side confirmation.
The grant names its scopes and device. Start with view, operate and manage;
only an authorized manager can pair or revoke other clients.

For the same-origin web client, prefer an HttpOnly Secure session cookie and
origin/CSRF enforcement. Native clients use credentials in OS secure storage.
Store token verifiers rather than plaintext bearer secrets on the host. Bind
socket tickets to sessions and recheck revocation when the ticket is redeemed.
Define expiry and renewal in the contract; renewal must not replace a healthy
stream. Ordinary workspace exports must contain no session secrets.

Completion criteria:

- Used, expired and brute-forced pairing attempts fail without granting access.
- Two phones receive independent sessions; revoking one closes its active
  sockets/streams and blocks renewal without stopping the other phone or host work.
- Every remotely exposed HTTP route and socket channel enforces its scope,
  including terminals, approvals, files, provider settings and browser tools.
- Remote clients cannot obtain the local launch token or reach internal
  orchestration MCP, desktop SSH proxy or management routes without authorization.
- Origin, Host and trusted-proxy handling is explicit; secrets are excluded from
  URLs sent to servers, diagnostics and logs. View-only sessions cannot mutate.

Validation: pending; inspect the full route/channel inventory and manually
exercise invalid pairing, expiry, CSRF, ticket replay and live revocation.
Run existing token, socket-ticket, proxy and approval checks.

Agreed scope (as implemented):

- `electron/host/auth/`:
  - `scopes.js` defines the ladder: view < operate < manage.
  - `host-auth.js` owns pairings and code claims (in memory), device
    sessions (in memory, plus the `device_sessions` table through the save
    queue's `device-session` write and the read pool's `device-sessions`
    read), authentication, renewal, revocation and live socket/stream
    tracking.
  - `route-policy.js` assigns a scope to each served route and each socket
    message, and lists the local-only routes.
  - Migration `0007` adds the table.
- The pairing, session and expiry contract is in the header of
  `host-auth.js`:
  - A pairing expires after 10 minutes and works once. The link carries
    `#pair=<id>.<secret>` in the fragment.
  - The short code is 8 Crockford characters, limited to 10 claims a minute
    host-wide, and needs operator confirmation by device name before the
    device's poll receives the session once.
  - Wrong secrets are limited to 30 a minute.
  - Tokens are `dsess.<id>.<secret>`; only sha256(secret) is stored.
  - A session expires after 30 idle days. A use after an hour extends it
    (and is written down). `POST /api/remote/session/renew` extends it
    without changing the credential, so streams and sockets continue.
    Revocation is immediate.
- `electron/api/app.js` now registers routes once for both listeners
  (`registerHostRoutes`, `serveApp`). On the local listener the launch token
  is the `local` principal with every scope.
- `electron/api/remote-app.js` is the remote listener:
  - Host allowlist from the public origins; `trustForwardedHost` is the
    explicit trusted-proxy switch.
  - Foreign Origin and cross-site fetch metadata are refused.
  - Bearer token or `__Host-dream-session` cookie (HttpOnly, Secure,
    SameSite=Strict). A cookie-carried request other than GET must send a
    matching Origin.
  - Route policy check: unlisted routes return 404, too-low scopes 403, and
    startup asserts every registered route is classified.
  - Response bodies close on revocation, which detaches the observer only.
- Local-only, never registered remotely: `host-info`, orchestration MCP,
  browser MCP, `browser-tools/call` and the `/api/hosts/:hostId/*` SSH proxy.
  On the host socket, the browser channel (including its resume
  announcement) is local-only. Terminal input and resize need operate;
  following terminals and catalog changes needs view.
- Socket tickets are bound to the requesting principal. Redemption rechecks
  the session, and revocation closes the socket with code 4401.
- Remote-access routes (`electron/api/remote-access-routes.js`):
  - Public: `GET /api/remote/descriptor`, `POST /api/remote/pair`,
    `/pair/code`, `/pair/claim`.
  - Session: `GET /api/remote/session`, `POST .../session/renew`,
    `.../session/end`.
  - Manage: `POST /api/remote/pairings`, `/claims`, `/claims/answer`,
    `/sessions`, `/sessions/revoke`. These are also served on the local
    listener for the local operator.
  - A web client receives only the cookie; a native client receives its
    token in the body.
- `createHost` exposes `listenRemote` and `closeRemote`. The daemon gained
  `--remote-port`, `--remote-origin` (repeatable) and
  `--trust-forwarded-host` so the listener can be exercised; the record and
  status include `remotePort`.

Validation (2026-10-18): `pnpm typecheck`, `pnpm lint` and `pnpm test` (173
files, 1197 passed, 4 skipped) pass. Existing tests updated: the socket
ticket test (redeem now returns the principal) and two migration-rewind
tests (they drop the new table). No new tests were added. Ad hoc scratch
programs outside the checkout passed:
- A real daemon with its remote listener passed 50 checks:
  - The descriptor is public; requests without a session, or with only the
    launch token, are refused.
  - All five local-only routes return 404.
  - Pairing: link exchange; replayed and forged secrets refused; secret only
    in URL fragments; web pairing sets the hardened cookie and returns no
    token.
  - CSRF and Host: cookie POST without Origin or from a foreign Origin
    refused; cross-site metadata refused; unknown Host refused with 421.
  - Scopes: view refused for catalog changes, chat submit, approvals,
    terminal start, commit, checkpoint restore, pairing and device listing;
    pull-request reads allowed and merges refused; operate refused for CLI
    upgrade.
  - Code flow: pending, then confirmed by name, then delivered once; code
    guessing limited.
  - Two phones' sockets: ticket replay refused; revoking one closed its
    socket (4401), blocked its requests, renewal and new tickets, and left
    the other phone's socket, requests and renewal working.
  - No token or pairing secret in the database or host log. A session and a
    revocation both survived a daemon restart. Self sign-out works.
- With a fake clock: expired pairing link and code; expired idle session and
  its renewal refused; sliding extension written down; tampered tokens
  refused; operate cannot mint manage; secret guessing limited. Socket
  scopes: view cannot type into terminals, and no remote client can run or
  announce the browser channel. Revoking a session ended its open stream
  with an error and cancelled only the observer.

- The local host built as Electron main builds it (a shared save queue
  behind main's writer adapter) starts without warnings. A pairing made on it
  is written through the shared queue, and the new session reads the catalog.
  The first desktop start failed because `electron/main.js`'s adapter lacked
  `writeDeviceSession`. That is fixed, and a failed session load no longer
  stops the local host.

Not yet inspected: a real browser over HTTPS, since the cookie path is
validated with Node fetch (CONN-04/05), and a desktop-hosted remote listener
(the desktop does not start one until CONN-05's settings).

Known limit, recorded rather than fixed: pairing grants the host's OS user.
View sessions read files by path, without project isolation, so they can
read files such as a daemon's `host.json` that contains its launch token.
That token is useless through the remote listener, which ignores it.
Project-level isolation is outside this plan.

Remaining/deferred: pairing and session UI, QR codes and CLI commands are
CONN-05. Serving the web client's pairing page at `/pair` is CONN-04.
Cloud-bound proof credentials are CONN-08. Team isolation and arbitrary
project-specific grants are outside this plan.

## CONN-03: Shared connection runtime and platform services

Status: proposed

Problem and trigger: API authorization, socket URLs, workspace loading and SSH
actions currently assume `window.dream` and a local same-origin API.

Scope: introduce `src/lib/connections/` with one connection supervisor per host
and narrow platform ports for workspace storage, credentials, lifecycle and SSH
launching. Route `api-client.ts`, `api-session.ts`, `host-routing.ts`,
`host-socket.ts`, chat streaming and raw file/attachment fetches through it.
Adapt `ide-store-persistence.ts` to a workspace storage interface: current IPC
on desktop, IndexedDB in web. Keep the codec and workspace change-set rules.
Avoid implementing a fake desktop bridge in the browser.

Completion criteria:

- Every host request uses that host's endpoint and credentials, including
  downloads and streams; credentials never attach to unrelated URLs or redirects.
- Booting without Electron loads a paired host and a client-local workspace.
  Desktop startup and SSH access retain existing behavior.
- State distinguishes connecting, ready, reconnecting, unauthorized,
  incompatible and offline; catalog freshness is tracked separately.
- Foregrounding probes or replaces a stale connection, then resumes channel
  cursors or refetches after reset. Old connections cannot overwrite new state.
- Ambiguous chat submissions reuse existing durable request IDs. Other writes,
  approvals and buffered terminal input are not blindly replayed on reconnect.
- Removing a connection clears its credentials and local caches; a temporary
  disconnect preserves drafts and readable cached data.

Validation: pending; run existing host socket, routing, catalog-sync, transcript
and scheduler checks; inspect a dropped stream and delayed response during
connection replacement. Include two clients editing the same host catalog.

Remaining/deferred: ordered route failover is CONN-07. Keep the runtime in the
current tree initially; package it for native use in CONN-09 if needed.

## CONN-04: Browser client and phone layout

Status: proposed

Problem and trigger: a reachable API alone cannot provide a usable client on a
phone, and workspace startup currently requires Electron IPC.

Scope: reuse the React application with a browser entry and responsive navigation.
Add a static asset handler to the remote listener and include the client build
in host archives via `scripts/build-host-runtime.mjs`. Adapt desktop-only
clipboard, dialogs, uploads, downloads and external links through platform
services. Keep desktop settings out of browser flows.

The first mobile layout offers host/project navigation, one active chat, readable
history, composer attachments, queue/Stop controls, approvals, file reading and
diff inspection. Opening an existing project or selecting a host directory uses
the host directory API, not the phone's filesystem picker.

Completion criteria:

- A clean browser profile can pair and complete that workflow without Electron.
- At 360px width, keyboard appearance and safe areas do not hide the composer
  or approval controls; desktop and tablet layouts remain usable.
- Phone and desktop see the same host changes while keeping separate layout and
  drafts. Simultaneous approval responses produce one accepted decision.
- Suspending the browser during a turn, then returning, restores current state
  without resubmitting work. Interrupted host runs retain existing explicit-resume
  behavior rather than appearing to continue.
- Static routes cannot serve arbitrary host files; cached assets remain compatible
  with the host protocol. Initial delivery does not cache authenticated API data
  in a service worker.

Validation: pending; inspect the running development app and built assets on
iOS Safari, Android Chrome and desktop browsers. Follow the development-tools
guide for UI inspection; do not start a dev server.

Remaining/deferred: native push is CONN-10; streamed browser control is CONN-11.
Full phone terminal/editor ergonomics follow in the native client milestone.

## CONN-05: Tailscale and direct access setup

Status: proposed

Problem and trigger: the host listens on loopback and exposes no shareable
client URL or pairing flow.

Scope: add Connections settings and headless CLI commands for exposure status,
pairing and session revocation. Introduce a stable configurable remote listener
port, bound to loopback by default, serving the client and the authorized API.
Use Tailscale Serve to terminate HTTPS and forward to that listener. Show
installation/sign-in/HTTPS prerequisites and the exact setup action; inspect
existing Serve configuration before changing it. Do not overwrite unrelated
services. Stop only exposure that Dream owns.

Support manually supplied HTTPS reverse-proxy endpoints with the same protocol.
An optional LAN listener must be explicitly enabled; first-release phone pairing
requires HTTPS. Do not advertise `127.0.0.1` as a route for another device.

Completion criteria:

- The user gets a reachable HTTPS pairing URL/QR code and can complete milestone
  1 from a phone on the same tailnet, including over cellular networking.
- Missing Tailscale, unavailable HTTPS, port conflicts and denied tailnet access
  have distinct setup messages; no unreachable address is reported as ready.
- Disabling exposure removes remote reachability while local desktop work
  continues; pairing remains required even for a reachable tailnet peer.
- The same packaged host serves UI, HTTP, streaming responses and WebSockets
  through the configured reverse proxy without buffering chat output.

Validation: pending; record a phone-to-desktop and phone-to-daemon walkthrough,
including revocation and reconnect. Inspect proxy configuration and stream behavior.

Remaining/deferred: automatic LAN discovery and route preference are CONN-07;
public managed tunnels are CONN-08.

## CONN-06: Host lifecycle independent of the desktop

Status: proposed

Problem and trigger: local host work ends when Electron quits; the existing SSH
daemon is detached but is not an installed startup service.

Scope: extend `electron/host/daemon.js` with install/start/status/restart/uninstall
service operations and platform adapters. Target Windows, macOS and Linux with
their respective user startup mechanisms; document login/boot guarantees per
platform. Add explicit foreground, desktop-owned and service-owned modes.
Let desktop attach to the service host. Preserve host identity and catalog when
moving an existing desktop installation into service mode.

Resolve storage ownership before handoff: the desktop workspace and local host
currently share a database writer. Separate the client workspace database from
the host catalog through an offline, backed-up migration, then enforce one host
writer/process per data directory. Preserve provider environment, credentials
and CLI PATH when the service starts outside an interactive shell.

Completion criteria:

- Closing desktop leaves service-hosted turns and terminals running; reconnecting
  reaches the same identity and catalog. Uninstall keeps user data.
- A reboot/login starts the host according to the documented platform behavior;
  status gives the active version, port and useful failure/log information.
- Two launchers cannot create competing writers. Migration interruption is
  recoverable without duplicate catalogs or silently lost workspace settings.
- Service mode stays available while idle. Explicit restart/update reports
  interruption and preserves durable queue recovery rules.
- Update installs are staged, verified and recoverable; a failed startup can
  return to a compatible previous binary without reversing incompatible data
  migrations. Compatibility requirements are checked before replacement.

Validation: pending; exercise install, desktop attach, quit, restart, update and
uninstall on each supported OS using copies of existing desktop data.

Remaining/deferred: sleeping hardware is unreachable; wake-on-LAN is not included.

## CONN-07: Multiple routes and unified connection management

Status: proposed

Problem and trigger: one host should remain the same host when a client changes
network or switches between SSH, Tailscale, LAN and managed access.

Scope: extend the shared supervisor with ordered routes, bounded attempts,
backoff and cancellation. Move desktop SSH forwarding behind its platform
adapter, reusing `electron/ssh/` installation, prompts and reconnection code.
Keep process ownership separate from connection ownership.

Completion criteria:

- A host has one entry with editable routes, current route and useful failure
  reasons. Adding the same authenticated host merges its routes.
- Failure advances to another compatible route; a healthy fallback is replaced
  only after a preferred route passes authorization and readiness checks.
  Cooldowns prevent repeated switching between unstable routes.
- Wrong-host descriptors receive no credentials. Identity verification and TLS
  policy prevent trusting a copied descriptor as proof; learned endpoints cannot
  downgrade HTTPS credentials onto an insecure route.
- Changing Wi-Fi/cellular, losing a VPN and restoring SSH preserve drafts and
  host state. Protocol incompatibility and revoked grants are not endless retries.
- Removing an SSH route stops its forward, without stopping a shared service.
  Desktop can run with only remote hosts and no local execution host.

Validation: pending; inspect route loss/recovery, a reassigned LAN address,
revocation on a fallback route and SSH authentication cancellation.

Remaining/deferred: the managed route provider arrives in CONN-08.

## CONN-08: Dream Connect cloud discovery and managed tunnels

Status: proposed

Problem and trigger: VPN-free access requires account discovery and a managed
reachable endpoint, plus a lifecycle for linking and unlinking hosts.

Scope: introduce a separately deployed Connect control service and
`electron/host/connect/` connector. Use account authentication, a device-code
CLI flow, user-to-host links, host signing identity and tunnel allocations.
Provision managed HTTPS tunnels through a provider adapter. Cloudflare is a
candidate matching the earlier T3 comparison; select the provider and identity
vendor after checking operational constraints and current pricing.

The control service discovers hosts and brokers short-lived, one-time bootstrap
credentials bound to a client proof key. The host exchanges them for its own
session. Sign and nonce-bind host/broker exchanges, including the host identity,
user, requested scopes and client proof key. Keep host session credentials out
of the broker. The broker remains a trusted minting authority; this is not an
end-to-end encryption claim. Application traffic uses the tunnel endpoint.

Completion criteria:

- Sign in on host and phone, link the host, then connect from a network without
  Tailscale. A signed-in account without an active host link cannot obtain access.
- Expired/replayed bootstrap proofs, wrong-host responses, malicious endpoint
  hints and redirects cannot mint a usable session or turn the broker into an
  arbitrary HTTP proxy.
- Unlink revokes cloud-derived authorization before external cleanup. Directly
  paired sessions remain independently manageable. Logout does not delete host data.
- Provisioning is idempotent and records partial progress. Shutdown, sleep,
  restart and concurrent unlink cannot delete a newer tunnel allocation.
- Quotas, bounded retries, allocation reconciliation, rate limits, redacted
  diagnostics and tunnel failure alerts exist before public rollout.
- Pilot records tunnel usage and operating cost; it can disable managed exposure
  while retaining local/SSH/Tailscale access. Recovery instructions are usable
  from a headless host.

Validation: pending; use an isolated deployment for link/unlink, account changes,
tunnel loss and recovery, proof replay and provisioning failure scenarios.

Remaining/deferred: team sharing, billing and automation webhook buffering are
separate products; they are not prerequisites for connection parity.

## CONN-09: Native mobile clients

Status: proposed

Problem and trigger: a responsive browser supplies early access, but native
pairing, credential storage, lifecycle and phone interaction need platform UI.

Scope: add a mobile application, with React Native/Expo as the initial candidate.
Share connection contracts, runtime, transcript/domain logic and authorization;
implement native screens instead of assuming React DOM components are portable.
Prove streaming, secure storage and lifecycle support in a small vertical slice
before committing to the framework. Add QR/deep-link pairing, host switching,
chat and queue controls, approvals, attachments, files/diffs and terminal access.

Completion criteria:

- iOS and Android pair directly or sign into Connect and load the same catalog.
  Direct pairing remains usable without a cloud account.
- Credentials use platform secure storage. Deep links validate their destination
  and never transmit pairing secrets to an unrelated origin.
- Background/foreground and network changes recover current state and drafts;
  no persistent background socket is required for correctness.
- Core tasks work with touch, keyboard, screen readers and large text. A terminal
  input action is never duplicated after reconnect.
- Install, upgrade and signed release delivery are documented for both platforms.

Validation: pending; complete the milestone-1 workflow on physical iOS and
Android devices, then exercise long suspension and app termination.

Remaining/deferred: notifications are CONN-10; host browser control is CONN-11.

## CONN-10: Host notifications and mobile push

Status: proposed

Problem and trigger: current desktop activity notifications depend on a live
renderer; suspended mobile clients need host-originated delivery.

Scope: publish finished/failed/waiting events from host run and approval owners
into a durable outbox. Add registered device destinations and an authenticated
push delivery service, reusing Connect infrastructure. Deliver through platform
push services or a selected provider; deduplicate by host, event and destination.

Completion criteria:

- A suspended app receives completion and approval notifications; tapping one
  opens the correct host/chat and checks current state before showing an action.
- Retry, host restart and duplicate delivery do not produce duplicate logical
  events. Revoked devices/account links receive no new notifications.
- Push payloads omit prompts, secrets and file contents by default. Preferences,
  invalid push tokens and retention are handled explicitly.
- A notification cannot authorize an approval by itself; the app obtains a valid
  host session and verifies the approval is still pending.

Validation: pending; inspect physical-device delivery while suspended, stale
approval taps, offline host recovery and device revocation.

Remaining/deferred: browser Web Push can reuse this event pipeline; native push
is the completion target for this candidate.

## CONN-11: Host browser and remote control

Status: proposed

Problem and trigger: Dream currently lends the desktop window's browser to a
remote host. Phone-only agents need a browser owned by the execution host.

Scope: add a host-owned Chromium service with persistent tab identities,
per-project storage, agent automation and streamed viewing/input. Adapt
`electron/browser-sessions.js`, `electron/api/browser-bridge.js`, browser tools
and `host-browser-watch.ts` behind one browser service contract. Move remote
execution to the host and retain desktop rendering as an adapter where useful.
Select frame transport after measuring a thin end-to-end implementation; do not
couple the API contract to that first transport.

Completion criteria:

- An agent can browse with no desktop client connected; `localhost` resolves on
  the project's host. Reconnecting clients see the same live tabs.
- Desktop, browser and native clients can view and take/release control without
  racing agent input. Viewing and control enforce separate permissions.
- Navigation, resizing, clipboard, uploads, downloads, popups and disconnect
  recovery work. Remote pages cannot access Dream auth through a shared origin.
- Chromium installation, sandbox prerequisites, process cleanup and resource
  limits are managed on supported hosts. A failed browser does not kill chat work.
- Record input latency, bandwidth and CPU for phone and desktop over representative
  links; set explicit acceptance budgets before final transport selection.

Validation: pending; exercise a host-local development site, an upload/download,
an agent/client control handoff and reconnect on all three client surfaces.

Remaining/deferred: audio and picture-in-picture are follow-up items if required
for exact browser UX parity; this task covers shared browsing and control.

## Validation and release discipline

Each candidate starts with its recorded scope and finishes with evidence beside
that candidate. Run relevant existing checks, typecheck and lint for code
changes. Do not write new tests unless requested, and do not start a dev server.
Use the existing development instance for UI work. Device, service and cloud
checks that cannot run must remain explicit unmet criteria, not assumed passes.

The largest uncertainty in milestone 1 is removing desktop assumptions from
every request and persistence path. The largest later migrations are shared
database ownership in CONN-06 and browser ownership in CONN-11. CONN-08 adds an
operated service, while CONN-09 adds two release platforms. Estimate calendar
delivery after the first identity/auth/runtime slice; these are separate release
milestones rather than one feature-sized patch.

First implementation slice: CONN-01, followed by CONN-02. Establish identity and
authorization while the application remains desktop-compatible, then use those
contracts for the browser client. Keep each candidate independently reviewable.

Recovery: `docs/architecture/tasks/remote-connections.md`. CONN-01 and
CONN-02 implemented (desktop walkthrough and real-browser HTTPS checks
pending); CONN-03 through CONN-11 proposed, next is CONN-03. Preserve the user's no-new-tests and no-dev-server constraints; commits
and pushes require explicit confirmation.
