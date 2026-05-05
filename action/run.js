const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getAllFiles(dir, exts, root = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results = results.concat(getAllFiles(fullPath, exts, root));
      }
    } else {
      const ext = entry.name.split('.').pop();
      if (ext && exts.has(ext)) results.push(path.relative(root, fullPath));
    }
  }
  return results;
}

async function run() {
  const githubToken = core.getInput('github_token', { required: true });
  const writulosApiKey = core.getInput('writulos_api_key', { required: true });
  const fileExtensions = core.getInput('file_extensions') || 'js,ts,jsx,tsx,py,java,go,rb';
  const outputDir = core.getInput('output_dir') || 'docs';
  const apiUrl = core.getInput('api_url') || 'https://writulos.com/api/action-generate';

  const octokit = github.getOctokit(githubToken);
  const context = github.context;
  const exts = new Set(fileExtensions.split(',').map(e => e.trim().replace(/^\./, '')));

  const isFullScan = context.eventName === 'workflow_dispatch';
  let changedFiles = [];

  if (isFullScan) {
    core.info('Full-repo scan triggered via workflow_dispatch.');
    changedFiles = getAllFiles('.', exts);
    core.info(`Found ${changedFiles.length} file(s) to document.`);
  } else {
    try {
      const diff = execSync('git diff HEAD~1 HEAD --name-only').toString().trim();
      changedFiles = diff.split('\n').filter(f => {
        const ext = f.split('.').pop();
        return ext && exts.has(ext);
      });
    } catch (e) {
      core.warning('Could not determine changed files via git diff. Skipping.');
      return;
    }
  }

  if (changedFiles.length === 0) {
    core.info('No supported files found. Nothing to document.');
    return;
  }

  core.info(`Files to document: ${changedFiles.join(', ')}`);

  const documented = [];
  const failed = [];

  for (const filePath of changedFiles) {
    if (!fs.existsSync(filePath)) {
      core.info(`Skipping deleted file: ${filePath}`);
      continue;
    }

    const code = fs.readFileSync(filePath, 'utf8');

    if (!code.trim()) {
      core.info(`Skipping empty file: ${filePath}`);
      continue;
    }

    if (code.length > 100_000) {
      core.warning(`Skipping ${filePath} — file exceeds 100KB limit.`);
      continue;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': writulosApiKey,
        },
        body: JSON.stringify({
          code,
          filename: path.basename(filePath),
          context: `File path: ${filePath}`,
        }),
      });

      if (response.status === 401) {
        core.setFailed('Invalid Writulos API key. Check that WRITULOS_API_KEY is set correctly in your repo secrets.');
        return;
      }

      if (!response.ok) {
        const body = await response.text();
        core.warning(`Failed to generate docs for ${filePath}: ${response.status} ${body}`);
        failed.push(filePath);
        continue;
      }

      const data = await response.json();
      const documentation = data.documentation;

      if (!documentation) {
        core.warning(`Empty documentation returned for ${filePath}`);
        failed.push(filePath);
        continue;
      }

      const docPath = path.join(outputDir, filePath.replace(/\.[^.]+$/, '.md'));
      fs.mkdirSync(path.dirname(docPath), { recursive: true });
      fs.writeFileSync(docPath, documentation, 'utf8');
      core.info(`Documented: ${filePath} → ${docPath}`);
      documented.push({ src: filePath, doc: docPath });

    } catch (err) {
      core.warning(`Error documenting ${filePath}: ${err.message}`);
      failed.push(filePath);
    }
  }

  if (documented.length === 0) {
    core.info('No docs generated.');
    return;
  }

  if (context.eventName === 'push' || isFullScan) {
    execSync('git config user.name "Writulos Bot"');
    execSync('git config user.email "action@writulos.com"');
    execSync(`git add ${outputDir}`);
    try {
      const msg = isFullScan
        ? `docs: full-repo scan — document ${documented.length} file(s) [writulos]`
        : 'docs: auto-generate documentation [writulos]';
      execSync(`git commit -m "${msg}"`);
      execSync('git push');
      core.info(`Committed docs for ${documented.length} file(s).`);
    } catch {
      core.info('Nothing new to commit.');
    }
  } else if (context.eventName === 'pull_request') {
    const lines = documented.map(({ src, doc }) => `- \`${src}\` → \`${doc}\``);
    const body = [
      '### 📄 Writulos Auto-Docs',
      '',
      `Generated documentation for **${documented.length}** file(s):`,
      '',
      ...lines,
      '',
      failed.length > 0 ? `> ⚠️ ${failed.length} file(s) failed: ${failed.join(', ')}` : '',
    ].filter(l => l !== undefined).join('\n');

    await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: context.payload.pull_request.number,
      body,
    });
  }
}

run().catch(err => core.setFailed(err.message));
