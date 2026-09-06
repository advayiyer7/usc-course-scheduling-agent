# USC Course Scheduling Agent

A shared USC course-data service that students can use through an MCP-compatible AI assistant and a companion Chrome extension.

**Status: design only. No server, extension, scheduler, or authentication flow is implemented yet.**

## Specification

- [Architecture and boundaries](docs/architecture.md)
- [Tool contracts](docs/tool-contracts.md)
- [Runtime assistant system prompt](prompts/scheduling-assistant.system.md)
- [Implementation agent prompt](prompts/implementation-agent.md)
- [Phased delivery plan](docs/implementation-plan.md)

The runtime prompt describes how a scheduling assistant should behave. The implementation prompt instructs a coding agent how to build this repository. An external assistant may not let an MCP server install a system prompt; its host controls instructions. Enforce correctness and limits in the backend as well as documenting them for the model.

## Product scope

Students choose courses and preferences, inspect section alternatives, and validate proposed schedules. Their chosen assistant performs the conversation and initial planning. The backend provides authoritative data and deterministic validation. Full schedule generation is a later phase.

The Chrome extension displays preferences, saved course selections, and a weekly calendar. It calls the same backend over HTTPS. It does not automatically grant tools to arbitrary AI chat websites.

No automatic enrollment, degree certification, professor ratings, or collection of USC credentials in the initial scope.

This is an independent project, not an official USC service. Successful public access does not establish a supported integration or permission for ongoing bulk reuse.
