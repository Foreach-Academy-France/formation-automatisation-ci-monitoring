# TaskFlow « opérée » — Documentation du projet fil rouge

## Présentation

TaskFlow est l'application de gestion de tâches déjà utilisée dans les cours *Initialisation CI* et *Ansible & Kubernetes* : un front Vanilla JavaScript buildé avec Vite et servi par nginx, avec son workflow `ci.yml` du cours précédent.

Pour ce cours, elle est enrichie d'une **API Node/Express** minimaliste (`api/`) afin d'avoir un vrai service à déployer et à surveiller :

| Endpoint | Rôle |
|---|---|
| `GET /api/tasks`, `POST /api/tasks`, `DELETE /api/tasks/:id`, `PATCH /api/tasks/:id/toggle` | CRUD des tâches (stockage en mémoire) |
| `GET /health` | Sonde de santé (`{"status":"ok","version":"…","env":"…"}`) |
| `GET /metrics` | Métriques Prometheus (à instrumenter au J3) |

La simplicité de l'application est intentionnelle : l'objectif pédagogique porte sur la **chaîne d'automatisation et de surveillance**, pas sur le code applicatif.

## Stack technique

| Composant | Technologie |
|---|---|
| Front | Vanilla JS + Vite 5, tests Vitest, ESLint 9, Prettier |
| API | Node 20 + Express 4, tests Vitest + supertest, `prom-client` |
| CI/CD | GitHub Actions : workflow réutilisable + action composite, **runner self-hosted** (conteneur Docker avec Ansible, labels `self-hosted, lab`), environments `staging` / `production` |
| Déploiement | Ansible ≥ 2.14, rôles `taskflow` et `node_exporter`, cibles Multipass `taskflow-web1` (staging) / `taskflow-web2` (prod) |
| Serveur web (VMs) | nginx (front statique + proxy `/api`, `/health`, `/metrics` vers l'API en service systemd) |
| Monitoring | Prometheus, Grafana, Alertmanager, node_exporter, cAdvisor, blackbox_exporter, MailHog (Docker Compose) |

## Arborescence du projet

```
fil-rouge-taskflow/
├── README.md                          ← ce fichier
├── jour1-runner-ci-factorise.md       ← énoncé TP1
├── jour2-deploiement-ansible.md       ← énoncé TP2
├── jour3-monitoring-prometheus.md     ← énoncé TP3
├── jour4-alerting-monitoring-complet.md ← énoncé TP4
├── starter/                           ← point de départ des étudiants
│   ├── index.html, vite.config.js, vitest.config.js, eslint.config.js, .prettierrc
│   ├── package.json                   ← scripts lint / test / test:ci (JUnit + coverage) / build
│   ├── src/  (app.js, tasks.js, styles.css)
│   ├── tests/ (tasks.test.js)
│   ├── Dockerfile                     ← multi-stage front (node → nginx), hérité du cours CI
│   ├── api/
│   │   ├── package.json               ← express, prom-client, vitest, supertest
│   │   ├── src/server.js              ← point d'entrée (écoute PORT, défaut 3000)
│   │   ├── src/app.js                 ← routes /api/tasks, /health, /metrics
│   │   ├── src/metrics.js             ← TODO J3 : middleware prom-client
│   │   └── tests/app.test.js
│   ├── .github/
│   │   ├── actions/
│   │   │   └── setup-node-project/action.yml   ← TODO J1 : action composite (setup-node + cache + npm ci)
│   │   └── workflows/
│   │       ├── ci.yml                 ← hérité du cours CI (lint/test/build du front) → TODO J1 : appeler le workflow réutilisable pour . et api/
│   │       ├── hello-runner.yml       ← TODO J1 : premier job sur [self-hosted, lab]
│   │       ├── reusable-node-ci.yml   ← TODO J1 : workflow_call (inputs working-directory, node-version) : lint → test (JUnit, coverage) → build (artefact)
│   │       ├── deploy.yml             ← TODO J2 : build → deploy-staging → smoke-staging → deploy-prod (approbation) → smoke-prod ; rollback ; TODO J4 : annotate-grafana
│   │       └── monitoring.yml         ← TODO J3 : déploie node_exporter (playbook monitoring.yml) depuis le runner
│   ├── ansible/
│   │   ├── ansible.cfg
│   │   ├── requirements.yml
│   │   ├── inventory/
│   │   │   ├── hosts.ini              ← groupes [staging] et [prod] : IP à renseigner
│   │   │   └── group_vars/ (all.yml, staging.yml, prod.yml ← TODO J2 : chiffré Vault)
│   │   ├── playbooks/
│   │   │   ├── deploy.yml             ← TODO J2 : compléter
│   │   │   ├── rollback.yml           ← TODO J2 : créer
│   │   │   └── monitoring.yml         ← TODO J3 : déploie node_exporter
│   │   └── roles/
│   │       ├── taskflow/              ← rôle du cours Ansible, à étendre (releases, API systemd, proxy)
│   │       │   ├── defaults/main.yml, handlers/main.yml, tasks/main.yml
│   │       │   └── templates/ (nginx-taskflow.conf.j2, taskflow-api.service.j2 ← TODO, api.env.j2 ← TODO)
│   │       └── node_exporter/         ← TODO J3 : squelette
│   └── monitoring/
│       ├── docker-compose.yml         ← Prometheus + Grafana + node_exporter (+ TODO J4 : Alertmanager, cAdvisor, blackbox, MailHog)
│       ├── prometheus/
│       │   ├── prometheus.yml         ← TODO J3 : scrape_configs
│       │   └── rules/taskflow.yml     ← TODO J4 : règles d'alerte
│       ├── prometheus/tests/          ← bonus J4 : tests de règles (`promtool test rules`)
│       ├── alertmanager/
│       │   ├── alertmanager.example.yml  ← versionné (webhook CHANGE_ME) ← TODO J4
│       │   └── alertmanager.yml       ← copie locale avec le vrai webhook, gitignorée
│       ├── blackbox/blackbox.yml
│       ├── loki/ (loki-config.yml, promtail-config.yml ← bonus J4)
│       ├── grafana/provisioning/
│       │   ├── datasources/prometheus.yml
│       │   └── dashboards/ (dashboards.yml, json/ ← TODO J3)
│       └── README.md
├── docs/runbooks/                     ← un runbook par alerte (cibles des `runbook_url`)
└── solution/                          ← solution de référence complète (accès formateur)
```

Le **runner self-hosted** (compose + image custom avec Ansible) est fourni dans **`../../ressources/lab/runner/`** : il ne fait pas partie du repo applicatif.

## Secrets et variables GitHub attendus

| Niveau | Nom | Usage |
|---|---|---|
| Environment `staging` et `production` | secret `SSH_PRIVATE_KEY` | clé privée `~/.ssh/taskflow_lab` (accès `ubuntu@VM`) |
| Environment `staging` et `production` | secret `ANSIBLE_VAULT_PASSWORD` | déchiffre `group_vars/prod.yml` |
| Environment `staging` | variable `TARGET_IP` | IP de `taskflow-web1` |
| Environment `production` | variable `TARGET_IP` | IP de `taskflow-web2` ; **required reviewer** activé |
| Repo | secret `GRAFANA_TOKEN` (J4) | service account token Grafana pour les annotations |
| Repo | variable `GRAFANA_URL` (J4) | ex. `http://host.docker.internal:3001` vu depuis le runner |
| Repo | secret `DISCORD_WEBHOOK` (bonus) | notifications de déploiement |

## Utiliser le starter

```bash
# Copier le starter dans votre espace de travail, puis le pousser sur VOTRE repo GitHub
cp -r starter/ ~/taskflow-ops
cd ~/taskflow-ops
git init && git add . && git commit -m "chore: starter TaskFlow opérée"
# créer le repo taskflow-ops sur GitHub puis :
git remote add origin git@github.com:<vous>/taskflow-ops.git && git push -u origin main

# Vérifier le front
npm ci && npm test && npm run build

# Vérifier l'API
cd api && npm ci && npm test && npm start   # http://localhost:3000/health
```

## Accès à la solution

Le dossier `solution/` contient la solution complète et fonctionnelle (workflows finaux, action composite, rôles Ansible, API instrumentée, stack monitoring avec règles et dashboards). Il est destiné au **formateur** pour les démonstrations et les corrections. Les étudiants ne doivent y accéder qu'après avoir terminé le TP ou en cas de blocage prolongé.

## Prérequis du lab

- Docker + Docker Compose v2
- Multipass (ou Incus) avec les VMs `taskflow-web1` et `taskflow-web2` du cours Ansible (`../../ressources/lab/lab-up.sh` les recrée)
- Un compte GitHub et un repo `taskflow-ops` créé depuis le starter
- Un webhook Discord ou Slack pour les notifications (J2 bonus, J4)

L'installation complète est décrite dans **[`../../ressources/setup-lab.md`](../../ressources/setup-lab.md)**.

## Commandes clés résumées

```bash
# Runner self-hosted (depuis ressources/lab/runner)
cp .env.example .env   # REPO_URL + RUNNER_TOKEN (Settings → Actions → Runners → New self-hosted runner)
docker compose up -d && docker compose logs -f runner

# Front / API
npm run test:ci                 # tests + rapport JUnit (reports/junit.xml) + coverage
cd api && npm run test:ci

# Ansible (identique à ce que fait le workflow)
ansible-galaxy collection install -r ansible/requirements.yml
ansible -i ansible/inventory/hosts.ini all -m ping
ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml -l staging -e app_version=42
ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/rollback.yml -l prod -e rollback_to=41
ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/monitoring.yml

# Monitoring (depuis monitoring/)
docker compose up -d            # Prometheus :9090, Grafana :3001 (admin/admin), Alertmanager :9093
docker compose exec prometheus promtool check rules /etc/prometheus/rules/taskflow.yml

# Déclencher manuellement un workflow
gh workflow run deploy.yml -f rollback_to=41
gh workflow run monitoring.yml
```
