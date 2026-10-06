import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REQUIREMENT_DIR = path.join(PROJECT_ROOT, 'Requirement');
const SPEC_DIR = path.join(PROJECT_ROOT, 'TestAutomate', 'tests');
const MANIFEST = path.join(__dirname, 'runs.json'); // requirement basename -> spec files its tests live in
const PORT = process.env.PORT || 4000;
// Headed runs need a logged-in desktop. Set PLAYWRIGHT_HEADED=false on a server with no display
// (e.g. a Linux VM, or a Windows VM without an auto-logon session).
const HEADED = !/^(false|0|no)$/i.test(process.env.PLAYWRIGHT_HEADED || 'true');

// Agent sessions on Windows need Git Bash for their Bash tool. A per-user Git install
// (e.g. %LOCALAPPDATA%\Programs\Git) isn't found automatically, which left execution-agent with no
// shell, so locate bash.exe next to git.exe on PATH and pass it on.
const GIT_BASH = (() => {
  if (process.platform !== 'win32') return null;
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!fs.existsSync(path.join(dir, 'git.exe'))) continue;
    const bash = path.resolve(dir, '..', 'bin', 'bash.exe');
    if (fs.existsSync(bash)) return bash;
  }
  return null;
})();

// Folders whose contents the UI is allowed to serve back as report links.
const OUTPUT_DIRS = ['Requirement', 'TestCases', 'TestDesign', 'TestReview', 'TestResults', 'FailureAnalysis', 'ReleaseReadiness', 'PipelineReports'];

const STAGES = [
  'requirement-agent',
  'test-design-agent',
  'test-review-agent', // independent review on a different model, before any automation is written
  'automation-agent',
  'execution-agent',
  'failure-analysis-agent',
  'defect-triage-agent',
  'release-agent',
];

fs.mkdirSync(REQUIREMENT_DIR, { recursive: true });

// ---- File helpers ----
const rel = (abs) => path.relative(PROJECT_ROOT, abs).split(path.sep).join('/');
const exists = (p) => fs.existsSync(path.join(PROJECT_ROOT, p));
const isFresh = (p, since) => exists(p) && fs.statSync(path.join(PROJECT_ROOT, p)).mtimeMs >= since;

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function writeManifest(m) { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }

function specFiles() {
  if (!fs.existsSync(SPEC_DIR)) return [];
  return fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.ts')).map((f) => `TestAutomate/tests/${f}`);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every test in the suite with its real title and Scenario IDs, as Playwright itself reports them.
// Reading spec source isn't reliable: titles can be built in code (test(t.title, ...)) and IDs can
// appear in comments. Listing takes ~30s, so it's cached until a test, page object or the config changes.
const AUTOMATE_DIR = path.join(PROJECT_ROOT, 'TestAutomate');
let listCache = { key: null, tests: null, pending: null };

function suiteKey() {
  const files = [path.join(AUTOMATE_DIR, 'playwright.config.ts')];
  for (const dir of ['tests', 'pages']) {
    const abs = path.join(AUTOMATE_DIR, dir);
    if (fs.existsSync(abs)) for (const f of fs.readdirSync(abs, { recursive: true })) files.push(path.join(abs, f));
  }
  return files.filter((f) => fs.existsSync(f)).map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
}

function listAllTests() {
  const key = suiteKey();
  if (listCache.key === key && listCache.tests) return Promise.resolve(listCache.tests);
  if (listCache.key === key && listCache.pending) return listCache.pending;
  const pending = new Promise((resolve, reject) => {
    execFile('npx playwright test --list --reporter=json', { cwd: AUTOMATE_DIR, shell: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      let report;
      try { report = JSON.parse(stdout); } catch {
        // Include what Playwright actually printed: err.message alone is often just "Command failed".
        const detail = [stderr, stdout].map((s) => (s || '').trim()).filter(Boolean).join('\n').slice(0, 2000);
        console.error('Playwright --list failed:', err?.message, '\n', detail);
        return reject(new Error(`Could not list Playwright tests: ${err?.message || 'unreadable output'}${detail ? `\n${detail}` : ' (no output)'}`));
      }
      const tests = [];
      const walk = (suite) => {
        for (const sp of suite.specs || []) {
          const ids = new Set([...(sp.title.match(/\[[A-Za-z0-9]*-?SCN-\d+\]/g) || []).map((b) => b.slice(1, -1)), ...(sp.tags || []).map((t) => t.replace(/^@/, '')).filter((t) => /^[A-Za-z0-9]*-?SCN-\d+$/.test(t))]);
          tests.push({ spec: `TestAutomate/tests/${sp.file.split(path.sep).join('/')}`, title: sp.title.replace(/^(\[[^\]]*\])+\s*/, ''), ids: [...ids] });
        }
        for (const child of suite.suites || []) walk(child);
      };
      for (const suite of report.suites || []) walk(suite);
      resolve(tests);
    });
  });
  listCache = { key, tests: null, pending };
  pending.then((tests) => { if (listCache.pending === pending) listCache = { key, tests, pending: null }; },
    () => { if (listCache.pending === pending) listCache = { key: null, tests: null, pending: null }; });
  return pending;
}

// Finds the individual tests that belong to a requirement, so only those run — not every test in
// the spec files they share with other requirements. A test can carry several Scenario IDs
// (e.g. '[SCN-1][SCN-14][JIRA190-SCN-9] Completes checkout…'). A requirement's IDs are either
// namespaced ('JIRA190-SCN-9') or, for older requirements, bare ('SCN-9') as listed in its TestDesign CSV.
async function identifyTests(base) {
  const token = base.replace(/[^A-Za-z0-9]/g, '');
  const all = await listAllTests();
  const namespaced = all.some((t) => t.ids.some((id) => id.startsWith(`${token}-SCN-`)));
  let ownIds;
  let grep;
  if (namespaced) {
    ownIds = (id) => id.startsWith(`${token}-SCN-`);
    grep = `\\[${escRe(token)}-SCN-\\d+\\]`;
  } else {
    const design = path.join(PROJECT_ROOT, `TestDesign/${base}_PlaywrightScenarios.csv`);
    const csvIds = fs.existsSync(design) ? [...new Set(fs.readFileSync(design, 'utf8').match(/^"?(SCN-\d+)"?,/gm) || [])].map((s) => s.replace(/[",]/g, '')) : [];
    const set = new Set(csvIds);
    ownIds = (id) => set.has(id);
    grep = csvIds.length ? `\\[(${csvIds.join('|')})\\]` : null;
  }
  const tests = [];
  for (const t of all) {
    const mine = t.ids.filter(ownIds);
    if (mine.length) tests.push({ spec: t.spec, id: mine.join(', '), title: t.title });
  }
  return { tests, grep: tests.length ? grep : null, specs: [...new Set(tests.map((t) => t.spec))].sort() };
}

// What a re-upload of this requirement means: unchanged + its tests already exist => skip stages 1–3
// and run just those tests from the execution stage onward.
async function analyze(base, contentChanged) {
  const testCases = `TestCases/${base}_TestDesign.csv`;
  const design = `TestDesign/${base}_PlaywrightScenarios.csv`;
  // Tests are found by their Scenario IDs in the specs, so this works even after a reset has cleared
  // TestDesign/ (namespaced IDs like JIRA191-SCN-4 need no design file; bare SCN-n IDs still do).
  const found = await identifyTests(base);
  // hasTests: running the existing tests is possible. canRerun: it's the recommended default
  // (the requirement is unchanged); when it has changed, regenerating is suggested instead.
  const hasTests = found.tests.length > 0;
  const canRerun = !contentChanged && hasTests;
  return { ...found, testCases: exists(testCases) ? testCases : null, design: exists(design) ? design : null, hasTests, canRerun };
}

// ---- Upload: keep the original name (downstream agents derive output names from it) ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---- Single active run; its event log is polled by every open page via /api/state ----
let run = null;

function emit(evt) {
  if (!run) return;
  evt.ts = Date.now();
  run.events.push(evt);
}

function setStage(name, patch) {
  Object.assign(run.stages.find((s) => s.name === name), patch);
  emit({ type: 'stages', stages: run.stages });
}

function summarizeToolUse(block) {
  const i = block.input || {};
  switch (block.name) {
    case 'Agent':
    case 'Task':
      return `Delegating to ${i.subagent_type || 'agent'}: ${i.description || ''}`;
    case 'Bash':
    case 'PowerShell':
      return `$ ${String(i.command || '').slice(0, 200)}`;
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${block.name} ${rel(path.resolve(PROJECT_ROOT, i.file_path || '.'))}`;
    case 'Glob':
    case 'Grep':
      return `${block.name} ${i.pattern || ''}`;
    default:
      return block.name;
  }
}

// Runs one stage agent as its own top-level session, so it gets exactly the tools its definition
// grants (e.g. Bash for execution-agent) rather than whatever a parent orchestrator was given.
async function runAgent(agent, prompt) {
  const q = query({
    prompt,
    options: {
      cwd: PROJECT_ROOT,
      agent,
      settingSources: ['project', 'user'], // loads .claude/agents/*.md
      permissionMode: 'bypassPermissions', // unattended run: stages need Bash (Playwright, Jira API) and Write
      allowDangerouslySkipPermissions: true,
      abortController: run.abort,
      // No MCP servers: no stage uses them (Jira goes through the REST API with .env credentials), and
      // loading the account's claude.ai connectors only added "needs authorizing" noise to summaries.
      strictMcpConfig: true,
      env: { ...process.env, ...(GIT_BASH ? { CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH } : {}) },
      ...(process.env.CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH } : {}),
    },
  });
  let result = { ok: false, text: '' };
  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') emit({ type: 'log', level: 'tool', agent, text: summarizeToolUse(block) });
        else if (block.type === 'text' && block.text.trim()) emit({ type: 'log', level: 'text', agent, text: block.text.trim() });
      }
    } else if (msg.type === 'result') {
      result = { ok: msg.subtype === 'success' && !msg.is_error, text: msg.result || msg.subtype, cost: msg.total_cost_usd || 0 };
    }
  }
  return result;
}

const PROMPTS = {
  'requirement-agent': (c) => `Analyze the requirement in ${c.requirement} and write TestCases/${c.base}_TestDesign.csv.`,
  'test-design-agent': (c) => `Generate Playwright test scenarios from TestCases/${c.base}_TestDesign.csv and write TestDesign/${c.base}_PlaywrightScenarios.csv. ` +
    `Run the coverage check against the existing tests in TestAutomate/tests/ and write TestDesign/${c.base}_Coverage.json (always, even at 0%).`,
  'test-review-agent': (c) =>
    `Review the test cases for requirement ${c.base} against the requirement itself: ${c.requirement}, TestCases/${c.base}_TestDesign.csv, ` +
    `TestDesign/${c.base}_PlaywrightScenarios.csv and TestDesign/${c.base}_Coverage.json. ` +
    `Write TestReview/${c.base}_TestReview.json and TestReview/${c.base}_TestReview.md.`,
  'automation-agent': (c) => {
    const ids = `${c.base.replace(/[^A-Za-z0-9]/g, '')}-SCN-<n>`;
    const cov = c.coverage;
    const plan = !cov ? ''
      : c.mappingOnly
        ? `MAPPING ONLY: all ${cov.total} scenarios are already covered by existing tests (see TestDesign/${c.base}_Coverage.json), and the user chose to re-execute them. Write no new tests and change no page objects: only add this requirement's Scenario IDs (${ids}) to each covering test's title, tags and annotations. `
        : `${cov.covered} of ${cov.total} scenarios (${cov.percent}%) are already covered by existing tests. Map those IDs onto the covering tests, and write new tests only for the ${cov.new} scenarios marked New in TestDesign/${c.base}_Coverage.json. `;
    const review = c.review?.findings?.length
      ? `An independent reviewer left findings in TestReview/${c.base}_TestReview.md. Apply its recommendations where they concern how a scenario should be automated (e.g. wrong actor or account, a weak assertion, or a doubtful "already covered" mapping); don't rewrite the TestCases/TestDesign files. `
      : '';
    return `Automate the scenarios in TestDesign/${c.base}_PlaywrightScenarios.csv under TestAutomate/. ${plan}${review}` +
      `In your final report, list every spec file under TestAutomate/tests/ that now contains tests for these scenarios (new, extended, or mapped onto existing tests).`;
  },
  'execution-agent': (c) =>
    `Run only the ${c.tests.length} tests that belong to requirement ${c.base}, in ${HEADED ? 'headed' : 'headless'} mode${HEADED ? '' : ' (this server has no display: do not pass --headed)'}. They live in these spec files:\n${c.specs.map((s) => `- ${s}`).join('\n')}\n` +
    `Select them with Playwright's title filter, passing the spec files above as arguments too: --grep "${c.grep}"\n` +
    `Tests in those files that belong to other requirements must not run. Publish ONE combined report for this requirement at TestResults/${c.base}_TestResults.html (not one per spec file).\n` +
    `Run Playwright in the foreground (not as a background task) with a long timeout; if it could take longer than ~9 minutes, run one spec file per command with the same --grep and merge the JSON results into the one report. This session ends when you reply, so only reply once the report is written.`,
  // Exact output paths, not "<basename>_…" patterns: given a pattern, agents have taken the report's
  // whole name as the basename (JIRA-191_TestResults_FailureAnalysis.csv), which blocked the run.
  'failure-analysis-agent': (c) => `Analyze these test result reports and write the failure analysis CSV at exactly the path shown (write it even if a report has no failures):\n${c.reports.map((r) => `- ${r} → ${analysisPath(r)}`).join('\n')}`,
  'defect-triage-agent': (c) => `File Jira defects under parent issue ${c.parentIssue} for these failure analyses, writing the defects CSV at exactly the path shown (even if no defects qualify). Jira credentials are in the project's .env.\n${c.analyses.map((a) => `- ${a} → ${a.replace(/\.csv$/, '_JiraDefects.csv')}`).join('\n')}`,
  'release-agent': (c) =>
    `Assess release readiness for requirement ${c.base} using these files, and save the report as ReleaseReadiness/${c.base}_ReleaseReadiness.html, plus its summary as ReleaseReadiness/${c.base}_ReleaseReadiness.json:\n${[...c.reports, ...c.analyses, ...c.defects, ...(c.review ? [`TestReview/${c.base}_TestReview.md (test case review: ${c.review.verdict}, score ${c.review.score})`] : [])].map((f) => `- ${f}`).join('\n')}`,
};

// Reads test-design-agent's coverage verdict. Counts are recomputed from the per-scenario list
// rather than trusting the agent's own totals.
function readCoverage(file) {
  const j = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'));
  const scenarios = Array.isArray(j.scenarios) ? j.scenarios : [];
  const isCovered = (x) => /^covered$/i.test(String(x.status || ''));
  const total = scenarios.length || Number(j.totalScenarios) || 0;
  const covered = scenarios.length ? scenarios.filter(isCovered).length : Number(j.coveredScenarios) || 0;
  return {
    total, covered, new: total - covered, percent: total ? Math.round((100 * covered) / total) : 0,
    scenarios: scenarios.map((x) => ({ id: x.id, name: x.name, status: isCovered(x) ? 'Covered' : 'New', coveredBy: x.coveredBy || null })),
  };
}

// Reads test-review-agent's verdict. Counts are taken from the findings list, and the verdict is
// re-derived from them using the agent's own rules, so a mislabelled verdict can't skip the gate.
function readReview(file) {
  const j = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'));
  const findings = (Array.isArray(j.findings) ? j.findings : []).map((f) => ({
    severity: /^crit/i.test(f.severity) ? 'Critical' : /^maj/i.test(f.severity) ? 'Major' : 'Minor',
    area: f.area || '', ids: Array.isArray(f.ids) ? f.ids : [], issue: f.issue || '', recommendation: f.recommendation || '',
  }));
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity.toLowerCase()]++;
  const verdict = counts.critical || counts.major >= 3 ? 'Changes required' : counts.major ? 'Approved with comments' : 'Approved';
  const score = Math.max(0, 100 - 25 * counts.critical - 8 * counts.major - 2 * counts.minor);
  return { verdict, score, counts, findings, agentVerdict: j.verdict || null };
}

// Pauses the run until someone answers on the page (POST /api/decision). Cancelling counts as "no".
function askDecision(question, labels = { yes: 'Yes', no: 'No, stop here' }) {
  run.status = 'awaiting';
  run.decision = { question, labels, askedAt: Date.now() };
  emit({ type: 'decision', question, labels });
  return new Promise((resolve) => {
    const finish = (choice) => {
      run.resolveDecision = null;
      run.decision = null;
      run.status = 'running';
      run.abort.signal.removeEventListener('abort', onAbort);
      resolve(choice);
    };
    const onAbort = () => finish('no');
    run.abort.signal.addEventListener('abort', onAbort);
    run.resolveDecision = finish;
  });
}

const analysisPath = (report) => `FailureAnalysis/${path.basename(report).replace(/_TestResults\.html$/, '')}_FailureAnalysis.csv`;

// After each stage, confirm on disk that it produced what the next stage needs. Returns an error string or null.
async function verify(stage, c, since) {
  switch (stage) {
    case 'requirement-agent':
      return isFresh(`TestCases/${c.base}_TestDesign.csv`, since) ? null : `TestCases/${c.base}_TestDesign.csv was not written`;
    case 'test-design-agent': {
      if (!isFresh(`TestDesign/${c.base}_PlaywrightScenarios.csv`, since)) return `TestDesign/${c.base}_PlaywrightScenarios.csv was not written`;
      const covFile = `TestDesign/${c.base}_Coverage.json`;
      if (!isFresh(covFile, since)) return `${covFile} (the coverage check against existing tests) was not written`;
      try {
        c.coverage = readCoverage(covFile);
      } catch (err) {
        return `${covFile} is unreadable: ${err.message}`;
      }
      return null;
    }
    case 'test-review-agent': {
      const file = `TestReview/${c.base}_TestReview.json`;
      if (!isFresh(file, since)) return `${file} was not written`;
      if (!isFresh(`TestReview/${c.base}_TestReview.md`, since)) return `TestReview/${c.base}_TestReview.md was not written`;
      try {
        c.review = readReview(file);
      } catch (err) {
        return `${file} is unreadable: ${err.message}`;
      }
      return null;
    }
    case 'automation-agent': {
      Object.assign(c, await identifyTests(c.base));
      return c.tests.length ? null : `No tests under TestAutomate/tests/ carry this requirement's Scenario IDs`;
    }
    case 'execution-agent': {
      c.reports = [`TestResults/${c.base}_TestResults.html`];
      return isFresh(c.reports[0], since) ? null : `${c.reports[0]} was not written`;
    }
    case 'failure-analysis-agent': {
      c.analyses = c.reports.map(analysisPath);
      // Still accept the variant name an agent may use (…_TestResults_FailureAnalysis.csv), renaming it
      // to the expected path so later stages and reruns see one consistent file.
      for (const a of c.analyses) {
        const variant = a.replace(/_FailureAnalysis\.csv$/, '_TestResults_FailureAnalysis.csv');
        if (!isFresh(a, since) && isFresh(variant, since)) fs.renameSync(path.join(PROJECT_ROOT, variant), path.join(PROJECT_ROOT, a));
      }
      const missing = c.analyses.filter((a) => !isFresh(a, since));
      return missing.length ? `Missing failure analysis: ${missing.join(', ')}` : null;
    }
    case 'defect-triage-agent': {
      // Naming varies slightly between runs (<x>_FailureAnalysis_JiraDefects.csv vs <x>_JiraDefects.csv), so accept any fresh one.
      c.defects = fs.readdirSync(path.join(PROJECT_ROOT, 'FailureAnalysis'))
        .map((f) => `FailureAnalysis/${f}`)
        .filter((f) => f.endsWith('_JiraDefects.csv') && isFresh(f, since));
      return c.defects.length ? null : 'No *_JiraDefects.csv file was written';
    }
    case 'release-agent':
      return isFresh(`ReleaseReadiness/${c.base}_ReleaseReadiness.html`, since) ? null : `ReleaseReadiness/${c.base}_ReleaseReadiness.html was not written`;
  }
}

function writePipelineReport(c) {
  const lines = [
    `# QA Pipeline Report — ${c.base}`,
    '',
    `**Requirement:** \`${c.requirement}\`  `,
    `**Mode:** ${c.mode === 'rerun' ? 'Rerun — existing test scripts reused, stages 1–3 skipped' : 'Full pipeline'}  `,
    `**Parent Jira issue for defects:** ${c.parentIssue}  `,
    `**Run date:** ${new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    ...(c.review ? [`**Test case review:** ${c.review.verdict} (score ${c.review.score}): ${c.review.counts.critical} critical, ${c.review.counts.major} major, ${c.review.counts.minor} minor  `] : []),
    ...(c.coverage ? [`**Existing coverage:** ${c.coverage.covered}/${c.coverage.total} scenarios (${c.coverage.percent}%) already covered; ${c.coverage.new} new${c.mappingOnly ? ' (re-executed existing tests only)' : ''}  `] : []),
    '',
  ];
  run.stages.forEach((s, i) => {
    lines.push(`## Stage ${i + 1} — ${s.name}`, '', `**Status:** ${s.state}`, '');
    if (s.summary) lines.push(s.summary, '');
  });
  const out = `PipelineReports/${c.base}_PipelineReport.md`;
  fs.mkdirSync(path.join(PROJECT_ROOT, 'PipelineReports'), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, out), lines.join('\n'));
}

// ---- Report summary shown in the UI's Reporting section ----
const htmlText = (file) => fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8')
  .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// Counts from the execution report's summary line ("Total 34 · Passed 34 · Failed 0 · …").
function readTestCounts(file) {
  if (!exists(file)) return null;
  const text = htmlText(file);
  const num = (label) => { const m = text.match(new RegExp(`\\b${label}\\b\\W{0,6}(\\d+(?:\\.\\d+)?)`, 'i')); return m ? Number(m[1]) : null; };
  const total = num('Total');
  if (total == null) return null;
  const passed = num('Passed') ?? 0;
  const dur = text.match(/\bDuration\W{0,6}(\d+(?:\.\d+)?)\s*(ms|s|m|min)?/i);
  return {
    total, passed, failed: num('Failed') ?? 0, flaky: num('Flaky') ?? 0, skipped: num('Skipped') ?? 0,
    passRate: total ? Math.round((1000 * passed) / total) / 10 : 0,
    duration: dur ? `${dur[1]}${dur[2] || 's'}` : null,
  };
}

// The release call: from the agent's JSON when present, else read off the HTML banner.
function readRelease(base) {
  const json = `ReleaseReadiness/${base}_ReleaseReadiness.json`;
  const html = `ReleaseReadiness/${base}_ReleaseReadiness.html`;
  if (exists(json)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, json), 'utf8'));
      return {
        recommendation: j.recommendation || null, riskLevel: j.riskLevel || null,
        qualityScore: j.qualityScore ?? null, summary: j.summary || '',
        keyRisks: Array.isArray(j.keyRisks) ? j.keyRisks.slice(0, 5) : [],
        conditions: Array.isArray(j.conditions) ? j.conditions.slice(0, 5) : [],
      };
    } catch { /* fall through to the HTML */ }
  }
  if (!exists(html)) return null;
  const text = htmlText(html);
  const rec = text.match(/Recommendation\W{0,4}(No[-\s]?Go|Go with conditions|Conditional Go|Not ready|Go)/i);
  const risk = text.match(/Risk Level\W{0,4}(Trivial|Low|Medium|High)/i);
  const score = text.match(/Quality Score\W{0,6}(\d{1,3})/i);
  const norm = (r) => (/no[-\s]?go|not ready/i.test(r) ? 'No-Go' : /condition/i.test(r) ? 'Go with conditions' : 'Go');
  return { recommendation: rec ? norm(rec[1]) : null, riskLevel: risk ? risk[1] : null, qualityScore: score ? Number(score[1]) : null, summary: '', keyRisks: [], conditions: [] };
}

// Jira defects this run filed (or found already filed), from the *_JiraDefects.csv files.
function readDefects(files) {
  let created = 0, existing = 0, failed = 0;
  for (const f of files || []) {
    if (!exists(f)) continue;
    for (const line of fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8').split(/\r?\n/).slice(1)) {
      if (/,\s*"?Created"?\s*,/i.test(line)) created++;
      else if (/,\s*"?Already exists"?\s*,/i.test(line)) existing++;
      else if (/,\s*"?Failed"?\s*,/i.test(line)) failed++;
    }
  }
  return { created, existing, failed };
}

function buildSummary(c) {
  const resultsFile = `TestResults/${c.base}_TestResults.html`;
  const releaseFile = `ReleaseReadiness/${c.base}_ReleaseReadiness.html`;
  // Only link reports this run actually produced, so an old report is never shown as this run's.
  const fresh = (f) => isFresh(f, run.startedAt);
  return {
    requirement: c.base,
    mode: c.mode,
    tests: fresh(resultsFile) ? readTestCounts(resultsFile) : null,
    release: fresh(releaseFile) ? readRelease(c.base) : null,
    defects: c.defects?.length ? readDefects(c.defects) : null,
    review: c.review ? { verdict: c.review.verdict, score: c.review.score, counts: c.review.counts } : null,
    coverage: c.coverage ? { percent: c.coverage.percent, covered: c.coverage.covered, total: c.coverage.total } : null,
    reports: {
      testResults: fresh(resultsFile) ? `/files/${resultsFile}` : null,
      releaseReadiness: fresh(releaseFile) ? `/files/${releaseFile}` : null,
    },
  };
}

function listOutputs(c) {
  const files = [];
  for (const dir of OUTPUT_DIRS) {
    const abs = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      const p = `${dir}/${f}`;
      if (!fs.statSync(path.join(abs, f)).isFile()) continue;
      const fresh = isFresh(p, run.startedAt);
      const reused = c.mode === 'rerun' && (p === c.testCases || p === c.design);
      if (fresh || reused) files.push({ folder: dir, name: f, url: `/files/${dir}/${encodeURIComponent(f)}`, reused: reused && !fresh });
    }
  }
  return files.sort((a, b) => OUTPUT_DIRS.indexOf(a.folder) - OUTPUT_DIRS.indexOf(b.folder));
}

async function runPipeline(c) {
  emit({ type: 'log', level: 'info', text: c.mode === 'rerun'
    ? `Same requirement: skipping stages 1–4 and running its ${c.tests.length} existing tests (${c.specs.join(', ')})`
    : `Starting full pipeline for ${c.requirement} (parent ${c.parentIssue})` });

  let blocked = null;
  let stopped = null; // why the user ended the run early: 'already-covered' or 'review-changes'
  for (const stage of STAGES) {
    const s = run.stages.find((x) => x.name === stage);
    if (s.state === 'skipped') continue;
    if (run.abort.signal.aborted) { blocked = 'cancelled'; break; }

    const since = Date.now() - 2000;
    setStage(stage, { state: 'running', startedAt: Date.now() });
    emit({ type: 'log', level: 'info', agent: stage, text: `Stage ${STAGES.indexOf(stage) + 1}: ${stage} started` });
    try {
      const res = await runAgent(stage, PROMPTS[stage](c));
      const problem = !res.ok ? `Agent session ended with "${res.text}"` : await verify(stage, c, since);
      setStage(stage, { state: problem ? 'failed' : 'done', summary: res.text, error: problem, endedAt: Date.now() });
      if (problem) {
        emit({ type: 'log', level: 'error', agent: stage, text: `Blocked: ${problem}` });
        blocked = stage;
        break;
      }
      if (stage === 'test-design-agent' && c.coverage) {
        const cov = c.coverage;
        run.coverage = cov;
        emit({ type: 'coverage', coverage: cov });
        emit({ type: 'log', level: 'info', agent: stage, text: `Coverage: ${cov.covered}/${cov.total} scenarios (${cov.percent}%) already covered by existing tests; ${cov.new} new` });
      }
      if (stage === 'test-review-agent' && c.review) {
        const r = c.review;
        run.review = r;
        emit({ type: 'review', review: r });
        emit({ type: 'log', level: 'info', agent: stage, text: `Review: ${r.verdict} (score ${r.score}): ${r.counts.critical} critical, ${r.counts.major} major, ${r.counts.minor} minor` });
        const skipRest = (reason) => {
          for (const x of run.stages) if (x.state === 'pending') x.state = 'skipped';
          emit({ type: 'stages', stages: run.stages });
          stopped = run.abort.signal.aborted ? 'cancelled' : reason;
        };
        if (r.verdict === 'Changes required') {
          const choice = await askDecision(
            `The test case review found problems: ${r.counts.critical} critical and ${r.counts.major} major findings (score ${r.score}). See the Test review stage or TestReview/${c.base}_TestReview.md. Continue to automation anyway?`,
            { yes: 'Continue anyway', no: 'Stop and fix the test cases' });
          emit({ type: 'log', level: 'info', text: choice === 'yes' ? 'Decision: continue despite review findings' : 'Decision: stop to fix the test cases' });
          if (choice !== 'yes') { skipRest('review-changes'); break; }
        }
        const cov = c.coverage;
        if (cov?.total && cov.covered === cov.total) {
          const choice = await askDecision(
            `All ${cov.total} scenarios of ${c.base} are already covered by existing tests (100% coverage). No new test cases or scripts are needed. Re-execute the existing tests?`,
            { yes: 'Yes, re-execute the tests', no: 'No, stop here' });
          emit({ type: 'log', level: 'info', text: choice === 'yes' ? 'Decision: re-execute the existing tests' : 'Decision: stop here, without re-executing' });
          if (choice !== 'yes') { skipRest('already-covered'); break; }
          c.mappingOnly = true;
        }
      }
    } catch (err) {
      const msg = run.abort.signal.aborted ? 'Cancelled' : `Error: ${err.message || err}`;
      setStage(stage, { state: 'failed', error: msg, endedAt: Date.now() });
      emit({ type: 'log', level: 'error', agent: stage, text: msg });
      blocked = run.abort.signal.aborted ? 'cancelled' : stage;
      break;
    }
  }

  if (stopped === 'cancelled') blocked = 'cancelled';
  run.status = blocked === 'cancelled' ? 'cancelled' : blocked ? 'failed' : 'completed';
  if (c.specs?.length) {
    const m = readManifest();
    m[c.base] = { specs: c.specs, lastRun: new Date().toISOString(), status: run.status };
    writeManifest(m);
  }
  writePipelineReport(c);
  const release = run.stages.find((s) => s.name === 'release-agent');
  run.summary = buildSummary(c);
  emit({ type: 'done', status: run.status, blockedAt: blocked, stoppedReason: stopped, coverage: c.coverage || null, review: c.review || null, verdict: release.state === 'done' ? release.summary : null, summary: run.summary, outputs: listOutputs(c) });
}

// ---- HTTP ----
const app = express();

// Password gate for when the UI is shared with other people: agents run with permission
// checks off, so nobody without the password may reach any route. Set UI_PASSWORD in the project's .env.
if (process.env.UI_PASSWORD) {
  const expected = Buffer.from(process.env.UI_PASSWORD);
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const password = scheme === 'Basic' ? Buffer.from(encoded || '', 'base64').toString().split(':').slice(1).join(':') : '';
    const given = Buffer.from(password);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="QA Agent Pipeline"').status(401).send('Password required');
  });
} else {
  console.warn('UI_PASSWORD is not set — the UI is open to anyone who can reach this port.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
for (const dir of OUTPUT_DIRS) app.use(`/files/${dir}`, express.static(path.join(PROJECT_ROOT, dir)));

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  if (run?.status === 'running' || run?.status === 'awaiting') return res.status(409).json({ error: 'A pipeline run is in progress — wait for it to finish' });
  const file = path.basename(req.file.originalname).replace(/[^\w.\-]/g, '_');
  const dest = path.join(REQUIREMENT_DIR, file);
  const previous = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  const contentChanged = previous ? !previous.equals(req.file.buffer) : true;
  fs.writeFileSync(dest, req.file.buffer);
  const base = path.parse(file).name;
  try {
    res.json({ file, path: `Requirement/${file}`, base, previouslyUploaded: !!previous, contentChanged: !!previous && contentChanged, ...(await analyze(base, contentChanged)) });
  } catch (err) { res.status(500).json({ error: `Uploaded, but ${err.message}` }); }
});

// Requirements already in Requirement/, with the tests that exist for each, so one can be rerun without uploading.
app.get('/api/requirements', async (_req, res) => {
  let list;
  try {
    list = await Promise.all(fs.readdirSync(REQUIREMENT_DIR)
    .filter((f) => fs.statSync(path.join(REQUIREMENT_DIR, f)).isFile())
    .map(async (file) => {
      const base = path.parse(file).name;
      return { file, path: `Requirement/${file}`, base, previouslyUploaded: true, contentChanged: false, ...(await analyze(base, false)) };
    }));
  } catch (err) { return res.status(500).json({ error: err.message }); }
  res.json(list);
});

app.post('/api/run', async (req, res) => {
  if (run?.status === 'running' || run?.status === 'awaiting') return res.status(409).json({ error: 'A pipeline run is already in progress' });
  const file = path.basename(String(req.body.file || ''));
  const parentIssue = String(req.body.parentIssue || '').trim().toUpperCase();
  if (!file || !fs.existsSync(path.join(REQUIREMENT_DIR, file))) return res.status(400).json({ error: 'Requirement file not found — upload it first' });
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(parentIssue)) return res.status(400).json({ error: 'Parent Jira issue must look like SCRUM-1' });

  const base = path.parse(file).name;
  let info;
  try { info = await analyze(base, false); } catch (err) { return res.status(500).json({ error: err.message }); }
  if (run?.status === 'running' || run?.status === 'awaiting') return res.status(409).json({ error: 'A pipeline run is already in progress' });
  const mode = req.body.mode === 'rerun' && info.canRerun ? 'rerun' : 'full';
  const c = { base, requirement: `Requirement/${file}`, parentIssue, mode, testCases: info.testCases, design: info.design,
    ...(mode === 'rerun' ? { tests: info.tests, grep: info.grep, specs: info.specs } : { tests: [], specs: [] }) };

  run = {
    id: Date.now().toString(36),
    file,
    mode,
    status: 'running',
    stages: STAGES.map((name, i) => ({ name, state: mode === 'rerun' && i < STAGES.indexOf('automation-agent') + 1 ? 'skipped' : 'pending' })),
    events: [],
    startedAt: Date.now(),
    abort: new AbortController(),
  };
  runPipeline(c);
  res.json({ id: run.id, mode });
});

app.post('/api/cancel', (_req, res) => {
  if (run?.status === 'running' || run?.status === 'awaiting') run.abort.abort();
  res.json({ ok: true });
});

app.post('/api/decision', (req, res) => {
  if (run?.status !== 'awaiting' || !run.resolveDecision) return res.status(409).json({ error: 'No decision is pending' });
  const choice = req.body.choice === 'yes' ? 'yes' : 'no';
  run.resolveDecision(choice);
  res.json({ ok: true, choice });
});

// Polled by the page every couple of seconds. (A streaming event-source connection would be
// lighter, but tunnels and reverse proxies often buffer such streams, so progress never reached viewers.)
app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!run) return res.json({ idle: true });
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  res.json({ id: run.id, file: run.file, mode: run.mode, status: run.status, stages: run.stages, decision: run.decision || null, coverage: run.coverage || null, review: run.review || null, events: run.events.slice(since), next: run.events.length });
});

app.listen(PORT, () => {
  console.log(`QA Agent UI listening on port ${PORT} (http://${os.hostname()}:${PORT}) · Playwright ${HEADED ? 'headed' : 'headless'}`);
  listAllTests().catch((err) => console.warn(err.message)); // warm the test list so the first page load is quick
});
