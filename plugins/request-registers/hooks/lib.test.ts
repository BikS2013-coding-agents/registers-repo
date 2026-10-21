import { expect, test } from 'claude-code/testing'

import * as lib from './lib'

const LOG = `# Prompt log

## P-001 — 2026-10-20 09:00:00 +0200

> first

## P-002 — 2026-10-20 09:05:00 +0200

> line one
>
> line three
`

const header = '| ID | Requested | Prompt | Text | Status | Notes |\n|---|---|---|---|---|---|\n'

function registers(over: Partial<lib.RegisterTexts> = {}): lib.RegisterTexts {
  return {
    'requirements.md': header + '| REQ-001 | 2026-10-20 09:00:00 | P-001 | A feature. | Implemented (to be checked by the user) | |\n',
    'bugs.md': header,
    'working-process.md': header,
    'other-cases.md': header + '| OTH-001 | 2026-10-20 09:05:00 | P-002 | A question. | Answered | Yes. |\n',
    ...over,
  }
}

test('ids and the last prompt of the log', () => {
  expect(lib.promptId(7)).toBe('P-007')
  expect(lib.promptId(1234)).toBe('P-1234')
  expect(lib.lastPromptNumber(LOG)).toBe(2)
  expect(lib.lastPromptNumber('# Prompt log\n')).toBe(0)
})

test('a prompt is quoted line by line and read back the same', () => {
  const prompt = 'line one\n\nline three\n'
  expect(lib.quote(prompt)).toBe('> line one\n>\n> line three')
  const log = LOG + lib.entry('P-003', '2026-10-20 10:00:00 +0200', 'a | b\n> nested')
  expect(lib.lastEntry(log)).toEqual({ id: 'P-003', prompt: 'a | b\n> nested' })
  expect(lib.isLastEntry(LOG, 'line one\n\nline three')).toBe('P-002')
  expect(lib.isLastEntry(LOG, 'something else')).toBeUndefined()
})

test('a prompt is registered when a row names it, not a longer id', () => {
  expect(lib.itemsFor('P-001', registers())).toEqual(['REQ-001'])
  expect(lib.itemsFor('P-002', registers())).toEqual(['OTH-001'])
  const later = registers({ 'bugs.md': header + '| BUG-001 | 2026-10-20 | P-0021 | x | Open | |\n' })
  expect(lib.itemsFor('P-002', later)).toEqual(['OTH-001'])
  expect(lib.itemsFor('P-003', registers())).toEqual([])
})

test('lint finds duplicates, unknown prompts, unnamed prompts and stray cells', () => {
  expect(lib.lint(LOG, registers())).toEqual([])
  const bad = registers({
    'other-cases.md': header
      + '| OTH-001 | 2026-10-20 | P-002 | A question. | Answered | Yes. |\n'
      + '| OTH-001 | 2026-10-20 | P-002 | Again. | Answered | Yes. |\n'
      + '| OTH-002 | 2026-10-20 | P-009 | Unknown prompt. | Done | x | extra |\n',
    'requirements.md': header,
  })
  const problems = lib.lint(LOG, bad)
  expect(problems).toContain('other-cases.md: OTH-001 appears 2 times.')
  expect(problems).toContain('other-cases.md: OTH-002 names P-009, which is not in prompt-log.md.')
  expect(problems).toContain('P-001 is in prompt-log.md but no register names it in its Prompt column.')
  expect(problems).toContain('other-cases.md: OTH-002 has 7 cells, its table 6.')
})

test('open items: pending statuses, and other-cases only when explicitly pending', () => {
  const open = lib.openItems(registers({
    'other-cases.md': header
      + '| OTH-001 | 2026-10-20 | P-002 | Q. | Question | Answered. |\n'
      + '| OTH-002 | 2026-10-20 | P-002 | Work. | In progress | |\n',
    'bugs.md': header + '| BUG-001 | 2026-10-20 | P-001 | x | Fixed | |\n| BUG-002 | 2026-10-20 | P-001 | y | Open | |\n',
  }))
  expect(open.map(i => i.id)).toEqual(['REQ-001', 'BUG-002', 'OTH-002'])
})

test('the model is told the id and the time, and why a Stop is refused', () => {
  const text = lib.promptContext('P-003', '2026-10-20 10:00:00 +0200', '/p/registers')
  expect(text).toContain('Request P-003 was received at 2026-10-20 10:00:00 +0200')
  expect(text).toContain('/p/registers/requirements.md (REQ-NNN)')
  expect(lib.blockReason('P-003', '/p/registers')).toContain('P-003 (the latest prompt')
  expect(Object.keys(lib.TEMPLATES).sort()).toEqual(
    ['README.md', 'bugs.md', 'other-cases.md', 'prompt-log.md', 'requirements.md', 'working-process.md'])
})
