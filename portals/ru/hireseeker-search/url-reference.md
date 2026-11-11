# HireSeeker public-page contract

Observed 2026-11-11, without authentication or browser impersonation.

| URL | Purpose |
| --- | --- |
| `https://hireseeker.ru/robots.txt` | Checked before each command; denies private/API routes |
| `https://hireseeker.ru/llms.txt` | Markdown links identify live profession codes and labels |
| `https://hireseeker.ru/vacancy-list/<code>` | Public profession sample, observed 25 cards |
| `https://hireseeker.ru/vacancy/<id>-<slug>` | Public detail; numeric IDs may redirect to the canonical slug |
| `https://hireseeker.ru/ai.txt` | Allows public research/short answers with attribution and source links |
| `https://hireseeker.ru/oferta` | Public service terms; no rights to republish third-party ads implied |

Search has no invented query parameters: `--query` selects a code/label from
`llms.txt`, then reads that category's public HTML. `--page > 1` and unsupported
filters fail explicitly. A category's advertised weekly count is not the number
of cards accessible in its sample; it is deliberately not reported as a total.

Anchors: `data-testid="category-sample"`; each `div[data-vacancy-card]` is parsed
independently; `a[data-testid="vacancy-title-link"]` supplies title/URL; a company
directory anchor supplies the employer. Detail uses the vacancy header's `h1`
and `section#vacancy-description`. Both can expose `time[data-testid="vacancy-seen-at"]`:
its `dateTime` is service appearance, not employer publication. `date` stays null.
No company/location/contact pages or origin URLs are fetched by the CLI.

No calls to `/api/`, `/mcp`, disallowed `/search/`, private routes, or third-party
hosts. All redirect destinations are checked before following them. Missing or
changed HTML is an explicit error; a 403 never becomes archive evidence.

If these public pages become restricted, stop and use existing WebSearch tools
without bypassing the restriction. Search snippets alone do not verify a job.
