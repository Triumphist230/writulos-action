# Writulos Auto-Docs — GitHub Action

Automatically generate **markdown documentation** for every changed code file in your repository, powered by [Writulos](https://writulos.com).

- **On push to main/master** → docs are committed directly to your `docs/` folder by the Writulos Bot
- **On pull requests** → a bot comment lists every newly documented file

---

## Quick start

### Step 1 — Get your Writulos API key

Log in to [writulos.com](https://writulos.com), go to **GitHub Actions** in the sidebar, and copy your API key. Then add it as a secret in your GitHub repo:

- Go to your repo → **Settings → Secrets and variables → Actions**
- Create a new secret named `WRITULOS_API_KEY` and paste your key

### Step 2 — Add the workflow file

Create `.github/workflows/writulos-docs.yml` in your repository:

```yaml
name: Writulos Auto-Docs

on:
  push:
    branches: [main, master]
    paths: ['**.js', '**.ts', '**.tsx', '**.jsx', '**.py', '**.java', '**.go', '**.rb']
  pull_request:
    paths: ['**.js', '**.ts', '**.tsx', '**.jsx', '**.py', '**.java', '**.go', '**.rb']

jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: Triumphist230/writulos-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          writulos_api_key: ${{ secrets.WRITULOS_API_KEY }}
```

### Step 3 — Push to main

That's it. Every push automatically documents changed files and commits them to `docs/`. On PRs, a bot comment lists every newly documented file.

---

## How it works

1. On every push or PR, the action runs `git diff HEAD~1 HEAD` to find only changed files.
2. Each changed file is sent to the Writulos API with your API key in the `x-api-key` header.
3. Writulos generates structured markdown documentation for each file.
4. **Push events** → docs committed to `docs/` by the Writulos Bot.
5. **PR events** → a comment is posted listing all newly documented files.

Doc paths mirror your source tree:
```
src/utils/auth.ts   →   docs/src/utils/auth.md
api/generate.js     →   docs/api/generate.md
```

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github_token` | ✅ | — | Pass `secrets.GITHUB_TOKEN`. Used to commit docs and post PR comments. |
| `writulos_api_key` | ✅ | — | Your Writulos API key from the dashboard. Pass `secrets.WRITULOS_API_KEY`. |
| `file_extensions` | ❌ | `js,ts,jsx,tsx,py,java,go,rb` | Comma-separated extensions to document (no dots). |
| `output_dir` | ❌ | `docs` | Directory to write generated `.md` files into. |
| `api_url` | ❌ | `https://writulos.com/api/action-generate` | Override only if self-hosting Writulos. |

---

## Built-in guards

| Guard | Behaviour |
|---|---|
| **Unchanged files** | Only files in `git diff HEAD~1 HEAD` are processed |
| **Empty files** | Skipped silently |
| **Files over 100KB** | Skipped with a warning |
| **Invalid API key** | Action fails immediately with a clear error message |
| **Unsupported extensions** | Filtered by `file_extensions` input |

---

## Supported file types (default)

`.js` `.ts` `.jsx` `.tsx` `.py` `.java` `.go` `.rb`

---

## License

MIT © [Writulos](https://writulos.com)
