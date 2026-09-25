# Security

Relevant decision records:
- [000-initial-design.md](../decision-records/000-initial-design.md): §1.1, §1.3, §1.4, §5.1–5.7

## Trust boundaries

| Component | Trust |
|---|---|
| Harness server, harness UI | Trusted. Never runs runtime-agent-written code. |
| Runtime agent container: runtime agent, runner, build tools, static server | Untrusted. |
| Applet iframe: loader and applet | Untrusted, sandboxed, separate origin. The loader is protected from edits, but runs in the same realm as the applet. |

## Where runtime agent code runs

**Code written by the runtime agent runs only in the runtime agent container or the sandboxed applet iframe, never in the harness**. This is the main rule behind G5. It covers building, serving, typechecking, migrations and state transformers. The harness handles only data: chat, state, patches and pointers.

`migrate` and state transformers run in the runtime agent container. There is exactly one migrator, so there's no multi-tab race.

## Runtime agent container

- Non-root user, `--cap-drop ALL`, `no-new-privileges`.
- Memory, CPU and process-count limits.
- Never mount the Docker socket.
- **Protected files** (`vite.config.ts`, the loader, `@harness/state`) are root-owned and read-only to the runtime agent's user. Vite runs the config as trusted code, and the loader is how the harness recovers without the runtime agent (G7).
- Writable: `work/`, `dist/`, `~/.claude`, the Vite cache.
- Permission mode: `bypassPermissions`, plus the guardrail below.
- **Disposable:** durable things (`work/` and its git history, Claude Code session transcripts under `~/.claude`) live on a volume. The harness can recreate the container and resume the SDK session. Accepted consequence: in dev, the applet is briefly unavailable while the runtime agent container restarts, because the container also serves the applet.

Later: a read-only root filesystem.

## Network and egress

- The runtime agent container is only on an **internal Docker network**, with no internet. It can reach only the harness.
- The harness proxies the Anthropic API and **adds the API key**, so the runtime agent container never holds it.
- The harness reverse-proxies the runtime agent container's static applet server on a separate port. That gives the iframe its own origin.

### Egress

MVP: **none.** Packages are preinstalled (see [code versions](code-versions.md#applet-code-conventions)).

Later (e.g. `npm install`): an **egress proxy service** (e.g. Squid) on both networks, with a domain allowlist starting with `registry.npmjs.org`. The runtime agent container reaches it via `HTTPS_PROXY` and npm's `registry` setting. Possibly add a registry mirror (e.g. Verdaccio) to cache or vet packages.

## Applet iframe

- `sandbox="allow-scripts allow-same-origin allow-forms"`. This is safe **only because** the applet's origin (a separate port) differs from the harness's. It must stay that way.
- CSP `connect-src 'self'`: **no network access for applets**. The applet talks only to its own static server, and to the parent via `postMessage`.
- The iframe holds no credentials, and syncs only the active state doc through the parent. The parent's `shareConfig` enforces this; it doesn't rely only on unguessable IDs (see [state](state.md#documents)).
- **Enforce at the channel.** Code in one JS realm can't be reliably locked down, so in-iframe APIs are conveniences. The iframe's power is whatever the parent grants over the port.

Post-MVP: applet network access through a harness-controlled proxy, with an allowlist the user manages in harness settings.

## Keeping the runtime agent in `work/`

The runtime agent shares a filesystem and user with `dist/`, git history and the runner. It could write into `dist/` directly and skip typechecking and migration. The threat is mostly mistakes, or a prompt-injected runtime agent; either way, the damage stays inside the runtime agent container and the iframe.

- MVP: the runtime instructions, plus a Claude Code **`PreToolUse` hook** that blocks Edit/Write outside `work/`. A guardrail, not a wall: Bash can get around it.
- Later (real enforcement):
  - A separate **serve container** that builds and serves `dist/` and runs `tsc`/`migrate` on publish. It mounts `work/` read-only; the runtime agent container mounts only `work/`.
  - The harness keeps copies of published trees, source and build (data, not execution, so the rule above allows it). Full recovery = recreate the containers from images and restore from those copies (G7).

## Prompt injection

**Deferred for the MVP.** There's a single user, so the only injector is the user. The runtime agent has nowhere to exfiltrate to: no network, and no key. In place already:

- User content in `<applet-changes>` is framed as data (see [runtime agent](runtime-agent.md#message-encoding)).
- Chat lives in the harness UI, so it's the one channel where "the user said this" is certain (see [ux](ux.md#chat)).

Revisit when either of these lands: applet network access, npm egress.

## Open questions

- **Is chat more authoritative than in-applet text?** In the original project, text typed into applet text boxes and addressed to the runtime agent was treated like chat, and that worked well. Revisit with prompt injection.
