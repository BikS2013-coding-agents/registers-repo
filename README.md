# registers

A Claude Code plugin marketplace. It holds one plugin, `request-registers`.

## request-registers

Every prompt in a project is logged as `P-NNN` in `registers/prompt-log.md` and must be
registered, item by item, in one of four registers before the turn can end:

| Register | Item ids | For |
|---|---|---|
| `registers/requirements.md` | `REQ-NNN` | Requirements |
| `registers/bugs.md` | `BUG-NNN` | Bugs |
| `registers/working-process.md` | `WP-NNN` | Working-process instructions |
| `registers/other-cases.md` | `OTH-NNN` | Everything else |

The plugin does nothing in a project without `registers/prompt-log.md`.

What it does in a project that has one:
- **On every prompt:** appends the prompt to the log and tells the model its id.
- **In the system prompt:** adds the registration rule.
- **When a turn ends:** refuses to end it once while the latest prompt is in no register. The next stop
  passes, so a model that cannot register never loops.
- **Status line:** shows `registers: P-NNN → <items>` or `P-NNN not registered yet`.

### Commands

| Command | Does |
|---|---|
| `/registers init` | Creates `registers/` with the log and the four registers in the current project |
| `/registers status` | The latest prompt and the items registered for it (the default) |
| `/registers check` | Lints the registers: unique ids, every prompt named, every reference logged, table widths |
| `/registers open` | Lists unfinished items |

## Install

```bash
claude plugin marketplace add BikS2013-coding-agents/registers
claude plugin install request-registers@registers
```

The repository is private, so the account running these needs access to the
`BikS2013-coding-agents` organization.

## Developing

The plugin is a Claude Code hooks module (`plugins/request-registers/hooks/register.ts`).
On the development machine it is **not installed** from this marketplace. Instead,
`~/.claude/skills/request-registers` is a symlink to `plugins/request-registers`, so Claude Code
loads it straight from this checkout and reloads it on every save. Installing it as well
would load it twice.

```bash
claude plugin validate plugins/request-registers
claude plugin test plugins/request-registers
```

Bump `version` in both `plugins/request-registers/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` on every change, or installed copies will not update.
