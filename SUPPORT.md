# Support

ActionManifest is an open-source project maintained by hello-ai-company.
Here is how to route your question or report.

## I found a bug

Open a [GitHub issue](https://github.com/hello-ai-company/ActionManifest/issues)
with:

- the package and version (`npm ls @actionmanifest/core` or
  `actionman --version`),
- Node.js version (`node --version`) and OS,
- a minimal reproduction (a small synthetic input document — **never** real
  personal data; see [docs/PUBLIC-BOUNDARY.md](docs/PUBLIC-BOUNDARY.md)),
- expected vs actual behavior.

Before filing, please check whether the behavior is a known limitation
(README → "Known limitations") or intended verifier behavior
([docs/SPECIFICATION.md](docs/SPECIFICATION.md)).

## I found a security issue

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) — use GitHub
private vulnerability reporting.

## I want help using it

- Start with the [README](README.md) quick start and
  [docs/examples/](docs/examples/) (executable, CI-tested examples).
- API entry points: [docs/API.md](docs/API.md).
- Writing a parser adapter: [docs/ADAPTER-AUTHOR-GUIDE.md](docs/ADAPTER-AUTHOR-GUIDE.md).
- Conformance for non-TypeScript implementations:
  [docs/CONFORMANCE.md](docs/CONFORMANCE.md).
- Usage questions: open a GitHub issue with the `question` label.

## I want a feature

Open an issue describing the use case. Note the architecture constitution
(README → "Architecture constitution"): Core never executes actions (no
calendar/email/Todoist writes), never invents facts, and stays
parser-independent. Features that violate the constitution are out of scope
for this repository (product features belong downstream).

## Release status

The packages are in release-candidate preparation and not yet on npm. See
[docs/RELEASING.md](docs/RELEASING.md) and
[docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) for the current state.
