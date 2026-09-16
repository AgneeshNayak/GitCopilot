import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();
const issuesByInstance = new Map();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function scoreIssue(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    const reasons = [];
    let score = 0;
    if (labels.some((label) => ["urgent", "critical", "blocker", "security"].includes(label))) {
        score += 8;
        reasons.push("high-severity label");
    }
    if (labels.some((label) => ["bug", "regression", "broken"].includes(label)) || /\b(fail|broken|crash|error)\b/.test(text)) {
        score += 5;
        reasons.push("likely defect or failure");
    }
    if (/\b(blocked|blocking|cannot|can't|release)\b/.test(text)) {
        score += 4;
        reasons.push("mentions a blocker or release impact");
    }
    if (issue.assignees.length === 0) {
        score += 2;
        reasons.push("unassigned");
    }
    if ((Date.now() - Date.parse(issue.updatedAt)) / 86_400_000 <= 7) {
        score += 3;
        reasons.push("updated recently");
    }
    return {
        ...issue,
        labels,
        score,
        justification: reasons.length > 0 ? reasons.slice(0, 3).join(", ") : "highest remaining priority by issue activity",
    };
}

async function loadIssues(cwd) {
    const { stdout } = await execFileAsync(
        "gh",
        [
            "issue",
            "list",
            "--repo",
            "AgneeshNayak/GitCopilot",
            "--state",
            "open",
            "--limit",
            "50",
            "--json",
            "number,title,body,labels,assignees,updatedAt,createdAt,url",
        ],
        { cwd },
    );
    return {
        issues: JSON.parse(stdout).map(scoreIssue).sort((a, b) => b.score - a.score),
    };
}

function renderIssue(issue, isTop) {
    const labels = issue.labels.map((label) => `<span class="label">${escapeHtml(label)}</span>`).join("");
    return `<article class="card ${isTop ? "priority" : ""}">
      <div class="card-header"><span class="number">#${issue.number}</span><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></div>
      <div class="labels">${labels}</div>
      <p>${escapeHtml(issue.body || "No description provided.")}</p>
      ${isTop ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(issue.justification)}.</p>` : ""}
      <button data-number="${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(instanceId, state) {
    const error = state.error ? `<div class="error" role="alert">${escapeHtml(state.error)}</div>` : "";
    const top = state.issues.slice(0, 3).map((issue) => renderIssue(issue, true)).join("");
    const remainder = state.issues.slice(3).map((issue) => renderIssue(issue, false)).join("");
    return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Issue triage</title>
    <style>
      :root { color-scheme: light dark; } body { margin: 0; padding: 20px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font-family: var(--font-sans, system-ui, sans-serif); }
      h1 { margin: 0 0 6px; font-size: 24px; } h2 { margin: 0; font-size: 16px; } .muted { color: var(--text-color-muted, #656d76); margin-top: 0; }
      .section { margin-top: 24px; } .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; } .section-heading p { margin: 0; font-size: 12px; color: var(--text-color-muted, #656d76); }
      .priority-section { padding: 16px; border: 1px solid var(--true-color-red-muted, #ffebe9); border-radius: 12px; background: color-mix(in srgb, var(--true-color-red-muted, #ffebe9) 35%, transparent); }
      .backlog-section { padding: 16px; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 12px; background: color-mix(in srgb, var(--border-color-default, #d0d7de) 12%, transparent); }
      .grid { display: grid; gap: 12px; } .priority-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .backlog-grid { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
      .card { min-width: 0; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; padding: 14px; background: var(--background-color-default, #fff); box-shadow: 0 2px 6px rgb(0 0 0 / 8%); }
      .priority { border-top: 4px solid var(--true-color-red, #cf222e); } .backlog-section .card { box-shadow: none; } .card-header { display: flex; gap: 8px; align-items: baseline; } .card-header a { color: var(--text-color-default, #1f2328); font-weight: 600; text-decoration: none; } .number { flex: 0 0 auto; color: var(--text-color-muted, #656d76); font-family: var(--font-mono, monospace); }
      .labels { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0; } .label { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 999px; padding: 2px 7px; font-size: 11px; }
      p { line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; } .why { color: var(--text-color-muted, #656d76); font-size: 13px; } button { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; padding: 7px 10px; background: var(--background-color-default, #fff); color: inherit; cursor: pointer; } button:hover, button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 1px; } button:disabled { opacity: .6; cursor: wait; } .error { padding: 12px; border: 1px solid var(--true-color-red, #cf222e); border-radius: 6px; }
      @media (max-width: 760px) { body { padding: 14px; } .priority-grid { grid-template-columns: 1fr; } .section-heading { align-items: flex-start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <h1>Issue triage</h1><p class="muted">Top candidates are ranked by severity, failure/blocker signals, ownership, and recent activity.</p>
    ${error}
    <section class="section priority-section" aria-labelledby="priority-heading">
      <div class="section-heading"><h2 id="priority-heading">Needs attention now</h2><p>Top 3 ranked issues</p></div>
      <div class="grid priority-grid">${top || "<p class='muted'>No open issues found.</p>"}</div>
    </section>
    <section class="section backlog-section" aria-labelledby="backlog-heading">
      <div class="section-heading"><h2 id="backlog-heading">Remaining backlog</h2><p>Continue triage below</p></div>
      <div class="grid backlog-grid">${remainder || "<p class='muted'>Nothing else to triage.</p>"}</div>
    </section>
    <script>
      document.querySelectorAll("button[data-number]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Adding...";
          const response = await fetch("/add-to-context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: Number(button.dataset.number) }) });
          button.textContent = response.ok ? "Added to context" : "Could not add";
          if (!response.ok) button.disabled = false;
        });
      });
    </script>
    <small class="muted">Canvas instance: ${escapeHtml(instanceId)}</small>
  </body>
</html>`;
}

async function addIssueToContext(issue) {
    await session.send({
        prompt: `Work on GitHub issue #${issue.number}: ${issue.title}

Issue URL: ${issue.url}
Description:
${issue.body || "No description provided."}

Start by inspecting the repository and issue context, then implement and verify the appropriate fix.`,
    });
}

async function startServer(instanceId, state) {
    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/add-to-context") {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", async () => {
                try {
                    const { number } = JSON.parse(body);
                    const issue = state.issues.find((item) => item.number === number);
                    if (!issue) throw new Error("Issue is no longer available.");
                    await addIssueToContext(issue);
                    res.writeHead(204).end();
                } catch (error) {
                    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(error instanceof Error ? error.message : "Unable to add issue.");
                }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId, state));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "A Kanban board that ranks open GitHub issues and adds selected issues to the current session context.",
            actions: [
                {
                    name: "add_issue_to_context",
                    description: "Add an issue from the board to the current session as an actionable work request.",
                    inputSchema: {
                        type: "object",
                        properties: { number: { type: "integer", minimum: 1 } },
                        required: ["number"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const state = issuesByInstance.get(ctx.instanceId);
                        const issue = state?.issues.find((item) => item.number === ctx.input.number);
                        if (!issue) throw new CanvasError("issue_not_found", `Issue #${ctx.input.number} is not available on this board.`);
                        await addIssueToContext(issue);
                        return { added: issue.number, title: issue.title };
                    },
                },
            ],
            open: async (ctx) => {
                const state = { issues: [], error: "" };
                try {
                    state.issues = (await loadIssues(session.workspacePath || process.cwd())).issues;
                } catch (error) {
                    state.error = error instanceof Error ? `Unable to load GitHub issues: ${error.message}` : "Unable to load GitHub issues.";
                }
                issuesByInstance.set(ctx.instanceId, state);
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, state);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                issuesByInstance.delete(ctx.instanceId);
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
