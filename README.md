# Writulos Auto-Docs — GitHub Action

Automatically generate **markdown documentation** for every changed code file in your repository, powered by [Writulos](https://writulos.com).

- **On push to main/master** → docs are committed directly to your `docs/` folder
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
      - uses: Triumphist230/Writulos-final@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          writulos_secret: ${{ secrets.WRITULOS_ACTION_SECRET }}   # optional
```

That's it. No API key needed — Writulos is a hosted service.

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github_token` | ✅ | — | Pass `secrets.GITHUB_TOKEN`. Used to commit docs and post PR comments. |
| `writulos_secret` | ❌ | `''` | Optional shared secret to protect your Writulos endpoint. |
| `file_extensions` | ❌ | `js,ts,jsx,tsx,py,java,go,rb` | Comma-separated extensions to document (no dots). |
| `output_dir` | ❌ | `docs` | Directory to write generated `.md` files into. |
| `api_url` | ❌ | `https://writulos.com/api/action-generate` | Override only if self-hosting. |

---

## How it works

1. On every push or PR, the action runs `git diff` to find changed source files.
2. Each changed file is sent to the Writulos API (`/api/action-generate`).
3. Writulos generates structured markdown documentation.
4. **Push events** → docs are committed to `docs/` by the Writulos bot.
5. **PR events** → a comment is posted listing all newly documented files.

Doc paths mirror your source tree:
```
src/utils/auth.ts   →   docs/src/utils/auth.md
api/generate.js     →   docs/api/generate.md
```

---

## Optional: protect your endpoint with a secret

This is recommended for production use to prevent unauthorised calls to your Writulos endpoint.

**1. Generate a secret:**
```bash
openssl rand -hex 32
```

**2. Add it to your Vercel project** as `WRITULOS_ACTION_SECRET`.

**3. Add it to your GitHub repository:**
- Go to **Settings → Secrets and variables → Actions**
- Create a secret named `WRITULOS_ACTION_SECRET` with the same value
- It is automatically sent in every API request via `x-writulos-secret`

---

## Supported file types

`.js` `.ts` `.jsx` `.tsx` `.py` `.java` `.go` `.rb`

Add more by passing `file_extensions: 'js,ts,py,rs,cpp'` to the action.

---

## Local testing

```bash
cd action
npm install
CHANGED_FILES="src/utils/auth.ts,api/generate.js" \
EVENT_NAME="push" \
REPO_NAME="your-org/your-repo" \
node run.js
```

---

## License

MIT © [Writulos](https://writulos.com)
