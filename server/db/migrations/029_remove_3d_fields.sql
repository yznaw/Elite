-- Removes the 3D/GLB model-viewer feature's schema footprint. The feature
-- itself (media-library .glb upload, product "has 3D" badge/filter,
-- dashboard "Top 3D Views") was already dead in the frontend before this
-- migration — nothing wrote a real value to has_3d beyond `false`, and
-- views_3d was never incremented from any live code path. This just catches
-- the database up.
--
-- The `model_3d` labels inside the media_kind enum and the media_links.role
-- check constraint are left in place: Postgres can't cheaply drop an enum
-- label (it requires rebuilding the type and every column that uses it),
-- and an unused label is harmless — it just means no future .glb upload
-- will ever be tagged with it, since the upload code path that produced it
-- is also being removed.
ALTER TABLE products DROP COLUMN IF EXISTS has_3d;
ALTER TABLE products DROP COLUMN IF EXISTS views_3d;
