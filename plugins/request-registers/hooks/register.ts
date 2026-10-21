import type { EngineInterface, Register } from 'claude-code'

import * as lib from './lib'

// The request-registers policy (outlook-work WP-004, WP-008): every prompt is logged in
// registers/prompt-log.md as P-NNN and registered, item by item, in requirements.md,
// bugs.md, working-process.md or other-cases.md. The mod does nothing in a project
// without registers/prompt-log.md (`/registers init` creates it).

type $ = EngineInterface

async function registersDir($: $): Promise<string | undefined> {
  const dir = `${await $.session.root()}/registers`
  return (await $.fs.exists(`${dir}/${lib.LOG}`)) ? dir : undefined
}

async function readRegisters($: $, dir: string): Promise<lib.RegisterTexts> {
  const texts = {} as lib.RegisterTexts
  for (const r of lib.REGISTERS) {
    const path = `${dir}/${r.file}`
    texts[r.file] = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  }
  return texts
}

/** The latest prompt and the items that name it. */
async function latest($: $, dir: string): Promise<{ id?: string; items: string[] }> {
  const log = await $.fs.read(`${dir}/${lib.LOG}`)
  const n = lib.lastPromptNumber(log)
  if (n === 0) return { items: [] }
  const id = lib.promptId(n)
  return { id, items: lib.itemsFor(id, await readRegisters($, dir)) }
}

function showStatus($: $, state: { id?: string; items: string[] }): void {
  if (!state.id) return void $.ui.status(undefined)
  $.ui.status(state.items.length > 0
    ? `registers: ${state.id} → ${state.items.join(', ')}`
    : `registers: ${state.id} not registered yet`)
}

async function timestamp($: $): Promise<string> {
  const { stdout, exitCode } = await $.process.run(['date', '+%Y-%m-%d %H:%M:%S %z'])
  if (exitCode !== 0) throw new Error('request-registers: `date` failed; the prompt was not logged.')
  return stdout.trim()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'registers',
      description: 'Request registers: status, check (lint), open (unfinished items), init (set up registers/ here)',
      argumentHint: 'status | check | open | init',
    })
    const dir = await registersDir($)
    if (dir) showStatus($, await latest($, dir))
    return next(e)
  })

  // Capture. A settings UserPromptSubmit hook beneath (outlook-work's register-prompt.sh)
  // may have logged the prompt already: then its id and context stand and nothing is
  // logged twice. Otherwise the mod logs it and tells the model.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const dir = await registersDir($)
    if (!dir) return result
    // Notices, wake-ups and peer messages are not the person's requests (BUG-019).
    if (e.source !== undefined && e.source !== 'user' && e.source !== 'sdk') return result
    if (e.prompt.trim() === '' || e.prompt.includes('<task-notification>')) return result

    const logPath = `${dir}/${lib.LOG}`
    const log = await $.fs.read(logPath)
    const logged = lib.isLastEntry(log, e.prompt)
    if (logged && (result.additionalContext ?? []).some(text => text.includes(`Request ${logged} `))) {
      $.ui.status(`registers: ${logged} not registered yet`)
      return result
    }
    const at = await timestamp($)
    const id = logged ?? lib.promptId(lib.lastPromptNumber(log) + 1)
    if (!logged) await $.fs.write(logPath, log + lib.entry(id, at, e.prompt))
    $.ui.status(`registers: ${id} not registered yet`)
    return { ...result, additionalContext: [...(result.additionalContext ?? []), lib.promptContext(id, at, dir)] }
  })

  // The rule, in the system prompt of every request in a project with registers/.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const dir = await registersDir($)
    if (!dir) return composed
    return {
      sections: [...composed.sections, { id: 'request-registers:rule', text: lib.ruleSection(dir), scope: 'session' as const }],
    }
  })

  // The hard check: the turn does not end while the latest prompt is in no register.
  // Once refused, the next Stop of the same turn passes (stop_hook_active), so a model
  // that cannot register never loops; the status line still says so.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block !== undefined) return result
    const dir = await registersDir($)
    if (!dir) return result
    const state = await latest($, dir)
    showStatus($, state)
    if (!state.id || state.items.length > 0 || e.stop_hook_active) return result
    return { ...result, block: lib.blockReason(state.id, dir) }
  })

  on('command.run', { command: 'registers' }, async ($, e) => ({ text: await runCommand($, e.args.trim()) }))
}

async function runCommand($: $, args: string): Promise<string> {
  const [verb = 'status'] = args.split(/\s+/).filter(Boolean)
  if (verb === 'init') return init($)
  const dir = await registersDir($)
  if (!dir) return `No registers/${lib.LOG} under ${await $.session.root()}. Run /registers init to set them up.`

  if (verb === 'status') {
    const state = await latest($, dir)
    showStatus($, state)
    if (!state.id) return `${dir}/${lib.LOG} has no prompts yet.`
    return state.items.length > 0
      ? `${state.id}, the latest prompt, is registered as ${state.items.join(', ')}.`
      : `${state.id}, the latest prompt, is not registered yet.`
  }
  if (verb === 'check') {
    const problems = lib.lint(await $.fs.read(`${dir}/${lib.LOG}`), await readRegisters($, dir))
    return problems.length === 0
      ? 'The registers are consistent: unique ids, every prompt named, every reference logged, every row as wide as its table.'
      : `${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map(p => `- ${p}`).join('\n')}`
  }
  if (verb === 'open') {
    const items = lib.openItems(await readRegisters($, dir))
    if (items.length === 0) return 'No unfinished items.'
    return `${items.length} unfinished or unchecked item${items.length === 1 ? '' : 's'}:\n`
      + items.map(i => `- ${i.id} (${i.status}): ${i.text.length > 140 ? i.text.slice(0, 139) + '…' : i.text}`).join('\n')
  }
  return `Unknown: /registers ${args}. Use status, check, open or init.`
}

/** Creates registers/ with its five files (an existing file is kept) and adds the rule to CLAUDE.md. */
async function init($: $): Promise<string> {
  const root = await $.session.root()
  const dir = `${root}/registers`
  const made: string[] = []
  const { exitCode, stderr } = await $.process.run(['mkdir', '-p', dir])
  if (exitCode !== 0) return `Could not create ${dir}: ${stderr.trim()}`
  for (const [file, text] of Object.entries(lib.TEMPLATES)) {
    const path = `${dir}/${file}`
    if (await $.fs.exists(path)) continue
    await $.fs.write(path, text)
    made.push(`registers/${file}`)
  }
  const claude = `${root}/CLAUDE.md`
  const current = (await $.fs.exists(claude)) ? await $.fs.read(claude) : ''
  if (!current.includes('Rule: register every request')) {
    await $.fs.write(claude, current + (current === '' || current.endsWith('\n') ? '' : '\n') + lib.CLAUDE_RULE)
    made.push('CLAUDE.md (the rule)')
  }
  const state = await latest($, dir)
  showStatus($, state)
  return made.length === 0
    ? `The registers are already set up in ${dir}.`
    : `Set up: ${made.join(', ')}. From the next prompt on, every prompt is logged and must be registered before a turn ends. Record this policy as WP-001 in registers/working-process.md.`
}
