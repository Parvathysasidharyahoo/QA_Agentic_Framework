import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REQUIREMENT_DIR = path.join(PROJECT_ROOT, 'Requirement');
const SPEC_DIR = path.join(PROJECT_ROOT, 'TestAutomate', 'tests');
const MANIFEST = path.join(__dirname, 'runs.json'); // requirement basename -> spec files its tests live in
const PORT = process.env.PORT || 4000;

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

// Finds the individual tests that belong to a requirement, so only those run — not every test in
// the spec files they share with other requirements. Test titles carry bracketed Scenario IDs,
// possibly several (e.g. '[SCN-1][SCN-14][JIRA190-SCN-9] Completes checkout…'). A requirement's IDs
// are either namespaced ('JIRA190-SCN-9') or, for older requirements, bare ('SCN-9') as listed in
// its TestDesign CSV.
function identifyTests(base) {
  const token = base.replace(/[^A-Za-z0-9]/g, '');
  const titleRe = /(['"`])((?:\[[A-Za-z0-9]*-?SCN-\d+\])+)\s*(.*?)\1/g;
  const all = [];
  for (const spec of specFiles()) {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, spec), 'utf8');
    for (const m of src.matchAll(titleRe)) all.push({ spec, ids: m[2].slice(1, -1).split(']['), title: m[3] });
  }
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
function analyze(base, contentChanged) {
  const testCases = `TestCases/${base}_TestDesign.csv`;
  const design = `TestDesign/${base}_PlaywrightScenarios.csv`;
  const found = exists(design) ? identifyTests(base) : { tests: [], grep: null, specs: findSpecsFor(base) };
  const canRerun = !contentChanged && found.tests.length > 0;
  return { ...found, testCases: exists(testCases) ? testCases : null, design: exists(design) ? design : null, canRerun };
}

// ---- Upload: keep the original name (downstream agents derive output names from it) ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---- Single active run, with an event log replayed to any (re)connecting browser ----
let run = null;

function emit(evt) {
  if (!run) return;
  evt.ts = Date.now();
  run.events.push(evt);
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of run.clients) res.write(line);
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
  'test-design-agent': (c) => `Generate Playwright test scenarios from TestCases/${c.base}_TestDesign.csv and write TestDesign/${c.base}_PlaywrightScenarios.csv.`,
  'automation-agent': (c) => `Automate the scenarios in TestDesign/${c.base}_PlaywrightScenarios.csv under TestAutomate/. In your final report, list every spec file under TestAutomate/tests/ that now contains tests for these scenarios (new, extended, or mapped onto existing tests).`,
  'execution-agent': (c) =>
    `Run only the ${c.tests.length} tests that belong to requirement ${c.base}, in headed mode. They live in these spec files:\n${c.specs.map((s) => `- ${s}`).join('\n')}\n` +
    `Select them with Playwright's title filter, passing the spec files above as arguments too: --grep "${c.grep}"\n` +
    `Tests in those files that belong to other requirements must not run. Publish ONE combined report for this requirement at TestResults/${c.base}_TestResults.html (not one per spec file).\n` +
    `Run Playwright in the foreground (not as a background task) with a long timeout; if it could take longer than ~9 minutes, run one spec file per command with the same --grep and merge the JSON results into the one report. This session ends when you reply, so only reply once the report is written.`,
  'failure-analysis-agent': (c) => `Analyze these test result reports and write one FailureAnalysis/<basename>_FailureAnalysis.csv per report (write the CSV even if a report has no failures):\n${c.reports.map((r) => `- ${r}`).join('\n')}`,
  'defect-triage-agent': (c) => `File Jira defects under parent issue ${c.parentIssue} for these failure analyses, writing FailureAnalysis/<basename>_JiraDefects.csv for each (even if no defects qualify). Jira credentials are in the project's .env.\n${c.analyses.map((a) => `- ${a}`).join('\n')}`,
  'release-agent': (c) =>
    `Assess release readiness for requirement ${c.base} using these files, and save the report as ReleaseReadiness/${c.base}_ReleaseReadiness.html:\n${[...c.reports, ...c.analyses, ...c.defects].map((f) => `- ${f}`).join('\n')}`,
};

// After each stage, confirm on disk that it produced what the next stage needs. Returns an error string or null.
function verify(stage, c, since) {
  switch (stage) {
    case 'requirement-agent':
      return isFresh(`TestCases/${c.base}_TestDesign.csv`, since) ? null : `TestCases/${c.base}_TestDesign.csv was not written`;
    case 'test-design-agent':
      return isFresh(`TestDesign/${c.base}_PlaywrightScenarios.csv`, since) ? null : `TestDesign/${c.base}_PlaywrightScenarios.csv was not written`;
    case 'automation-agent': {
      Object.assign(c, identifyTests(c.base));
      return c.tests.length ? null : `No tests under TestAutomate/tests/ carry this requirement's Scenario IDs`;
    }
    case 'execution-agent': {
      c.reports = [`TestResults/${c.base}_TestResults.html`];
      return isFresh(c.reports[0], since) ? null : `${c.reports[0]} was not written`;
    }
    case 'failure-analysis-agent': {
      c.analyses = c.reports.map((r) => `FailureAnalysis/${path.basename(r).replace(/_TestResults\.html$/, '')}_FailureAnalysis.csv`);
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
  for (const stage of STAGES) {
    const s = run.stages.find((x) => x.name === stage);
    if (s.state === 'skipped') continue;
    if (run.abort.signal.aborted) { blocked = 'cancelled'; break; }

    const since = Date.now() - 2000;
    setStage(stage, { state: 'running', startedAt: Date.now() });
    emit({ type: 'log', level: 'info', agent: stage, text: `Stage ${STAGES.indexOf(stage) + 1}: ${stage} started` });
    try {
      const res = await runAgent(stage, PROMPTS[stage](c));
      const problem = !res.ok ? `Agent session ended with "${res.text}"` : verify(stage, c, since);
      setStage(stage, { state: problem ? 'failed' : 'done', summary: res.text, error: problem, endedAt: Date.now() });
      if (problem) {
        emit({ type: 'log', level: 'error', agent: stage, text: `Blocked: ${problem}` });
        blocked = stage;
        break;
      }
    } catch (err) {
      const msg = run.abort.signal.aborted ? 'Cancelled' : `Error: ${err.message || err}`;
      setStage(stage, { state: 'failed', error: msg, endedAt: Date.now() });
      emit({ type: 'log', level: 'error', agent: stage, text: msg });
      blocked = run.abort.signal.aborted ? 'cancelled' : stage;
      break;
    }
  }

  run.status = blocked === 'cancelled' ? 'cancelled' : blocked ? 'failed' : 'completed';
  if (c.specs?.length) {
    const m = readManifest();
    m[c.base] = { specs: c.specs, lastRun: new Date().toISOString(), status: run.status };
    writeManifest(m);
  }
  writePipelineReport(c);
  const release = run.stages.find((s) => s.name === 'release-agent');
  emit({ type: 'done', status: run.status, blockedAt: blocked, verdict: release.state === 'done' ? release.summary : null, outputs: listOutputs(c) });
}

// ---- HTTP ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
for (const dir of OUTPUT_DIRS) app.use(`/files/${dir}`, express.static(path.join(PROJECT_ROOT, dir)));

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  if (run?.status === 'running') return res.status(409).json({ error: 'A pipeline run is in progress — wait for it to finish' });
  const file = path.basename(req.file.originalname).replace(/[^\w.\-]/g, '_');
  const dest = path.join(REQUIREMENT_DIR, file);
  const previous = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  const contentChanged = previous ? !previous.equals(req.file.buffer) : true;
  fs.writeFileSync(dest, req.file.buffer);
  const base = path.parse(file).name;
  res.json({ file, path: `Requirement/${file}`, base, previouslyUploaded: !!previous, contentChanged: !!previous && contentChanged, ...analyze(base, contentChanged) });
});

app.post('/api/run', (req, res) => {
  if (run?.status === 'running') return res.status(409).json({ error: 'A pipeline run is already in progress' });
  const file = path.basename(String(req.body.file || ''));
  const parentIssue = String(req.body.parentIssue || '').trim().toUpperCase();
  if (!file || !fs.existsSync(path.join(REQUIREMENT_DIR, file))) return res.status(400).json({ error: 'Requirement file not found — upload it first' });
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(parentIssue)) return res.status(400).json({ error: 'Parent Jira issue must look like SCRUM-1' });

  const base = path.parse(file).name;
  const info = analyze(base, false);
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
    clients: new Set(),
    startedAt: Date.now(),
    abort: new AbortController(),
  };
  runPipeline(c);
  res.json({ id: run.id, mode });
});

app.post('/api/cancel', (_req, res) => {
  if (run?.status === 'running') run.abort.abort();
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  if (!run) return res.write(`data: ${JSON.stringify({ type: 'idle' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'hello', file: run.file, mode: run.mode, status: run.status, stages: run.stages })}\n\n`);
  for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  run.clients.add(res);
  const r = run;
  req.on('close', () => r.clients.delete(res));
});

app.listen(PORT, () => console.log(`QA Agent UI running at http://localhost:${PORT}`));
