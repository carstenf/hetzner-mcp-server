// Background jobs for the exec MCP servers (Lenovo1 + Hetzner, shared codebase).
//
// A long command must not depend on the chat connection: job_start launches it as a transient systemd
// unit (`systemd-run`, unit mcpjob-<id>), so it survives dropped MCP sessions AND restarts of this
// server. State lives in JOBS_DIR/<id>/ (cmd.sh, log.txt, rc, meta.json); job_status/job_log read it,
// job_cancel stops the unit. Non-root jobs run as the service user (--uid), root jobs with sudo=true.
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { userInfo } from 'os';

const JOBS_DIR = process.env.MCP_JOBS_DIR || join(process.env.HOME || '/home/carsten', '.mcp-jobs');
const MAX_RUNNING = 6;
const MAX_TIMEOUT_S = 24 * 3600;
const MAX_TEXT = 40000;

function runSudo(argv, password) {
  // run argv as root; password piped like toolExec(sudo:true), else NOPASSWD (-n)
  const flags = password ? ['-S', '-p', ''] : ['-n'];
  return new Promise((resolve) => {
    const c = spawn('sudo', [...flags, ...argv], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('close', code => resolve({ code, out, err: err.replace(/^\s*\n/, '') }));
    c.on('error', e => resolve({ code: -1, out, err: String(e) }));
    if (password) c.stdin.write(password + '\n');
    c.stdin.end();
  });
}

function run(argv) {
  return new Promise((resolve) => {
    const c = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('close', code => resolve({ code, out, err }));
    c.on('error', e => resolve({ code: -1, out, err: String(e) }));
  });
}

const unitOf = id => `mcpjob-${id}`;
const okId = id => typeof id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(id) && existsSync(join(JOBS_DIR, id, 'meta.json'));

function tail(path, n) {
  if (!existsSync(path)) return '';
  const lines = readFileSync(path, 'utf-8').split('\n');
  return lines.slice(-Math.max(1, n) - 1).join('\n').slice(-MAX_TEXT);
}

async function state(id) {
  const d = join(JOBS_DIR, id);
  const meta = JSON.parse(readFileSync(join(d, 'meta.json'), 'utf-8'));
  const r = await run(['systemctl', 'show', unitOf(id), '-p', 'ActiveState', '--value']);
  const active = ['active', 'activating', 'deactivating'].includes(r.out.trim());
  const rcFile = join(d, 'rc');
  const rcTxt = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8').trim() : '';
  if (active) meta.status = 'running';
  else if (meta.cancelled) meta.status = 'cancelled';
  else if (rcTxt !== '') {
    meta.exit_code = parseInt(rcTxt, 10);
    meta.status = meta.exit_code === 0 ? 'finished' : meta.exit_code === 124 ? 'timeout' : 'failed';
    meta.ended = statSync(rcFile).mtime.toISOString().slice(0, 19);
  } else meta.status = 'lost';  // unit gone without exit code (reboot, OOM of the wrapper)
  const end = meta.ended ? Date.parse(meta.ended + 'Z') : Date.now();
  meta.elapsed_s = Math.round((end - Date.parse(meta.started + 'Z')) / 1000);
  return meta;
}

function ids() {
  if (!existsSync(JOBS_DIR)) return [];
  return readdirSync(JOBS_DIR).filter(okId).sort().reverse();
}

const text = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

export const jobToolDefs = [
  {
    name: 'job_start',
    description: 'Start a shell command as a background job and return immediately (job_id). Use for anything that may run longer than ~1 minute (backups, downloads, builds, data dumps, long scripts): the job runs as its own systemd unit, keeps running if the chat connection drops or this MCP server restarts. Poll with job_status, read output with job_log, stop with job_cancel.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command (bash) to run' },
        name: { type: 'string', description: 'Short label for the job id. Default: job' },
        cwd: { type: 'string', description: 'Working directory. Default: the exec default directory' },
        sudo: { type: 'boolean', description: 'Run as root (like exec sudo:true). Default: false (runs as the service user)' },
        timeout_s: { type: 'number', description: 'Kill after this many seconds (exit code 124). Default 7200, max 86400' },
        memory_max: { type: 'string', description: 'Optional memory cap for the job, e.g. "4G" (systemd MemoryMax)' }
      },
      required: ['command']
    }
  },
  {
    name: 'job_status',
    description: 'Status of one background job incl. the last log lines, or without job_id the last 20 jobs. status: running | finished | failed (exit_code != 0) | timeout | cancelled | lost (ended without exit code, e.g. reboot).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id from job_start. Omit to list recent jobs' },
        lines: { type: 'number', description: 'Log lines to include. Default 15' }
      }
    }
  },
  {
    name: 'job_log',
    description: 'Last lines of a background job\'s combined stdout/stderr (max ~40 KB).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id from job_start' },
        lines: { type: 'number', description: 'Number of lines. Default 100, max 5000' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'job_cancel',
    description: 'Stop a running background job (systemctl stop of its unit: SIGTERM, then SIGKILL).',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id from job_start' } },
      required: ['job_id']
    }
  }
];

export function makeJobHandlers({ workCwd, sudoPassword }) {
  return {
    async job_start(args) {
      const { command, name = 'job', cwd = workCwd, sudo = false, timeout_s = 7200, memory_max } = args || {};
      if (!command) throw new Error('command is required');
      if (memory_max && !/^[0-9]+[KMGT]?$/.test(memory_max)) throw new Error('memory_max like "4G"');
      let running = 0;
      for (const j of ids().slice(0, 50)) if ((await state(j)).status === 'running') running++;
      if (running >= MAX_RUNNING) throw new Error(`${running} jobs running (max ${MAX_RUNNING})`);
      const t = Math.max(10, Math.min(Math.floor(timeout_s), MAX_TIMEOUT_S));
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const id = `${ts}-${String(name).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'job'}`;
      const d = join(JOBS_DIR, id);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'user.sh'), command + '\n');
      writeFileSync(join(d, 'cmd.sh'),
        `#!/bin/bash\ncd ${JSON.stringify(cwd)} || exit 2\n` +
        `timeout --signal=TERM --kill-after=30 ${t} /bin/bash ${JSON.stringify(join(d, 'user.sh'))} > ${JSON.stringify(join(d, 'log.txt'))} 2>&1\n` +
        `echo $? > ${JSON.stringify(join(d, 'rc'))}\n`, { mode: 0o755 });
      const me = userInfo();
      const argv = ['systemd-run', `--unit=${unitOf(id)}`, '--collect', '--quiet',
        `--description=MCP job ${id}`, '-p', 'KillMode=control-group'];
      if (memory_max) argv.push('-p', `MemoryMax=${memory_max}`);
      if (!sudo) argv.push(`--uid=${me.uid}`, `--gid=${me.gid}`, `--setenv=HOME=${me.homedir}`);
      argv.push(`--setenv=PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`, '/bin/bash', join(d, 'cmd.sh'));
      const r = await runSudo(argv, sudoPassword);   // systemd-run for a system unit needs root
      if (r.code !== 0) throw new Error(`systemd-run failed: ${r.err || r.out}`);
      const meta = { job_id: id, name, unit: unitOf(id), cwd, sudo: !!sudo, timeout_s: t, memory_max: memory_max || null,
        started: new Date().toISOString().slice(0, 19) };
      writeFileSync(join(d, 'meta.json'), JSON.stringify(meta, null, 1));
      return text({ ok: true, ...meta, hint: 'poll job_status(job_id); output via job_log(job_id)' });
    },
    async job_status(args) {
      const { job_id, lines = 15 } = args || {};
      if (job_id) {
        if (!okId(job_id)) throw new Error(`unknown job_id ${job_id}`);
        const s = await state(job_id);
        s.log_tail = tail(join(JOBS_DIR, job_id, 'log.txt'), lines);
        return text({ ok: true, ...s });
      }
      const out = [];
      for (const j of ids().slice(0, 20)) {
        const s = await state(j);
        out.push({ job_id: s.job_id, status: s.status, exit_code: s.exit_code, elapsed_s: s.elapsed_s, started: s.started });
      }
      return text({ ok: true, jobs: out });
    },
    async job_log(args) {
      const { job_id, lines = 100 } = args || {};
      if (!okId(job_id)) throw new Error(`unknown job_id ${job_id}`);
      const s = await state(job_id);
      return text({ ok: true, job_id, status: s.status,
        log: tail(join(JOBS_DIR, job_id, 'log.txt'), Math.min(Math.max(1, lines), 5000)) });
    },
    async job_cancel(args) {
      const { job_id } = args || {};
      if (!okId(job_id)) throw new Error(`unknown job_id ${job_id}`);
      const s = await state(job_id);
      if (s.status !== 'running') throw new Error(`job is ${s.status}`);
      const p = join(JOBS_DIR, job_id, 'meta.json');
      const meta = JSON.parse(readFileSync(p, 'utf-8'));
      meta.cancelled = true;
      writeFileSync(p, JSON.stringify(meta, null, 1));
      const r = await runSudo(['systemctl', 'stop', unitOf(job_id)], sudoPassword);
      if (r.code !== 0) throw new Error(`systemctl stop failed: ${r.err}`);
      return text({ ok: true, job_id, status: 'cancelled' });
    }
  };
}
