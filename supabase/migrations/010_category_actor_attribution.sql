-- Preserve who created a custom category without changing the existing
-- created_by user/system source-type constraint.

alter table household_categories
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists household_categories_created_by_user_idx
  on household_categories(created_by_user_id)
  where created_by_user_id is not null;
