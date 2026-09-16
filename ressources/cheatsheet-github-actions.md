# Cheatsheet — GitHub Actions avancé (système CI, runners, factorisation)

> ForEach Academy — Formation Automatisation CI & Monitoring — Formateur : Fabrice Claeys
> Complète la cheatsheet du cours *Initialisation CI* (bases : workflow, jobs, steps, matrix, secrets).

---

## 1. Anatomie d'un workflow (rappel condensé)

```yaml
name: CI
on:
  push:
    branches: [main]
    paths: ['src/**', 'api/**', '.github/**']   # ne tourne que si ces chemins changent
  pull_request:
  workflow_dispatch:                            # bouton "Run workflow" + inputs

permissions:            # moindre privilège pour GITHUB_TOKEN
  contents: read
  checks: write

concurrency:            # un nouveau push annule le run en cours de la même branche
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: npm }
      - run: npm ci
      - run: npm run test:ci
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: junit, path: reports/junit.xml }
```

## 2. Contextes et expressions

| Contexte | Exemples | Note |
|---|---|---|
| `github` | `github.ref`, `github.sha`, `github.run_number`, `github.run_id`, `github.actor`, `github.repository`, `github.event_name`, `github.server_url` | `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}` = lien du run |
| `inputs` | `inputs.rollback_to` | inputs de `workflow_dispatch` **et** de `workflow_call` |
| `vars` | `vars.TARGET_IP`, `vars.GRAFANA_URL` | variables (non secrètes) repo / environment / org |
| `secrets` | `secrets.SSH_PRIVATE_KEY` | masqués dans les logs ; `secrets.GITHUB_TOKEN` auto |
| `env` | `env.NODE_VERSION` | défini au niveau workflow / job / step |
| `needs` | `needs.build.outputs.version`, `needs.build.result` | dépend de `needs: [build]` |
| `steps` | `steps.meta.outputs.tags` | step avec `id:` |
| `runner` | `runner.os`, `runner.temp`, `runner.name` | |
| `job` | `job.status` | dans `if:` d'un step |

Fonctions utiles : `contains()`, `startsWith()`, `format()`, `toJSON()`, `fromJSON()`, `hashFiles('**/package-lock.json')`, `success()`, `failure()`, `always()`, `cancelled()`.

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
if: ${{ inputs.rollback_to != '' }}
if: always()          # même si un job précédent a échoué
```

Outputs entre jobs :

```yaml
jobs:
  build:
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - id: v
        run: echo "version=${{ github.run_number }}" >> "$GITHUB_OUTPUT"
  deploy:
    needs: build
    steps:
      - run: echo "Déploie ${{ needs.build.outputs.version }}"
```

Fichiers spéciaux : `$GITHUB_OUTPUT` (outputs), `$GITHUB_ENV` (variables pour les steps suivants), `$GITHUB_STEP_SUMMARY` (Markdown dans l'onglet Summary), `$GITHUB_PATH`.

```bash
echo "::add-mask::$VALEUR_SENSIBLE"      # masque une valeur calculée
echo "::warning file=api/src/app.js,line=12::Attention"
echo "## Couverture : 87 %" >> "$GITHUB_STEP_SUMMARY"
```

## 3. Cache, artefacts, matrix, conteneurs

```yaml
# Cache (setup-node le fait déjà pour npm ; version manuelle :)
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-

# Artefacts : produits par un job, consommés par un autre
- uses: actions/upload-artifact@v4
  with: { name: taskflow-${{ github.run_number }}, path: taskflow.tar.gz, retention-days: 7 }
- uses: actions/download-artifact@v4
  with: { name: taskflow-${{ github.run_number }}, path: . }

# Matrix
strategy:
  fail-fast: false
  matrix:
    node: [20, 22]
runs-on: ubuntu-latest
steps:
  - uses: actions/setup-node@v4
    with: { node-version: ${{ matrix.node }} }

# Job dans un conteneur + service (base de données de test)
container: node:20-alpine
services:
  postgres:
    image: docker.io/postgres:16
    env: { POSTGRES_PASSWORD: test }
    options: --health-cmd pg_isready --health-interval 5s

# Action Docker à la volée (promtool sans l'installer)
- uses: docker://prom/prometheus:v2.53.0
  with:
    entrypoint: promtool
    args: check rules monitoring/prometheus/rules/taskflow.yml
```

## 4. Action composite (factoriser des **steps**)

`.github/actions/setup-node-project/action.yml` :

```yaml
name: Setup Node project
description: Installe Node + dépendances (npm ci) avec cache pour un sous-projet
inputs:
  working-directory:
    description: Dossier contenant package.json
    required: false
    default: '.'
  node-version:
    description: Version de Node
    required: false
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
      shell: bash                          # OBLIGATOIRE dans une action composite
      working-directory: ${{ inputs.working-directory }}
```

Appel : `- uses: ./.github/actions/setup-node-project` + `with: { working-directory: api }` (checkout requis avant).

## 5. Workflow réutilisable (factoriser des **jobs**)

`.github/workflows/reusable-node-ci.yml` :

```yaml
name: Reusable Node CI
on:
  workflow_call:
    inputs:
      working-directory: { type: string, required: true }
      node-version:      { type: string, default: '20' }
    secrets:
      NPM_TOKEN: { required: false }
    outputs:
      artifact-name:
        value: ${{ jobs.build.outputs.artifact-name }}

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-project
        with: { working-directory: ${{ inputs.working-directory }}, node-version: ${{ inputs.node-version }} }
      - run: npm run lint
        working-directory: ${{ inputs.working-directory }}
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
        if: always()
        with:
          name: Tests (${{ inputs.working-directory }})
          path: ${{ inputs.working-directory }}/reports/junit.xml
          reporter: java-junit
  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    outputs: { artifact-name: dist-${{ inputs.working-directory }} }
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-project
        with: { working-directory: ${{ inputs.working-directory }} }
      - run: npm run build --if-present
        working-directory: ${{ inputs.working-directory }}
      - uses: actions/upload-artifact@v4
        with: { name: dist-${{ inputs.working-directory }}, path: ${{ inputs.working-directory }}/dist }
```

Appel depuis `ci.yml` (au niveau **job**, pas step) :

```yaml
jobs:
  front:
    uses: ./.github/workflows/reusable-node-ci.yml
    with: { working-directory: '.' }
  api:
    uses: ./.github/workflows/reusable-node-ci.yml
    with: { working-directory: 'api' }
    secrets: inherit
```

Inter-repos : `uses: Foreach-Academy-France/ci-templates/.github/workflows/node-ci.yml@v1` (épingler un tag ou un SHA).

| Besoin | Action composite | Workflow réutilisable |
|---|---|---|
| Granularité | steps | jobs (avec `runs-on`, `needs`, `environment`) |
| Runner | celui du job appelant | défini dans le workflow appelé |
| Secrets | via `inputs` | `secrets:` / `secrets: inherit` |
| Imbrication | illimitée | 4 niveaux max |

## 6. Environments, approbation, déploiement

```yaml
jobs:
  deploy-staging:
    runs-on: [self-hosted, lab]
    environment:
      name: staging
      url: http://${{ vars.TARGET_IP }}
    steps: [...]
  deploy-prod:
    needs: smoke-staging
    runs-on: [self-hosted, lab]
    environment: production          # required reviewers → attente d'approbation
    steps: [...]
```

- *Settings → Environments* : **Required reviewers**, **Wait timer**, **Deployment branches** (ex. `main` uniquement), secrets et variables **par environment** (même nom `TARGET_IP`, valeur différente).
- Un job ne voit que les secrets/vars de son environment + ceux du repo.

Déclencheurs de déploiement :

```yaml
on:
  push: { branches: [main] }             # simple : déploie chaque push sur main
  workflow_run:                          # après CI vert
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      rollback_to:
        description: Numéro de run à restaurer (vide = déploiement normal)
        required: false
        default: ''
```

Avec `workflow_run`, filtrer : `if: github.event.workflow_run.conclusion == 'success'`.

## 7. Runner self-hosted

**Installation native** (Linux, en tant qu'utilisateur non-root) :

```bash
mkdir ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> --name lab-runner --labels lab --unattended
./run.sh                       # premier plan
sudo ./svc.sh install && sudo ./svc.sh start   # service systemd
./config.sh remove --token <TOKEN>             # désinscription
```

Le token d'enregistrement vient de *Settings → Actions → Runners → New self-hosted runner* (valide 1 h) ou de `gh api -X POST repos/{owner}/{repo}/actions/runners/registration-token --jq .token`.

**Conteneur** (lab du cours, `ressources/lab/runner/`) :

```yaml
services:
  runner:
    build: .                               # FROM myoung34/github-runner + ansible
    environment:
      REPO_URL: https://github.com/<owner>/taskflow-ops
      RUNNER_TOKEN: ${RUNNER_TOKEN}        # ou ACCESS_TOKEN (PAT) pour auto-renouvellement
      RUNNER_NAME: lab-runner
      LABELS: lab,ansible
      RUNNER_WORKDIR: /tmp/runner/work
      EPHEMERAL: "false"
    extra_hosts: ["host.docker.internal:host-gateway"]
```

Ciblage : `runs-on: [self-hosted, lab]` (le label `self-hosted` est implicite, tous les labels listés doivent correspondre). Groupes de runners : niveau organisation.

**Sécurité** : jamais de runner self-hosted persistant sur un dépôt public ; *Settings → Actions → Fork pull request workflows* ; préférer `EPHEMERAL=true` en prod ; pas de `sudo` sans mot de passe inutile ; épingler les actions par SHA (`uses: actions/checkout@<sha>`), Dependabot `package-ecosystem: github-actions` ; **OIDC** (`id-token: write`) pour obtenir des credentials cloud temporaires sans secret stocké.

## 8. `gh` CLI

```bash
gh auth login
gh run list --limit 10 [--workflow ci.yml]
gh run watch                           # suit le dernier run
gh run view <id> [--log] [--job <job-id>]
gh run download <id> -n dist-front
gh run rerun <id> --failed
gh workflow list / gh workflow view deploy.yml
gh workflow run deploy.yml -f rollback_to=41
gh workflow run monitoring.yml --ref main
gh secret set SSH_PRIVATE_KEY --env staging < ~/.ssh/taskflow_lab
gh secret set ANSIBLE_VAULT_PASSWORD --env production
gh variable set TARGET_IP --env staging --body 192.168.64.11
gh api repos/{owner}/{repo}/actions/runners --jq '.runners[] | {name,status}'
gh api repos/{owner}/{repo}/environments
gh api -X POST repos/{owner}/{repo}/actions/runners/registration-token --jq .token
```

## 9. Ansible depuis un job

```yaml
- uses: actions/checkout@v4
- uses: actions/download-artifact@v4
  with: { name: taskflow-${{ github.run_number }} }
- run: tar xzf taskflow-*.tar.gz              # dist/ + api/ à la racine du workspace
- uses: webfactory/ssh-agent@v0.9.0
  with: { ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }} }
- name: Déployer
  env:
    ANSIBLE_HOST_KEY_CHECKING: 'False'
    ANSIBLE_FORCE_COLOR: 'true'
  run: |
    printf '%s' "${{ secrets.ANSIBLE_VAULT_PASSWORD }}" > "$RUNNER_TEMP/vault_pass"
    chmod 600 "$RUNNER_TEMP/vault_pass"
    ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml \
      -l staging -e app_version=${{ github.run_number }} \
      --vault-password-file "$RUNNER_TEMP/vault_pass"
    rm -f "$RUNNER_TEMP/vault_pass"
```

Variante sans action externe : `mkdir -p ~/.ssh && printf '%s\n' "$KEY" > ~/.ssh/id_lab && chmod 600 ~/.ssh/id_lab` puis `ansible_ssh_private_key_file=~/.ssh/id_lab` dans l'inventaire.

## 10. Correspondance Jenkins ↔ GitHub Actions

| Jenkins | GitHub Actions |
|---|---|
| `Jenkinsfile` (pipeline déclaratif) | `.github/workflows/*.yml` |
| Controller + agents (SSH/JNLP/Docker) | GitHub + runners (hosted / self-hosted) |
| `agent { label 'linux' }` / `agent { docker { image 'node:20' } }` | `runs-on: [self-hosted, linux]` / `container: node:20` |
| `stage('Build') { steps { sh '...' } }` | `jobs.build.steps: - run: ...` |
| `stages` séquentiels | `jobs` + `needs:` |
| `parallel { ... }` | jobs sans `needs` entre eux, ou `matrix` |
| `when { branch 'main' }` | `if: github.ref == 'refs/heads/main'` |
| `post { always / success / failure }` | `if: always()` / `success()` / `failure()` |
| `input message: 'Déployer ?'` | `environment:` avec required reviewers |
| `parameters { string(...) }` | `workflow_dispatch.inputs` |
| `triggers { pollSCM / cron }` | `on: push` (webhook natif) / `on: schedule: cron` |
| `environment { X = '...' }` | `env:` |
| Credentials (`withCredentials`, `sshagent`) | `secrets.*`, `webfactory/ssh-agent` |
| `archiveArtifacts` / `junit` | `upload-artifact` / `dorny/test-reporter` |
| `stash` / `unstash` | `upload-artifact` / `download-artifact` |
| Shared libraries | workflows réutilisables + actions composites |
| Plugins (1 800+) | Marketplace (20 000+ actions) |
| Multibranch pipeline | natif : chaque branche/PR déclenche le workflow |
| `options { timeout(...) }` | `timeout-minutes:` |
| `JENKINS_HOME` à sauvegarder | rien à héberger (SaaS) sauf les runners self-hosted |

## 11. Dépannage

| Symptôme | Piste |
|---|---|
| Job « Waiting for a runner to pick up this job » | aucun runner avec **tous** les labels ; runner hors ligne (`docker compose logs runner`) ; token expiré (re-générer) |
| `Resource not accessible by integration` | `permissions:` insuffisantes (ex. `checks: write` pour test-reporter) |
| Secret vide dans un job | secret défini au mauvais niveau (repo vs environment) ; le job ne déclare pas `environment:` |
| `download-artifact` ne trouve rien | nom différent de l'upload ; artefact produit dans un autre run |
| Workflow réutilisable : `workflow was not found` | chemin `./.github/workflows/...` incorrect ; sur un fork, référence `@ref` invalide |
| Runner ne joint pas les VMs | tester `docker compose exec runner ping <IP>` ; sous Linux, `network_mode: host` ; sous Docker Desktop, vérifier le routage vers Multipass |
| Ansible « Permission denied (publickey) » | clé non chargée (`ssh-add -l`), mauvais `ansible_user`, clé publique absente de la VM |
| `concurrency` annule un déploiement en cours | ne jamais mettre `cancel-in-progress: true` sur un workflow de déploiement |
| Action composite : `Required property is missing: shell` | ajouter `shell: bash` sur chaque step `run` |
