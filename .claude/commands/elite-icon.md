# elite-icon — Add a new SVG icon to the Elite admin icon library

Add a new icon to `client/projects/admin-portal/src/app/shared/icons/icon.component.ts`.

## Steps

1. **Read** `client/projects/admin-portal/src/app/shared/icons/icon.component.ts` to see current icons.

2. **Determine the icon name** from the user's request (e.g. `collections`, `tag`, `hierarchy`). The name must be camelCase, no spaces.

3. **Find or design the SVG path** — prefer Lucide-style (24×24 viewBox, stroke="currentColor", stroke-width="1.6–1.7", stroke-linecap="round", stroke-linejoin="round"). Always use `[attr.width]="size" [attr.height]="size"` so the size input is respected.

4. **Add the icon name** to the `IconName` type union (alphabetically).

5. **Add the `@case` block** inside the `@switch (name)` template, following the existing pattern exactly.

6. **Grep for all usages** of the icon name being replaced (if replacing an existing assignment) and confirm nothing broke:
   ```
   grep -r "name=\"ICON_NAME\"" client/projects/admin-portal/src/
   ```

7. **Update `docs/04-admin-portal.md`** — find the `IconsComponent` row in the Shared Components table and append the new icon name + description to the list.

## Rules
- Never change existing icon SVG paths — only add new cases.
- Use `fill="none"` for stroke icons (all current icons are stroke-based).
- The `size` input defaults to 18; always wire `[attr.width]="size" [attr.height]="size"`.
- Keep the `IconName` type sorted alphabetically.

## Usage
```
/elite-icon collections
/elite-icon reference
/elite-icon hierarchy
```
