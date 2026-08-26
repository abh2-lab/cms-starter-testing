# AI theme authoring

This repo ships an AI theme-authoring kit. To turn a mock HTML design into a
working theme (blocks, templates/parts, seed fixtures), read AGENTS.md in this
directory. It has the full loop, the pnpm commands (gen:block, gen:template,
verify:theme), the hard rules, and the authoring-vs-runtime boundary.

Quick start (always hybrid/dev — NEVER on the live container):

    pnpm install
    pnpm dev:services     # backing services in Docker
    pnpm dev              # apps from source: admin :5173, web :3001, api :3000
    # assistant: mock HTML -> pnpm gen:block / gen:template -> fill in -> fixtures
    pnpm verify:theme     # structure + content gate; loop until GREEN
    # preview http://localhost:3001, then do a human QA pass
