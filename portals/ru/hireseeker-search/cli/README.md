# HireSeeker CLI

Run with Bun: `bun run src/cli.ts --help`. No runtime dependencies, credentials,
environment configuration, install scripts or disk reads. `professions` discovers
current public categories; `search -q python_backend --format json` reads a
limited category sample; `detail <returned-url> --format plain` reads one posting.

See [the skill](../SKILL.md) for scope and [the URL reference](../url-reference.md)
for the observed HTML/policy contract. Country folder `ru` denotes the board's
home market, not an exclusion of international or English-language postings.

Development checks: `bun install`, `bun run typecheck`, `bun test`. Tests use
synthetic small HTML fixtures and an injected fetch mock; no live network calls.
Live verification is separate and bounded, never part of the test script.

MIT licensed, under the repository license. Public-page instructions derive from
FRAGnatt/ai-job-search (copyright 2026 Mads Lorentzen); see the included LICENSE.
`src/text.ts` adapts the MIT-licensed `global/linkedin-search` HTML visibility and
invisible-character helpers already in this repository. No posting text is
vendored; fixtures are synthetic.
