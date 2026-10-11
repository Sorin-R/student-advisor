# Website editing

Sign in as an administrator or a moderator with **Manage content** permission. Use **Edit this page**, or open **Admin → Open website Edit Mode**. Choose a page from the toolbar; it includes public pages, university profiles and account screens. Blog articles and newly linked routes appear as you browse. Editing follows navigation and refreshes until **Exit**.

Click outlined text or an image's edit control, then **Save and publish**. Changes are public immediately. **Restore original** removes that field's override. English and Romanian text are stored separately; images are shared between languages. **Preview** hides editing outlines; **Resume editing** brings them back. Account screens use sample content while editing, with account actions blocked. Student information, authentication values and input values are never website content.

## Adding future pages

Keep new React pages under `src/` and render them through the existing router. The shared root provider and Babel plugin automatically make JSX text, string expressions, static translation calls and static `<img src="…">` images editable. No per-page provider is needed. Unknown routes get a stable content scope automatically. Linked routes are discovered by the toolbar.

Use `EditableText`, `EditableInlineImage` or `EditableImage` from `SiteEditor` for public copy/images read from arrays, props, APIs or CSS backgrounds. Give each field a stable unique name (letters, numbers, dots, hyphens and underscores, at most 120 characters). Never bind private user data or secrets to editable content. Use `embedded` on `EditableText` inside links, buttons or labels. Use `data-editor-ignore` to exclude an entire subtree from automatic instrumentation. Inputs, metadata, scripts, code, SVG and dynamic data expressions are excluded automatically.

Automatic field IDs depend on the source filename, component name and source text/translation key. Preserve those identifiers to preserve overrides. For content that will move between files or change its default copy frequently, use an explicit stable field instead. Identical literals inside the same component share an override; use explicit fields if they must be edited independently.

The editor stores fields by page and language in `site_content`. Existing homepage and editorial field names remain compatible. Individual saves merge under a database row lock so editors changing different fields cannot overwrite each other. Limits are 5,000 characters per field, 1,000 fields and 128 KB per page map. Image uploads keep the existing validation and persistent `UPLOADS_DIR/site-content` storage. Include that folder and the database in backups.

Run `npm test` and `npm run build` before deploying. Keep `scripts/automatic-content-plugin.mjs` with `vite.config.js` in release source archives.
