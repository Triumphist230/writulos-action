'use strict';
const path = require('path');
const fs   = require('fs');

const API_URL     = process.env.INPUT_API_URL     || 'https://writulos.com/api/action-generate';
const OUTPUT_DIR  = process.env.INPUT_OUTPUT_DIR  || 'docs';
const API_KEY     = process.env.INPUT_WRITULOS_API_KEY     || '';
const GH_TOKEN    = process.env.GITHUB_TOKEN         || '';
const MODE        = (process.env.INPUT_MODE       || 'commit').toLowerCase();
const PR_NUMBER   = process.env.PR_NUMBER;
const EVENT_NAME  = process.env.EVENT_NAME;
const REPO_NAME   = process.env.REPO_NAME            || '';
const REPO_BRANCH = process.env.REPO_BRANCH          || 'main';

// WRITULOS_WORKSPACE = github.workspace = user's repo root on the runner
const WORKSPACE      = process.env.GITHUB_WORKSPACE || process.cwd();
const OUTPUT_DIR_ABS = path.resolve(WORKSPACE, OUTPUT_DIR);
const LOG_PATH       = path.join(OUTPUT_DIR_ABS, 'writulos.log');
const LOG_REPO_PATH  = `${OUTPUT_DIR}/writulos.log`;

if (!API_KEY) {
  console.error('Writulos: WRITULOS_API_KEY is not set. Add it as a GitHub secret.');
  process.exit(1);
}
if (!GH_TOKEN) {
  console.error('Writulos: GITHUB_TOKEN is not set.');
  process.exit(1);
}

const [OWNER, REPO] = REPO_NAME.split('/');

const GH_HEADERS = {
  Authorization: `Bearer ${GH_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github+json',
  'User-Agent': 'writulos-action',
  'X-GitHub-Api-Version': '2022-11-28',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getAllFiles(dir, root) {
  root = root || dir;
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== OUTPUT_DIR) {
        results = results.concat(getAllFiles(fullPath, root));
      }
    } else {
      const ext = entry.name.split('.').pop();
      const exts = new Set(
        (process.env.INPUT_FILE_EXTENSIONS || 'js,ts,jsx,tsx,py,java,go,rb')
          .split(',').map(e => e.trim().replace(/^\./, ''))
      );
      if (ext && exts.has(ext)) results.push(path.relative(root, fullPath));
    }
  }
  return results;
}

function appendLog({ succeeded, total, remaining, limitReached, isPro, daysLeft, monthlyLimit }) {
  try {
    if (!fs.existsSync(OUTPUT_DIR_ABS)) fs.mkdirSync(OUTPUT_DIR_ABS, { recursive: true });
    const isNew  = !fs.existsSync(LOG_PATH);
    const ts     = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const status = limitReached ? 'LIMIT REACHED' : 'OK';
    const lines  = [];
    if (isNew) {
      lines.push(
        '# Writulos Log',
        '# This file lives in your docs/ folder alongside generated documentation.',
        '# Every run appends a new entry -- it is never overwritten.',
        '# Delete it anytime -- it will be recreated on the next run.',
        '',
      );
    }
    lines.push(`[${ts}] GitHub Actions -- ${status}`);
    lines.push(`  Files: ${succeeded}/${total} documented`);
    if (!limitReached && remaining != null) lines.push(`  Remaining: ${remaining} generations this month`);
    if (limitReached) {
      lines.push(isPro
        ? `  NOTIFICATION: Pro limit reached (${monthlyLimit}/month). Resets in ${daysLeft} day(s) - https://writulos.com/#pricing`
        : `  NOTIFICATION: Free limit reached (10/month). Resets in ${daysLeft} day(s) - https://writulos.com/upgrade`);
    }
    lines.push('');
    fs.appendFileSync(LOG_PATH, lines.join('\n'), 'utf8');
    console.log(`[writulos] log -> ${LOG_PATH}`);
  } catch (err) {
    console.error('[writulos] Could not write log:', err.message);
  }
}

async function commitFileToBranch(docPath, content, branch) {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const apiPath = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${docPath}`;

  let existingSha = null;
  const getRes = await fetch(`${apiPath}?ref=${branch}`, { headers: GH_HEADERS });
  if (getRes.ok) {
    const existing = await getRes.json();
    existingSha = existing.sha || null;
  }

  const putRes = await fetch(apiPath, {
    method: 'PUT',
    headers: GH_HEADERS,
    body: JSON.stringify({
      message: `docs: auto-generate documentation for ${docPath} [writulos]`,
      content: encoded,
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
      committer: { name: 'Writulos Bot', email: 'action@writulos.com' },
    }),
  });

  if (!putRes.ok) {
    console.error(`  [commit error] ${docPath}: HTTP ${putRes.status} -- ${await putRes.text()}`);
    return false;
  }
  console.log(`  [committed] -> ${docPath} on ${branch}`);
  return true;
}

async function generateDoc(filePath) {
  const absPath = path.resolve(WORKSPACE, filePath);
  let code;
  try { code = fs.readFileSync(absPath, 'utf8'); }
  catch (e) { console.warn(`  [skip] Could not read ${absPath}`); return null; }

  if (!code.trim())          { console.warn(`  [skip] ${filePath} is empty`);      return null; }
  if (code.length > 100_000) { console.warn(`  [skip] ${filePath} is over 100KB`); return null; }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({
      code,
      filename: filePath,
      context: `File from GitHub repository: ${REPO_NAME}`,
    }),
  });

  if (response.status === 429) {
    const data = await response.json();
    const limitMatch = (data.error || '').match(/\d+/);
    return {
      limitReached:  true,
      daysLeft:      data.daysLeft || 0,
      isPro:         !data.showProBanner,
      remaining:     0,
      filename:      filePath,
      monthlyLimit:  limitMatch ? limitMatch[0] : '?',
    };
  }

  if (!response.ok) {
    console.error(`  [error] ${filePath}: HTTP ${response.status} -- ${await response.text()}`);
    return null;
  }

  const data = await response.json();
  return {
    documentation: data.documentation || null,
    remaining:     data.remaining != null ? data.remaining : null,
  };
}

async function getBaseSha(branch) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error(`Could not resolve SHA for branch ${branch}: ${await res.text()}`);
  return (await res.json()).object.sha;
}

async function createBranch(newBranch, fromSha) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    headers: GH_HEADERS,
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status !== 422) throw new Error(`Failed to create branch ${newBranch}: ${err}`);
    console.log(`  [branch] ${newBranch} already exists -- reusing.`);
  } else {
    console.log(`  [branch] Created ${newBranch}`);
  }
}

async function openPullRequest(docsBranch, docPaths) {
  const fileList = docPaths.map(p => `- \`${p}\``).join('\n');
  const body = [
    '## Writulos -- Documentation Ready for Review', '',
    'This PR was opened automatically by [Writulos](https://writulos.com).', '',
    '### Files documented', '', fileList, '',
    `> Docs are in the \`${OUTPUT_DIR}/\` folder on branch \`${docsBranch}\`.`, '',
    '_Generated by [Writulos](https://writulos.com)_',
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    headers: GH_HEADERS,
    body: JSON.stringify({
      title: 'docs: auto-generated documentation [writulos]',
      head: docsBranch,
      base: REPO_BRANCH,
      body,
      draft: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 422) { console.log(`  [pr] A PR for ${docsBranch} already exists.`); return null; }
    throw new Error(`Failed to open PR: ${err}`);
  }
  const pr = await res.json();
  console.log(`  [pr] Opened -> ${pr.html_url}`);
  return pr.html_url;
}

async function postPRComment(summaryLines, prUrl) {
  if (!GH_TOKEN || !PR_NUMBER || EVENT_NAME !== 'pull_request') return;
  const fileList = summaryLines.map(l => `- \`${l}\``).join('\n');
  const prLine   = prUrl ? `\n\n[View the docs PR ->](${prUrl})` : '';
  const body = [
    '## Writulos -- Documentation Generated', '',
    'Documentation was auto-generated for the following changed files:', '',
    fileList, '',
    MODE === 'pr'
      ? `> A new PR with the generated docs has been opened.${prLine}`
      : `> Docs are committed to the \`${OUTPUT_DIR}/\` folder in this branch.`,
    '', '_Generated by [Writulos](https://writulos.com)_',
  ].join('\n');

  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`,
    { method: 'POST', headers: GH_HEADERS, body: JSON.stringify({ body }) },
  );
  if (res.ok) console.log('PR comment posted successfully.');
  else console.warn('Failed to post PR comment:', await res.text());
}

// ---------------------------------------------------------------------------
async function main() {
  const isFullScan = EVENT_NAME === 'workflow_dispatch';
  let changedFiles = [];

  if (isFullScan) {
    console.log('Full-repo scan triggered via workflow_dispatch.');
    changedFiles = getAllFiles(WORKSPACE, WORKSPACE);
    console.log(`Found ${changedFiles.length} file(s) to document.`);
  } else {
    changedFiles = (process.env.CHANGED_FILES || '')
      .split(',')
      .map(f => f.trim())
      .filter(Boolean);
  }

  if (changedFiles.length === 0) {
    console.log('Writulos: no supported files found. Skipping.');
    appendLog({ succeeded: 0, total: 0, remaining: null, limitReached: false, isPro: false, daysLeft: 0 });
    const logContent = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
    if (logContent) await commitFileToBranch(LOG_REPO_PATH, logContent, REPO_BRANCH).catch(() => {});
    return;
  }

  console.log(`Files to document: ${changedFiles.join(', ')}`);

  const generated       = [];
  let lastRemaining     = null;
  let limitReached      = false;
  let limitDaysLeft     = 0;
  let limitIsPro        = false;
  let limitFilename     = null;
  let limitMonthlyLimit = null;

  for (const filePath of changedFiles) {
    console.log(`\nProcessing: ${filePath}`);
    const result = await generateDoc(filePath);
    if (!result) continue;

    if (result.limitReached) {
      limitReached      = true;
      limitDaysLeft     = result.daysLeft;
      limitIsPro        = result.isPro;
      limitFilename     = result.filename;
      limitMonthlyLimit = result.monthlyLimit;
      console.warn(`  [limit] Monthly generation limit reached.`);
      break;
    }

    if (result.remaining !== null) lastRemaining = result.remaining;

    const docPath = path
      .join(OUTPUT_DIR, filePath.replace(/\.[^.]+$/, '.md'))
      .replace(/\\/g, '/');

    generated.push({ docPath, content: result.documentation, srcPath: filePath });
  }

  // Write log immediately -- read back right away, guaranteed fresh
  appendLog({
    succeeded:    generated.length,
    total:        changedFiles.length,
    remaining:    lastRemaining,
    limitReached,
    isPro:        limitIsPro,
    daysLeft:     limitDaysLeft,
    monthlyLimit: limitMonthlyLimit,
  });
  const logContent = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';

  if (limitReached) {
    if (logContent) await commitFileToBranch(LOG_REPO_PATH, logContent, REPO_BRANCH);
    const msg = `Failed for ${limitFilename}. Monthly limit of ${limitMonthlyLimit} generations reached. Resets on the 1st of next month (in ${limitDaysLeft} day${limitDaysLeft === 1 ? '' : 's'}).`;
    console.error(`\n${msg}`);
    process.exit(1);
  }

  if (generated.length === 0) {
    console.log('\nWritulos: no docs generated.');
    return;
  }

  if (MODE === 'commit') {
    const committed = [];
    for (const { docPath, content } of generated) {
      const ok = await commitFileToBranch(docPath, content, REPO_BRANCH);
      if (ok) committed.push(docPath);
    }
    // Always commit log -- no empty guard
    await commitFileToBranch(LOG_REPO_PATH, logContent, REPO_BRANCH);
    console.log(`\nWritulos: done. Committed ${committed.length} doc(s) + writulos.log`);
    await postPRComment(committed);
    return;
  }

  if (MODE === 'pr') {
    const ts         = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12);
    const docsBranch = `writulos/docs-${REPO_BRANCH}-${ts}`;
    console.log(`\nPR mode -- creating branch: ${docsBranch}`);
    const baseSha = await getBaseSha(REPO_BRANCH);
    await createBranch(docsBranch, baseSha);
    const committed = [];
    for (const { docPath, content } of generated) {
      const ok = await commitFileToBranch(docPath, content, docsBranch);
      if (ok) committed.push(docPath);
    }
    // Always commit log -- no empty guard
    await commitFileToBranch(LOG_REPO_PATH, logContent, docsBranch);
    if (committed.length === 0) { console.log('\nWritulos: no docs committed -- skipping PR.'); return; }
    const prUrl = await openPullRequest(docsBranch, committed);
    console.log(`\nWritulos: done. Opened PR with ${committed.length} doc(s).`);
    await postPRComment(committed, prUrl);
    return;
  }

  console.log(`\nWritulos: comment mode -- ${generated.length} doc(s) would be written.`);
  await postPRComment(generated.map(g => g.docPath));
}

main().catch((err) => {
  console.error('Writulos action failed:', err.message);
  process.exit(1);
});

