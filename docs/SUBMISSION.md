# Astra AI submission: copy-ready answers

## Description of what you built

SignFlow AI is a working web app that gets a client's agreement signed on every file without the manual chasing. A firm signs up and gets its own private workspace. They add a client, open a file for that client, and upload their agreement as a normal PDF. Nothing about the document is assumed in advance: it can be any length, page size or orientation. They see every page in the browser, drag signature, initials, name, date and text boxes to where the client should fill them in, and create a secure signing link (copied, or emailed through Resend when it's set up).

The client opens the link on a phone or laptop with no account, reads the whole agreement, clicks each highlighted box, draws or types a signature, ticks a consent box that says plainly they are signing electronically, and finishes. The server then writes the signature and values into the original PDF at the exact positions chosen, adds a certificate page (who, when, IP, document fingerprints), stores the signed copy in private storage against the file, and only then marks the agreement Signed. The admin downloads it from the file, and every step shows up in an audit timeline.

For the repeat part of the problem, the standard agreement can be saved once as a template with its fields placed. After that, creating a new file can create the agreement and send the link in the same step, so each new client is one form.

Built with Next.js 15 and TypeScript, Tailwind and shadcn/ui, Supabase (Postgres with Row Level Security, Auth, private Storage), PDF.js for viewing, pdf-lib for writing the signed PDF, Zod, Resend, Vitest and Playwright. I used Claude (Anthropic) as an AI coding assistant throughout.

Decisions I made where the brief was open: one signer per agreement (the client); the signature is a visual electronic signature with an evidence page, not a cryptographic certificate signature; signers never need accounts; email is optional and the app never claims an email was delivered when the provider only accepted it.

## Features you included, and why

- Upload of any PDF, checked on the server: the test agreement is unseen, so the app can't rely on a known layout, and broken, encrypted or fake PDFs get a clear message instead of a crash.
- Visual field editor with positions saved relative to the page: the person setting it up isn't a developer, and the signature has to land exactly where they put it on any page size, rotation or zoom level.
- No-account signing link with consent and server-side checks: clients sign once per file, so any sign-up step is friction. The server re-checks required fields and consent so nothing can be skipped.
- Signed PDF built on the server from the untouched original: the firm needs a trustworthy document, so the agreement only turns Signed once the file is safely stored, and double clicks can't produce two copies.
- Templates and one-step send on new files: the client said it's the same agreement every time. This is the automation that removes the repeat work per file.
- Statuses, dashboard and audit trail: the firm needs to see which files are still waiting and prove who signed what and when.
- Workspace isolation enforced in the database, hashed expiring links, private storage: they want to sell this to competitors, so one company must never see another's agreements.
- Copy-link as a first-class option: the product works on day one, before anyone sets up email.

## Features you deliberately left out, and why

- Multiple signers and signing order: the brief's agreement is signed by the client. Multi-party routing roughly doubles the states to get right, and reliability of the single-signer path mattered more.
- Cryptographic (PAdES) digital signatures and ID checks: these need paid certificate providers. I built a visual e-signature with a consent step and evidence page, and I'm explicit that a typed name isn't identity verification.
- Billing, payments, marketplace, analytics: none of these help get an agreement signed. They come once a second firm is paying.
- AI field detection and chatbots: guessing where a signature goes on an unknown document risks a wrong placement. A person placing it, then reusing it as a template, is quicker and certain.
- Reminder emails, webhooks/CRM sync, team invites: useful next steps, but each only matters after the core flow is solid. The schema leaves room for them.
- Mobile apps: the signing page already works in a phone browser.

## GitHub repository URL

TODO: paste once the repo is pushed, e.g. `https://github.com/OWNER/signflow-ai`

## Submission URL

TODO: paste the Vercel URL once deployed and checked at `/api/health`.
