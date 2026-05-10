# Sidewire — état d'avancement

Notes de session pour reprendre proprement sur une autre machine. Ce fichier est lu automatiquement par Claude Code à l'ouverture du repo.

## Contexte

Sidewire est une extension Chrome qui logge les requêtes réseau dans un side panel (sans ouvrir DevTools). Le code lui-même est fonctionnel — les sessions récentes ont porté sur **le rebranding** (`Watch Network` → `Sidewire`) et **la préparation de la soumission Chrome Web Store**.

Le repo distant est `git@github.com:yoann54/sidewire.git` (déjà ajouté en `origin`, mais aucun commit n'a encore été poussé au moment où ces notes ont été écrites).

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
- `store/listing.md` — **tous les textes** prêts à coller dans le dashboard Web Store : description courte/longue, "Single purpose", justification de chaque permission (`webRequest`, `sidePanel`, `tabs`, `storage`, `debugger`, `<all_urls>`), tableau des disclosures Data usage, certifications à cocher
- `store/README.md` — guide de régénération des assets
- `PRIVACY.md` (racine) — politique de confidentialité

## Ce qui reste à faire

### 1. Premier push GitHub
```bash
git status                              # vérifier ce qui va partir
git add .
git commit -m "Initial commit"
git push -u origin main
```
(`origin` pointe déjà vers `git@github.com:yoann54/sidewire.git`. Si le repo distant a été créé avec un README/license, faire `git pull --rebase origin main` avant le push.)

### 2. Publier `PRIVACY.md` via GitHub Pages
- Repo Settings → **Pages** → Source : *Deploy from a branch* → Branche `main` / dossier `/ (root)` → Save
- L'URL à coller dans le champ "Privacy policy URL" du dashboard Web Store sera :
  ```
  https://yoann54.github.io/sidewire/PRIVACY
  ```
  (Jekyll convertit `PRIVACY.md` en HTML automatiquement.)

### 3. Screenshots du store (manuel — pas de raccourci possible)
- 1 à 5 screenshots **1280×800** (ou 640×400) PNG/JPG
- Reco de contenu : (a) la liste des requêtes capturées, (b) une entrée dépliée avec headers/body, (c) le filtre URL en action, (d) l'export HAR ou la replay
- Au moins 1 est obligatoire pour soumettre

### 4. Optionnel
- Tuile marquee 1400×560 (uniquement utile pour être éligible au "featured")
- Charger l'extension non packagée dans Chrome (`chrome://extensions` → Load unpacked) pour vérifier que les icônes s'affichent bien dans la toolbar avant de soumettre

### 5. Soumission Web Store
- Dashboard → Add new item → upload du ZIP du repo (sans le dossier `store/` ni `PRIVACY.md` ni `CLAUDE.md` — ces fichiers ne sont pas utiles dans le bundle uploadé). Un `.gitignore` ou un script de packaging serait à faire si on veut automatiser le ZIP propre.
- Coller tous les champs depuis `store/listing.md`
- Coller l'URL Pages dans "Privacy policy URL"
- Uploader les screenshots + `store/promo-440x280.png` (champ "Small tile")
- Soumettre pour review (délai habituel : quelques jours à 2 semaines)

## Détails utiles

- **Identifiants couleurs de la marque** : bleu primaire `#1a73e8`, accent rouge `#ea4335` (Google Material). Si tu veux varier, modifier `icons/icon.svg` et régénérer (commandes dans `store/README.md`).
- **Pourquoi ces permissions** : justifications individuelles dans `store/listing.md`. À synchroniser avec `PRIVACY.md` si tu en ajoutes/retires.
- **Limites connues** documentées dans `README.md` (corrélation webRequest/CDP par URL, headers fetch interdits en replay, buffer 2000 entrées, quota `storage.session` ~10MB).
