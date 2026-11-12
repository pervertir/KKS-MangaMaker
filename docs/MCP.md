# MCP server

`mangamaker-mcp` exposes the pipeline over the [Model Context Protocol](https://modelcontextprotocol.io),
so any MCP client can write a script, turn it into pages, pose the shots and render them. It is one
file (`mangamaker_mcp.py`) with no packages beyond the pipeline's own (PyYAML, Pillow, numpy), on
Python 3.9 or newer.

- **stdio** (default): the client launches `mangamaker-mcp` and talks over its stdin/stdout. Use this
  whenever the client runs on the same machine as this checkout.
- **Streamable HTTP**: `mangamaker-mcp --http` serves `http://127.0.0.1:8766/mcp` for clients that
  only take a URL. The deprecated HTTP+SSE transport is served next to it at `/sse`.

Protocol revisions served: `2026-07-28` (stateless: `server/discover`, the version in every request's
`_meta`) and the handshake revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`
(`initialize` first). A client asking for a revision the server does not know is answered with the
newest one of its era, as the specification asks.

Everything below uses `/ABS/PATH/KKS-MangaMaker` for the absolute path of this checkout. Most clients
do **not** start servers in the project folder and do not see your shell's `PATH`, so always give the
absolute path.

## What it offers

**Tools**

| tool | does | touches |
|---|---|---|
| `script_format` | the Script Wizard format and writing guide | read-only |
| `check_script` | parses a script: pages, panels, characters, layout, warnings to fix | read-only |
| `build_pages_from_script` | writes `pages/<project>/project.json` and one shot per panel | writes files (mode `new` replaces the project) |
| `list_shots` | every shot: characters, prompt, posed or not, renders | read-only |
| `list_poses` | searches the pose library by type or name | read-only |
| `pose_shot` | places figures from the library and writes the shot's `pose.png` | writes files |
| `pose_from_image` | finds the people in a local image and saves them as poses | **GPU pod**, writes files |
| `render_shot` | renders a posed shot | **GPU pod** (bills while it runs), adds a render |
| `place_renders` | puts each panel's newest render into the project | writes files |
| `pod` | pod `status`, `start`, `stop` | **`start` begins GPU billing**, `stop` ends it |
| `cast` | reads the character sheet, or adds/updates characters | writes `cast.json` with `set` |

Every tool has a strict input schema, a title, and behaviour hints (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`; the three pod tools are the open-world ones) so clients can ask
before the calls that cost money or overwrite something. Wrong arguments come back as a readable
tool error the model can correct, not a protocol failure. Tools that return data also return it as
`structuredContent` (protocol `2025-06-18` and later).

`render_shot` takes minutes. The server keeps answering other requests while it runs, reports each
pipeline step as a progress notification when the request carries a `progressToken`, and stops the
render when the client cancels (`notifications/cancelled` on stdio, closing the stream over HTTP).

**Prompts** (for clients without the script skill; many clients show them as slash commands)

| prompt | arguments | does |
|---|---|---|
| `write_manga_script` | `idea`, optional `pages`, `reading`, `cast` | writes a Script Wizard script from an idea, with the full guide attached |
| `convert_script_to_wizard_format` | `script` | rewrites a screenplay, prose or another comic format into the Script Wizard format |
| `storyboard_and_render` | `idea`, optional `project`, `render` (`yes` to use the GPU pod) | the whole pipeline with the tools: script, pages, poses, and renders only if asked |

**Resources**

| uri | is |
|---|---|
| `mangamaker://docs/script-wizard` | [SCRIPT_WIZARD.md](SCRIPT_WIZARD.md), the same guide `script_format` returns |

## Before connecting a client

```sh
/ABS/PATH/KKS-MangaMaker/mangamaker-mcp --version
```

must print the version. The launcher picks the interpreter in this order: `$MANGAPIPE_PYTHON`, the
`comfyui` conda environment under `~/miniconda3`, `python3`, `python`. If PyYAML, Pillow or numpy are
missing from it the server exits at once and says so on stderr with the `pip install` line to run.
On Windows use `mangamaker-mcp.cmd` (`%MANGAPIPE_PYTHON%`, else `python`, else `py -3`); it has not
been run on a Windows machine yet, so treat it as untested.

**Environment** (set in the client's `env` block when the client does not inherit your shell):

| variable | for |
|---|---|
| `MANGAPIPE_PYTHON` | the Python to run the server and the pipeline with |
| `MANGAPIPE_TARGET` | `local` or `runpod`, overriding `target` in `config.yaml` |
| `COMFYUI_URL` | a ComfyUI to render on, overriding the configured one |
| `CIVITAI_API_KEY` | lets the LoRA search download files that need a Civitai login |
| `PATH` | must reach `runpodctl` when the target is `runpod` (GUI clients start with a short `PATH`) |
| `MANGAMAKER_MCP_TOKEN`, `MANGAMAKER_MCP_ALLOW_HOST`, `MANGAMAKER_MCP_ALLOW_ORIGIN` | `--http` only, see below |

The generic entry almost every client accepts:

```json
{
  "mcpServers": {
    "kks-mangamaker": {
      "command": "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp",
      "args": [],
      "env": { "MANGAPIPE_PYTHON": "/ABS/PATH/TO/python" }
    }
  }
}
```

`env` is optional. On Windows the command is `C:\\ABS\\PATH\\KKS-MangaMaker\\mangamaker-mcp.cmd`; if
a client refuses to start a `.cmd` directly, use `"command": "cmd", "args": ["/c", "C:\\ABS\\PATH\\KKS-MangaMaker\\mangamaker-mcp.cmd"]`.

## Client setup

Paths and keys below were read from each client's own documentation in November 2026. Where that
documentation did not state something, it says "check your client's docs" instead of guessing.

### Claude Code

`.mcp.json` in this folder already registers the server for sessions started here (Claude Code asks
once before using a project-scoped server). Anywhere else:

```sh
claude mcp add --scope user kks-mangamaker -- /ABS/PATH/KKS-MangaMaker/mangamaker-mcp
claude mcp add --transport http kks-mangamaker-http http://127.0.0.1:8766/mcp      # the --http server
```

`/mcp` shows the connection. `.claude/skills/kks-mangamaker-script` is the script-writing skill for
this client; the prompts above carry the same guidance for the others.

### Claude Desktop

Settings › Developer › Edit Config opens `claude_desktop_config.json`
(macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`).
Add the generic entry above, then quit and reopen the app. Server logs (this server's stderr) are in
`~/Library/Logs/Claude/mcp-server-kks-mangamaker.log` (Windows `%APPDATA%\Claude\logs\`).

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project): the generic entry. For the
HTTP server use `{ "mcpServers": { "kks-mangamaker": { "url": "http://127.0.0.1:8766/mcp" } } }`.
Cursor lists tools, prompts and resources; errors are in the Output panel under "MCP Logs".

### VS Code (GitHub Copilot)

VS Code's own format has `servers` at the top, not `mcpServers`. In `.vscode/mcp.json`
(**MCP: Open Workspace Folder MCP Configuration**) or the user file (**MCP: Open User Configuration**):

```json
{
  "servers": {
    "kks-mangamaker": {
      "type": "stdio",
      "command": "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp",
      "args": []
    }
  }
}
```

or from a terminal:

```sh
code --add-mcp '{"name":"kks-mangamaker","type":"stdio","command":"/ABS/PATH/KKS-MangaMaker/mangamaker-mcp"}'
```

For the HTTP server: `"type": "http", "url": "http://127.0.0.1:8766/mcp"`. Copilot's newer native files
(`~/.copilot/mcp-config.json`, or `.mcp.json` at the workspace root behind an experimental setting)
use the generic `mcpServers` shape instead; which of the two your version reads: check your client's
docs. **MCP: Browse Resources** shows the guide resource.

### Windsurf / Devin Desktop (Cascade)

The Windsurf documentation now lives under Devin Desktop and names these files:
`~/.config/devin/mcp_config.json` (user) and `.devin/mcp_config.json` (project), with the generic
`mcpServers` entry. A remote entry is `{ "url": "http://127.0.0.1:8766/mcp", "transport": "http" }`.
Or: `devin mcp add kks-mangamaker -- /ABS/PATH/KKS-MangaMaker/mangamaker-mcp`. Older Windsurf builds
used `~/.codeium/windsurf/mcp_config.json`: check your client's docs for the file your version reads.

### Cline

Cline panel › MCP Servers icon › Configure › **Configure MCP Servers** opens
`cline_mcp_settings.json` (the CLI keeps it at `~/.cline/data/settings/cline_mcp_settings.json`).
Add the generic entry; `"disabled": false` and `"autoApprove": []` are optional. For the HTTP server:
`{ "type": "streamableHttp", "url": "http://127.0.0.1:8766/mcp" }` (without `type` Cline assumes the
old SSE transport, for which the URL is `http://127.0.0.1:8766/sse`). Raise the request timeout in
Cline's MCP settings before rendering.

### Roo Code

MCP settings view › **Edit Global MCP** (`mcp_settings.json`) or **Edit Project MCP**
(`.roo/mcp.json`): the generic entry plus a longer timeout, because Roo stops waiting after 60
seconds by default and a render takes longer:

```json
{
  "mcpServers": {
    "kks-mangamaker": {
      "command": "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp",
      "args": [],
      "timeout": 1800
    }
  }
}
```

For the HTTP server: `{ "type": "streamable-http", "url": "http://127.0.0.1:8766/mcp" }`.

### Continue

Create `.continue/mcpServers/kks-mangamaker.yaml` in the workspace:

```yaml
name: KKS-MangaMaker
version: 0.0.1
schema: v1
mcpServers:
  - name: kks-mangamaker
    type: stdio
    command: /ABS/PATH/KKS-MangaMaker/mangamaker-mcp
    args: []
```

Continue also picks up a JSON file in the generic shape dropped into `.continue/mcpServers/`. For the
HTTP server use `type: streamable-http` and `url: http://127.0.0.1:8766/mcp`. MCP tools work in agent
mode only. How prompts and resources show up: check your client's docs.

### Zed

`zed: open settings file`, then (or Settings › AI › MCP Servers › Add Server › Add Local Server):

```json
{
  "context_servers": {
    "kks-mangamaker": {
      "command": "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

A remote entry is `{ "url": "http://127.0.0.1:8766/mcp" }`. Zed uses tools and prompts.

### JetBrains AI Assistant

Settings › Tools › AI Assistant › Model Context Protocol (MCP) › Add, paste the generic `mcpServers`
JSON (STDIO), or give the URL of the HTTP server. The same page can import a Claude Desktop
configuration, and sets whether the server is global or for the current project. Logs: Help › Show
Log, `mcp` folder.

### OpenAI Codex (CLI, IDE extension, ChatGPT desktop app)

They share `~/.codex/config.toml`:

```toml
[mcp_servers.kks-mangamaker]
command = "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp"
args = []
startup_timeout_sec = 20
tool_timeout_sec = 1800     # the default of 60 is shorter than a render

[mcp_servers.kks-mangamaker.env]
MANGAPIPE_PYTHON = "/ABS/PATH/TO/python"
```

or `codex mcp add kks-mangamaker -- /ABS/PATH/KKS-MangaMaker/mangamaker-mcp` and edit the timeouts
afterwards. For the HTTP server: `url = "http://127.0.0.1:8766/mcp"` (with a token:
`bearer_token_env_var = "MANGAMAKER_MCP_TOKEN"`).

### Gemini CLI

`~/.gemini/settings.json` (user) or `.gemini/settings.json` (project): the generic entry. Its tool
timeout is 10 minutes by default; add `"timeout": 1800000` (milliseconds) for long renders. For the
HTTP server the key is `httpUrl`, not `url` (`url` means the old SSE transport there):
`{ "httpUrl": "http://127.0.0.1:8766/mcp" }`. Or:

```sh
gemini mcp add -s user kks-mangamaker /ABS/PATH/KKS-MangaMaker/mangamaker-mcp
```

Prompts become slash commands named after the prompt, e.g. `/write_manga_script --idea="..."`.

### LM Studio

0.3.17 or newer: Program tab (right sidebar) › Install › **Edit mcp.json**, and add the generic entry
(LM Studio follows Cursor's notation; a remote entry is `{ "url": "http://127.0.0.1:8766/mcp" }`).
Eleven tool definitions plus the guide are a lot for a small local model: load one with a large
context window and tool support.

### Goose

Desktop: sidebar › Extensions › Add custom extension › type STDIO, command
`/ABS/PATH/KKS-MangaMaker/mangamaker-mcp`, timeout 1800. CLI: `goose configure` › Add Extension ›
Command-line Extension. Or in `~/.config/goose/config.yaml`:

```yaml
extensions:
  kks-mangamaker:
    name: KKS-MangaMaker
    type: stdio
    cmd: /ABS/PATH/KKS-MangaMaker/mangamaker-mcp
    args: []
    enabled: true
    timeout: 1800
```

For the HTTP server: `type: streamable_http` and `uri: http://127.0.0.1:8766/mcp`. For one session
only: `goose session --with-extension "/ABS/PATH/KKS-MangaMaker/mangamaker-mcp"`.

### Open WebUI

Open WebUI (0.6.31 and later) connects to Streamable HTTP servers itself. Start `mangamaker-mcp --http`,
then Settings › Admin › Integrations › External Tool Servers › Add Connection, **Type: MCP (Streamable
HTTP)**, URL `http://127.0.0.1:8766/mcp` (from a Docker container: `http://host.docker.internal:8766/mcp`,
with the server started as `--allow-host host.docker.internal --token ...` and the same token entered
as Bearer auth; whether your Docker setup can reach a server bound to 127.0.0.1 on the host: check
Docker's docs).

For builds without that, [mcpo](https://github.com/open-webui/mcpo) turns the stdio server into an
OpenAPI one that Open WebUI adds as an OpenAPI connection:

```sh
uvx mcpo --port 8000 --api-key "choose-a-key" -- /ABS/PATH/KKS-MangaMaker/mangamaker-mcp
```

(tool list at `http://localhost:8000/docs`).

### Anything else that takes "mcpServers" JSON

Use the generic entry. If the client only takes a URL, run the HTTP server (next section) and give it
`http://127.0.0.1:8766/mcp`; if it only speaks the old SSE transport, `http://127.0.0.1:8766/sse`.

## The HTTP server

```sh
/ABS/PATH/KKS-MangaMaker/mangamaker-mcp --http                 # http://127.0.0.1:8766/mcp
/ABS/PATH/KKS-MangaMaker/mangamaker-mcp --http --port 9000
```

- `POST /mcp` with one JSON-RPC message answers with `application/json`, or with a
  `text/event-stream` that carries progress and then the answer when the call asked for progress or
  is one of the slow pod tools (the client must list both types in `Accept`, as the specification
  requires). Notifications get `202`. `GET` and `DELETE` on `/mcp` get `405`: there are no sessions
  and no server-initiated stream, because the tool, prompt and resource lists never change while the
  server runs.
- `2026-07-28` requests must carry the `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`,
  `prompts/get`, `resources/read`) `Mcp-Name` headers matching the body; a mismatch is `400` with
  error `-32020`. Earlier revisions send `MCP-Protocol-Version` after `initialize`; a request with no
  header is treated as `2025-03-26`.
- It binds to `127.0.0.1` and refuses requests whose `Host` is not this machine or whose `Origin` is
  not a local page (`403`), which is what stops a web page you visit from driving it (DNS rebinding).
  `--allow-origin https://app.example` admits one more origin, `--allow-host name` one more host name.
- `--token SECRET` (better: the `MANGAMAKER_MCP_TOKEN` environment variable, which does not show in
  the process list) makes every request need `Authorization: Bearer SECRET`. The server will not start
  on any address other than loopback, or with `--allow-host`, without a token of at least 16
  characters.
- `GET /sse` + `POST /messages` is the HTTP+SSE transport from `2024-11-05`, kept for clients that
  still use it. It is deprecated in the specification; prefer `/mcp`.

### Clients that can only reach a public URL (ChatGPT, the OpenAI Responses API, other hosted clients)

Hosted clients call the server from their own machines, so they need an HTTPS address that leads to
your computer. That means putting **your own** tunnel or reverse proxy in front of `--http`:

```sh
export MANGAMAKER_MCP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
/ABS/PATH/KKS-MangaMaker/mangamaker-mcp --http --allow-host YOUR-TUNNEL-HOSTNAME
# then point your tunnel at http://127.0.0.1:8766 and give the client https://YOUR-TUNNEL-HOSTNAME/mcp
```

Read this before doing it:

- **Whoever can reach that URL with the token can spend your money and write to your disk.** The tools
  start the GPU pod, queue renders, overwrite projects, and `pose_from_image` reads any image file the
  server's user can read and sends it to the pod. Treat the token like a password, keep the tunnel up
  only while you use it, and stop the pod when you are done.
- No tunnel product is recommended here as safe. Whichever you use sees all traffic in clear text at
  its edge, and some rewrite the `Host` header to `localhost`, in which case `--allow-host` is not
  what protects you: the token is. Never run a tunnel to this server without a token.
- The server implements a static bearer token, not OAuth. **ChatGPT**'s "Add custom MCP server"
  dialog (Plugins › + › Add custom MCP server) offers OAuth or no authentication only, per OpenAI's
  help article, so it cannot send this token: connecting it means either an OAuth-capable gateway of
  your own in front, or OpenAI's Secure MCP Tunnel; check OpenAI's docs for both, and do not choose
  "No authentication" over a public URL.
- The **OpenAI Responses API** takes a remote server as
  `{"type": "mcp", "server_label": "kks_mangamaker", "server_url": "https://YOUR-TUNNEL-HOSTNAME/mcp", "authorization": "<token>", "require_approval": "always"}`.
  OpenAI documents `authorization` as an OAuth access token; that it is sent as the `Authorization:
  Bearer` header this server checks has not been tried here: check OpenAI's docs. Keep
  `require_approval` on.

## Trying it by hand

One line in, one line out (stderr carries the log):

```sh
cd /ABS/PATH/KKS-MangaMaker

# handshake revisions
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ./mangamaker-mcp

# 2026-07-28: no handshake
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' | ./mangamaker-mcp

# over HTTP (./mangamaker-mcp --http running in another terminal)
curl -s http://127.0.0.1:8766/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_script","arguments":{"script":"[Rem] Classroom at sunset\nRem: Hello"}}}'
```

The [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector) is the protocol's own test
client (Node 22.19 or newer; `npx` downloads it on first use):

```sh
npx @modelcontextprotocol/inspector /ABS/PATH/KKS-MangaMaker/mangamaker-mcp                      # web UI
npx @modelcontextprotocol/inspector --cli /ABS/PATH/KKS-MangaMaker/mangamaker-mcp --method tools/list
npx @modelcontextprotocol/inspector --cli /ABS/PATH/KKS-MangaMaker/mangamaker-mcp \
  --method tools/call --tool-name check_script --tool-arg 'script=[Rem] Classroom at sunset'
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8766/mcp --transport http --method tools/list
```

## Troubleshooting

**The server is not listed, or shows as failed.** Run the configured command in a terminal, exactly
as written in the config, with `--version`. Then read the client's server log (it is this server's
stderr): a line starting `mangamaker-mcp:` names the problem. Most clients need a full restart after
the config changes, and JSON config files must be valid JSON (no comments, no trailing commas).

**`spawn ... ENOENT`, "command not found", "No such file".** The client could not find the command.
Use the absolute path; a relative `./mangamaker-mcp` only works where the client starts servers in
this folder. Check the file is executable (`chmod +x mangamaker-mcp`). On Windows point at
`mangamaker-mcp.cmd`, through `cmd /c` if needed.

**`... is missing: pyyaml, pillow, numpy`.** The launcher found a Python without the pipeline's
packages, typically the system one, because GUI clients do not load your shell profile or conda. Set
`MANGAPIPE_PYTHON` in the entry's `env` to the interpreter you run `mangapipe` with, or install the
packages with the command the message prints.

**"Unexpected token", "invalid JSON", the connection drops right after it starts.** Something other
than the protocol reached the client on stdout. The server routes its own prints, its imports and
the pipeline's output to stderr, so the usual cause is a wrapper around it: do not launch it through
a shell profile that echoes text, `conda run` (use the environment's `python` path in
`MANGAPIPE_PYTHON` instead), or a script that prints a banner.

**A render "times out" or the tool call is cancelled after a minute.** That is the client's limit,
not the server's: a render takes one to several minutes, more on a cold pod. Raise the client's tool
timeout (Roo Code `timeout`, Codex `tool_timeout_sec`, Gemini CLI `timeout`, Goose `timeout`, Cline's
MCP request timeout; Claude Code waits long enough by default, `MCP_TOOL_TIMEOUT` changes it). Clients that reset their timer on progress
notifications are kept alive by the per-step progress this server sends. A cancelled call stops the
local pipeline run; a job already queued on ComfyUI may still finish there.

**`render_shot` fails with "not answering".** The pod is stopped or still booting: `pod` with
`status`, then `start` (billing begins), wait until status reports ComfyUI ready, render, and `stop`
when done.

**`pod` fails with "runpodctl" not found.** Add the folder that holds `runpodctl` to `PATH` in the
entry's `env`.

**`Not initialized: send initialize first`.** A hand-written request skipped the handshake: send
`initialize` first, or use the `2026-07-28` form with `_meta` as in the example above.

**HTTP `403`.** The request's `Host` or `Origin` is not local: see `--allow-host` and
`--allow-origin`. **`401`**: the bearer token is missing or wrong. **`400` with `-32020`**: a
`2026-07-28` request whose `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers do not match
its body.

**A change to the server is not picked up.** Clients keep the server process running: restart the
client or reconnect the server from its MCP panel.
