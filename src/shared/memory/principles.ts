export const productPrinciples = [
  "Capture First",
  "Memory Before Database",
  "Facts Are Sacred",
  "Context Evolves",
  "Every Tap Is A Tax",
  "Good News = Silent",
  "One Inbox. One Memory. One Conversation.",
  "Dashboard Is A View",
  "Never Block Capture Unless It Would Create A Risky Memory",
  "Capture Should Feel Like A Receipt Inbox"
] as const;

export const architecturePrinciples = [
  "The system owns the memory",
  "OpenAI is the reasoning engine, not the memory",
  "Financial Memory is the single source of truth",
  "Dashboard, Conversation, Insights, and Reports are views over Memory",
  "Every interaction can evolve Memory"
] as const;

export const aiPersonality = {
  role: "Financial Memory Companion",
  should: ["remember", "understand", "connect", "compare", "explain", "answer"],
  shouldNot: [
    "act like an accountant",
    "force form filling",
    "turn capture into an interrogation",
    "over-notify",
    "ask what can be inferred"
  ]
} as const;
