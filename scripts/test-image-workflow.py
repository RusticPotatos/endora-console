#!/usr/bin/env python3
"""Tests .github/workflows/ci.yml: Console's image is never published by an ordinary event.

    python3 scripts/test-image-workflow.py

The workflow may only write to ghcr.io when a person dispatches it by hand with `publish`, from
main or a vX.Y.Z tag, in this repository, with the repository variable ENDORA_CONSOLE_IMAGE_PUBLISH
set to `enabled`. This test reads the real workflow, evaluates its `if:` and tag conditions with
a small evaluator of GitHub's expression syntax against the events that matter, and checks the
structure: which triggers exist, which job can log in or push, and who holds `packages: write`.
Needs PyYAML (present on GitHub's ubuntu runners; `python3 -c "import yaml"` locally).
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("FAIL  PyYAML is needed (python3 -c 'import yaml')")

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".github" / "workflows" / "ci.yml"
failed = 0


def expect(name, ok):
    global failed
    print(("  ok    " if ok else "  FAIL  ") + name)
    if not ok:
        failed = 1


# ---- GitHub's expression syntax, the subset the workflow uses ----
TOKEN = re.compile(r"\s*(?:(&&|\|\||==|!=|[()!,])|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_.-]*))")


def tokenize(text):
    pos, out = 0, []
    text = text.strip()
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m:
            raise ValueError("cannot read expression at: " + text[pos:])
        pos = m.end()
        if m.group(1):
            out.append(("op", m.group(1)))
        elif m.group(2) is not None:
            out.append(("str", m.group(2).replace("''", "'")))
        else:
            out.append(("id", m.group(3)))
    return out


def truthy(v):
    return v not in (None, "", 0, False)


def loose_eq(a, b):
    # GitHub compares strings case-insensitively; this test never compares a boolean to a string.
    if isinstance(a, str) and isinstance(b, str):
        return a.lower() == b.lower()
    return a == b


def evaluate(expr, ctx):
    toks = tokenize(expr)
    i = 0

    def peek():
        return toks[i] if i < len(toks) else (None, None)

    def take(kind=None, val=None):
        nonlocal i
        t = peek()
        if (kind and t[0] != kind) or (val and t[1] != val):
            raise ValueError("expected %s %s, got %s" % (kind, val, t))
        i += 1
        return t

    def or_():
        v = and_()
        while peek() == ("op", "||"):
            take()
            r = and_()
            v = v if truthy(v) else r
        return v

    def and_():
        v = eq()
        while peek() == ("op", "&&"):
            take()
            r = eq()
            v = r if truthy(v) else v
        return v

    def eq():
        v = unary()
        while peek() in (("op", "=="), ("op", "!=")):
            op = take()[1]
            r = unary()
            v = loose_eq(v, r) if op == "==" else not loose_eq(v, r)
        return v

    def unary():
        if peek() == ("op", "!"):
            take()
            return not truthy(unary())
        return atom()

    def atom():
        kind, val = peek()
        if kind == "str":
            take()
            return val
        if peek() == ("op", "("):
            take()
            v = or_()
            take("op", ")")
            return v
        if kind == "id":
            take()
            if val == "true":
                return True
            if val == "false":
                return False
            if peek() == ("op", "("):          # a function call
                take()
                args = []
                if peek() != ("op", ")"):
                    args.append(or_())
                    while peek() == ("op", ","):
                        take()
                        args.append(or_())
                take("op", ")")
                if val == "startsWith":
                    return str(args[0]).lower().startswith(str(args[1]).lower())
                raise ValueError("function not supported by this test: " + val)
            return ctx.get(val)                # a context value; unset is null
        raise ValueError("unexpected %s" % (peek(),))

    v = or_()
    if i != len(toks):
        raise ValueError("trailing input in: " + expr)
    return v


def expr_of(text):
    """`${{ x }}` or a bare condition -> the expression."""
    text = str(text).strip()
    m = re.fullmatch(r"\$\{\{(.*)\}\}", text, re.S)
    return (m.group(1) if m else text).strip()


def substitute(text, ctx):
    """Every ${{ }} in a string, evaluated, as GitHub renders it."""
    def one(m):
        v = evaluate(m.group(1), ctx)
        return {True: "true", False: "false", None: ""}.get(v, str(v)) if not isinstance(v, str) else v
    return re.sub(r"\$\{\{(.*?)\}\}", one, text)


# ---- the workflow ----
wf = yaml.safe_load(WORKFLOW.read_text())
on = wf.get(True, wf.get("on"))            # YAML reads a bare `on` as true
jobs = wf["jobs"]
steps_of = lambda job: jobs[job].get("steps", [])


def uses(job, prefix):
    return [s for s in steps_of(job) if str(s.get("uses", "")).startswith(prefix)]


def pushes(job):
    return [s for s in steps_of(job) if str(s.get("with", {}).get("push", "")).lower() == "true"]


def ctx(event="push", ref="refs/heads/main", owner="RusticPotatos", var=None, publish=None, repo="RusticPotatos/endora-console"):
    c = {"github.event_name": event, "github.ref": ref, "github.repository": repo,
         "github.repository_owner": owner, "github.actor": "someone"}
    if var is not None:
        c["vars.ENDORA_CONSOLE_IMAGE_PUBLISH"] = var
    if event == "workflow_dispatch":
        c["inputs.publish"] = bool(publish)
    return c


def publish_runs(c):
    """Does any job that can log in or push run for this event?"""
    out = []
    def holds(cond):
        return cond is None or truthy(evaluate(expr_of(cond), c))

    for name in jobs:
        if not holds(jobs[name].get("if")):
            continue
        risky = [s for s in steps_of(name)
                 if str(s.get("uses", "")).startswith("docker/login-action") or s in pushes(name)]
        if any(holds(s.get("if")) for s in risky):
            out.append(name)
    return out


print("== what can trigger it")
triggers = set(on) if isinstance(on, dict) else set(on if isinstance(on, list) else [on])
expect("it runs on push, on pull requests and by hand, and on nothing that runs with another repository's code or on a clock",
       {"push", "pull_request", "workflow_dispatch"} <= triggers and not triggers & {"pull_request_target", "schedule", "workflow_run", "release", "repository_dispatch"})
inputs = ((on.get("workflow_dispatch") or {}) if isinstance(on, dict) else {}).get("inputs") or {}
expect("the only input is `publish`: no manual way to move `latest`", set(inputs) == {"publish"})
for name in ("publish",):
    expect("`%s` is a boolean input that defaults to off" % name,
           (inputs.get(name) or {}).get("type") == "boolean" and (inputs.get(name) or {}).get("default") is False)

print("== who may write packages")
expect("the workflow's own permissions are read-only", wf.get("permissions") == {"contents": "read"})
writers = [n for n, j in jobs.items() if (j.get("permissions") or {}).get("packages") == "write"]
expect("exactly one job holds packages: write", len(writers) == 1)
if len(writers) != 1:
    print("image workflow tests FAILED: no single publishing job to test further")
    sys.exit(1)
publisher = writers[0]
others = [n for n in jobs if n != publisher]
expect("the publishing job holds nothing beyond contents: read and packages: write",
       jobs[publisher].get("permissions") == {"contents": "read", "packages": "write"})
expect("every other job's permissions are explicit and read-only",
       all(jobs[n].get("permissions") == {"contents": "read"} for n in others))
expect("only the job that holds packages: write logs in to a registry or pushes",
       all(not uses(n, "docker/login-action") and not pushes(n) for n in others)
       and bool(uses(publisher, "docker/login-action")) and len(pushes(publisher)) == 1)
expect("the build job loads its image and never pushes it",
       all(str(s["with"].get("push", "false")).lower() == "false" and str(s["with"].get("load")).lower() == "true"
           for n in others for s in steps_of(n) if str(s.get("uses", "")).startswith("docker/build-push-action")))
expect("the publishing job needs the build job, so a failed build or smoke test stops it",
       publisher is not None and jobs[publisher].get("needs") in ("image", ["image"]) and "image" in others)
expect("the build job smoke-tests the image it built",
       any("smoke.sh" in str(s.get("run", "")) for s in steps_of("image")))

print("== which events publish (every combination that matters, the variable enabled where it could matter)")
SAFE = [
    ("a push to main", ctx("push", "refs/heads/main", var="enabled")),
    ("the first push to main, nothing set", ctx("push", "refs/heads/main")),
    ("a push to develop", ctx("push", "refs/heads/develop", var="enabled")),
    ("a push of a v1.2.3 tag", ctx("push", "refs/tags/v1.2.3", var="enabled")),
    ("a pull request", ctx("pull_request", "refs/pull/7/merge", var="enabled")),
    ("a pull request from a fork (target)", ctx("pull_request_target", "refs/heads/main", var="enabled")),
    ("a scheduled run", ctx("schedule", "refs/heads/main", var="enabled")),
    ("a manual run without `publish`", ctx("workflow_dispatch", "refs/heads/main", var="enabled", publish=False)),
    ("a manual run, `publish`, variable not set", ctx("workflow_dispatch", "refs/heads/main", publish=True)),
    ("a manual run, `publish`, variable `disabled`", ctx("workflow_dispatch", "refs/heads/main", var="disabled", publish=True)),
    ("a manual run, `publish`, variable empty", ctx("workflow_dispatch", "refs/heads/main", var="", publish=True)),
    ("a manual run, `publish`, variable `true` (not the word `enabled`)", ctx("workflow_dispatch", "refs/heads/main", var="true", publish=True)),
    ("a manual run, `publish`, from develop", ctx("workflow_dispatch", "refs/heads/develop", var="enabled", publish=True)),
    ("a manual run, `publish`, from a feature branch", ctx("workflow_dispatch", "refs/heads/feature/x", var="enabled", publish=True)),
    ("a manual run, `publish`, from a non-version tag", ctx("workflow_dispatch", "refs/tags/nightly", var="enabled", publish=True)),
    ("a manual run, `publish`, in a fork", ctx("workflow_dispatch", "refs/heads/main", owner="someone", repo="someone/endora-console", var="enabled", publish=True)),
    ("a manual run, `publish`, in another repository of the owner", ctx("workflow_dispatch", "refs/heads/main", repo="RusticPotatos/endora-core", var="enabled", publish=True)),
]
for name, c in SAFE:
    expect("%s: nothing logs in, nothing is pushed" % name, publish_runs(c) == [])

for name, c in [
    ("main", ctx("workflow_dispatch", "refs/heads/main", var="enabled", publish=True)),
    ("a v1.2.3 tag", ctx("workflow_dispatch", "refs/tags/v1.2.3", var="enabled", publish=True)),
]:
    expect("a manual run, `publish`, variable `enabled`, from %s: the publishing job runs" % name, publish_runs(c) == [publisher])

print("== which tags a publish gives")
meta = [s for s in steps_of(publisher) if str(s.get("uses", "")).startswith("docker/metadata-action")][0]
tag_lines = [l.strip() for l in meta["with"]["tags"].splitlines() if l.strip()]
# metadata-action's `flavor` input; `latest` defaults to `auto`, which adds `latest` on a semver tag
# ref whatever the `tags` rules say (https://github.com/docker/metadata-action#latest-tag).
flavor = dict(l.strip().split("=", 1) for l in str(meta["with"].get("flavor", "")).splitlines() if "=" in l)
latest_mode = flavor.get("latest", "auto").strip().lower()


def tags_for(c):
    """The tag rules metadata-action would apply, as it would read `enable=`."""
    out = []
    for line in tag_lines:
        fields = dict(p.split("=", 1) for p in line.split(",") if "=" in p)
        enabled = substitute(fields.get("enable", "true"), c).strip().lower() != "false"
        kind = line.split(",")[0]
        if not enabled:
            continue
        if kind == "type=sha":
            out.append("sha-<commit>")
        elif kind == "type=raw":
            out.append(fields["value"])
        elif kind == "type=semver":
            if c["github.ref"].startswith("refs/tags/v"):
                out.append("X.Y.Z")
                if latest_mode in ("auto", "true") and "latest" not in out:
                    out.append("latest")        # the action's own addition, not a `tags` rule
    return out


def tags_everywhere():
    """Every tag the metadata step could give, over every ref the workflow can run on."""
    refs = ["refs/heads/main", "refs/heads/develop", "refs/heads/feature/x", "refs/tags/v1.2.3", "refs/tags/nightly"]
    return {t for r in refs for ev in ("push", "workflow_dispatch")
            for t in tags_for(ctx(ev, r, var="enabled", publish=True))}


def tags_for_run(ref):
    return tags_for(ctx("workflow_dispatch", ref, var="enabled", publish=True))


expect("from main: only sha-<commit>; `latest` is not touched", tags_for_run("refs/heads/main") == ["sha-<commit>"])
expect("from a version tag: sha-<commit> and X.Y.Z, never latest", tags_for_run("refs/tags/v1.2.3") == ["sha-<commit>", "X.Y.Z"])
expect("no ref, no event gives `latest` (there is no manual way to move it either)", "latest" not in tags_everywhere())
expect("the metadata step sets `flavor` `latest=false`, so the action adds no `latest` of its own",
       latest_mode == "false")
expect("no tag is written outright except through the metadata step",
       not re.search(r"endora-console:(latest|[0-9])", WORKFLOW.read_text())
       and all("steps.meta.outputs.tags" in str(s["with"]["tags"]) for s in pushes(publisher)))

print()
if failed:
    print("image workflow tests FAILED")
    sys.exit(1)
print("image workflow tests passed")
