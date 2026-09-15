---
marp: true
theme: uncover
paginate: true
footer: M2 ESTD - Automatisation CI & Monitoring | ForEach Academy
style: |
  section {
    font-size: 20px;
    padding: 40px 50px;
  }
  h1 { font-size: 36px; color: #E6522C; margin: 0 0 15px 0; }
  h2 { font-size: 28px; color: #9f3316; margin: 0 0 12px 0; }
  h3 { font-size: 24px; color: #f97316; margin: 0 0 10px 0; }
  code { font-size: 18px; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
  table { font-size: 16px; }
  blockquote { border-left: 4px solid #f97316; padding-left: 15px; font-style: italic; color: #4b5563; margin: 10px 0; font-size: 18px; }
  ul { margin: 10px 0; padding-left: 25px; }
  li { margin-bottom: 5px; line-height: 1.3; }
  pre { font-size: 15px; padding: 20px; margin: 15px 0; background: #1e1e1e !important; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
  pre code { background: transparent !important; color: #d4d4d4; font-size: 15px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
---

<!-- _class: lead -->
# Jour 1 — Automatiser et opérer le système CI

**Automatisation du système CI & Monitoring**
M2 — ForEach Academy

Formateur : Fabrice Claeys

---

## Programme de la journée

| Horaire | Contenu |
|---------|---------|
| 9h00-9h30 | **Du workflow au système CI** — rappels, SaaS vs self-hosted, Jenkins en 10 min |
| 9h30-10h30 | **Runner self-hosted** — installer, enregistrer, labelliser, sécuriser |
| 10h45-11h45 | **Factoriser le CI** — actions composites, workflows réutilisables, gouvernance |
| 11h45-12h15 | **Build & tests automatisés** — reproductibilité, JUnit, coverage, artefacts |
| 13h15-17h00 | **TP1** — Opérer et factoriser le CI de TaskFlow |

> Fil rouge : TaskFlow « opérée » — la chaîne *commit → build → test → déploiement → monitoring → alerte*

---

## Où en sommes-nous ?

Ce que vous savez déjà faire (cours *Initialisation CI* et *Ansible & Kubernetes*) :

- Écrire un workflow GitHub Actions : jobs, steps, matrix, secrets, artefacts
- Publier une release, une image Docker sur ghcr.io, un site sur GitHub Pages
- Écrire un playbook et un rôle Ansible, chiffrer avec Vault
- Déployer sur Kubernetes (k3d)

**Ce cours** : passer de « j'écris un workflow » à « **j'automatise et j'opère le système CI** », puis assembler la chaîne complète jusqu'à l'alerte.

---

<!-- _class: lead -->
# 1. Du workflow au système CI

---

## Rappels flash : le vocabulaire

```
┌─────────────────────────────────────────────────────────────┐
│  WORKFLOW  (.github/workflows/ci.yml)                        │
│  déclenché par un TRIGGER (push, pull_request, schedule…)   │
│                                                             │
│   ┌──────────── JOB lint ────────────┐  ┌── JOB test ──┐    │
│   │ step 1 : actions/checkout        │  │ needs: lint  │    │
│   │ step 2 : actions/setup-node      │  │ matrix: node │    │
│   │ step 3 : run: npm ci             │  │ …            │    │
│   │ step 4 : run: npm run lint       │  │ ARTEFACT ────┼──▶ │
│   └───── s'exécute sur un RUNNER ────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

| Terme | Définition |
|---|---|
| **Runner** | La machine (VM, conteneur) qui exécute un job |
| **Artefact** | Fichier produit par un job et conservé (dist, rapport, binaire) |
| **Secret** | Valeur chiffrée injectée à l'exécution, masquée dans les logs |

---

## Un workflow ≠ un système CI

Écrire `ci.yml` dans un repo, c'est le début. Un **système** CI, c'est :

| Dimension | Question à se poser |
|---|---|
| **Runners** | Qui exécute ? Où ? Avec quels outils, quel accès réseau ? |
| **Factorisation** | 30 repos = 30 copies du même YAML ? |
| **Secrets & permissions** | Qui peut déployer où ? Quel token pour quoi ? |
| **Gouvernance** | Quels checks sont obligatoires avant de merger ? |
| **Observabilité du CI** | Combien de temps ? Combien d'échecs ? Combien ça coûte ? |
| **Cycle de vie** | Mises à jour des actions, des runners, des images |

> Automatiser le système CI = construire une **plateforme** que les équipes consomment, pas un script par projet.

---

## SaaS vs self-hosted

| | **SaaS** (GitHub Actions hosted, GitLab CI SaaS) | **Self-hosted** (Jenkins, GitLab Runner, Woodpecker, runners GHA) |
|---|---|---|
| Installation | Aucune | À faire (VM, conteneur, K8s) |
| Maintenance | Fournisseur | Vous (mises à jour, disques, sécurité) |
| Coût | Minutes facturées (gratuit en public) | Infra + temps humain |
| Réseau privé | Inaccessible sans VPN/tunnel | Accès direct aux VMs, bases, registres internes |
| Outils spécifiques | Images standard | Ce que vous voulez (GPU, licences, gros caches) |
| Contrôle / conformité | Limité | Total (données qui ne sortent pas) |

**Approche hybride** (la plus courante) : orchestrateur SaaS + runners self-hosted là où c'est nécessaire.

> C'est exactement ce que nous ferons : GitHub Actions orchestre, un runner chez vous déploie sur le lab.

---

## Jenkins en 10 minutes (1/3) — pourquoi en parler

- Le syllabus le cite « par exemple » ; il reste **très présent en entreprise** (2011, ex-Hudson)
- Modèle **100 % self-hosted** : vous installez, vous opérez, vous sauvegardez
- Concepts identiques à GitHub Actions — savoir passer de l'un à l'autre est une compétence

```
┌──────────────────────────────┐        ┌──────────────┐
│  CONTROLLER (jenkins:lts)    │  SSH / │  AGENT linux │
│  - UI, jobs, plugins         │◀──────▶│  executors   │
│  - JENKINS_HOME (état)       │  JNLP  └──────────────┘
│  - credentials               │        ┌──────────────┐
└──────────────────────────────┘◀──────▶│ AGENT docker │
                                        └──────────────┘
```

---

## Jenkins en 10 minutes (2/3) — le Jenkinsfile déclaratif

```groovy
pipeline {
  agent { docker { image 'node:20-alpine' } }
  options { timestamps(); timeout(time: 15, unit: 'MINUTES') }
  environment { CI = 'true' }
  stages {
    stage('Install') { steps { sh 'npm ci' } }
    stage('Quality') {
      parallel {
        stage('Lint') { steps { sh 'npm run lint' } }
        stage('Test') {
          steps { sh 'npm run test:ci' }
          post { always { junit 'reports/junit.xml' } }
        }
      }
    }
    stage('Build') { steps { sh 'npm run build'; archiveArtifacts 'dist/**' } }
  }
  post { failure { echo 'Build KO' } }
}
```

---

## Jenkins en 10 minutes (3/3) — correspondance des concepts

| Jenkins | GitHub Actions |
|---|---|
| `Jenkinsfile` (Groovy déclaratif) | `.github/workflows/*.yml` (YAML) |
| Controller + agents | GitHub + runners (hosted / self-hosted) |
| `agent { label 'linux' }` | `runs-on: [self-hosted, linux]` |
| `stage` / `steps` / `sh` | `job` / `steps` / `run` |
| `parallel { }` | Jobs sans `needs` entre eux, ou `matrix` |
| Plugins (JUnit, Docker, SSH Agent…) | Actions du Marketplace (`uses:`) |
| Credentials + `withCredentials` | Secrets + `${{ secrets.X }}` |
| `archiveArtifacts` / `junit` | `actions/upload-artifact` / `dorny/test-reporter` |
| `input` (approbation) | Environment avec *required reviewers* |
| Shared Library | Workflows réutilisables + actions composites |
| `pollSCM` / webhook | `on: push` (webhook natif) |

> Les **concepts** sont les mêmes ; seule la syntaxe change. Cheatsheet fournie.

---

## Les 3 promesses de l'automatisation CI

1. **Build reproductible** — même code, même résultat, quel que soit le poste
2. **Test systématique** — aucun commit ne passe sans la suite de tests
3. **Deploy sans humain** — le déploiement est un job, pas une procédure

```
commit ──▶ build ──▶ test ──▶ artefact ──▶ deploy staging ──▶ deploy prod
                                 │                              │
                              (J1)                            (J2)
                                                    monitoring ──▶ alerte
                                                        (J3)        (J4)
```

---

## À retenir — Du workflow au système CI

- Un workflow est un script ; un **système CI** est une plateforme : runners, factorisation, secrets, gouvernance
- **SaaS** = zéro maintenance mais réseau privé inaccessible ; **self-hosted** = contrôle total mais à opérer
- L'approche **hybride** (orchestrateur SaaS + runners self-hosted) est la norme
- Jenkins et GitHub Actions partagent les mêmes concepts : controller/agents, stages/jobs, plugins/actions, credentials/secrets

---

<!-- _class: lead -->
# 2. Installer et configurer un runner self-hosted

---

## Runners hosted vs self-hosted

| | `runs-on: ubuntu-latest` (hosted) | `runs-on: [self-hosted, …]` |
|---|---|---|
| Machine | VM neuve à chaque job, détruite après | La vôtre, persistante (ou éphémère si configuré) |
| Outils | Image GitHub (Node, Java, Docker, …) | Ce que vous installez |
| Réseau | Internet public uniquement | Votre réseau privé (VMs, bases, registres) |
| Cache | `actions/cache` (réseau) | Disque local, `node_modules` peuvent survivre |
| Coût | Minutes (2 000/mois gratuites en privé) | Gratuit côté GitHub, infra à votre charge |
| Sécurité | Isolation forte | **Vous** isolez |

**Quand un self-hosted ?** Accès réseau privé, GPU / matériel spécifique, gros caches, coût des minutes, conformité.

> Dans notre lab : les VMs Multipass ne sont joignables que depuis votre poste → **un runner chez vous** est obligatoire pour déployer.

---

## Anatomie d'un runner

```
   GitHub (github.com)                       Votre machine
┌──────────────────────┐   long-polling   ┌──────────────────────────┐
│  file d'attente jobs │◀────────────────▶│  actions/runner (agent)  │
│  runs-on: [self-     │   HTTPS sortant  │  ├─ Runner.Listener      │
│   hosted, lab]       │   (aucun port    │  ├─ Runner.Worker (job)  │
│                      │    entrant)      │  └─ _work/ (workspace)   │
└──────────────────────┘                  └──────────────────────────┘
```

- L'agent **sort** vers GitHub en HTTPS : aucun port à ouvrir, fonctionne derrière un NAT
- Enregistrement avec un **token** (valable 1 h) : `Settings → Actions → Runners → New self-hosted runner`
- Un runner appartient à un **repo**, une **organisation** ou une **entreprise**
- **Labels** : `self-hosted`, `linux`, `x64` (automatiques) + les vôtres (`lab`, `gpu`, `ansible`)
- **Groupes** (org) : restreindre quels repos peuvent utiliser quels runners
- **Éphémère** (`--ephemeral`) : un job puis désenregistrement — recommandé pour l'autoscaling

---

## Installation native (référence)

Ce que fait le bouton *New self-hosted runner* :

```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
tar xzf actions-runner-linux-x64.tar.gz

# Enregistrement (token depuis l'UI GitHub, valable 1 h)
./config.sh --url https://github.com/<vous>/taskflow-ops \
            --token AXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
            --name lab-runner --labels lab,ansible --unattended

# Lancer une fois… ou installer en service systemd
./run.sh
sudo ./svc.sh install && sudo ./svc.sh start
```

> Le runner se **met à jour tout seul**. Ne jamais lancer en root ; créer un user dédié.

---

## Installation en conteneur (notre lab)

```yaml
# ressources/lab/runner/docker-compose.yml
services:
  runner:
    build: .                        # myoung34/github-runner + Ansible
    image: taskflow-runner:latest
    restart: unless-stopped
    env_file: .env                  # REPO_URL, RUNNER_TOKEN
    environment:
      RUNNER_NAME: lab-runner
      LABELS: self-hosted,lab,ansible
      RUNNER_WORKDIR: /tmp/runner/work
      EPHEMERAL: "false"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # docker depuis un job
    extra_hosts:
      - "host.docker.internal:host-gateway"          # joindre Grafana (J4)
```

```bash
cp .env.example .env     # coller REPO_URL + RUNNER_TOKEN
docker compose up -d && docker compose logs -f runner
# → "Runner successfully added" puis "Listening for Jobs"
```

---

## L'image du runner : pourquoi une image custom ?

```dockerfile
# ressources/lab/runner/Dockerfile
FROM myoung34/github-runner:latest

# Outils nécessaires aux jobs de déploiement (J2) et de monitoring (J3)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip rsync sshpass curl \
 && pip3 install --no-cache-dir --break-system-packages ansible \
 && ansible-galaxy collection install community.general ansible.posix \
 && rm -rf /var/lib/apt/lists/*
```

- Un runner hosted n'a **pas** Ansible, ni accès à vos VMs
- Le runner est une **dépendance de build** : versionnez son image comme le reste
- Alternative : `container:` dans le job (image par job) — mais il faut Docker sur le runner

---

## Premier job sur le runner

```yaml
# .github/workflows/hello-runner.yml
name: Hello runner
on:
  workflow_dispatch:
  push:
    paths: ['.github/workflows/hello-runner.yml']

jobs:
  hello:
    runs-on: [self-hosted, lab]        # ← labels : ET logique
    steps:
      - uses: actions/checkout@v4
      - name: Qui suis-je ?
        run: |
          echo "Runner : $RUNNER_NAME sur $(hostname)"
          ansible --version | head -1
          docker --version
```

`runs-on: [self-hosted, lab]` = un runner qui a **tous** ces labels. Sans runner disponible, le job reste *Queued*.

---

## Sécurité : `permissions` du GITHUB_TOKEN

Chaque run reçoit un token automatique. Par défaut il est trop permissif : **restreignez-le**.

```yaml
permissions:            # au niveau workflow (ou job)
  contents: read        # checkout
  checks: write         # publier un rapport de tests
  pull-requests: write  # commenter une PR
# tout ce qui n'est pas listé = none
```

| Scope | Sert à |
|---|---|
| `contents: write` | créer une release, pousser un commit |
| `packages: write` | pousser sur ghcr.io |
| `id-token: write` | **OIDC** : obtenir un token cloud (AWS/Azure/GCP) sans secret stocké |
| `deployments: write` | marquer un déploiement |

> Réglage recommandé côté repo : *Settings → Actions → Workflow permissions → Read repository contents*.

---

## Sécurité : secrets et niveaux

```
Organisation ──▶ Repo ──▶ Environment (staging, production)
   (partagés)      (ce repo)     (visibles uniquement par les jobs
                                  qui ciblent cet environment)
```

- Un secret d'environment n'est délivré **qu'aux jobs** qui déclarent `environment: production`
- Les secrets sont **masqués** dans les logs (`***`) — mais pas s'ils sont transformés (base64, découpés)
- `::add-mask::valeur` masque une valeur calculée
- Ne jamais `echo $SECRET`, ne jamais les écrire dans un artefact
- Variables non sensibles : `vars.TARGET_IP` (mêmes niveaux, en clair)

```yaml
- run: echo "::add-mask::$TOKEN"
  env: { TOKEN: ${{ steps.login.outputs.token }} }
```

---

## Sécurité : self-hosted + repos publics = danger

- Sur un **repo public**, n'importe qui peut ouvrir une PR → un workflow `pull_request` s'exécute **avec le code de la PR**
- Sur un runner hosted, la VM est jetée ; sur **votre** runner, le code inconnu tourne chez vous
- Règles :
  - Self-hosted **uniquement sur des repos privés** (ou via groupes restreints)
  - *Settings → Actions → Require approval for all outside collaborators*
  - Runner **éphémère** + conteneur : rien ne survit au job
  - Épingler les actions par **SHA**, pas par tag mutable

```yaml
- uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332  # v4.1.7
```

> Un tag `@v4` peut être déplacé par le mainteneur (ou un attaquant). Dependabot peut gérer ces mises à jour.

---

## Démo live

1. `docker compose up -d` du runner → le voir apparaître dans *Settings → Actions → Runners* (Idle)
2. Pousser `hello-runner.yml` → le job s'exécute **chez nous** (hostname du conteneur)
3. Couper le runner → le job passe *Queued* et attend
4. Regarder les logs : `docker compose logs -f runner`

---

## À retenir — Runner self-hosted

- Un runner **sort** en HTTPS vers GitHub : aucun port entrant, fonctionne derrière un NAT
- Enregistrement par **token**, ciblage par **labels** (`runs-on: [self-hosted, lab]`), isolation par **groupes**
- Natif (`config.sh` + service) ou **conteneur** (image custom avec vos outils = dépendance versionnée)
- **Sécurité** : `permissions:` minimales, secrets par environment, jamais de self-hosted sur un repo public, actions épinglées par SHA

---

<!-- _class: lead -->
# 3. Factoriser : actions composites et workflows réutilisables

---

## Le problème : copier-coller de YAML

Front et API ont besoin du même enchaînement : `setup-node → cache → npm ci → lint → test → build`.

```yaml
# ci.yml — 60 lignes pour le front…
jobs:
  lint-front: { steps: [checkout, setup-node, npm ci, npm run lint] }
  test-front: { steps: [checkout, setup-node, npm ci, npm test] }
  # … et 60 lignes quasi identiques pour api/
  lint-api:   { steps: [checkout, setup-node, cd api, npm ci, npm run lint] }
  test-api:   { steps: [checkout, setup-node, cd api, npm ci, npm test] }
```

Multipliez par 30 repos : une correction de sécurité = 30 PRs.

**Deux outils de factorisation** :
- **Action composite** → factorise des **steps**
- **Workflow réutilisable** → factorise des **jobs**

---

## Action composite : factoriser des steps

```yaml
# .github/actions/setup-node-project/action.yml
name: Setup Node project
description: Installe Node avec cache npm et exécute npm ci dans un dossier
inputs:
  working-directory:
    description: Dossier du package.json
    default: '.'
  node-version:
    default: '20'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm
        cache-dependency-path: ${{ inputs.working-directory }}/package-lock.json
    - run: npm ci
      shell: bash                       # obligatoire dans une composite
      working-directory: ${{ inputs.working-directory }}
```

```yaml
# utilisation (dans n'importe quel job, après checkout)
- uses: ./.github/actions/setup-node-project
  with: { working-directory: api }
```

---

## Workflow réutilisable : factoriser des jobs

```yaml
# .github/workflows/reusable-node-ci.yml
name: Reusable Node CI
on:
  workflow_call:                          # ← déclencheur spécial
    inputs:
      working-directory: { type: string, default: '.' }
      node-version:      { type: string, default: '20' }
      artifact-name:     { type: string, required: true }
    secrets:
      DISCORD_WEBHOOK: { required: false }
    outputs:
      coverage: { value: ${{ jobs.test.outputs.coverage }} }

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-project
        with: { working-directory: ${{ inputs.working-directory }} }
      - run: npm run lint
        working-directory: ${{ inputs.working-directory }}
  # test, build : voir slides suivantes
```

---

## Workflow réutilisable : l'appelant

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  front:
    uses: ./.github/workflows/reusable-node-ci.yml     # ← jobs.<id>.uses
    with: { working-directory: '.', artifact-name: dist-front }
  api:
    uses: ./.github/workflows/reusable-node-ci.yml
    with: { working-directory: api, artifact-name: dist-api }
    secrets: inherit                                     # transmet tous les secrets
```

- Un job `uses:` **ne peut pas** avoir de `steps` : il délègue tout
- Depuis un autre repo : `uses: mon-org/ci-templates/.github/workflows/node-ci.yml@v1`
- Versionner par tag ou SHA ; 4 niveaux d'imbrication max ; 20 workflows réutilisables max par run

---

## Composite vs réutilisable vs action Docker/JS

| | Action composite | Workflow réutilisable | Action Docker / JavaScript |
|---|---|---|---|
| Factorise | des **steps** | des **jobs** entiers | un step complexe |
| Fichier | `action.yml` (`runs: composite`) | workflow avec `on: workflow_call` | `action.yml` + code |
| S'utilise | `steps: - uses:` | `jobs: x: uses:` | `steps: - uses:` |
| Runner | celui du job appelant | défini dans le workflow appelé | celui du job appelant |
| Secrets | via `inputs` / env | `secrets:` / `inherit` | via `inputs` |
| Matrix, needs, environment | non (c'est un step) | **oui** | non |
| Typique | setup outils, login | pipeline standard d'un type de projet | outil publié sur le Marketplace |

> Règle simple : **steps répétés → composite** ; **jobs répétés → réutilisable** ; les deux se combinent.

---

## Optimiser : `concurrency`

Sans `concurrency`, 5 pushs rapides = 5 runs complets en parallèle (minutes gaspillées, résultats obsolètes).

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true      # annule le run précédent du même groupe
```

```yaml
# Pour un déploiement : ne JAMAIS annuler, mettre en file
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

| Cas | `cancel-in-progress` |
|---|---|
| CI sur une branche / PR | `true` (seul le dernier commit compte) |
| Déploiement | `false` (un déploiement interrompu = état incohérent) |

---

## Optimiser : `paths`, cache, timeouts

```yaml
on:
  push:
    paths: ['api/**', '.github/workflows/api.yml']     # ne tourne que si l'API change
    paths-ignore: ['**.md', 'docs/**']
```

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
```

```yaml
jobs:
  test:
    timeout-minutes: 10          # défaut : 360 ! Toujours le fixer
    continue-on-error: false
    steps:
      - run: npm run test:flaky
        continue-on-error: true  # n'échoue pas le job (à réserver aux tests instables)
```

> `setup-node` avec `cache: npm` fait déjà le cache du store npm ; `actions/cache` sert pour le reste (Playwright, Gradle, pip…).

---

## Optimiser : `if`, `needs` et résultats

```yaml
jobs:
  test:  { … }
  build:
    needs: test                       # attend ET exige le succès
  notify:
    needs: [test, build]
    if: always()                      # tourne même si test a échoué
    steps:
      - run: |
          echo "test  : ${{ needs.test.result }}"    # success | failure | cancelled | skipped
          echo "build : ${{ needs.build.result }}"
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

Fonctions de statut : `success()` (défaut), `failure()`, `cancelled()`, `always()`.

---

## Gouvernance : branch protection et rulesets

*Settings → Rules → Rulesets* (ou *Branches → Branch protection*) sur `main` :

- **Require status checks to pass** : sélectionner `front / lint`, `front / test`, `api / test`…
- **Require a pull request before merging** + 1 review
- **Require branches to be up to date**
- **Block force pushes**

```
# CODEOWNERS — reviewers obligatoires par chemin
.github/    @equipe-platform
ansible/    @equipe-ops
api/        @equipe-backend
```

> Les checks requis sont nommés `<job appelant> / <job du workflow réutilisable>` — d'où l'intérêt de noms stables.

---

## Gouvernance : maintenir le système

```yaml
# .github/dependabot.yml — met à jour les actions (et npm)
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: npm
    directory: /api
    schedule: { interval: weekly }
```

- **Required workflows** (org) : imposer un workflow à tous les repos (scan sécurité, licence)
- **Templates de workflow** (org, `.github` repo) : proposer un starter au clic
- Tableau de bord *Actions → Usage* : minutes, durée par workflow, taux d'échec

---

## Démo live

1. `ci.yml` du cours précédent (front seul, 3 jobs) → on extrait `setup-node-project` (composite)
2. On crée `reusable-node-ci.yml` (`workflow_call`) avec les jobs lint / test / build
3. `ci.yml` devient 15 lignes qui l'appellent pour `.` et `api/`
4. Ruleset sur `main` : checks `front / test` et `api / test` requis ; PR de démonstration bloquée puis verte

---

## À retenir — Factoriser

- **Action composite** = steps réutilisables (`action.yml`, `runs: composite`, `shell:` obligatoire)
- **Workflow réutilisable** = jobs réutilisables (`on: workflow_call`, `inputs`/`secrets`/`outputs`, appelé par `jobs.x.uses`)
- `concurrency` (annuler le CI, jamais le déploiement), `paths`, `timeout-minutes`, `needs.*.result`
- Gouvernance = **rulesets** (checks requis), CODEOWNERS, Dependabot sur les actions, required workflows

---

<!-- _class: lead -->
# 4. Automatiser le build et les tests

---

## Un build reproductible

| Pratique | Pourquoi |
|---|---|
| `npm ci` (pas `npm install`) | Installe **exactement** le lockfile, échoue s'il diverge, supprime `node_modules` |
| Lockfile committé | Même arbre de dépendances partout |
| Version d'outil explicite (`setup-node@v4` avec `node-version: 20`) | Pas de « ça marchait hier » |
| `.nvmrc` / `engines` | Documente la version attendue |
| Variables d'env `CI=true` | Désactive les prompts, active les modes non interactifs |

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container: node:20-alpine          # image imposée : encore plus reproductible
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
```

> `container:` exige Docker sur le runner (hosted : oui ; self-hosted : à installer).

---

## Côté Java : Maven et Gradle, mêmes principes

```yaml
# Maven
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: '21', cache: maven }
- run: mvn -B verify          # -B = batch mode ; verify = compile + test + package + checks
```

```yaml
# Gradle
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: '21' }
- uses: gradle/actions/setup-gradle@v4     # cache + wrapper
- run: ./gradlew build --no-daemon
```

| Concept | npm | Maven | Gradle |
|---|---|---|---|
| Fichier de build | `package.json` | `pom.xml` | `build.gradle(.kts)` |
| Lockfile | `package-lock.json` | (versions fixes dans le pom) | `gradle.lockfile` (opt.) |
| Cycle de vie | scripts | `validate → compile → test → package → verify → install → deploy` | tasks (`test`, `build`) |
| Rapports de tests | reporter JUnit | Surefire → `target/surefire-reports/*.xml` | `build/test-results/test/*.xml` |
| Cache CI | `~/.npm` | `~/.m2/repository` | `~/.gradle/caches` |

---

## Tests dans le pipeline : produire un rapport JUnit

Le format **JUnit XML** est le lingua franca des outils CI (Jenkins, GitLab, GitHub, Azure).

```json
// package.json
"scripts": {
  "test": "vitest run",
  "test:ci": "vitest run --reporter=default --reporter=junit --outputFile=reports/junit.xml --coverage"
}
```

```js
// vitest.config.js
export default defineConfig({
  test: {
    coverage: { reporter: ['text', 'lcov', 'cobertura'] },
  },
})
```

Sortie : `reports/junit.xml` (résultats) + `coverage/lcov.info` et `coverage/cobertura-coverage.xml` (couverture).

---

## Publier le rapport de tests

```yaml
test:
  runs-on: ubuntu-latest
  permissions: { contents: read, checks: write }
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-project
      with: { working-directory: ${{ inputs.working-directory }} }
    - run: npm run test:ci
      working-directory: ${{ inputs.working-directory }}
    - uses: dorny/test-reporter@v1
      if: always()                                 # même si les tests échouent
      with:
        name: Tests ${{ inputs.working-directory }}
        path: ${{ inputs.working-directory }}/reports/junit.xml
        reporter: java-junit
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: coverage-${{ inputs.artifact-name }}
        path: ${{ inputs.working-directory }}/coverage
```

Résultat : un *check* « Tests api » avec la liste des tests, les échecs annotés sur la PR.

---

## Couverture : résumé et seuil bloquant

```yaml
- name: Résumé de couverture
  if: always()
  working-directory: ${{ inputs.working-directory }}
  run: |
    total=$(grep -oP 'lines-valid="\K[0-9]+' coverage/cobertura-coverage.xml)
    covered=$(grep -oP 'lines-covered="\K[0-9]+' coverage/cobertura-coverage.xml)
    pct=$(( covered * 100 / total ))
    echo "### Couverture : ${pct} % (${covered}/${total} lignes)" >> "$GITHUB_STEP_SUMMARY"
    echo "coverage=$pct" >> "$GITHUB_OUTPUT"
  id: cov
- name: Seuil de couverture
  run: test ${{ steps.cov.outputs.coverage }} -ge 70 || { echo "::error::Couverture < 70 %"; exit 1; }
```

- `$GITHUB_STEP_SUMMARY` : Markdown affiché dans la page du run
- `$GITHUB_OUTPUT` : sorties de step, réutilisables (`steps.cov.outputs.coverage`) et exposables en `outputs` du workflow
- Alternative : `vitest --coverage.thresholds.lines=70` échoue directement

---

## Le build produit un artefact immuable

```yaml
build:
  needs: [lint, test]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-project
      with: { working-directory: ${{ inputs.working-directory }} }
    - run: npm run build --if-present
      working-directory: ${{ inputs.working-directory }}
    - uses: actions/upload-artifact@v4
      with:
        name: ${{ inputs.artifact-name }}
        path: ${{ inputs.working-directory }}/dist
        retention-days: 7
        if-no-files-found: ignore
```

- L'artefact est **le** livrable : le CD (J2) le télécharge, ne rebuild jamais
- Nommer avec le numéro de run ou le SHA → traçabilité
- `retention-days` : par défaut 90, réduisez pour les artefacts intermédiaires

---

## Qualité au-delà des tests

```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-project
    - run: npm audit --audit-level=high        # échoue si vulnérabilité ≥ high
```

- **Lint** (ESLint, Prettier `--check`) : bloquant
- **Audit de dépendances** : `npm audit`, Dependabot alerts, `trivy` sur l'image Docker
- **Badge** dans le README :
  `![CI](https://github.com/<vous>/taskflow-ops/actions/workflows/ci.yml/badge.svg)`
- **Annotations** : `echo "::warning file=api/src/app.js,line=12::message"` apparaît sur la PR

---

## Le pipeline CI complet de TaskFlow (cible du TP1)

```
ci.yml (appelant)
├── front  ──uses──▶ reusable-node-ci.yml (working-directory: .)
│                     ├── lint
│                     ├── test ──▶ check "Tests ." + coverage + résumé
│                     └── build ──▶ artefact dist-front
└── api    ──uses──▶ reusable-node-ci.yml (working-directory: api)
                      ├── lint
                      ├── test ──▶ check "Tests api" + coverage
                      └── build (pas de dist : if-no-files-found: ignore)

hello-runner.yml ──▶ [self-hosted, lab]   (prépare J2)
```

Checks requis sur `main` : `front / test`, `api / test`, `front / build`.

---

## À retenir — Build & tests

- **Reproductible** = `npm ci` + lockfile + versions d'outils fixées (+ `container:` si besoin)
- Maven/Gradle : mêmes jobs, mêmes rapports (Surefire / `test-results` en JUnit XML)
- **JUnit XML** est le format universel ; `dorny/test-reporter` le transforme en check lisible
- Couverture → `$GITHUB_STEP_SUMMARY` + seuil qui **casse** le build
- Le CI se termine par un **artefact immuable** : c'est lui que le CD déploiera

---

<!-- _class: lead -->
# TP de l'après-midi

---

## TP1 — Opérer et factoriser le CI de TaskFlow (3h45)

| Étape | Contenu | Durée |
|---|---|---|
| 1 | Créer `taskflow-ops` depuis le starter ; lancer le **runner self-hosted** (compose) ; `hello-runner.yml` sur `[self-hosted, lab]` | 45 min |
| 2 | Action composite `.github/actions/setup-node-project` | 30 min |
| 3 | Workflow réutilisable `reusable-node-ci.yml` (lint → test JUnit + coverage → build + artefact) ; `ci.yml` l'appelle pour `.` et `api/` | 1h15 |
| 4 | `concurrency`, `paths`, `timeout-minutes`, résumé + seuil de couverture ; casser un test ; ruleset avec checks requis | 45 min |
| 5 (bonus) | Job `audit`, matrix Node 20/22 via input, badge README | 30 min |

**Livrable** : runner en ligne ; `ci.yml` vert appelant le workflow réutilisable pour front + API ; rapports de tests et artefacts `dist`.

Énoncé : `tp/fil-rouge-taskflow/jour1-runner-ci-factorise.md`

---

## Synthèse de la journée

- Un **système CI** se pense comme une plateforme : runners, factorisation, secrets, gouvernance
- Le **runner self-hosted** est la brique « installée et opérée » — et notre porte vers le lab
- **Composite** pour les steps, **réutilisable** pour les jobs : un seul pipeline standard, N projets
- Le CI livre des **rapports** (JUnit, coverage) et un **artefact immuable**

**Demain** : ce même artefact traverse staging puis production, déployé par Ansible depuis le runner, avec approbation et rollback.

---

<!-- _class: lead -->
# Questions ?

**Ressources**
- docs.github.com/actions — *Hosting your own runners*, *Reusing workflows*
- `ressources/cheatsheet-github-actions.md` (+ correspondance Jenkins)
- `ressources/lab/runner/README.md`
