import { z } from "zod";

export const MemoryDomainSchema = z.enum([
  "financial",
  "warranty",
  "insurance",
  "home",
  "car",
  "medical",
  "document"
]);

export const CaptureSourceSchema = z.enum(["text", "receipt", "voice", "email", "bank_import"]);
export const ConfidenceBandSchema = z.enum(["high", "medium", "low"]);
export const MemoryStatusSchema = z.enum(["auto_confirmed", "review_later", "needs_user_input", "archived"]);
export const RelationshipTypeSchema = z.enum([
  "supports_same_memory",
  "contradicts_context",
  "updates_context",
  "derived_from",
  "answers_with",
  "replaces_interpretation",
  "similar_to"
]);

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().default("HKD")
});

export const SourceRefSchema = z.object({
  type: z.enum(["capture", "fact", "context", "memory", "conversation", "file"]),
  id: z.string(),
  label: z.string().optional(),
  strength: z.enum(["weak", "medium", "strong"]).default("medium")
});

export const CaptureSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  sourceType: CaptureSourceSchema,
  rawText: z.string().optional(),
  transcript: z.string().optional(),
  fileRefs: z.array(z.string()).default([]),
  createdBy: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export const FinancialFactPayloadSchema = z.object({
  eventDate: z.string(),
  merchant: z.string().optional(),
  money: MoneySchema.optional(),
  category: z.string().optional(),
  direction: z.enum(["expense", "income", "transfer", "unknown"]).default("unknown"),
  recurringHint: z.boolean().default(false),
  participants: z.array(z.string()).default([]),
  ownershipScope: z.enum(["shared", "member"]).default("shared"),
  assignedMember: z.string().optional(),
  ownershipReason: z.string().optional(),
  note: z.string().optional()
});

export const ContextPayloadSchema = z.object({
  subject: z.string(),
  state: z.string(),
  effectiveFrom: z.string().optional(),
  evidence: z.string().optional()
});

export const MemoryInterpretationSchema = z.object({
  id: z.string(),
  memoryObjectId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  intent: z.enum(["financial_event", "context_update", "question", "correction", "unknown"]),
  structuredOutput: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  confidenceBand: ConfidenceBandSchema,
  reasoningSummary: z.string(),
  sourceRefs: z.array(SourceRefSchema),
  createdAt: z.string()
});

export const MemoryFactSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  memoryObjectId: z.string(),
  domain: MemoryDomainSchema.default("financial"),
  payload: FinancialFactPayloadSchema,
  sourceRefs: z.array(SourceRefSchema),
  immutable: z.literal(true).default(true),
  createdAt: z.string()
});

export const HouseholdContextSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  domain: MemoryDomainSchema.default("financial"),
  subject: z.string(),
  state: z.string(),
  currentState: z.enum(["active", "superseded", "uncertain"]).default("active"),
  confidence: z.number().min(0).max(1),
  sourceRefs: z.array(SourceRefSchema),
  effectiveFrom: z.string().optional(),
  updatedAt: z.string()
});

export const MemoryRelationshipSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  fromType: z.enum(["capture", "memory", "fact", "context", "insight", "conversation"]),
  fromId: z.string(),
  toType: z.enum(["capture", "memory", "fact", "context", "insight", "conversation"]),
  toId: z.string(),
  relationshipType: RelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  createdAt: z.string()
});

export const MemoryRevisionSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  memoryObjectId: z.string(),
  revisionType: z.enum(["ai_interpretation", "user_correction", "merge", "split", "reprocess", "context_update", "privacy_redaction"]),
  actor: z.enum(["ai", "user", "system"]),
  actorUserId: z.string().optional(),
  reason: z.string(),
  diff: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export const MemoryObjectSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  domain: MemoryDomainSchema.default("financial"),
  title: z.string(),
  currentState: z.enum(["active", "merged", "needs_review", "needs_user_input", "archived"]).default("active"),
  confidence: z.number().min(0).max(1),
  status: MemoryStatusSchema,
  sourceRefs: z.array(SourceRefSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const InsightSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  severity: z.enum(["info", "review", "attention"]),
  title: z.string(),
  explanation: z.string(),
  sourceRefs: z.array(SourceRefSchema),
  dismissed: z.boolean().default(false),
  createdAt: z.string()
});

export const ConversationMessageSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdBy: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceRefs: z.array(SourceRefSchema).default([]),
  createdAt: z.string()
});

export const ApiEnvelopeSchema = z.object({
  memory_object_id: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  source_refs: z.array(SourceRefSchema),
  current_state: z.string().nullable(),
  needs_user_input: z.boolean(),
  next_best_question: z.string().optional(),
  data: z.unknown().optional()
});

export type MemoryDomain = z.infer<typeof MemoryDomainSchema>;
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Capture = z.infer<typeof CaptureSchema>;
export type MemoryObject = z.infer<typeof MemoryObjectSchema>;
export type MemoryInterpretation = z.infer<typeof MemoryInterpretationSchema>;
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export type HouseholdContext = z.infer<typeof HouseholdContextSchema>;
export type MemoryRelationship = z.infer<typeof MemoryRelationshipSchema>;
export type MemoryRevision = z.infer<typeof MemoryRevisionSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ApiEnvelope = z.infer<typeof ApiEnvelopeSchema>;
