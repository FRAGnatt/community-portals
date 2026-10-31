<p align="center">
  <img src="https://raw.githubusercontent.com/ai-job-search-dev/ai-job-search/master/assets/mascot/pip_flight_loop.gif" alt="Pip, the courier bird" width="200">
</p>

# AI Job Search: Community Portals

*Job boards for every market, maintained by the people who search them.*

Job portal search skills for [AI Job Search](https://github.com/ai-job-search-dev/ai-job-search). The framework stays market-neutral; the job boards live here. This repo is **community driven**: every portal is contributed and maintained by someone who uses it, one folder per job board, one maintainer per folder.

> Note: Each portal belongs to its maintainer, who keeps it working and is responsible for respecting the job board's terms and `robots.txt`. Read a portal's code before you run it - it runs against your career data.

## Use a portal

Copy the folder for your job board into `.agents/skills/` in your AI Job Search checkout, then run:

```bash
python3 tools/install_portal_clis.py
```

`/scrape` picks it up automatically.

## Add a portal

Built a portal for your market? Generate it with `/add-portal` in AI Job Search, then open a PR here that adds the folder and lists you as its code owner in `.github/CODEOWNERS`. You maintain what you add.

Looking for full market or language adaptations instead? See [Community forks & adaptations](https://github.com/ai-job-search-dev/ai-job-search/discussions/78).
