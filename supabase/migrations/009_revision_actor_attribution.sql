-- Sayve V1 revision actor attribution.
-- A household memory can be corrected by multiple members. Keep the acting
-- Supabase user id queryable instead of burying it only inside JSON diff.

alter table memory_revisions
  add column if not exists actor_user_id uuid references auth.users(id);

create index if not exists memory_revisions_actor_user_idx
  on memory_revisions(household_id, actor_user_id, created_at desc);
