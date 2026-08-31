# dsh-plugins-cli-login-app

**Status: confirmed working.** Builds clean, installs via `dsh plugin
--profile <name> add dsh-plugins-cli-login-app` into its own profile, and
`dsh --profile <name> --help` boots the composition and prints this
package's own help text through `dsh-cmdline` with zero errors.

A standalone `dsh` profile for CLI-driven credential authorization:

```sh
dsh plugin --profile anthropic add dsh-plugins-bundle-anthropic-subscription
dsh --profile anthropic llm-pi-ai/anthropic
```

This is its own dedicated profile plugin, not a `login` subcommand added to
`@deepseek-ai/dsh-headless`. `dsh-cmdline` lets any number of plugins read
the launcher's argument line, but each program parses independently:
`@deepseek-ai/dsh-headless/startup` declares a variadic `[task...]`
catch-all with no grammar that rejects `login llm-pi-ai/anthropic`, so
composing a `login` command alongside it would fire **both** actions on one
invocation — a real headless task run using the credential key as its
literal prompt, racing the actual login flow. A profile with no
task-positional parser mounted has no such ambiguity.

`packages/boot/cmdline/README.md` documents this as supported: *"Apps built
outside this repository behave the same way [as `dsh-headless`'s own
`startup.ts`]: their `--help` prints and exits instead of crashing, even
though they carry their own commander copy."*

Ports the terminal-interaction and login-run logic from
`packages/bundle/headless/src/index.ts`'s `login` mode in
`yga/deepseek-harness` — the fork wove it into `headless-runner`'s own
`Config`/`apply()` instead of giving it an independent grammar. See
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
