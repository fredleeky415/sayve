# Core Architecture Philosophy

The product is not a bookkeeping application.

The product is an AI-powered, continuously evolving Financial Memory.

The web app is only one interface to interact with that memory.

## Household First Identity

Sayve is family-first, not personal-first.

One household owns one shared Financial Memory.

Each family member logs in with their own account, but they write into the same `household_id`.

This means:

- Dashboard reads the household aggregate.
- Conversation answers from the shared family memory.
- Captures and user questions keep `created_by` attribution.
- Corrections and context confirmations keep the acting member id in revision metadata.
- `created_by` means who supplied the memory, not necessarily who paid.
- Future member views can be generated from the same memory without splitting the product into separate personal ledgers.

## Mental Model

Think of this system as a ChatGPT Project that continuously updates itself.

Unlike a normal ChatGPT Project, where knowledge is mostly static until users upload new documents, Financial Memory is a living knowledge base.

Every interaction updates the memory.

Examples:

- User speaks.
- User types.
- User uploads a receipt.
- User corrects a memory.
- AI discovers recurring expenses.
- AI detects changes in household context.

All of these continuously evolve the Financial Memory.

## Receipt Inbox Capture

Capture should feel like a receipt inbox.

The user should be able to drop something into the system with almost no friction:

- Type one short line.
- Speak one sentence.
- Take one receipt photo.
- Correct one memory casually.

The first job of the product is to receive the memory, not interrogate the user.

The AI should run a clarity check at capture time, but it should not turn every capture into a back-and-forth conversation.

Default behavior:

- High confidence: remember silently.
- Medium confidence: remember now and mark for low-friction review.
- Low confidence and low impact: keep the capture, mark for later review, and avoid interrupting.
- Low confidence and high impact: ask one minimal question only.

This protects the core habit:

> I tell my AI what happened.
>
> I do not fill in a bookkeeping form.

## The Memory Engine

OpenAI is not the memory.

OpenAI is the reasoning engine.

The system owns the memory.

The Memory Engine is responsible for:

- Storing facts.
- Storing household context.
- Storing relationships.
- Storing revision history.
- Storing AI interpretations.

OpenAI continuously:

- Understands new captures.
- Updates memories.
- Reasons over memories.
- Answers questions.
- Generates insights.

This separation allows:

- Model upgrades.
- Memory persistence.
- Explainability.
- Future AI providers.
- Continuous evolution.

## Single Source Of Truth

The Financial Memory is the single source of truth.

Everything else is simply another way of reading it.

Examples:

- Dashboard is generated from Memory.
- Conversation is generated from Memory.
- Insights are generated from Memory.
- Reports are generated from Memory.
- Future features are generated from Memory.

The application never stores separate business logic for Dashboard or Conversation.

They are different views over the same evolving Financial Memory.

## Product Philosophy

Users are not interacting with bookkeeping software.

Users are interacting with an AI that remembers their family's financial life.

The AI should feel like an external financial brain.

The goal is simple:

> I don't keep books anymore.
>
> I simply tell my AI what happened.
