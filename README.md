<p align="center">
  <img src="https://raw.githubusercontent.com/ai-job-search-dev/ai-job-search/master/assets/mascot/pip_flight_loop.gif" alt="Pip, the courier bird" width="200">
</p>

# AI Job Search: Community Portals

*Job boards for every market, maintained by the people who search them.*

[Browse the portals](portals/) by country. Missing your job board? **[Add your own](#add-a-portal)** and own it.

Job portal search skills for [AI Job Search](https://github.com/ai-job-search-dev/ai-job-search). The framework stays market-neutral; the job boards live here. This repo is **community driven**: every portal is contributed and owned by the people who use it, so each market gets the job boards it actually needs. One folder per job board, one or more owners per folder.

> Note: Each portal belongs to its owners, who keep it working and are responsible for respecting the job board's terms and `robots.txt`. Read a portal's code before you run it - it runs against your career data.

## Use a portal

In your AI Job Search checkout, ask your agent:

> Copy https://github.com/ai-job-search-dev/community-portals/tree/main/portals/dk/jobindex-search into `.agents/skills/`, show me what it does, then run `python3 tools/install_portal_clis.py`.

Browse `portals/<country>/` for your market and swap in your job board's folder. `/scrape` picks it up automatically.

## Add a portal

Built a portal for your market? Generate it with `/add-portal` in AI Job Search, then open a PR here that adds it under `portals/<country>/` and lists you as its owner in `.github/CODEOWNERS`. You own what you add. [CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the review bar, and how ownership works, including how to step down.

Looking for full market or language adaptations instead? See [Community forks & adaptations](https://github.com/ai-job-search-dev/ai-job-search/discussions/78).

## License

[MIT](LICENSE), as AI Job Search.
