// The register policy as plain functions over the registers' text: no I/O, so the
// tests run them directly. register.ts reads and writes the files and calls these.

/** The four classified registers, in the order a prompt is checked against them. */
export const REGISTERS = [
  { file: 'requirements.md', prefix: 'REQ', kind: 'requirement' },
  { file: 'bugs.md', prefix: 'BUG', kind: 'bug' },
  { file: 'working-process.md', prefix: 'WP', kind: 'working-process instruction' },
  { file: 'other-cases.md', prefix: 'OTH', kind: 'other case' },
] as const

export type RegisterTexts = Record<(typeof REGISTERS)[number]['file'], string>

export const LOG = 'prompt-log.md'

/** The directory and each of its parents up to the filesystem root, nearest first. */
export function selfAndParents(dir: string): string[] {
  const dirs: string[] = []
  let d = dir.length > 1 ? dir.replace(/\/+$/, '') : dir
  for (;;) {
    dirs.push(d)
    if (d === '/' || d === '') return dirs
    const cut = d.lastIndexOf('/')
    d = cut <= 0 ? '/' : d.slice(0, cut)
  }
}

/** P-NNN, three digits at least. */
export function promptId(n: number): string {
  return `P-${String(n).padStart(3, '0')}`
}

/** The number of the last `## P-NNN` heading in the log, or 0 for an empty log. */
export function lastPromptNumber(log: string): number {
  let last = 0
  for (const m of log.matchAll(/^## P-(\d+)\b/gm)) last = Number(m[1])
  return last
}

/** The prompt as the log quotes it: every line behind "> ", an empty line as ">". */
export function quote(prompt: string): string {
  return prompt
    .replace(/\n+$/, '')
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

/** A log entry, appended as is to the end of prompt-log.md. */
export function entry(id: string, timestamp: string, prompt: string): string {
  return `\n## ${id} — ${timestamp}\n\n${quote(prompt)}\n`
}

/** The last entry of the log: its id and its prompt, unquoted. */
export function lastEntry(log: string): { id: string; prompt: string } | undefined {
  const at = [...log.matchAll(/^## (P-\d+)\b.*$/gm)].pop()
  if (!at || at.index === undefined) return undefined
  const body = log.slice(at.index + at[0].length)
  const prompt = body
    .split('\n')
    .filter(line => line.startsWith('>'))
    .map(line => (line === '>' ? '' : line.replace(/^> ?/, '')))
    .join('\n')
  return { id: at[1] ?? '', prompt }
}

/** Whether the log's last entry is this prompt (so a settings hook already logged it). */
export function isLastEntry(log: string, prompt: string): string | undefined {
  const last = lastEntry(log)
  const norm = (text: string) => text.replace(/\s+$/gm, '').replace(/\n+$/, '')
  return last && norm(last.prompt) === norm(prompt) ? last.id : undefined
}

/** A table line's cells, trimmed; an escaped "\\|" stays inside its cell. */
export function cellsOf(line: string): string[] {
  return line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim())
}

/** The table rows of a register: each row's id and its cells. */
export function rows(text: string, prefix: string): { id: string; cells: string[] }[] {
  const found: { id: string; cells: string[] }[] = []
  for (const line of text.split('\n')) {
    const m = line.match(new RegExp(`^\\|\\s*(${prefix}-\\d+)\\s*\\|`))
    if (!m) continue
    found.push({ id: m[1] ?? '', cells: cellsOf(line) })
  }
  return found
}

/** The register items whose row names the prompt id (in any column). */
export function itemsFor(id: string, registers: RegisterTexts): string[] {
  const pattern = new RegExp(`\\b${id}\\b`)
  return REGISTERS.flatMap(r => rows(registers[r.file] ?? '', r.prefix))
    .filter(row => row.cells.slice(1).some(cell => pattern.test(cell)))
    .map(row => row.id)
}

/** Duplicate ids, references to prompts the log lacks, and prompts no register names. */
export function lint(log: string, registers: RegisterTexts): string[] {
  const problems: string[] = []
  const logged = new Set([...log.matchAll(/^## (P-\d+)\b/gm)].map(m => m[1] ?? ""))
  const named = new Set<string>()
  for (const r of REGISTERS) {
    const seen = new Map<string, number>()
    for (const row of rows(registers[r.file] ?? '', r.prefix)) {
      seen.set(row.id, (seen.get(row.id) ?? 0) + 1)
      const prompt = row.cells[2] ?? ''
      for (const m of prompt.matchAll(/\bP-\d+\b/g)) {
        named.add(m[0])
        if (!logged.has(m[0])) problems.push(`${r.file}: ${row.id} names ${m[0]}, which is not in ${LOG}.`)
      }
    }
    for (const [id, count] of seen) if (count > 1) problems.push(`${r.file}: ${id} appears ${count} times.`)
    // A row with more or fewer cells than its table's header (a stray "|" or a lost column).
    let width = 0
    for (const line of (registers[r.file] ?? '').split('\n')) {
      if (/^\|\s*ID\s*\|/.test(line)) width = cellsOf(line).length
      const m = line.match(new RegExp(`^\\|\\s*(${r.prefix}-\\d+)\\s*\\|`))
      if (m && width && cellsOf(line).length !== width) {
        problems.push(`${r.file}: ${m[1] ?? ''} has ${cellsOf(line).length} cells, its table ${width}.`)
      }
    }
  }
  for (const id of logged) if (!named.has(id)) problems.push(`${id} is in ${LOG} but no register names it in its Prompt column.`)
  return problems
}

const DONE = /^(implemented|fixed|done|answered|active|closed|declined|superseded)\b/i
const PENDING = /in progress|open|proposed|to be (checked|confirmed)|not (verified|confirmed)|partly|mitigated|pending|awaiting/i

/** Items that are not finished, or finished but waiting for a check. */
export function openItems(registers: RegisterTexts): { register: string; id: string; status: string; text: string }[] {
  const found: { register: string; id: string; status: string; text: string }[] = []
  for (const r of REGISTERS) {
    for (const row of rows(registers[r.file] ?? '', r.prefix)) {
      const status = row.cells[4] ?? ''
      // other-cases.md's older rows hold a kind (Question, Action) in that column, so
      // there only an explicit pending status counts.
      const isOpen = r.prefix === 'OTH' ? PENDING.test(status) : PENDING.test(status) || (status !== '' && !DONE.test(status))
      if (isOpen) {
        found.push({ register: r.file, id: row.id, status, text: row.cells[3] ?? '' })
      }
    }
  }
  return found
}

/** What the model is told with each prompt. */
export function promptContext(id: string, timestamp: string, dir: string): string {
  return `Request ${id} was received at ${timestamp} and logged verbatim in ${dir}/${LOG}.
Before you answer, register it (the request-registers policy):
- Classify each item in the request: a requirement (something the project must do), a bug (something that does not work), a working-process instruction (how the work is done), or another case (a question, a one-off action, a decision, a declined request). One request can hold several items of different kinds.
- Add one row per item to ${dir}/requirements.md (REQ-NNN), bugs.md (BUG-NNN), working-process.md (WP-NNN) or other-cases.md (OTH-NNN), using the next free number, the requested time ${timestamp} and the prompt id ${id}.
- When the work on an item finishes, update its status and notes. Record bugs you find while working in bugs.md too, marked as found while working on the request.
The turn cannot end until a register row names ${id}.`
}

/** The system-prompt section the mod adds in a project that has registers/. */
export function ruleSection(dir: string): string {
  return `# Request registers

This project keeps a dated record of every request in ${dir}/ (the request-registers policy):
- ${LOG}: every prompt, verbatim, as P-NNN with its date and time. It is appended automatically; never edit past entries.
- requirements.md (REQ-NNN): features and changes the project must have. bugs.md (BUG-NNN): defects, with cause, fix and verification. working-process.md (WP-NNN): instructions on how the work is done, with where each is enforced. other-cases.md (OTH-NNN): questions, one-off actions, decisions, declined requests.
Every prompt gets at least one row, with the prompt's time and P-NNN; a prompt holding several items gets one row per item, in the matching registers. Ids are the next free number of their register and are never reused; rows are never deleted (a dropped item gets a new status and the reason). Statuses tell what was verified and what was not. Update an item's status and notes when its work finishes. A turn cannot end while the latest prompt is not named in any register.`
}

/** Why a Stop is refused. */
export function blockReason(id: string, dir: string): string {
  return `${id} (the latest prompt in ${dir}/${LOG}) is not registered yet. Classify it and add one row per item to requirements.md, bugs.md, working-process.md or other-cases.md in ${dir}/, with ${id} and its time in the row, then finish.`
}

export const TEMPLATES: Record<string, string> = {
  'README.md': `# Registers

A dated record of everything requested in this project, so the complete working flow can be reconstructed.

| File | Holds | Ids |
|---|---|---|
| [\`prompt-log.md\`](prompt-log.md) | Every request, verbatim, with the date and time it was made | \`P-NNN\` |
| [\`requirements.md\`](requirements.md) | What the project must do, and whether it is done | \`REQ-NNN\` |
| [\`bugs.md\`](bugs.md) | Defects reported or found while working, with cause and fix | \`BUG-NNN\` |
| [\`working-process.md\`](working-process.md) | Instructions on how the work is done, and where each one is enforced | \`WP-NNN\` |
| [\`other-cases.md\`](other-cases.md) | Questions, one-off actions, decisions and declined requests | \`OTH-NNN\` |

## How items get here

1. The \`request-registers\` Claude Code mod logs every prompt in \`prompt-log.md\` with a new \`P-NNN\` and the date and time, and asks Claude to classify and register it.
2. Claude splits the request into items and adds one row per item to the matching register, with the next free number, the prompt's time and its \`P-NNN\`.
3. A turn cannot end while the latest prompt is not named in any register (the mod's Stop check).
4. When an item is finished, its status and notes are updated. Bugs found while working are registered too, marked *found while working on P-NNN*.

## Conventions

- Times are local, with their UTC offset: \`YYYY-MM-DD HH:MM:SS +ZZZZ\`. They are the time of the request, not the time the row was written.
- Rows are never deleted. A changed or dropped item gets a new status, such as \`Superseded by REQ-NNN\` or \`Declined\`, with the reason.
- \`/registers check\` finds duplicate ids and prompts no register names; \`/registers open\` lists unfinished items.
`,
  'prompt-log.md': `# Prompt log

Every request, verbatim, in the order it was made. \`registers/*.md\` items point back here by id (\`P-NNN\`).
New entries are appended automatically (the \`request-registers\` mod); never edit past entries.
`,
  'requirements.md': `# Requirements register

What the project must do. One row per requirement; a prompt that asked for several things has several rows.

- **Requested**: the date and time of the prompt, with its offset. The prompt is in \`prompt-log.md\` under the same \`P-NNN\`.
- **Status**: \`Implemented\`, \`Partly implemented\`, \`Open\`, \`In progress\` or \`Declined\` (reason in Notes); say what was verified and what was not.

| ID | Requested | Prompt | Requirement | Status | Notes |
|---|---|---|---|---|---|
`,
  'bugs.md': `# Bugs register

Defects, whether reported or found while working (marked *found while working on P-NNN*).

- **Reported**: the date and time of the prompt, with its offset.
- **Status**: \`Open\`, \`In progress\`, \`Fixed\` or \`Closed\` (not a code defect). Notes hold the cause, the fix and how it was verified.

| ID | Reported | Prompt | Bug | Status | Cause, fix and verification |
|---|---|---|---|---|---|
`,
  'working-process.md': `# Working process register

Instructions about how the work is done.

- **Requested**: the date and time of the prompt, with its offset.
- **Status**: \`Active\` (applies from then on), \`Done\` (a one-off instruction) or \`Superseded\` (with the item that replaced it).
- **Enforced by**: where the rule is written down or checked, so it survives new sessions.

| ID | Requested | Prompt | Instruction | Status | Enforced by |
|---|---|---|---|---|---|
`,
  'other-cases.md': `# Other cases register

Requests that are not requirements, bugs or working-process instructions: questions, one-off actions, decisions, and requests that were declined.

- **Requested**: the date and time of the prompt, with its offset.
- **Status**: what happened (\`Answered\`, \`Done\`, \`Declined\`, \`In progress\`); the outcome says what was done, or why not.

| ID | Requested | Prompt | Request | Status | Outcome |
|---|---|---|---|---|---|
`,
}

/** The rule appended to CLAUDE.md by /registers init, unless it is there already. */
export const CLAUDE_RULE = `
## Rule: register every request

Every request is recorded in \`registers/\` with the date and time it was made (see \`registers/README.md\`).

- The \`request-registers\` mod logs each prompt verbatim in \`registers/prompt-log.md\` as \`P-NNN\`.
- Classify each item in the request and add one row per item to the matching register, with the prompt's time and id: \`requirements.md\`, \`bugs.md\`, \`working-process.md\`, \`other-cases.md\`.
- When an item is finished, update its status and notes. Also register bugs you find while working.
- A turn cannot end while the latest prompt is not registered (the mod's Stop check).
`
