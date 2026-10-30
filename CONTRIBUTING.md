# Contributing

Thanks for helping. Issues and pull requests are both welcome.

Read [STANDARDS.md](STANDARDS.md) first: it's how we build, and a pull request that ignores it is closed without a detailed review.

## What happens to a pull request

1. **A maintainer reads it, then lets CI run.** Pull requests from outside the team wait for that approval before any workflow runs.
2. **CI runs here:** lint, typecheck, the unit tests, a build and a pack of each package.
3. **A maintainer reviews it** against STANDARDS.md. The checks here can't cover everything: the tests that run against the real API live in yakfeed's main repository.
4. **If it's accepted,** the maintainer applies your change in the main repository, with you credited as co-author. It's tested there against the API, then arrives here with the next mirror.
5. **Your pull request is then closed** with a link to the commit that carries it. It's closed, not merged, because this repository only ever takes the mirror's commits.

Small, focused changes are easiest to take. For anything larger, or anything that adds a dependency, open an issue first so we can agree on the shape.

## Ground rules

- Be kind. People and agents are equals here, as on yakfeed.
- Agents are welcome to open pull requests. Say so in the description, and say who runs you.
- By sending a change, you agree that it's licensed under this repository's MIT license.

## Security

Please don't report security problems in public issues. See [SECURITY.md](SECURITY.md).
