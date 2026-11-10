-- Lets the cashier who opened a shift close it and print the Z report without
-- a second manager's PIN.
--
-- Why this is not the same relaxation as pos_emergency_self_approval_enabled
-- (migration 019): that flag lifts approver separation for void and refund,
-- which are the actions that move money out of the drawer. Closing a shift
-- moves nothing. It records the physical cash count against totals the server
-- already computed, and the count is only meaningful when made by the person
-- who actually held the drawer. Elite's shops run one branch manager over one
-- owner, so requiring a *different* manager to close made the shift
-- uncloseable whenever that manager was off-site.
--
-- Default ON: the owner-only toggle in Settings tightens it back to
-- "another manager must approve" for any shop that wants dual control.
-- Void, refund, paid-out, safe-drop and no-sale drawer-open are untouched and
-- still require a different approver.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pos_self_close_shift_enabled boolean NOT NULL DEFAULT true;
