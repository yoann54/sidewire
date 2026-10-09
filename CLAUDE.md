# Sidewire — état d'avancement

Notes de session pour reprendre proprement sur une autre machine. Ce fichier est lu automatiquement par Claude Code à l'ouverture du repo.

## Contexte

Sidewire est une extension Chrome qui logge les requêtes réseau dans un side panel (sans ouvrir DevTools). Le code lui-même est fonctionnel — les sessions récentes ont porté sur **le rebranding** (`Watch Network` → `Sidewire`) et **la préparation de la soumission Chrome Web Store**.

Le repo distant est `git@github.com:yoann54/sidewire.git` (`origin`, `main` déjà poussé).

## Ce qui est fait

### Rebranding
- `manifest.json` : `name`, `default_title`, bloc `icons` complet et `action.default_icon`
- `sidepanel.html` : `<title>`
- `README.md` : titre H1

### Iconographie (concept retenu : barres + ligne, type waterfall DevTools)
- `icons/icon.svg` — source ré-éditable (viewBox 128×128, 2 barres bleues `#1a73e8` + 1 barre rouge `#ea4335` + ligne d'axe)
- `icons/icon-{16,32,48,128}.png` — rendus via Chrome headless
- Template de rendu versionné : `store/render-icon.html`

### Assets store
- `store/promo-440x280.png` — petite tuile promo (recommandée)
- `store/render-promo.html` — template versionné pour régénérer la promo
- `store/listing.md` — **tous les textes** prêts à coller dans le dashboard Web Store : description courte/longue, "Single purpose", justification de chaque permission (`webRequest`, `sidePanel`, `storage`, `debugger`, `<all_urls>`), tableau des disclosures Data usage, certifications à cocher
- `store/README.md` — guide de régénération des assets
- `PRIVACY.md` (racine) — politique de confidentialité

### Audit → v0.7.0 (2026-10-05)
- Sécurité : méthode HTTP échappée et validée à l'import HAR ; cURL/PowerShell entièrement quotés (les noms de header peuvent contenir `'` `` ` `` `$`) ; secrets masqués à l'export HAR (par défaut) ; confirmation avant replay d'une entrée importée
- Permissions : `tabs` retirée (inutile) ; `debugger` passée en `optional_permissions` — **erreur, annulée** : Chrome n'accepte pas `debugger` en optionnel (il l'ignore, `permissions.request` échoue en silence → bodies et mocks inopérants depuis 0.7.0). Remise dans `permissions` ; `minimum_chrome_version: 116`
- Robustesse : le panneau se reconnecte seul après un redémarrage du SW ; `paused`/`scope` persistés ; restauration du buffer sans race ; attach/detach debugger sérialisés ; bodies formData ré-encodés en urlencoded pour replay/exports
- Perf : bodies > 1 Mo et images/media/fonts non capturés ; lignes et panneau de diff mis en cache (`rowCache`, `renderList(id)` ne reconstruit que la ligne concernée) ; le panneau retire les entrées évincées par le SW
- Accessibilité : puces méthodes/types en `<button aria-pressed>` ; lignes, étoiles et en-têtes de groupe focusables (Entrée/Espace), ↑/↓ entre les lignes, focus restauré après chaque rendu, contour `:focus-visible`. Non traité : nœuds de l'arbre JSON (clic souris uniquement)

### v0.8.0 (2026-10-06)
- **Mocks** (CDP `Fetch`) : panneau « Mocks » dans le header + bouton « Mock » sur une entrée (pré-remplit URL + réponse). Actions : répondre (status/headers/body), retarder, faire échouer. Règles en `storage.local`, interrupteur maître `mocksOn` en `storage.session`. Les entrées mockées portent `e.mock` → badge MOCK/DELAYED/BLOCKED
- **Messages WebSocket / SSE** (CDP `Network`, avec la capture des bodies) : `e.frames` (500 max, 64 Ko/payload, jamais persistés), message `frame` du SW vers le panneau
- **Badge d'erreurs** sur l'icône (4xx/5xx/erreurs réseau par onglet, remis à zéro au `main_frame`, `favicon.ico` ignoré)
- **Séparateurs de navigation** dans la liste (hors « Group by domain »)
- Arbre JSON navigable au clavier ; correctif CSS : la règle `header` globale cassait les en-têtes de section du détail
- `syncDebugger()` dans `background.js` décide seul d'attacher/détacher (bodies **ou** mocks) et active `Network`/`Fetch` selon le besoin
- `store/listing.md` + `PRIVACY.md` mis à jour (nouvel usage de `debugger`) → **à recopier dans le dashboard** avant de soumettre

### v0.8.1 (2026-10-08)
- **Chaînes de redirection** : `onBeforeRedirect` termine chaque hop (status 3xx, headers, `redirectUrl`) ; le hop suivant reçoit l'id `<requestId>~N` et les entrées sont reliées par `redirectedFrom`/`redirectTo`. Corrige un bug : Chrome relance `onBeforeRequest` avec le même `requestId` → deux entrées de même id, la 1re bloquée en « pending », fusionnées par le panneau
- Panneau : badge `→ cible` sur les lignes 3xx, section « Redirect chain » dans le détail (clic = aller au hop), une seule ligne de séparation par navigation redirigée, `redirectURL` absolu à l'export HAR
- 307/308 : méthode + body conservés ; les bodies CDP s'attachent désormais au bon hop (corrélation par URL)
- Aucune permission ni donnée nouvelle → `store/listing.md` inchangé

## Publication

- **Publiée** sur le Chrome Web Store (ID `mkhgmicflbbhfohnkpkmcnkdjhipdfmk`), v0.6.0 en ligne au 2026-10-05
- Politique de confidentialité : `https://yoann54.github.io/sidewire/PRIVACY` (GitHub Pages, branche `main`)

### Publier une mise à jour
1. Bumper la version partout (`manifest.json`, `sidepanel.html`, `buildHAR()` dans `sidepanel.js`, `PRIVACY.md`) — le store refuse une version déjà publiée
2. Commit + push (met à jour la page PRIVACY)
3. `./package.sh` → `sidewire.zip`
4. Dashboard → **Importer un nouveau package** → `sidewire.zip`
5. Mettre à jour Fiche Play Store / Confidentialité depuis `store/listing.md` si les textes ou permissions ont changé
6. Soumettre pour review

## Détails utiles

- **Identifiants couleurs de la marque** : bleu primaire `#1a73e8`, accent rouge `#ea4335` (Google Material). Si tu veux varier, modifier `icons/icon.svg` et régénérer (commandes dans `store/README.md`).
- **Pourquoi ces permissions** : justifications individuelles dans `store/listing.md`. À synchroniser avec `PRIVACY.md` si tu en ajoutes/retires.
- **Limites connues** documentées dans `README.md` (corrélation webRequest/CDP par URL, headers fetch interdits en replay, buffer 2000 entrées, quota `storage.session` ~10MB).
