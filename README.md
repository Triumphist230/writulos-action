# Writulos Auto-Docs — GitHub Action

Automatically generate **markdown documentation** for every changed code file in your repository, powered by [Writulos](https://writulos.com).

- **On push to main/master** → docs are committed directly to your `docs/` folder by the Writulos Bot
- **On pull requests** → a bot comment lists every newly documented file

---

## Quick start

Add this workflow file to your repository at `.github/workflows/writulos-docs.yml`:

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
```

That's it. No API key needed — Writulos is a fully hosted service.

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github_token` | ✅ | — | Pass `secrets.GITHUB_TOKEN`. Used to commit docs and post PR comments. |
| `writulos_secret` | ❌ | `''` | Shared secret to reject unauthorised calls to your endpoint. See [Securing your endpoint](#optional-secure-your-endpoint). |
| `file_extensions` | ❌ | `js,ts,jsx,tsx,py,java,go,rb` | Comma-separated extensions to document (no dots). |
| `output_dir` | ❌ | `docs` | Directory to write generated `.md` files into. |
| `api_url` | ❌ | `https://writulos.com/api/action-generate` | Override only if self-hosting Writulos. |

---

## How it works

1. On every push or PR, the action runs `git diff HEAD~1 HEAD` to find only the files that changed in that commit — not the whole repo.
2. Each changed file is sent to the Writulos API (`/api/action-generate`).
3. Writulos generates structured markdown documentation for each file.
4. **Push events** → docs are committed to `docs/` by the Writulos Bot (`action@writulos.com`).
5. **PR events** → a comment is posted listing all newly documented files.

Doc paths mirror your source tree exactly:
```
src/utils/auth.ts   →   docs/src/utils/auth.md
api/generate.js     →   docs/api/generate.md
```

---

## Built-in guards

The action automatically skips files that would produce bad or useless output — no configuration needed:

| Guard | Behaviour |
|---|---|
| **Unchanged files** | Only files in `git diff HEAD~1 HEAD` are processed — never the whole repo |
| **Empty files** | Skipped silently |
| **Files over 100KB** | Skipped with a warning in the Action log |
| **Unsupported extensions** | Filtered out by `file_extensions` input before processing |

---

## Customising file extensions

Override the default extensions to match your stack:

```yaml
- uses: Triumphist230/writulos-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    file_extensions: 'js,ts,py,rs,go,cpp'
```

> **Tip:** also update the `paths:` filter in the `on:` trigger to match, so the workflow only runs when relevant files change.

---

## Optional: secure your endpoint

Recommended for production to prevent random internet requests hitting `/api/action-generate`.

**Step 1 — Generate a secret:**
```bash
openssl rand -hex 32
```

**Step 2 — Add it to your Vercel project** as `WRITULOS_ACTION_SECRET` in your environment variables.

**Step 3 — Add it to your GitHub repository:**
- Go to **Settings → Secrets and variables → Actions**
- Create a new secret named `WRITULOS_ACTION_SECRET` with the same value

**Step 4 — Pass it to the action:**
```yaml
- uses: Triumphist230/writulos-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    writulos_secret: ${{ secrets.WRITULOS_ACTION_SECRET }}
```

Every request from the action will now include `x-writulos-secret` in the header. Requests without the correct secret are rejected with `401 Unauthorized`.

---

## Supported file types (default)

`.js` `.ts` `.jsx` `.tsx` `.py` `.java` `.go` `.rb`

Add more via `file_extensions` — the action supports any plain-text source file.

---

## Local testing

```bash
cd action
CHANGED_FILES="src/utils/auth.ts,api/generate.js" \
EVENT_NAME="push" \
REPO_NAME="your-org/your-repo" \
node run.js
```

---

## License

MIT © [Writulos](https://writulos.com)
