import { createId, nowIso } from "@/server/memory/id";
import { getMemoryRepository, withMemoryRepositoryRetry, type HouseholdCategory } from "@/server/memory/store";

export const DEFAULT_CATEGORY_NAMES = [
  "Dining",
  "Groceries",
  "Housing",
  "Transport",
  "Utilities",
  "Baby",
  "Health and Insurance",
  "Subscriptions",
  "Family Living"
];

const DEFAULT_COLORS = ["#f97362", "#f9cc55", "#4fd1c5", "#8fb3ff", "#c8facc", "#f0abfc", "#fb7185", "#a78bfa", "#d1d5db"];

const DEFAULT_HOUSEHOLD_ID = "household_demo";

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function isDuplicateCategory(existing: HouseholdCategory[], householdId: string, name: string): boolean {
  const normalized = normalizeName(name).toLowerCase();
  return existing.some(
    (category) => category.householdId === householdId && !category.archivedAt && category.name.toLowerCase() === normalized
  );
}

export function listActiveCategories(householdId = DEFAULT_HOUSEHOLD_ID): HouseholdCategory[] {
  const repository = getMemoryRepository(householdId);
  const customCategories = repository.read().categories.filter((category) => category.householdId === householdId && !category.archivedAt);
  return mergeDefaultCategories(householdId, customCategories);
}

export async function listActiveCategoriesAsync(householdId = DEFAULT_HOUSEHOLD_ID): Promise<HouseholdCategory[]> {
  const repository = getMemoryRepository(householdId);
  const store = await repository.readAsync();
  const customCategories = store.categories.filter((category) => category.householdId === householdId && !category.archivedAt);
  return mergeDefaultCategories(householdId, customCategories);
}

function mergeDefaultCategories(householdId: string, customCategories: HouseholdCategory[]): HouseholdCategory[] {
  const seededDefaults = DEFAULT_CATEGORY_NAMES.map((name, index) => ({
    id: `default_${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_")}`,
    householdId,
    name,
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    createdBy: "system" as const,
    createdAt: "system"
  }));

  const customNames = new Set(customCategories.map((category) => category.name.toLowerCase()));
  return [...seededDefaults.filter((category) => !customNames.has(category.name.toLowerCase())), ...customCategories];
}

export function addHouseholdCategory(input: { householdId?: string; name: string; color?: string; actorUserId?: string }): HouseholdCategory {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const name = normalizeName(input.name);
  if (!name) throw new Error("category_name_required");

  const repository = getMemoryRepository(householdId);
  const store = repository.read();
  const existing = listActiveCategories(householdId);
  if (isDuplicateCategory(existing, householdId, name)) {
    const duplicate = existing.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return duplicate;
  }

  const category: HouseholdCategory = {
    id: createId("cat"),
    householdId,
    name,
    color: input.color,
    createdBy: "user",
    createdByUserId: input.actorUserId,
    createdAt: nowIso()
  };
  store.categories.unshift(category);
  repository.commit();
  return category;
}

async function addHouseholdCategoryOnce(input: { householdId?: string; name: string; color?: string; actorUserId?: string }): Promise<HouseholdCategory> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const name = normalizeName(input.name);
  if (!name) throw new Error("category_name_required");

  const repository = getMemoryRepository(householdId);
  const store = await repository.readAsync();
  const customCategories = store.categories.filter((category) => category.householdId === householdId && !category.archivedAt);
  const existing = mergeDefaultCategories(householdId, customCategories);
  if (isDuplicateCategory(existing, householdId, name)) {
    const duplicate = existing.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return duplicate;
  }

  const category: HouseholdCategory = {
    id: createId("cat"),
    householdId,
    name,
    color: input.color,
    createdBy: "user",
    createdByUserId: input.actorUserId,
    createdAt: nowIso()
  };
  store.categories.unshift(category);
  await repository.commitAsync();
  return category;
}

export async function addHouseholdCategoryAsync(input: { householdId?: string; name: string; color?: string; actorUserId?: string }): Promise<HouseholdCategory> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  return withMemoryRepositoryRetry(householdId, () => addHouseholdCategoryOnce(input));
}
