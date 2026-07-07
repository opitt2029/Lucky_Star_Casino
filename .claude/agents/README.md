# Subagents — Six-Role Team (Lucky Star Casino)

One role per `.md` file. YAML frontmatter: `name` (invocation name), `description`
(Claude uses this line to decide when to auto-delegate), `tools` (tool allowlist),
`model` (optional, omitted = inherit from main thread). The body is that role's
system prompt. Each subagent has an isolated context window: noise stays out of
the main thread, only conclusions are reported back.

## Roles

| Role | Responsibility | Key constraint |
|------|----------------|----------------|
| `dev-coder` | Java/Spring Boot backend implementation | No test writing, no commits |
| `frontend-dev` | React frontend implementation | Follows the three betting-game iron rules; no commits |
| `qa-tester` | Write and run tests | Test files only; reports product bugs, never fixes them |
| `code-reviewer` | Review diffs/files | **Read-only** (no Edit/Write — reviewer must not be the author) |
| `ui-ux` | Design specs | Read-only; hands specs to frontend-dev |
| `devops` | Environment / infra / scripts | Secrets red line; never touches main branch |

## Pipeline (commit only when everything is green)

```
requirement → split into steps → dev-coder / frontend-dev implement
           → qa-tester adds tests → code-reviewer reviews
           → must-fix findings → back to implementer → re-review
           → PASS + all tests green → main thread commits
             (format: type(scope): 中文描述, plus a root CHANGELOG.md entry)
```

## Single source of truth for landmines

Every agent file starts by pointing back to the repo root `AGENTS.md`
(§2 known landmines, §3 conventions) and `CLAUDE.md`. Landmine knowledge is
maintained ONLY there — do NOT copy it into agent files (six copies will drift).

## Usage

- Auto-delegation: give instructions normally; Claude picks a role via `description`.
- Manual: "use code-reviewer to review the latest diff in backend/game-service".
- Interactive management: type `/agents` in a session.
- After adding/editing agent files, **restart the session** for them to register.
- Cost note: a subagent cold-starts and must re-read AGENTS.md itself. For small
  tasks the main thread is faster; use the pipeline for large multi-step work.
