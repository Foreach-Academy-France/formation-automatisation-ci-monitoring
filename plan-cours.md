---
type: course-plan
parent: "[[Cours Automatisation CI et Monitoring]]"
duration: 4 jours × 7h (syllabus : 35h)
format: cours matin + TP après-midi
last_updated: 2026-09-15
---

# Plan de cours — Automatisation du système CI et monitoring (4 jours)

**Format type d'une journée :**
- **Matin (9h00-12h15)** — Cours théorique + démos live
- **Après-midi (13h15-17h00)** — TP fil rouge encadré

**Positionnement :** ce cours est la suite directe de *Initialisation de l'intégration du système CI* (GitHub Actions) et de *Ansible & Kubernetes*. Les étudiants savent déjà écrire un workflow GitHub Actions (jobs, matrix, secrets, artefacts, environments, release, Docker → ghcr.io → Pages), utiliser Ansible (inventaire, playbooks, rôles, Jinja2, Vault) et Kubernetes (k3d). On ne ré-explique pas ces bases : on passe de « j'écris un workflow » à « **j'automatise et j'opère le système CI** », puis on **assemble** la chaîne complète *commit → build → test → déploiement → monitoring → alerte*.

**Choix d'outils (et pourquoi) :**

| Besoin | Outil | Pourquoi |
|---|---|---|
| Système CI | **GitHub Actions** (comme au cours précédent) — le syllabus cite Jenkins « par exemple » ; Jenkins est présenté en comparaison | Continuité avec le cours *Initialisation CI* ; les concepts sont transférables (tableau de correspondance Jenkins ↔ GitHub Actions fourni) |
| « Installation et configuration d'un outil de CI » | **Runner self-hosted** GitHub Actions (conteneur Docker sur le poste étudiant, image avec Ansible) | C'est la partie *opérée* du système CI : installer, enregistrer, labelliser, sécuriser un runner ; indispensable pour atteindre les VMs du lab depuis le pipeline |
| Automatisation à l'échelle | **Workflows réutilisables** (`workflow_call`), **actions composites**, `concurrency`, cache, `paths`, branch protection | Factoriser le CI pour plusieurs projets/repos = automatiser le *système* et pas un seul pipeline |
| Build & test | Node.js (npm scripts, Vitest, rapports JUnit) — équivalents **Maven / Gradle** présentés | Stack TaskFlow déjà connue ; mêmes principes côté Java (lifecycle, cache, Surefire) |
| Déploiement automatisé | **Ansible** lancé par un job GitHub Actions sur le runner self-hosted | Cité par le syllabus ; réutilise le rôle TaskFlow du cours précédent |
| Environnements & approbation | **GitHub Environments** `staging` / `production` (required reviewers, secrets et variables par environnement) | Promotion staging → prod avec approbation manuelle native |
| Cible de déploiement | VM **Multipass** `taskflow-web1` (staging) et `taskflow-web2` (prod) — même lab que le cours Ansible (fallback Incus via `lab-up.sh`) | Lab déjà installé chez les étudiants |
| Monitoring métriques | **Prometheus** + exporters (node_exporter, cAdvisor, blackbox) | Standard cloud-native, cité par le syllabus ; modèle pull + PromQL |
| Dashboards | **Grafana** (provisionné en code) | Standard ; dashboards versionnés = *monitoring as code* |
| Alerting | **Alertmanager** + notification webhook (Discord/Slack) et mail (MailHog) | Boucle complète métrique → règle → alerte → notification |
| Logs (bonus J4) | **Loki + Promtail** | Ouverture vers l'observabilité (3 piliers) |

**Projet fil rouge : TaskFlow, version « opérée »** — on repart de l'application TaskFlow (front Vite + nginx, avec son `ci.yml` du cours précédent) et on lui ajoute une petite **API Node/Express** (`api/`) qui expose `/api/tasks`, `/health` et `/metrics`. Sur 4 jours on construit autour :

| Jour | Brique construite |
|---|---|
| J1 | Runner self-hosted installé + CI factorisé : action composite, workflow réutilisable appelé pour le front **et** l'API, rapports de tests JUnit, coverage, cache, concurrency, checks requis |
| J2 | Workflow **Deploy** : build once → artefact → job `deploy-staging` (Ansible sur le runner) → smoke test → approbation (environment `production`) → `deploy-prod` ; rollback par `workflow_dispatch` |
| J3 | Stack Prometheus + Grafana ; API instrumentée (`prom-client`) ; node_exporter déployé par Ansible via un workflow `monitoring.yml` ; premier dashboard |
| J4 | Règles d'alerte + Alertmanager + notifications ; blackbox (uptime) ; cAdvisor ; `promtool` dans le CI ; annotation Grafana à chaque déploiement ; bonus Loki ; QCM |

**Évaluation :** état final du repo TaskFlow (100 pts, 4 blocs de 25) + QCM 30 questions (J4, 45 min).

---

## 📅 Jour 1 — Automatiser et opérer le système CI (modules 1 + 2 du syllabus)

> **Objectif fin de journée :** l'étudiant a installé et enregistré un runner self-hosted, comprend ce que signifie *opérer* un système CI (runners, permissions, secrets, factorisation), et a refactorisé le CI de TaskFlow en workflow réutilisable + action composite, avec rapports de tests et couverture, pour le front et l'API.

### Matin — Cours (3h15)

**Bloc 1.1 — Du workflow au système CI (30 min)** *(module 1)*
- Rappels flash : pipeline, job, step, artefact, trigger, runner — ce qu'on sait déjà faire avec GitHub Actions
- Automatiser *le système* CI : ne plus écrire un workflow par repo mais une **plateforme** (runners, workflows partagés, politiques, secrets, observabilité du CI)
- SaaS vs self-hosted : GitHub Actions / GitLab CI (hébergés) vs Jenkins / GitLab Runner / Woodpecker (auto-hébergés) ; coût, contrôle, sécurité, réseau privé, maintenance
- **Jenkins en 10 minutes** : controller/agents, plugins, `Jenkinsfile` déclaratif — tableau de correspondance Jenkins ↔ GitHub Actions (le syllabus le cite ; les concepts sont identiques)
- Les 3 promesses : *build* reproductible, *test* systématique, *deploy* sans humain

**Bloc 1.2 — Installer et configurer un runner self-hosted (1h)** *(module 1 : « installation et configuration d'un outil de CI »)*
- Runners GitHub-hosted (`ubuntu-latest`) vs **self-hosted** : quand (réseau privé, GPU, coût, cache local, outils spécifiques), risques (repos publics, isolation)
- Anatomie d'un runner : agent `actions/runner`, enregistrement (token), `runs-on` + **labels**, groupes de runners (org), runner éphémère, mise à jour automatique
- Installation native (`config.sh`, service systemd) vs **conteneur Docker** (image `myoung34/github-runner`, variables `REPO_URL`, `RUNNER_TOKEN`/`ACCESS_TOKEN`, `LABELS`) — le lab utilise le conteneur, avec Ansible pré-installé
- Sécurité : permissions du `GITHUB_TOKEN` (`permissions:`), secrets (repo / environment / org), **OIDC** vers le cloud (mention), `pull_request` sur repos publics et runners self-hosted, workflows épinglés par SHA
- Démo live : `docker compose up` du runner, apparition dans *Settings → Actions → Runners*, workflow `hello-runner.yml` avec `runs-on: [self-hosted, lab]`

**Bloc 1.3 — Factoriser : actions composites et workflows réutilisables (1h)** *(modules 1 + 2)*
- **Action composite** (`.github/actions/<nom>/action.yml`) : `inputs`, `runs: using: composite`, `shell: bash` — DRY sur les steps (setup Node + cache + `npm ci`)
- **Workflow réutilisable** (`on: workflow_call` avec `inputs`, `secrets`, `outputs`) appelé par `jobs.<id>.uses:` — DRY sur les jobs, versionnement par tag/SHA, partage inter-repos (`org/repo/.github/workflows/x.yml@v1`)
- Action composite vs workflow réutilisable vs action Docker/JS : tableau de décision
- Optimiser : `concurrency` (annuler les runs obsolètes), `paths` / `paths-ignore`, `actions/cache` (clé sur lockfile), `timeout-minutes`, `continue-on-error`, `if:` et `needs.*.result`
- Gouvernance : **branch protection / rulesets** (checks requis, reviews), `CODEOWNERS`, Dependabot pour les actions, `required workflows` (org)
- Démo live : refactor `ci.yml` → `reusable-node-ci.yml` + action composite, appelé deux fois (front, api)

**Bloc 1.4 — Automatiser build & tests (45 min)** *(module 2)*
- Environnement de build reproductible : `npm ci` vs `npm install`, lockfile, cache, versions d'outils (`setup-node`, `setup-java`), conteneurs (`container:`)
- Côté Java : **Maven** (`mvn -B verify`, phases du lifecycle, Surefire, `setup-java` avec `cache: maven`) et **Gradle** (`gradle test`, `gradle/actions/setup-gradle`) — mêmes principes, mêmes jobs
- Tests dans le pipeline : rapports **JUnit XML** (`vitest --reporter=junit`), publication (`dorny/test-reporter`, `mikepenz/action-junit-report`), couverture (`lcov` → résumé dans `$GITHUB_STEP_SUMMARY`, seuil bloquant), tests en parallèle (matrix / jobs)
- Qualité : lint, `npm audit`, annotations de PR, badge de statut, artefacts de build (`upload-artifact`) — la sortie du CI est l'**artefact immuable** consommé par le CD (J2)

### Après-midi — TP1 : Opérer et factoriser le CI de TaskFlow (3h45)

- Étape 1 — Créer le repo `taskflow-ops` à partir du starter ; lancer le runner self-hosted (compose fourni, token d'enregistrement) ; workflow `hello-runner.yml` sur `[self-hosted, lab]` (45 min)
- Étape 2 — Action composite `.github/actions/setup-node-project` (inputs `working-directory`, `node-version` ; `setup-node` + cache + `npm ci`) (30 min)
- Étape 3 — Workflow réutilisable `reusable-node-ci.yml` (`workflow_call` : lint → tests JUnit + coverage résumée → build + artefact) ; `ci.yml` l'appelle pour `.` (front) et `api/` (1h15)
- Étape 4 — `concurrency`, `paths`, `timeout-minutes`, résumé de couverture, seuil bloquant ; casser un test et lire le rapport ; branch protection avec checks requis (45 min)
- Étape 5 (bonus) — Job `audit` (`npm audit --audit-level=high`), matrix Node 20/22 via input, badge dans le README (30 min)

**Livrable J1 :** runner self-hosted en ligne ; `ci.yml` vert appelant le workflow réutilisable pour front + API, rapports de tests et artefacts `dist`.

---

## 📅 Jour 2 — Automatiser le déploiement (module 3 du syllabus)

> **Objectif fin de journée :** le workflow Deploy construit une fois l'artefact, le déploie automatiquement sur la VM *staging* via Ansible (job sur le runner self-hosted), puis en *prod* après approbation dans l'environment GitHub, avec smoke test et rollback possible.

### Matin — Cours (3h15)

**Bloc 2.1 — Du CI au CD (45 min)**
- Continuous Delivery vs Continuous Deployment ; le *pipeline de livraison* (build once, deploy many)
- Artefact immuable : archive `dist` + `api` (`upload-artifact` / `download-artifact`), image Docker taguée par SHA / version ; **jamais** de rebuild par environnement
- Stratégies de déploiement : recreate, rolling, blue/green, canary — ce que ça implique côté infra et monitoring
- Environnements : staging → prod, promotion, **GitHub Environments** (required reviewers, wait timer, branches autorisées, secrets/variables par environnement), fenêtres de déploiement
- Rollback : redéployer l'artefact N-1 ; feature flags (mention)

**Bloc 2.2 — Ansible piloté par le workflow (1h)**
- Rappels express Ansible (inventaire, rôle, handlers, idempotence) — 10 min max
- Job de déploiement sur le runner self-hosted : clé SSH depuis un secret (`webfactory/ssh-agent` ou fichier + `chmod 600`), mot de passe Vault depuis un secret, `ansible-playbook -i inventory/hosts.ini playbooks/deploy.yml -l staging -e app_version=${{ github.run_number }}`
- `workflow_run` (après CI vert) vs `push` sur `main` vs `workflow_dispatch` (inputs) : choisir son déclencheur
- Le rôle `taskflow` étendu : nginx (front statique) + service **systemd** pour l'API Node + variables d'environnement par environnement
- Zero-downtime simple : déployer dans `releases/<n>` + lien symbolique `current` + `reload` ; conserver N releases pour rollback
- Démo live : workflow `build → deploy-staging → smoke → (approbation) → deploy-prod`

**Bloc 2.3 — Gestion des configurations pour le déploiement (45 min)**
- Séparer code / config / secrets (12-factor) ; `group_vars/staging` vs `group_vars/prod` ; `vars.STAGING_IP` / `vars.PROD_IP` par environment GitHub
- Secrets : Ansible Vault + mot de passe en secret d'environment ; masquage automatique dans les logs, `::add-mask::`, ne jamais `echo` un secret
- Templates Jinja2 : `.env`, vhost nginx, unit systemd
- Versionner la config d'infra dans le même repo (mono-repo app + `ansible/`) vs repo séparé
- Vérification post-déploiement : smoke test (`curl /health`), test de fumée E2E minimal, `--check`/`--diff` en pré-prod

**Bloc 2.4 — Ouverture : déployer sur Kubernetes et GitOps (30 min)**
- Même workflow, cible k3d : `kubectl set image` / `kubernetes.core` / Helm
- GitOps (Argo CD, Flux) : le cluster tire l'état désiré depuis Git — le pipeline ne fait plus que produire l'image + modifier un manifest
- Où mettre le curseur pour une PME : VM + Ansible reste une réponse valable

### Après-midi — TP2 : Déploiement automatisé GitHub Actions + Ansible (3h45)

- Étape 1 — Lab : VMs `taskflow-web1` (staging) et `taskflow-web2` (prod) up (`lab-up.sh`) ; environments GitHub `staging` et `production` (reviewer requis sur `production`), secrets `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD`, variables `STAGING_IP` / `PROD_IP` ; test `ansible all -m ping` depuis le runner (30 min)
- Étape 2 — Compléter le rôle `taskflow` : déploiement de `dist/` + `api/` dans `releases/<run_number>`, lien `current`, unit systemd `taskflow-api`, vhost nginx qui proxy `/api` (1h)
- Étape 3 — `deploy.yml` : job `build` (artefact `taskflow-<run>.tar.gz`) → job `deploy-staging` (`runs-on: [self-hosted, lab]`, `environment: staging`, download-artifact, Ansible) → job `smoke-staging` (45 min)
- Étape 4 — Job `deploy-prod` (`environment: production` → approbation) + `smoke-prod` ; `group_vars/prod.yml` chiffré Vault ; vérifier le masquage des secrets (45 min)
- Étape 5 — Rollback : `workflow_dispatch` avec input `rollback_to` → job `rollback` (playbook `rollback.yml`) ; test grandeur nature (30 min)
- Bonus — Notification Discord/Slack de fin de déploiement avec version + lien du run

**Livrable J2 :** workflow complet build → staging → approbation → prod ; TaskFlow (front + API) servi sur les deux VMs ; rollback démontré.

---

## 📅 Jour 3 — Introduction au monitoring : Prometheus & Grafana (module 4 du syllabus)

> **Objectif fin de journée :** l'étudiant sait ce qu'on mesure et pourquoi (KPI, golden signals, SLI/SLO), a une stack Prometheus + Grafana qui scrape l'API TaskFlow instrumentée et les VMs (node_exporter déployé par Ansible via un workflow), et sait écrire des requêtes PromQL de base.

### Matin — Cours (3h15)

**Bloc 3.1 — Pourquoi et quoi monitorer (45 min)**
- Monitoring vs observabilité : métriques, logs, traces (les 3 piliers) ; ce cours = métriques (+ logs en bonus)
- Objectifs : détecter, diagnostiquer, capacité, prouver (SLA)
- **KPI et indicateurs** : disponibilité (uptime), latence (p50/p95/p99), taux d'erreur, débit ; les **4 golden signals** (Google SRE) ; méthode **USE** (infra) et **RED** (services)
- SLI → SLO → SLA, error budget ; exemple chiffré TaskFlow (SLO 99,5 % dispo, p95 < 300 ms)
- Boîte noire (blackbox, synthetic) vs boîte blanche (instrumentation)

**Bloc 3.2 — Prometheus (1h15)**
- Panorama : Nagios/Zabbix (checks, push, état) vs Prometheus (métriques, **pull**, séries temporelles) ; Datadog / Grafana Cloud (SaaS)
- Architecture : serveur, `scrape_configs`, targets, exporters, TSDB, rétention, Pushgateway (quand), service discovery
- Modèle de données : métrique + labels ; types **counter / gauge / histogram / summary** ; cardinalité (le piège)
- Exposition : format texte `/metrics` ; exporters standards (node_exporter, cAdvisor, nginx, blackbox)
- **PromQL** : sélecteurs, `rate()` / `increase()`, agrégations `sum by()`, `histogram_quantile()`, `up`, `absent()` ; les 10 requêtes à connaître
- Démo live : `docker compose up` Prometheus + node_exporter, exploration des targets, PromQL dans l'UI

**Bloc 3.3 — Instrumenter une application (30 min)**
- Librairies client (`prom-client` Node, Micrometer Java, `prometheus_client` Python) ; middleware HTTP
- Quoi exposer : compteur de requêtes par route/statut, histogramme de latence, gauges métier (`taskflow_tasks_total`), métriques par défaut (event loop, mémoire, GC)
- Nommer correctement : `_total`, `_seconds`, unités de base, labels stables
- Démo live : ajout de `prom-client` à l'API TaskFlow en 15 lignes

**Bloc 3.4 — Grafana (45 min)**
- Datasources, dashboards, panels (time series, stat, gauge, table), variables, annotations
- **Provisioning as code** : `provisioning/datasources`, `provisioning/dashboards`, dashboards JSON versionnés ; import depuis grafana.com (Node Exporter Full 1860)
- Bon dashboard : une question par panel, hiérarchie (vue d'ensemble → détail), unités, seuils, pas de « mur de graphes »
- Démo live : dashboard TaskFlow (RED) en 10 minutes puis export JSON

### Après-midi — TP3 : Monitorer TaskFlow (3h45)

- Étape 1 — Stack `monitoring/docker-compose.yml` : Prometheus + Grafana + node_exporter local ; targets `UP` (30 min)
- Étape 2 — Instrumenter `api/` avec `prom-client` : middleware (compteur + histogramme), gauge métier, `/metrics` ; tests unitaires du middleware (le CI réutilisable les exécute) (1h)
- Étape 3 — Rôle Ansible `node_exporter` (binaire, user système, unit systemd, port 9100) + workflow `monitoring.yml` (`workflow_dispatch` + `push` sur `ansible/roles/node_exporter/**`) qui le déploie sur les 2 VMs depuis le runner (45 min)
- Étape 4 — `prometheus.yml` : jobs `taskflow-api` (staging + prod, label `env`) et `node` ; PromQL : requêtes/s, taux d'erreur, p95, CPU/RAM/disque des VMs (45 min)
- Étape 5 — Grafana provisionné : datasource + dashboard « TaskFlow RED » + import Node Exporter Full ; commit du JSON (45 min)
- Bonus — Générer du trafic (`hey` / boucle `curl`) et observer p95 ; nginx exporter sur le front

**Livrable J3 :** stack monitoring versionnée ; API instrumentée ; VMs sous node_exporter déployé par workflow ; 2 dashboards provisionnés.

---

## 📅 Jour 4 — Monitoring avancé, alerting & bonnes pratiques (module 5 du syllabus) + QCM

> **Objectif fin de journée :** l'étudiant a un système de monitoring complet : infra + application + disponibilité externe, règles d'alerte pertinentes routées vers une notification, validation des règles dans le CI, annotations de déploiement, et connaît les bonnes pratiques d'un monitoring proactif. QCM passé.

### Matin — Cours (3h15)

**Bloc 4.1 — Surveillance de l'infrastructure (45 min)**
- node_exporter en profondeur : CPU (`node_cpu_seconds_total` par mode), mémoire (`MemAvailable`), disque (`filesystem_avail`, I/O), réseau (`receive/transmit_bytes`), load, saturation
- Conteneurs : **cAdvisor** (CPU/mémoire/restarts par conteneur), Docker `--metrics-addr`
- Disponibilité externe : **blackbox_exporter** (HTTP 200, TLS expiry, ICMP), monitoring synthétique
- Capacité : `predict_linear()` (disque plein dans 4 h), tendances sur 7/30 jours, saisonnalité

**Bloc 4.2 — Alertes et notifications (1h15)**
- Règles d'alerte Prometheus : `expr`, `for`, `labels` (severity), `annotations` (summary, runbook) ; recording rules
- **Alertmanager** : routes (par severity/équipe), receivers (webhook Discord/Slack, email, PagerDuty), `group_by`, `group_wait/interval`, `repeat_interval`, inhibition, silences
- Alertes basées sur les **symptômes** (SLO, taux d'erreur, latence) plutôt que sur les causes (CPU à 80 %) ; alertes multi-fenêtres sur le burn rate (intro)
- Éviter la fatigue d'alerte : seuils réalistes, `for`, dédoublonnage, runbooks, astreinte
- Démo live : alerte `TaskFlowApiDown` → Alertmanager → message Discord en < 1 min ; silence pendant une maintenance

**Bloc 4.3 — Analyse des tendances et du comportement (30 min)**
- Corréler déploiement et incident : **annotations Grafana** poussées par le workflow Deploy (API Grafana) ; alertes Grafana (mention)
- Logs : **Loki + Promtail**, LogQL, corrélation métrique → log ; traces : OpenTelemetry (mention)
- Post-mortem sans blâme, MTTD/MTTR, DORA metrics (lead time, deploy frequency, change failure rate, MTTR) — le lien CI/CD ↔ monitoring

**Bloc 4.4 — Bonnes pratiques pour un monitoring proactif (45 min)**
- Monitoring **as code** : tout versionné (Prometheus, règles, Alertmanager, dashboards), testé dans le CI (`promtool check rules`, `amtool check-config`, `promtool test rules`), déployé par le pipeline
- Monitorer le monitoring (`up`, `absent()`, Watchdog / dead man's switch), rétention & stockage long terme (Thanos/Mimir, mention), sécurité (auth Grafana, réseau, secrets)
- Checklist « prêt pour la prod » ; synthèse des 4 jours : la chaîne complète commit → alerte

### Après-midi — TP4 : Monitoring complet + alerting (2h45) puis QCM (45 min)

- Étape 1 — Ajouter cAdvisor + blackbox_exporter à la stack ; jobs Prometheus ; panels infra (30 min)
- Étape 2 — `rules/taskflow.yml` : `InstanceDown`, `TaskFlowApiDown`, `HighErrorRate` (> 5 % sur 5 min), `HighLatencyP95`, `DiskWillFillIn4h`, `HostHighCpu` ; job CI `lint-monitoring` (`promtool check rules` + `amtool check-config` via `docker://`) (45 min)
- Étape 3 — Alertmanager : route par `severity`, receiver Discord/Slack (webhook) + MailHog ; couper l'API et recevoir l'alerte ; poser un silence (45 min)
- Étape 4 — Job `annotate-grafana` dans `deploy.yml` (annotation à chaque déploiement, secret `GRAFANA_TOKEN`) ; vérifier la corrélation déploiement ↔ courbes (30 min)
- Bonus — Loki + Promtail : logs de l'API dans Grafana, panel corrélé (15 min)
- **QCM final (45 min, 30 questions)** — 16h15-17h00

**Livrable J4 :** monitoring complet (infra + app + uptime) avec alertes routées et notifiées, règles validées par le CI, annotations de déploiement ; repo final rendu ; QCM.

---

## 🧰 Préparation formateur

- [ ] Vérifier chez les étudiants : Docker Desktop / Docker Engine, lab Multipass (ou Incus) du cours Ansible encore fonctionnel, clés SSH du lab, compte GitHub
- [ ] Tester le compose du runner self-hosted (image custom avec Ansible) sur Linux, macOS et Windows/WSL2 ; vérifier l'accès runner → VMs Multipass depuis le conteneur (fallback `network_mode: host` sous Linux)
- [ ] Préparer un webhook Discord de démo (salon `#alertes-formation`) et MailHog
- [ ] Scripts de démo : J1 runner + workflow réutilisable, J2 workflow deploy complet, J3 Prometheus/PromQL + instrumentation live, J4 alerte → Discord
- [ ] Solution formateur complète et testée : `.github/` (workflows + action composite), `ansible/`, `api/`, `monitoring/`
- [ ] QCM 30 questions (corrigé **non publié**), grille 100 points
- [ ] Cheatsheets : GitHub Actions avancé (+ correspondance Jenkins), Prometheus/PromQL, Alerting
- [ ] Fallback réseau : si les VMs ne sont pas joignables depuis le runner, cible `ssh-target` en conteneur (fourni dans `ressources/lab/`)

## 🎯 Couverture du syllabus

| Module syllabus | Jour | Bloc | Exercice pratique du syllabus |
|---|---|---|---|
| 1. Introduction à l'automatisation du système CI (concepts, installation et configuration d'un outil de CI) | J1 | 1.1, 1.2, 1.3 | Pipeline CI simple → TP1 étapes 1-3 (runner self-hosted + workflow réutilisable) |
| 2. Automatisation du build et du test (Maven/Gradle, tests, plugins) | J1 | 1.3, 1.4 | Build + tests automatisés dans le pipeline → TP1 étapes 3-5 |
| 3. Automatisation du déploiement (stratégies, Ansible/Docker, configs) | J2 | 2.1 → 2.4 | Déploiement d'une application avec Ansible → TP2 |
| 4. Introduction au monitoring (principes, KPI, Prometheus) | J3 | 3.1 → 3.4 | Monitoring des performances d'une application → TP3 |
| 5. Monitoring avancé et bonnes pratiques (infra, alertes, tendances) | J4 | 4.1 → 4.4 | Système de monitoring complet → TP4 |

**Compétences :** C30, C33, C34, C35 (BC05 opt.2).
