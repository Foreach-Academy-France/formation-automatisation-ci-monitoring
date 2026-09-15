# Évaluation — Formation M2 DevOps : Automatisation du système CI et monitoring

**Formation** : DevOps - Automatisation du système CI et monitoring (4 jours)
**Organisme** : ForEach Academy
**Formateur** : Fabrice Claeys
**Référent pédagogique** : Michael MAVRODIS

---

## Modalités d'évaluation

| Modalité | Pondération | Seuil de validation |
|---|---|---|
| TP fil rouge — état final du repo `taskflow-ops` (+ runner, environments, monitoring) | 100 % | ≥ 10 / 20 |
| QCM théorique (30 questions, 45 min) | 100 % | ≥ 10 / 20 |

Les deux modalités sont **indépendantes** : chacune est validée à partir de 10/20.
Il n'y a pas de compensation entre les deux notes.

---

## TP fil rouge — TaskFlow « opérée » (100 points)

### Principe

Tout au long de la formation, les stagiaires construisent incrémentalement la
chaîne complète *commit → build → test → déploiement → monitoring → alerte*
autour de l'application **TaskFlow** (front Vite + API Node/Express).

L'évaluation porte sur **l'état final du dépôt GitHub `taskflow-ops`** rendu en
fin de formation, complété par trois éléments vivants qui ne sont pas dans le
dépôt et que le formateur vérifie en direct ou sur captures :

- le **runner self-hosted** enregistré sur le dépôt (état *Idle*) ;
- les **environments** GitHub `staging` et `production` (reviewer requis sur
  `production`, variables et secrets renseignés) ;
- un **run du workflow Deploy** approuvé et vert, et la stack de monitoring
  locale (Prometheus, Grafana, Alertmanager) démarrée.

### Ce qui est évalué

Le travail est organisé en quatre blocs de 25 points chacun, un par journée :

| # | Bloc | Points |
|---|---|---|
| 1 | Système CI : runner self-hosted, action composite, workflow réutilisable, rapports de tests et couverture | 25 |
| 2 | Déploiement automatisé GitHub Actions + Ansible (artefact immuable, staging → approbation → prod, rollback, secrets) | 25 |
| 3 | Monitoring Prometheus + Grafana (API instrumentée, node_exporter déployé par workflow, scrape, dashboards provisionnés) | 25 |
| 4 | Alerting et monitoring complet (règles validées par le CI, Alertmanager, blackbox, cAdvisor, annotations de déploiement) | 25 |
| | **Total** | **100** |

### Rendu attendu

Le stagiaire soumet l'URL de son dépôt GitHub `taskflow-ops` (le formateur doit
y avoir accès en lecture, ou être invité comme collaborateur) contenant :

```
.github/
  actions/
    setup-node-project/action.yml
  workflows/
    hello-runner.yml
    reusable-node-ci.yml
    ci.yml
    deploy.yml
    monitoring.yml
api/
  src/ (app.js, server.js, metrics.js)
  tests/ (app.test.js, metrics.test.js)
ansible/
  ansible.cfg
  requirements.yml
  inventory/
    hosts.ini
    group_vars/ (all.yml, staging.yml, prod.yml chiffré)
  playbooks/ (deploy.yml, rollback.yml, monitoring.yml)
  roles/
    taskflow/
    node_exporter/
monitoring/
  docker-compose.yml
  prometheus/ (prometheus.yml, rules/taskflow.yml)
  alertmanager/alertmanager.yml
  blackbox/blackbox.yml
  grafana/provisioning/ (datasources/, dashboards/, dashboards/json/)
```

Et, dans un dossier `captures/` du dépôt (ou envoyées au formateur), trois
captures d'écran :

1. *Settings → Actions → Runners* : le runner `lab-runner` (ou équivalent) en état **Idle** avec les labels `self-hosted`, `lab` ;
2. *Settings → Environments → production* : **Required reviewers** activé, variable `TARGET_IP` et secrets présents ;
3. *Actions → Deploy* : un run avec le job `deploy-prod` **approuvé** puis vert.

La grille de correction détaillée est disponible dans
[grille-evaluation.md](grille-evaluation.md).

---

## QCM théorique

| Paramètre | Valeur |
|---|---|
| Nombre de questions | 30 |
| Durée | 45 minutes |
| Format | 1 bonne réponse parmi 4 propositions (A/B/C/D) |
| Correction | 1 point par bonne réponse |
| Seuil de validation | ≥ 15 points (= 10/20) |

### Sections

| Section | Thème | Questions |
|---|---|---|
| 1 | Automatisation du système CI, runners, sécurité | 1 – 6 |
| 2 | Build, test, workflows réutilisables | 7 – 12 |
| 3 | Déploiement automatisé et gestion des configurations | 13 – 18 |
| 4 | Monitoring, Prometheus, PromQL, Grafana | 19 – 24 |
| 5 | Alerting et bonnes pratiques | 25 – 30 |

Le QCM est disponible dans [qcm.md](qcm.md).
Le corrigé formateur (usage interne uniquement) est dans `qcm-corrige.md` —
ce fichier est ignoré par Git et n'est jamais publié.
