# Grille d'évaluation — TP fil rouge TaskFlow « opérée »

**Formation** : DevOps - Automatisation du système CI et monitoring (4 jours)
**Formateur** : Fabrice Claeys — ForEach Academy

> **Note sur 100 points.** Seuil de validation : **50 points** (= 10/20).
> Chaque bloc correspond à une journée de formation et à un énoncé de TP.

Prérequis à la correction : cloner le dépôt de l'étudiant, s'authentifier avec
`gh auth login`, et se placer dans le clone (`gh` utilise le remote `origin`).

```bash
git clone git@github.com:<etudiant>/taskflow-ops.git && cd taskflow-ops
gh run list --limit 20                # vue d'ensemble des runs
gh workflow list                      # workflows présents et actifs
```

---

## Bloc 1 — Système CI : runner, action composite, workflow réutilisable (25 points)

> Objectif : l'étudiant sait installer et opérer un runner self-hosted, et
> factoriser le CI en composants réutilisables avec rapports de tests.

| Élément | Points | Vérification |
|---|---|---|
| Runner self-hosted enregistré et actif, labels `self-hosted` + `lab` | 4 | Capture *Settings → Actions → Runners* (état **Idle**) ou `gh api repos/{owner}/{repo}/actions/runners --jq '.runners[] \| {name,status,labels:[.labels[].name]}'` ; le run de `hello-runner.yml` doit être vert : `gh run list --workflow hello-runner.yml` |
| `hello-runner.yml` : `runs-on: [self-hosted, lab]`, affiche `hostname` / `ansible --version` | 2 | Ouvrir `.github/workflows/hello-runner.yml` ; `gh run view --log` du dernier run montre la sortie d'`ansible --version` |
| Action composite `.github/actions/setup-node-project/action.yml` : `inputs` (`working-directory`, `node-version`), `runs.using: composite`, `setup-node` avec cache, `npm ci` | 4 | Ouvrir le fichier ; vérifier `using: "composite"`, chaque step `run` porte `shell: bash`, `cache-dependency-path` pointe vers le lockfile du dossier |
| Workflow réutilisable `reusable-node-ci.yml` : `on: workflow_call` avec inputs `working-directory` (requis) et `node-version` (défaut), jobs `lint`, `test`, `build` utilisant l'action composite | 5 | Ouvrir le fichier ; `gh workflow view reusable-node-ci.yml` ; les trois jobs doivent utiliser `uses: ./.github/actions/setup-node-project` |
| `ci.yml` appelle le workflow réutilisable **deux fois** (`.` et `api`) via `jobs.<id>.uses: ./.github/workflows/reusable-node-ci.yml` | 3 | Ouvrir `ci.yml` ; `gh run view <id>` du dernier run sur `main` montre les jobs `front / lint`, `front / test`, `api / test`… tous verts |
| Rapport de tests JUnit publié (`dorny/test-reporter` ou `mikepenz/action-junit-report`) + résumé de couverture dans `$GITHUB_STEP_SUMMARY` | 3 | Sur le dernier run : onglet *Summary* affiche le tableau de tests et le pourcentage de couverture ; un check « Tests (front) » / « Tests (api) » apparaît |
| Artefact `dist` uploadé par le job `build` et téléchargeable | 2 | `gh run view <id>` liste l'artefact `dist-front` (ou équivalent) ; `gh run download <id> -n dist-front` fonctionne |
| `concurrency` (annulation des runs obsolètes) + `timeout-minutes` + `permissions` minimales (`contents: read`, `checks: write`) | 2 | Lire `ci.yml` et `reusable-node-ci.yml` ; `concurrency.group` contient `${{ github.ref }}`, `cancel-in-progress: true` |

**Bonus bloc 1 (max +2, hors barème)** : job `audit` (`npm audit --audit-level=high`), matrix de versions Node par input, badge de statut dans le README, branch protection avec checks requis (`gh api repos/{owner}/{repo}/branches/main/protection`).

---

## Bloc 2 — Déploiement automatisé GitHub Actions + Ansible (25 points)

> Objectif : l'étudiant construit une fois l'artefact puis le déploie via
> Ansible sur staging, puis en production après approbation, avec rollback.

| Élément | Points | Vérification |
|---|---|---|
| Job `build` : build front + archive `taskflow-<run_number>.tar.gz` (dist + api sans node_modules) + `upload-artifact` ; les jobs de déploiement font `download-artifact` (**aucun** rebuild) | 4 | Lire `deploy.yml` ; `gh run view <id>` liste l'artefact ; les jobs deploy ne contiennent ni `npm run build` ni `vite build` |
| Job `deploy-staging` : `runs-on: [self-hosted, lab]`, `environment: staging`, clé SSH depuis `secrets.SSH_PRIVATE_KEY` (ssh-agent ou fichier `chmod 600`), mot de passe Vault depuis `secrets.ANSIBLE_VAULT_PASSWORD`, `ansible-playbook … deploy.yml -l staging -e app_version=${{ github.run_number }}` | 5 | Lire le job ; `gh run view <id> --log` montre le `PLAY RECAP` sans `failed` ; aucune valeur de secret n'apparaît en clair dans les logs (masquage `***`) |
| Job `smoke-staging` : `curl -fsS http://${{ vars.TARGET_IP }}/health` vérifie `"status":"ok"` et la version déployée | 2 | Log du job : la réponse JSON contient `"version":"<run_number>"` |
| Environment `production` avec **required reviewer** ; job `deploy-prod` (`needs: smoke-staging`, `environment: production`) bloqué jusqu'à approbation puis vert ; `smoke-prod` | 4 | Capture *Settings → Environments → production* ; `gh run view <id>` montre « Approved by … » sur le job `deploy-prod` ; `curl http://<PROD_IP>/health` répond 200 |
| Rôle `taskflow` étendu : arborescence `/opt/taskflow/releases/<version>/{dist,api}`, lien symbolique `current`, `npm ci --omit=dev` dans la release, unit systemd `taskflow-api` (template), `.env` (template), vhost nginx qui sert `current/dist` et proxy `/api`, `/health`, `/metrics` vers `127.0.0.1:3000` | 5 | Lire `ansible/roles/taskflow/` ; sur la VM : `ls -l /opt/taskflow/current`, `systemctl is-active taskflow-api`, `curl -s localhost/api/tasks` |
| Idempotence : relancer `deploy.yml -l staging -e app_version=<même version>` donne `changed=0` (hors tâche de lien/restart légitimement `ok`) | 2 | Lancer deux fois le playbook depuis le clone avec la même version ; comparer le `PLAY RECAP` |
| `group_vars/prod.yml` chiffré avec Ansible Vault (`$ANSIBLE_VAULT;1.1;AES256`), aucun secret en clair dans le dépôt | 2 | `head -1 ansible/inventory/group_vars/prod.yml` ; `git log -p -- ansible/inventory/group_vars/prod.yml` ne montre jamais de version en clair ; `git grep -i "BEGIN OPENSSH PRIVATE KEY"` vide |
| Rollback : `workflow_dispatch` avec input `rollback_to`, job `rollback` conditionnel (`if: inputs.rollback_to != ''`) qui lance `rollback.yml -e rollback_to=…` ; démonstration d'un run de rollback vert | 1 | `gh workflow run deploy.yml -f rollback_to=<N-1>` puis `gh run watch` ; sur la VM `readlink /opt/taskflow/current` pointe vers la release N-1 |

**Bonus bloc 2 (max +1)** : notification Discord/Slack en fin de déploiement (version + lien du run), `keep_releases` respecté (au plus 5 releases conservées), déclencheur `workflow_run` après CI vert.

---

## Bloc 3 — Monitoring Prometheus + Grafana (25 points)

> Objectif : l'étudiant instrumente l'API, déploie node_exporter par workflow
> et construit une stack Prometheus/Grafana versionnée avec dashboards.

| Élément | Points | Vérification |
|---|---|---|
| `api/src/metrics.js` : registre prom-client, `collectDefaultMetrics`, counter `http_requests_total{method,route,status_code}`, histogram `http_request_duration_seconds` (buckets explicites), gauge `taskflow_tasks_total`, middleware branché **avant** les routes, `GET /metrics` en `text/plain` | 5 | Lire `api/src/metrics.js` et `api/src/app.js` ; `cd api && npm start` puis `curl -s localhost:3000/metrics \| grep -E "^http_requests_total\|^taskflow_tasks_total"` |
| Test `api/tests/metrics.test.js` (supertest sur `/metrics`) exécuté et vert dans le CI | 2 | Fichier présent ; le run `ci.yml` montre le test dans le rapport JUnit du job `api / test` |
| Rôle `node_exporter` : user système, binaire dans `/usr/local/bin`, unit systemd, service actif sur `:9100` ; `playbooks/monitoring.yml` | 4 | Lire le rôle ; sur les VMs : `systemctl is-active node_exporter` ; `curl -s http://<IP>:9100/metrics \| head -3` |
| Workflow `monitoring.yml` (`workflow_dispatch` + `push` sur `ansible/roles/node_exporter/**`), job sur `[self-hosted, lab]`, run vert | 3 | `gh run list --workflow monitoring.yml` ; le log montre le `PLAY RECAP` des deux VMs |
| `monitoring/docker-compose.yml` : prometheus (`:9090`), grafana (`:3001`), node-exporter local, volumes de config, réseau `monitoring` ; `docker compose config -q` sans erreur | 2 | Exécuter `docker compose -f monitoring/docker-compose.yml config -q` ; `docker compose up -d` puis http://localhost:9090/targets |
| `prometheus.yml` : `scrape_interval` défini, jobs `prometheus`, `node-local`, `taskflow-api` (staging + prod avec label `env`), `node-vms` ; toutes les targets **UP** | 4 | `docker run --rm -v "$PWD/monitoring/prometheus:/p" prom/prometheus:v2.53.0 promtool check config /p/prometheus.yml` ; page *Status → Targets* : `up == 1` partout |
| Requêtes PromQL du TP fonctionnelles (rate requêtes/s par env, taux d'erreur 5xx, p95 via `histogram_quantile`, CPU/mémoire/disque des VMs) — documentées dans le README du dépôt ou dans le dashboard | 2 | Exécuter chaque requête dans http://localhost:9090/graph ; résultat non vide |
| Grafana provisionné en code : `provisioning/datasources/prometheus.yml`, `provisioning/dashboards/dashboards.yml`, dashboard `taskflow-red.json` (stat req/s, taux d'erreur, p95, variable `env`) + dashboard node exporter importé (1860 ou équivalent) | 3 | http://localhost:3001 (admin/admin) : les deux dashboards existent **sans import manuel** (relancer `docker compose down -v && up -d` et vérifier) ; JSON valide : `node -e 'JSON.parse(require("fs").readFileSync("monitoring/grafana/provisioning/dashboards/json/taskflow-red.json"))'` |

**Bonus bloc 3 (max +1)** : nginx exporter sur le front, génération de charge et lecture du p95, recording rules pour les requêtes coûteuses.

---

## Bloc 4 — Alerting et monitoring complet (25 points)

> Objectif : l'étudiant surveille infra + application + disponibilité externe,
> définit des alertes pertinentes, les valide dans le CI et les route vers une
> notification, et corrèle les déploiements aux courbes.

| Élément | Points | Vérification |
|---|---|---|
| Stack complétée : `alertmanager` (`:9093`), `cadvisor` (`:8081`), `blackbox-exporter` (`:9115`), `mailhog` (`:8025`) ; jobs Prometheus `cadvisor` et `blackbox` (module `http_2xx`, relabeling `__param_target` → `instance`, `__address__` → `blackbox-exporter:9115`) | 4 | `docker compose config -q` ; *Status → Targets* : `probe_success == 1` pour `/health` de staging et prod ; `container_cpu_usage_seconds_total` renvoie des séries |
| `rules/taskflow.yml` : au moins `Watchdog`, `InstanceDown`, `TaskFlowApiDown`, `HighErrorRate`, `HighLatencyP95`, `HostHighCpu`, `DiskWillFillIn4h` ; chaque alerte a `for`, `labels.severity`, `annotations.summary`/`description` | 5 | `docker run --rm -v "$PWD/monitoring/prometheus:/p" prom/prometheus:v2.53.0 promtool check rules /p/rules/taskflow.yml` → `SUCCESS: 7 rules found` (ou plus) ; page *Alerts* de Prometheus liste les règles |
| Job `lint-monitoring` dans `ci.yml` : `promtool check config` + `promtool check rules` + `amtool check-config` via `uses: docker://prom/prometheus:v2.53.0` (+ `entrypoint`), vert | 3 | Lire `ci.yml` ; `gh run view <id>` montre le job `lint-monitoring` vert ; casser volontairement une règle en local et vérifier que `promtool` échoue |
| `alertmanager.yml` : route racine → receiver `mail` (MailHog `mailhog:1025`), sous-route `severity: critical` → receiver `discord` (ou `slack`) + mail, `group_by: [alertname, env]`, `group_wait`/`group_interval`/`repeat_interval` définis, `inhibit_rules` critical → warning | 4 | `docker run --rm -v "$PWD/monitoring/alertmanager:/a" prom/alertmanager:v0.27.0 amtool check-config /a/alertmanager.yml` ; http://localhost:9093/#/status affiche la config ; aucune URL de webhook réelle committée (`CHANGE_ME` ou secret hors dépôt) |
| Test de bout en bout : `sudo systemctl stop taskflow-api` sur staging → `TaskFlowApiDown` passe *pending* puis *firing* → reçue dans Alertmanager → mail visible dans MailHog (et/ou message Discord) ; puis service relancé, alerte résolue | 4 | Refaire le scénario avec l'étudiant ou capture MailHog/Discord horodatée ; `amtool alert query` (ou http://localhost:9093/#/alerts) pendant l'incident |
| Silence posé et documenté (UI ou `amtool silence add alertname=… --duration=1h --comment=…`) | 1 | `amtool silence query` ou page *Silences* ; commande dans le README ou capture |
| Job `annotate-grafana` dans `deploy.yml` (après `deploy-prod`, `if: success()`), `POST ${{ vars.GRAFANA_URL }}/api/annotations` avec `Authorization: Bearer ${{ secrets.GRAFANA_TOKEN }}`, tags `deploy`, `prod`, texte avec version + lien du run | 3 | Lire le job ; dans Grafana, dashboard TaskFlow RED : annotation verticale visible au moment du dernier déploiement ; `gh run view --log` du job montre `201` |
| Monitoring as code : tout est versionné (compose, prometheus.yml, rules, alertmanager, dashboards JSON), `Watchdog` toujours *firing* (dead man's switch), README de `monitoring/` explique le démarrage et les ports | 1 | `git ls-files monitoring/` ; page *Alerts* : `Watchdog` firing ; lecture du README |

**Bonus bloc 4 (max +1)** : Loki + Promtail (logs de l'API dans Grafana, requête LogQL `{job="taskflow-api"} |= "error"`), `promtool test rules` avec un fichier de tests unitaires de règles, alerte multi-fenêtres sur le burn rate.

---

## Barème final

### Conversion en note /20

| Points | Note /20 | Points | Note /20 |
|---|---|---|---|
| 100 | 20 | 50 | 10 |
| 90 | 18 | 40 | 8 |
| 80 | 16 | 30 | 6 |
| 70 | 14 | 20 | 4 |
| 60 | 12 | 10 | 2 |

Formule : `note = points / 5`, arrondie au demi-point le plus proche.

### Pénalités

| Situation | Pénalité |
|---|---|
| Secret en clair dans le dépôt (clé SSH, mot de passe Vault, token Grafana, webhook réel), même supprimé ensuite de `main` mais présent dans l'historique | **-5** |
| Workflow `ci.yml` ou `deploy.yml` rouge sur `main` au moment du rendu | **-5** |
| Runner self-hosted absent ou hors ligne au moment de la correction (sans justification) | **-3** |
| Dépôt non accessible au formateur à la date de rendu | note reportée, puis -2 par jour de retard |

### Bonus (max +5 au total, plafonné à 100 points)

Les bonus indiqués sous chaque bloc s'additionnent dans la limite de 5 points.
Ils ne peuvent pas compenser une pénalité pour secret en clair.

---

## Tableau de saisie des notes

| Étudiant | Bloc 1 /25 | Bloc 2 /25 | Bloc 3 /25 | Bloc 4 /25 | Bonus (≤5) | Pénalités | Total /100 | Note /20 | QCM /30 | QCM /20 |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |

> Rappel : validation du TP si Total ≥ 50 ; validation du QCM si ≥ 15 bonnes
> réponses. Les deux notes sont reportées séparément.
