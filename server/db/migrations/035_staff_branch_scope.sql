-- Which branch a staff member works at, and therefore which tills the
-- "Which till is this?" picker offers them.
--
-- listSelectableRegisters() filtered on tenant + active only, so every POS user
-- saw every register in every branch. On a single-location shop that reads as
-- harmless; the moment a tenant runs two branches it means a cashier standing
-- in one shop can bind their browser to a till standing in another, rotating
-- that register's credential and signing the real terminal out from across
-- town.
--
-- Shopify POS solves this by assigning retail locations to staff: a staff
-- member assigned to New York can only reach the New York location from the
-- POS app. This is the same idea with one branch per person, which is the
-- shape this business actually has.
--
-- NULL means "not scoped" and preserves the previous behaviour exactly: every
-- active register in the tenant. That is the right default for owners and
-- admins, who move between counters, and it means this migration changes
-- nothing for a tenant that never assigns anyone.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS pos_branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_users_pos_branch_idx
  ON admin_users (tenant_id, pos_branch_id)
  WHERE pos_branch_id IS NOT NULL;
