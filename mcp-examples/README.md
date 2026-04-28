# MCP Examples for Chrome Enterprise

Reference applications that integrate with the [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp). Use these as starting points for building admin tools, AI assistants, or custom dashboards on top of Chrome Enterprise APIs.

---

## What is MCP?

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open standard that lets AI applications connect to external tools and data sources through a uniform JSON-RPC interface. Instead of writing one-off integrations for every API, an MCP **server** exposes a set of *tools* and *prompts* once, and any MCP **client** — a chat app, an IDE, an internal admin tool — can call them.

The [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp) wraps the Chrome Browser Cloud Management, Chrome Policy, Chrome Management, and Admin SDK APIs into MCP tools. That means an AI agent can investigate user issues, audit extension risk, query browser fleet state, or read Chrome activity logs by calling tools — without hand-writing the API plumbing into every agent.

This folder collects example applications that demonstrate how to build on top of that server: how to authenticate, how to call tools, how to surface results, and how to design the developer experience around MCP.

---

## Examples

| Example | Description |
| --- | --- |
| [pocket-cep](./pocket-cep) | Educational Next.js companion app. A Workspace admin picks a user from a Chrome activity dropdown and chats with an AI agent (Claude or Gemini) that calls MCP tools to investigate Chrome Enterprise issues. Ships an **MCP Inspector** panel that shows every JSON-RPC request and response on the wire — useful for understanding how MCP works in practice. Built with Next.js 16, Vercel AI SDK v6, BetterAuth, Tailwind CSS 4, and the official MCP SDK. |

---

## Related

* **[Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp)** — the upstream MCP server that the examples connect to.
* **[Model Context Protocol](https://modelcontextprotocol.io)** — protocol documentation and SDK references.
