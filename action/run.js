const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// Replaces @actions/core
function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`] || '';
}
function info(msg) { process.stdout.write(`${msg}\n`); }
function warning(msg) { process.stdout.write(`::warning::${msg}\n`); }
function setFailed(msg) { process.stdout.write(`::error::${msg}\n`); process.exit(1); }

// Replaces @actions/github context
const eventName = process.env.GITHUB_EVENT_NAME || '';
const repo = { owner: (process.env.GITHUB_REPOSITORY || '').split('/')[0], repo: (process.env.GITHUB_REPOSITORY || '').split('/')[1] };
const githubToken = getInput('github_token');

function getAllFiles(dir, exts, root = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'docs') {
        results = results.concat(getAllFiles(fullPath, exts, root));
      }
    } else {
      const ext = entry.name.split('.').pop();
      if (ext && exts.has(ext)) results.push(path.relative(root, fullPath));
    }
  }
  return results;
}

function postComment(issueNumber, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ body });
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}/comments`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${githubToken}`,
        'User-Agent': 'writulos-action',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const writulosApiKey = getInput('writulos_api_key');
  const fileExtensions = getInput('file_extensions') || 'js,ts,jsx,tsx,py,java,go,rb';
  const outputDir = getInput('output_dir') || 'docs';
  const apiUrl = getInput('api_url') || 'https://writulos.com/api/action-generate';

  if (!writulosApiKey) { setFailed('writulos_api_key is required.'); return; }
  if (!githubToken) { setFailed('github_token is required.'); return; }

  const exts = new Set(fileExtensions.split(',').map(e => e.trim().replace(/^\./, '')));
  const isFullScan = eventName === 'workflow_dispatch';
  let changedFiles = [];

  if (isFullScan) {
    info('Full-repo scan triggered via workflow_dispatch.');
    changedFiles = getAllFiles('.', exts);
    info(`Found ${changedFiles.length} file(s) to document.`);
  } else {
    try {
      const diff = execSync('git diff HEAD~1 HEAD --name-only').toString().trim();
      changedFiles = diff.split('\n').filter(f => { const ext = f.split('.').pop(); return ext && exts.has(ext); });
    } catch (e) {
      warning('Could not determine changed files via git diff. Skipping.');
      return;
    }
  }

  if (changedFiles.length === 0) { info('No supported files found. Nothing to document.'); return; }
  info(`Files to document: ${changedFiles.join(', ')}`);

  const documented = [];
  const failed = [];

  for (const filePath of changedFiles) {
    if (!fs.existsSync(filePath)) { info(`Skipping deleted file: ${filePath}`); continue; }
    const code = fs.readFileSync(filePath, 'utf8');
    if (!code.trim()) { info(`Skipping empty file: ${filePath}`); continue; }
    if (code.length > 100_000) { warning(`Skipping ${filePath} — file exceeds 100KB limit.`); continue; }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': writulosApiKey },
        body: JSON.stringify({ code, filename: path.basename(filePath), context: `File path: ${filePath}` }),
      });

      if (response.status === 401) { const b = await response.text(); setFailed(`401: ${b}`); return; }
      if (!response.ok) { const b = await response.text(); warning(`Failed for ${filePath}: ${response.status} ${b}`); failed.push(filePath); continue; }

      const data = await response.json();
      if (!data.documentation) { warning(`Empty docs returned for ${filePath}`); failed.push(filePath); continue; }

      const docPath = path.join(outputDir, filePath.replace(/\.[^.]+$/, '.md'));
      fs.mkdirSync(path.dirname(docPath), { recursive: true });
      fs.writeFileSync(docPath, data.documentation, 'utf8');
      info(`Documented: ${filePath} → ${docPath}`);
      documented.push({ src: filePath, doc: docPath });
    } catch (err) {
      warning(`Error documenting ${filePath}: ${err.message}`);
      failed.push(filePath);
    }
  }

  if (documented.length === 0) { info('No docs generated.'); return; }

  if (eventName === 'push' || isFullScan) {
    execSync('git config user.name "Writulos Bot"');
    execSync('git config user.email "action@writulos.com"');
    execSync(`git add ${outputDir}`);
    try {
      const msg = isFullScan ? `docs: full-repo scan — document ${documented.length} file(s) [writulos]` : 'docs: auto-generate documentation [writulos]';
      execSync(`git commit -m "${msg}"`);
      execSync('git push');
      info(`Committed docs for ${documented.length} file(s).`);
    } catch { info('Nothing new to commit.'); }
  } else if (eventName === 'pull_request') {
    const prNumber = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request.number;
    const lines = documented.map(({ src, doc }) => `- \`${src}\` → \`${doc}\``);
    const body = ['### 📄 Writulos Auto-Docs', '', `Generated documentation for **${documented.length}** file(s):`, '', ...lines, '', failed.length > 0 ? `> ⚠️ ${failed.length} file(s) failed: ${failed.join(', ')}` : ''].join('\n');
    await postComment(prNumber, body);
  }
}

run().catch(err => setFailed(err.message));
