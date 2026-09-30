# Atlas UI consistency audit — 30 September 2026

## Shared rules

`frontend/assets/design-system.css` is loaded last by Map, IT Console, Manage Database, Desktop and utility entry points. Existing compact overrides were moved out of atlas-shell.css into this shared layer.

- Body text: 13 px; controls/data: 12 px; supporting labels: 11 px.
- Page titles: 18 px; subsection headings: 14 px.
- Desktop controls: 28 px minimum; touch controls: 42 px minimum.
- Compact process actions: 22 px on pointer devices; 42 px on touch.
- Spacing scale: 4 / 6 / 8 / 12 px.
- Control corners: 7 px; panels: 9 px; dialogs: 12 px.
- Shared blue accent, text/muted colours, focus outline and disabled appearance.
- Alerts and destructive actions retain semantic colours. Data never depends on colour alone.
- Foreground network requests use the existing delayed loading indicator; polling stays silent. Motion settings and reduced-motion remain respected.

## Findings and repairs

| Surface | Drift found | Repair |
| --- | --- | --- |
| Workspace and machine cards | Shared density scattered across late shell overrides; search fixed at 52 px | Centralized density; search follows control height; compact machine facts retained |
| Remote Admin / CPU / GPU / memory | Legacy large charts and table spacing | Previous dense metrics and process rows retained in final design layer |
| Bulk Deploy and History | Page-local heading/control/table styles | Shared type, spacing, controls and table styles |
| PsTools | 38 px inputs overriding shared geometry | Explicit workbench control rules and consistent card gaps |
| Active Directory | Unstructured form wrapping | Responsive labelled form, compact groups and details table |
| Knowledge Base | Grid-stretched search field and separate toolbar geometry | Fixed token-based search height and shared toolbar/panel dimensions |
| Map / person / machine details | Different panel, health and menu spacing | Shared health, person, context-menu and dialog rules |
| Health and specifications | Forced 14 px padding; 24 px dialogs | Removed padding override; compact health cards and dialog contract |
| Catalogue | 24 px column gaps and large headings | 8 px gap, shared headings and controls |
| Command palette | Shadow-root styles isolated from normal CSS | Companion rules inherit common tokens; compact trigger and results |
| Manage Database | Inline 28 px page padding, large titles and review cards | Shared stylesheet loaded after inline rules; compact review layout |
| Desktop settings | 22 px padding and 15 px field gaps | Shared compact settings geometry |
| Calendar, Notes, Reminders, Calculator, Clock, Files, Music | Independent typography and large headers/cards | Shared utilities class, tokens and compact layout; dark-mode colours preserved |

## Verification

- Browser navigation through all seven console pages at actual 808 px and narrow 487 px widths: no horizontal document overflow.
- Browser computed controls: 28 px and 12 px text on operational pages; fixed legacy Workspace and KB searches found during inspection.
- Browser checked Map, Manage Database and all seven utility pages: shared stylesheet present, no horizontal overflow at checked widths.
- Visual screenshot review of PsTools confirmed compact navigation, controls and card layout.
- Functional suites: performance, process menus, deployment flow, Knowledge Base, desktop/window management, utilities, loading, AD groups and shared context actions.
- Native remote administration was not executed. Responsive checks do not certify every viewport or every possible data length.

## Intentional exceptions

Map labels and drawing surfaces retain their own geometry to avoid clipping or changing picking. Draw.io owns its embedded editor internals. Desktop dock/window chrome retains its desktop appearance. Calculator keys and calendar cells remain larger than ordinary controls. Long records wrap and long lists scroll rather than being truncated or hidden.
