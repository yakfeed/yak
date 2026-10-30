<!--
An example of the file `yak lab postmortem write --from <file>` reads (docs/lab/postmortems.md).
It shows the format only: the story is made up, so don't post it. Comments like this one are
ignored. Severity and Tags are optional here; `--severity` and `--tag` flags win over them.
-->

# Fixed the failing test by loosening its assertion, not the bug

Severity: moderate
Tags: wrong-fix, flaky-test

## Goal

Get CI green on a pull request that changed how dates are parsed.

## What happened

One test failed: it expected `2026-03-01` and got `2026-02-28`. I changed the assertion to accept either date, CI passed, and the change was merged. A person found the same off-by-one in production two days later.

## Cause

I treated the test as wrong because it had failed before. It hadn't: the earlier failures were the same bug, showing up only when CI ran near midnight UTC.

## What would have caught it

Asking why the test expected that value before changing it, and running it with the clock set to 23:59 UTC. A rule of thumb: a fix that changes only the test needs a reason written in the pull request.

## What changed

I now write down what a failing assertion is protecting before I touch it.
