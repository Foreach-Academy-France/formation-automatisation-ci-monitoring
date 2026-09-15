# Démo J1 — action composite + workflow réutilisable

Copier le dossier `.github/` dans un repo qui contient deux projets Node (`.` et `api/`, avec `npm test`).

Déroulé (bloc 1.3) :
1. Montrer `ci.yml` **avant** (3 jobs × 2 projets = 6 blocs copiés-collés) puis **après** (2 appels `uses:`).
2. Ouvrir `reusable-ci.yml` : `on: workflow_call`, `inputs`, `outputs` remontés vers l'appelant.
3. Ouvrir `action.yml` : `runs: using: composite`, `shell: bash` obligatoire.
4. Pousser un commit → 2 runs parallèles, `summary` affiche les versions.
5. Pousser 2 commits d'affilée → `concurrency` annule le premier run.
