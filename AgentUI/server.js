import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
const OUTPUT_DIRS = ['Requirement', 'TestCases', 'TestDesign', 'TestResults', 'FailureAnalysis', 'ReleaseReadiness', 'PipelineReports'];

const STAGES = [
  'requirement-agent',
  'test-design-agent',
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
const specBase = (p) => path.basename(p).replace(/\.spec\.ts$/, '');

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function writeManifest(m) { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); }

function specFiles() {
  if (!fs.existsSync(SPEC_DIR)) return [];
  return fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.ts')).map((f) => `TestAutomate/tests/${f}`);
}

// Spec files that hold tests for a requirement: its own <base>.spec.ts, any spec carrying its
// namespaced Scenario IDs (e.g. JIRA190-SCN-4), plus whatever the last run recorded in the manifest.
function findSpecsFor(base) {
  const token = `${base.replace(/[^A-Za-z0-9]/g, '')}-SCN-`;
  const found = new Set((readManifest()[base]?.specs || []).filter(exists));
  for (const s of specFiles()) {
    if (specBase(s) === base || fs.readFileSync(path.join(PROJECT_ROOT, s), 'utf8').includes(token)) found.add(s);
  }
  return [...found].sort();
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
    execFile('npx playwright test --list --reporter=json', { cwd: AUTOMATE_DIR, shell: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      let report;
      try { report = JSON.parse(stdout); } catch { return reject(new Error(`Could not list Playwright tests: ${err?.message || 'unreadable output'}`)); }
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
  const found = exists(design) ? await identifyTests(base) : { tests: [], grep: null, specs: findSpecsFor(base) };
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
  'automation-agent': (c) => {
    const ids = `${c.base.replace(/[^A-Za-z0-9]/g, '')}-SCN-<n>`;
    const cov = c.coverage;
    const plan = !cov ? ''
      : c.mappingOnly
        ? `MAPPING ONLY: all ${cov.total} scenarios are already covered by existing tests (see TestDesign/${c.base}_Coverage.json), and the user chose to re-execute them. Write no new tests and change no page objects: only add this requirement's Scenario IDs (${ids}) to each covering test's title, tags and annotations. `
        : `${cov.covered} of ${cov.total} scenarios (${cov.percent}%) are already covered by existing tests. Map those IDs onto the covering tests, and write new tests only for the ${cov.new} scenarios marked New in TestDesign/${c.base}_Coverage.json. `;
    return `Automate the scenarios in TestDesign/${c.base}_PlaywrightScenarios.csv under TestAutomate/. ${plan}` +
      `In your final report, list every spec file under TestAutomate/tests/ that now contains tests for these scenarios (new, extended, or mapped onto existing tests).`;
  },
  'execution-agent': (c) =>
    `Run only the ${c.tests.length} tests that belong to requirement ${c.base}, in headed mode. They live in these spec files:\n${c.specs.map((s) => `- ${s}`).join('\n')}\n` +
    `Select them with Playwright's title filter, passing the spec files above as arguments too: --grep "${c.grep}"\n` +
    `Tests in those files that belong to other requirements must not run. Publish ONE combined report for this requirement at TestResults/${c.base}_TestResults.html (not one per spec file).\n` +
    `Run Playwright in the foreground (not as a background task) with a long timeout; if it could take longer than ~9 minutes, run one spec file per command with the same --grep and merge the JSON results into the one report. This session ends when you reply, so only reply once the report is written.`,
  // Exact output paths, not "<basename>_…" patterns: given a pattern, agents have taken the report's
  // whole name as the basename (JIRA-191_TestResults_FailureAnalysis.csv), which blocked the run.
  'failure-analysis-agent': (c) => `Analyze these test result reports and write the failure analysis CSV at exactly the path shown (write it even if a report has no failures):\n${c.reports.map((r) => `- ${r} → ${analysisPath(r)}`).join('\n')}`,
  'defect-triage-agent': (c) => `File Jira defects under parent issue ${c.parentIssue} for these failure analyses, writing the defects CSV at exactly the path shown (even if no defects qualify). Jira credentials are in the project's .env.\n${c.analyses.map((a) => `- ${a} → ${a.replace(/\.csv$/, '_JiraDefects.csv')}`).join('\n')}`,
  'release-agent': (c) =>
    `Assess release readiness for requirement ${c.base} using these files, and save the report as ReleaseReadiness/${c.base}_ReleaseReadiness.html:\n${[...c.reports, ...c.analyses, ...c.defects].map((f) => `- ${f}`).join('\n')}`,
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

// Pauses the run until someone answers on the page (POST /api/decision). Cancelling counts as "stop".
function askDecision(question) {
  run.status = 'awaiting';
  run.decision = { question, askedAt: Date.now() };
  emit({ type: 'decision', question });
  return new Promise((resolve) => {
    const finish = (choice) => {
      run.resolveDecision = null;
      run.decision = null;
      run.status = 'running';
      run.abort.signal.removeEventListener('abort', onAbort);
      resolve(choice);
    };
    const onAbort = () => finish('stop');
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
    ? `Same requirement: skipping stages 1–3 and running its ${c.tests.length} existing tests (${c.specs.join(', ')})`
    : `Starting full pipeline for ${c.requirement} (parent ${c.parentIssue})` });

  let blocked = null;
  let stopped = null; // 'already-covered' when the user chose not to re-execute fully covered tests
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
        if (cov.total && cov.covered === cov.total) {
          const choice = await askDecision(`All ${cov.total} scenarios of ${c.base} are already covered by existing tests (100% coverage). No new test cases or scripts are needed. Re-execute the existing tests?`);
          emit({ type: 'log', level: 'info', text: choice === 'rerun' ? 'Decision: re-execute the existing tests' : 'Decision: stop here, without re-executing' });
          if (choice !== 'rerun') {
            for (const x of run.stages) if (x.state === 'pending') x.state = 'skipped';
            emit({ type: 'stages', stages: run.stages });
            stopped = run.abort.signal.aborted ? 'cancelled' : 'already-covered';
            break;
          }
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
  emit({ type: 'done', status: run.status, blockedAt: blocked, stoppedReason: stopped, coverage: c.coverage || null, verdict: release.state === 'done' ? release.summary : null, outputs: listOutputs(c) });
}

// ---- HTTP ----
const app = express();

// Password gate for when the UI is shared through a public tunnel: agents run with permission
// checks off, so nobody without the password may reach any route. Set UI_PASSWORD in AgentUI/.env.
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
    stages: STAGES.map((name, i) => ({ name, state: mode === 'rerun' && i < 3 ? 'skipped' : 'pending' })),
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
  const choice = req.body.choice === 'rerun' ? 'rerun' : 'stop';
  run.resolveDecision(choice);
  res.json({ ok: true, choice });
});

// Polled by the page every couple of seconds. (A streaming event-source connection would be
// lighter, but Cloudflare tunnels buffer such streams, so progress never reached shared viewers.)
app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!run) return res.json({ idle: true });
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  res.json({ id: run.id, file: run.file, mode: run.mode, status: run.status, stages: run.stages, decision: run.decision || null, coverage: run.coverage || null, events: run.events.slice(since), next: run.events.length });
});

app.listen(PORT, () => {
  console.log(`QA Agent UI running at http://localhost:${PORT}`);
  listAllTests().catch((err) => console.warn(err.message)); // warm the test list so the first page load is quick
});
