# Formation DevOps - Automatisation du système CI et monitoring

> Formation de 4 jours sur l'automatisation complète de la chaîne CI/CD (GitHub Actions + runner self-hosted + Ansible) et la mise en place d'un monitoring proactif (Prometheus, Grafana, Alertmanager)

**Public**: M2 ESTD - Expert en stratégie et transformation digitale - Architecte Web
**Durée**: 4 jours x 7h (syllabus : 35 heures)
**Institution**: ForEach Academy (certification IEF2I)
**Formateur**: Fabrice Claeys
**Référent IEF2I**: Michael MAVRODIS
**Prérequis**: DevOps - Initialisation de l'intégration du système CI, Ansible - Kubernetes
**Dates**: à confirmer

---

## Objectifs du cours

Ce cours vise à fournir aux étudiants les compétences nécessaires pour automatiser le système d'intégration continue (CI) et mettre en place un monitoring efficace : automatiser les processus de build, de test et de déploiement, puis surveiller les performances et la disponibilité des systèmes.

**À l'issue de la formation, les participants seront capables de :**

- Comprendre les principes et les avantages de l'automatisation du système CI
- Installer, configurer et opérer un runner CI self-hosted et factoriser les pipelines (workflows réutilisables, actions composites)
- Automatiser les processus de build, de test et de déploiement (GitHub Actions + Ansible)
- Mettre en place un monitoring efficace d'une application et de son infrastructure (Prometheus, Grafana)
- Définir des alertes pertinentes et les router vers des notifications (Alertmanager)
- Appliquer les meilleures pratiques pour une automatisation et un monitoring proactif

**Compétences visées** : C30, C33, C34, C35

---

## Organisation

**Structure de chaque journée :**
- **Matin (9h-12h15)** : Théorie et démonstrations
- **Après-midi (13h15-17h)** : Travaux pratiques

**1 journée = 1 brique de la chaîne** *commit → build → test → déploiement → monitoring → alerte*

### Projet fil rouge : TaskFlow, version « opérée »

Les étudiants repartent de l'application **TaskFlow** (déjà utilisée dans les cours CI et Ansible/Kubernetes), enrichie d'une petite API Node/Express (`api/`) qui expose `/api/tasks`, `/health` et `/metrics`. Sur 4 jours, ils construisent toute la chaîne d'automatisation et de surveillance autour :

| Jour | Enrichissement du projet |
|------|--------------------------|
| J1 | Runner self-hosted + CI factorisé : action composite, workflow réutilisable (front + API), rapports JUnit, coverage, cache, concurrency |
| J2 | Workflow **Deploy** : artefact immuable → Ansible sur le runner → staging automatique, prod après approbation (environment), smoke test, rollback |
| J3 | Prometheus + Grafana : API instrumentée (`prom-client`), node_exporter déployé par un workflow Ansible, dashboards provisionnés |
| J4 | Alertes (règles Prometheus + Alertmanager → Discord/Slack/mail), blackbox, cAdvisor, `promtool` dans le CI, annotations de déploiement, QCM |

**Stack** : GitHub Actions (runner self-hosted) + Docker + Ansible + Multipass + Node.js + Prometheus + Grafana + Alertmanager

**Évaluation** : État final du repository TaskFlow (100 points) + QCM

Plan détaillé bloc par bloc : [plan-cours.md](./plan-cours.md)

---

## Programme de formation détaillé

### Jour 1 : Automatiser et opérer le système CI

*Modules 1 et 2 du syllabus*

| Horaire | Contenu |
|---------|---------|
| **MATIN - Théorie** | |
| 9h00-9h30 | **Du workflow au système CI** : rappels GitHub Actions, SaaS vs self-hosted, Jenkins en 10 min (correspondance des concepts) |
| 9h30-10h30 | **Runner self-hosted** : installer, enregistrer, labelliser, sécuriser (permissions, secrets, OIDC) — installation native vs conteneur |
| 10h45-11h45 | **Factoriser le CI** : actions composites, workflows réutilisables (`workflow_call`), concurrency, cache, paths, branch protection |
| 11h45-12h15 | **Build & tests automatisés** : environnement reproductible, Maven/Gradle vs npm, rapports JUnit, coverage, artefacts |
| **APRÈS-MIDI - Pratique** | |
| 13h15-17h00 | **TP1 : Opérer et factoriser le CI de TaskFlow** |

**Slides**: [Jour 1](./slides/jour1-systeme-ci-runner-workflows.md) | **TP1**: [Runner & CI factorisé](./tp/fil-rouge-taskflow/jour1-runner-ci-factorise.md)

---

### Jour 2 : Automatiser le déploiement

*Module 3 du syllabus*

| Horaire | Contenu |
|---------|---------|
| **MATIN - Théorie** | |
| 9h00-9h45 | **Du CI au CD** : delivery vs deployment, artefact immuable, stratégies (rolling, blue/green, canary), environnements, rollback |
| 9h45-10h45 | **Ansible piloté par le workflow** : job sur le runner self-hosted, secrets SSH/Vault, environments GitHub, rôle `taskflow` (nginx + systemd), releases + lien `current` |
| 11h00-11h45 | **Gestion des configurations** : code / config / secrets, `group_vars` par environnement, Vault, templates, vérification post-déploiement |
| 11h45-12h15 | **Ouverture** : déployer sur Kubernetes, GitOps (Argo CD / Flux) |
| **APRÈS-MIDI - Pratique** | |
| 13h15-17h00 | **TP2 : Déploiement automatisé GitHub Actions + Ansible** |

**Slides**: [Jour 2](./slides/jour2-deploiement-automatise.md) | **TP2**: [Déploiement Ansible](./tp/fil-rouge-taskflow/jour2-deploiement-ansible.md)

---

### Jour 3 : Introduction au monitoring — Prometheus & Grafana

*Module 4 du syllabus*

| Horaire | Contenu |
|---------|---------|
| **MATIN - Théorie** | |
| 9h00-9h45 | **Pourquoi et quoi monitorer** : métriques/logs/traces, KPI, golden signals, USE/RED, SLI/SLO/SLA |
| 9h45-11h00 | **Prometheus** : modèle pull, architecture, exporters, types de métriques, PromQL essentiel |
| 11h15-11h45 | **Instrumenter une application** : `prom-client`, middleware HTTP, métriques métier, nommage |
| 11h45-12h15 | **Grafana** : dashboards, panels, provisioning as code, bonnes pratiques de dashboard |
| **APRÈS-MIDI - Pratique** | |
| 13h15-17h00 | **TP3 : Monitorer TaskFlow** |

**Slides**: [Jour 3](./slides/jour3-monitoring-prometheus-grafana.md) | **TP3**: [Monitoring Prometheus](./tp/fil-rouge-taskflow/jour3-monitoring-prometheus.md)

---

### Jour 4 : Monitoring avancé, alerting & bonnes pratiques

*Module 5 du syllabus*

| Horaire | Contenu |
|---------|---------|
| **MATIN - Théorie** | |
| 9h00-9h45 | **Surveillance de l'infrastructure** : node_exporter en profondeur, cAdvisor, blackbox_exporter, capacité et `predict_linear` |
| 9h45-11h00 | **Alertes et notifications** : règles Prometheus, Alertmanager (routes, receivers, grouping, silences), alertes sur symptômes, fatigue d'alerte |
| 11h15-11h45 | **Analyse des tendances** : annotations de déploiement, logs (Loki), post-mortem, DORA metrics |
| 11h45-12h15 | **Bonnes pratiques** : monitoring as code (promtool/amtool dans le CI), monitorer le monitoring, checklist prod, synthèse de la chaîne complète |
| **APRÈS-MIDI - Pratique** | |
| 13h15-16h00 | **TP4 : Monitoring complet + alerting** |
| 16h15-17h00 | **QCM Final** |

**Slides**: [Jour 4](./slides/jour4-alerting-observabilite.md) | **TP4**: [Alerting & monitoring complet](./tp/fil-rouge-taskflow/jour4-alerting-monitoring-complet.md) | **Évaluation**: [QCM](./evaluation/)

---

## Pourquoi ces outils ?

| Outil | Rôle dans le cours | Pourquoi ce choix |
|-------|--------------------|--------------------|
| **GitHub Actions** | Système CI, workflows réutilisables, environments | Continuité avec le cours *Initialisation CI* ; Jenkins (cité par le syllabus) est présenté en comparaison, les concepts sont transférables |
| **Runner self-hosted** | Partie « installée et opérée » du système CI, accès aux VMs du lab | Installer/configurer un outil de CI (module 1) ; indispensable pour déployer sur un réseau privé |
| **Ansible** | Déploiement piloté par le pipeline | Cité par le syllabus, déjà maîtrisé par les étudiants (cours précédent), rôle TaskFlow réutilisé |
| **Multipass** | VMs staging / prod | Même lab que le cours Ansible : rien à réinstaller |
| **Prometheus** | Collecte de métriques, PromQL, règles d'alerte | Standard cloud-native cité par le syllabus, modèle pull, écosystème d'exporters |
| **Grafana** | Dashboards provisionnés en code | Standard du marché, monitoring as code |
| **Alertmanager** | Routage et notification des alertes | Boucle complète métrique → règle → alerte → notification |

> Le runner self-hosted et la stack de monitoring tournent en **Docker Compose** sur le poste étudiant. Voir [setup-lab.md](./ressources/setup-lab.md).

---

## Couverture du syllabus

| Module syllabus | Jour | Exercice pratique du syllabus |
|-----------------|------|-------------------------------|
| 1. Introduction à l'automatisation du système CI | J1 | Installation d'un runner + pipeline CI → TP1 |
| 2. Automatisation du build et du test | J1 | Build et tests dans un pipeline CI → TP1 |
| 3. Automatisation du déploiement | J2 | Déploiement d'une application avec Ansible → TP2 |
| 4. Introduction au monitoring | J3 | Monitoring des performances d'une application → TP3 |
| 5. Monitoring avancé et bonnes pratiques | J4 | Système de monitoring complet → TP4 |

---

## Évaluation

| Type | Coefficient |
|------|-------------|
| TP (projet fil rouge) | 100% |
| QCM | 100% |

**Validation de la compétence** : Note >= 10/20

Détails : [Grille d'évaluation](./evaluation/grille-evaluation.md) · [QCM](./evaluation/qcm.md)

---

## Ressources

### Documentation officielle
- [GitHub Actions — Self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [GitHub Actions — Reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows)
- [GitHub Actions — Composite actions](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action)
- [GitHub Actions — Environments](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment)
- [Jenkins — Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) (comparaison)
- [Ansible Documentation](https://docs.ansible.com/ansible/latest/)
- [Prometheus Documentation](https://prometheus.io/docs/introduction/overview/)
- [PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Grafana — Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [prom-client (Node.js)](https://github.com/siimon/prom-client)
- [Google SRE Book — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)

### Outils recommandés
- **Docker Desktop / Docker Engine** + Docker Compose v2
- **VSCode** + extensions GitHub Actions, Ansible, YAML
- **act** — exécution locale des workflows (limité)
- **Multipass** (ou Incus) — VMs du lab
- **promtool / amtool** — validation des règles et de la config Alertmanager

### Aide-mémoire
- [Cheatsheet GitHub Actions avancé (+ correspondance Jenkins)](./ressources/cheatsheet-github-actions.md)
- [Cheatsheet Prometheus & PromQL](./ressources/cheatsheet-prometheus.md)
- [Cheatsheet Alerting (règles, Alertmanager, Grafana)](./ressources/cheatsheet-alerting.md)
- [Guide d'installation du lab](./ressources/setup-lab.md)

### Bibliographie
- *Site Reliability Engineering*, Google (gratuit en ligne : sre.google/books)
- *Prometheus: Up & Running*, Brian Brazil, O'Reilly
- *Learning GitHub Actions*, Brent Laster, O'Reilly

---

## Contact

**Formateur ForEach** : Fabrice Claeys
**Référent IEF2I** : Michael MAVRODIS (michaelmavrodis@formateur.ief2i.fr)

---

**2026 - Formation Automatisation CI & Monitoring - ForEach Academy**
