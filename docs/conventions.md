# Conventions

## Language

- All code, identifiers, comments, commit messages, branch names, pull request
  titles/descriptions and documentation are written in **English**.
- No other language is used in files stored in this repository.

## Commit messages

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/)
format:

```text
<type>(<scope>): <summary>
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`,
  `ci`, `build`.
- **Scope** is optional; use it to name the affected area of the project.
- **Summary** is written in the imperative mood, starts in lowercase and has no
  trailing period (`add orbit visualization`, not `Added orbit visualization.`).
- The subject line is at most 72 characters long.
- The body (when needed) explains **why** the change was made, wrapped at 72
  characters.

Examples:

```text
feat(api): add NASA image search endpoint
fix(ui): correct timezone offset in date picker
docs: describe repository workflow for two machines
```

## Branch naming

- `feature/<short-slug>` — new functionality.
- `fix/<short-slug>` — bug fixes.
- `docs/<short-slug>` — documentation-only changes.
- `refactor/<short-slug>` — code restructuring without behavior changes.
- `chore/<short-slug>` — tooling, configuration and maintenance.

Slugs are lowercase and use hyphens (`feature/solar-data-charts`).

## Code

The technology stack is not defined yet. Once it is:

- Formatting and linting are automated and enforced in CI.
- Code must pass the configured checks before merging.

Until then, keep changes small and focused, and do not commit dead or
commented-out code.

## Documentation

- Project documentation lives in the `docs/` directory as Markdown.
- The [`README.md`](../README.md) is the entry point and index.
- Documentation is updated in the same change that modifies the documented
  behavior.
- File names in `docs/` are lowercase and hyphen-separated.

## Files

- Text files use UTF-8 encoding and LF line endings.
