# Changelog

High-level release notes for VeloBenchmark. Minor bug fixes and small optimizations are grouped under
generic language where they aren't individually notable.

## v0.2.0 — Responsive UX, reports & exports, result validity, benchmarking rigor

A large feature release: eight workstreams (M1–M8) covering the whole tool.

### Concurrent correctness & cancellation (M1)
- Concurrent steps mirror single-stream semantics; **Stop is now an acknowledged end-to-end
  cancellation** (no more stranded workers or silent kills).
- **Fix premature FINISHED status** — run completion is owned by the orchestrator (loop end / stop /
  fatal error), not by workers going idle between barrier steps. Req steps now stop the run on worker
  failure like Image steps.
- Reports show honest concurrent identities and cancellation surfaced in the UI.

### Metric arithmetic & contracts (M2)
- Report metric arithmetic corrected: ratio, delta signs, provenance, and restored reasoning counts.
- **Chat:** reload mid-run resumes the live stream instead of killing it; Stop interrupts stalled
  streams. Server-driven mid-run resume — any tab re-attaches.

### Responsive shell & chat layout (M3)
- Compact rail, phone drawer, chat-first layout, report toolbar fixes.
- Copy-code works on plain-HTTP with visible success/failure feedback; loading states no longer read
  as empty.

### Workflow & discovery UX (M4)
- **Drafts:** unsaved tests and runner configs survive navigation and reloads.
- Sessions: search, honest counts, case-insensitive providers, distinct short ids.
- Test runs: request-based progress, named completion actions, run label on turns.

### Report structure & exports (M5)
- **Real paginated PDF**, CSV/JSON downloads, labeled scope, transcript transparency.
- Session detail carries prompt + answer text; health exposes the app version.
- Print styles: inter-panel text prints dark.

### Accessibility (M6)
- Named navigation, named charts, real controls, readable labels.

### Result validity assertions (M7)
- **Server-side assertions** — expected answer / regex judged by the engine, PASS/FAIL everywhere.
- Assertion inputs in the test editor; PASS/FAIL badges in reports and Runner.

### Benchmarking rigor (M8)
- Model readiness checks, repeated concurrent plans, comparison compatibility banner, model Check in
  Settings, repeats input in Runner.

### Backend / fixes
- **Proxy fix:** an explicit `temperature` on a model entry serialized twice — HTTP 422 on strict
  engines; now serialized once.
- **Exports:** CSV and JSON carry the session's title; unnamed sessions fall back to their run/test
  label in titles.
- Embedded frontend bundle rebuilt for the new UI.

## v0.1.1 — Per-step reasoning override, test framework improvements

- **Per-step reasoning override.** Each test step can now set its own reasoning effort
  (`''` inherit / `off` / an effort level). It's honored by the chat path and the concurrent runner,
  with a reasoning dropdown in the test editor for prompt and image steps and an `r:<effort>` badge in
  the step header.
- **Classification balance (Test functionality).** Every prompt now asks for ~300 tokens of its
  regime, keeping the regime split comparable across turns in a test.
- **JSON-mode fixes (Test functionality).** The lossy JSON wire form for test steps is fixed (now
  preserves `tg` / `depth` / `pp` / `image` / `prompt` / `reasoningEffort`). Minor bug fixes and
  optimizations.

## v0.1.0 — Initial release

A single-binary LLM benchmarking and live-stats console, used entirely from a browser.

- **Single binary.** The Angular frontend is compiled into the Rust server (`include_dir!`);
  deploy is copying one file.
- **Live instrumentation.** Streaming tok/s, TTFT, min/median/max, inter-token latency, prefill
  behaviour — computed server-side from the stream, snapping to the provider's `usage` counts.
- **Per-regime analytics.** Answers tagged by regime (prose, code, math, json, reasoning, …) as they
  stream; charts split by regime.
- **Test builder + runner.** Visual suites with five step types (sections, prompts, exact context
  fills, fixed-shape bench requests, vision), a concurrent runner with a step barrier, and
  side-by-side session comparisons. PNG/PDF export.
- **Built-in OTLP telemetry receiver.** `/v1/logs` and `/v1/metrics` from a serving engine rendered
  as live per-stream panels; off by default.
- **One-line installer** (`install.sh`) with a build-from-source fallback.
- Changelog and install docs live in this repository; the [user manual](docs/user-manual.md) covers
  every page.
