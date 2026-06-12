# elite-migration — Create and document a new PostgreSQL DB migration

Create a numbered SQL migration file and update all relevant documentation.

## Argument
Short description of the migration, e.g. `add-parent-collection` or `add-product-barcode`.

## Steps

1. **Find the next migration number** by listing `server/db/migrations/`:
   ```
   ls server/db/migrations/
   ```
   The filename format is `NNN_{slug}.sql` (zero-padded to 3 digits).

2. **Create** `server/db/migrations/{NNN}_{slug}.sql` with:
   - A header comment block: purpose, date (today), affected tables
   - `-- UP` section: the forward migration SQL
   - `-- DOWN` section: the rollback SQL (DROP COLUMN / DROP TABLE / etc.)
   - Use `IF NOT EXISTS` / `IF EXISTS` guards where appropriate
   - Always scope by `tenant_id` on new tables; add FK constraints
   - Use `uuid_generate_v4()` for new UUID PKs (the extension is already loaded)

3. **Update `server/db/migrations/README.md`** if it exists, or note the migration in `docs/08-database-api-implementation.md` under the relevant section.

4. **Update `docs/08-database-api-implementation.md`**:
   - Add the new table/column to the schema section
   - Add endpoint-to-SQL mappings if new routes will use this migration

5. **Update `docs/04-admin-portal.md`** if the migration backs a new UI section — add/update the Backend Persistence Map table row.

6. **Print instructions** for the developer to apply the migration:
   ```
   psql $DATABASE_URL -f server/db/migrations/{NNN}_{slug}.sql
   ```
   and the rollback command.

## Rules
- Never use `SERIAL` — use `uuid_generate_v4()` for PKs and `BIGSERIAL` for numeric sequences.
- Always add `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` on new top-level tables.
- Index foreign keys that will be queried in WHERE clauses.
- Keep UP and DOWN in sync — every UP change must have a DOWN counterpart.

## Usage
```
/elite-migration add-parent-collection
/elite-migration add-product-barcode
/elite-migration add-pos-transactions
```
