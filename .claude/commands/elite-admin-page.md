# elite-admin-page — Scaffold a new Elite admin portal page

Scaffold a complete new page in `client/projects/admin-portal/src/app/pages/`.

## Argument
The argument is the page name in kebab-case, e.g. `suppliers` or `loyalty-tiers`.

## Steps

1. **Read** `client/projects/admin-portal/src/app/app.routes.ts` (current routes).
2. **Read** `client/projects/admin-portal/src/app/shared/sidebar/sidebar.component.ts` (nav links array).
3. **Read** `client/projects/admin-portal/src/app/i18n/en.ts` (i18n keys, to find the right prefix to add under).

4. **Create** `client/projects/admin-portal/src/app/pages/{name}/{name}.component.ts`:
   - Selector: `ap-{name}`
   - Standalone, imports CommonModule + FormsModule + IconComponent
   - Injects I18nService, ToastService
   - Includes a `page-fade` wrapper div with a card-title heading using `t('page.{name}.title')`
   - Shows an `<ap-empty-state>` placeholder until real data is wired

5. **Add route** in `app.routes.ts` using `loadComponent` lazy pattern — follow the existing pattern exactly.

6. **Add nav link** in `sidebar.component.ts` `links` array — choose the most semantically appropriate existing `IconName`. If a better icon is needed, note it but don't block scaffolding.

7. **Add i18n keys** to `client/projects/admin-portal/src/app/i18n/en.ts`:
   - `nav.{name}`: page label (e.g. `'Suppliers'`)
   - `nav.{name}.sub`: subtitle (e.g. `'VENDOR LIST'`)
   - `page.{name}.title`: full page title
   - `page.{name}.crumb`: breadcrumb (usually same as nav label)

8. **Update `docs/04-admin-portal.md`** — add a row to the Pages & Routes table.

## Rules
- Always use `authGuard` (canMatch). Add `roleGuard(['owner','admin'])` if the page is admin-only.
- Never use `constructor` injection — use `inject()`.
- Follow the luxury tone for any placeholder text (no generic "Welcome" copy).
- Bilingual: add matching keys to `client/projects/admin-portal/src/app/i18n/ar.ts` as well.

## Usage
```
/elite-admin-page suppliers
/elite-admin-page loyalty-tiers
/elite-admin-page pos-sessions
```
