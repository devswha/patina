# Editor clients (retired)

Patina's first-party editor clients were retired on 2026-09-08: the VS Code
extension, the Obsidian plugin and the Gmail browser-extension preview. This
page stays at its old address as a historical record so existing links keep
resolving.

The local client repositories were deleted. The remote repositories were left
unchanged and remain public:

- [patina-vscode](https://github.com/devswha/patina-vscode): VS Code
  extension, last released as `patina-vscode-1.1.0.vsix`.
- [patina-obsidian](https://github.com/devswha/patina-obsidian): Obsidian
  plugin, last released as 1.0.0.
- [patina-extension](https://github.com/devswha/patina-extension): Gmail
  browser-extension preview.

The releases published before retirement remain in those repositories, but
the clients get no further development, fixes or support. No Marketplace
listing, Obsidian Community directory submission or Chrome Web Store listing
was ever claimed, so retirement requires no takedown. Real signed-in Gmail
validation never happened; Notion and LinkedIn stayed outside the preview.

On the patina tracker, #207 (Obsidian directory submission) and #284
(signed-in Gmail acceptance) were closed as `not_planned` on 2026-09-08.
These closures record retirement, not completion of directory submission or
signed-in Gmail acceptance. #206 (VS Code) was closed when the 1.1.0 VSIX
shipped.

## What remains supported

- The [Aside CLI integration](aside.md) preview: load the bundled skill
  through Aside's custom-skill creator and open `patina aside options`.
  Native Aside desktop validation remains separate.
- The offline [editor inspection](editor-inspection.md) contract: `patina
  inspect` returns a deterministic local score and source-aligned diagnostics
  without invoking a model or reading provider credentials. Any editor can
  build on it.

Scores are writing hints, not authorship probabilities.
