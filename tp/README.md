# Travaux pratiques — Automatisation du système CI et monitoring

Un seul projet fil rouge, **TaskFlow « opérée »**, enrichi chaque après-midi. Chaque TP s'appuie sur le précédent : le repo `taskflow-ops` rendu en fin de J4 est l'objet de l'évaluation (100 points).

| Jour | Énoncé | Ce qu'on construit | Livrable | Points |
|---|---|---|---|---|
| J1 | [Opérer et factoriser le CI](./fil-rouge-taskflow/jour1-runner-ci-factorise.md) | Runner self-hosted en Docker, action composite, workflow réutilisable appelé pour le front et l'API, rapports JUnit + couverture, `concurrency`, checks requis | Run `CI` vert sur `main`, runner *Idle*, branche protégée | 25 |
| J2 | [Déploiement automatisé GitHub Actions + Ansible](./fil-rouge-taskflow/jour2-deploiement-ansible.md) | Rôle `taskflow` (releases, API systemd, nginx proxy), `deploy.yml` build once → staging → approbation → prod, Vault, rollback | Run `Deploy` complet vert, TaskFlow servie sur les 2 VMs, rollback démontré | 25 |
| J3 | [Monitorer TaskFlow](./fil-rouge-taskflow/jour3-monitoring-prometheus.md) | Stack Prometheus + Grafana, API instrumentée `prom-client`, rôle `node_exporter` + workflow `monitoring.yml`, PromQL RED/USE, dashboards provisionnés | `monitoring/` versionné, 6 targets UP, dashboard *TaskFlow RED* | 25 |
| J4 | [Alerting et monitoring complet](./fil-rouge-taskflow/jour4-alerting-monitoring-complet.md) | cAdvisor, blackbox, règles d'alerte validées par le CI, Alertmanager → mail + Discord, silences, annotations de déploiement | Alerte reçue et résolue, `lint-monitoring` vert, annotations visibles | 25 |

**Total : 100 points** — grille détaillée dans [`../evaluation/grille-evaluation.md`](../evaluation/grille-evaluation.md).

## Organisation

- **Starter** : [`fil-rouge-taskflow/starter/`](./fil-rouge-taskflow/starter/) — à copier dans `~/taskflow-ops` et pousser sur **votre** repo GitHub dès le J1
- **Solution formateur** : [`fil-rouge-taskflow/solution/`](./fil-rouge-taskflow/solution/) — à consulter après le TP ou en cas de blocage prolongé
- **Lab** : runner self-hosted dans [`../ressources/lab/runner/`](../ressources/lab/runner/), VMs via [`../ressources/lab/lab-up.sh`](../ressources/lab/lab-up.sh) — guide complet : [`../ressources/setup-lab.md`](../ressources/setup-lab.md)
- Présentation du projet et arborescence : [`fil-rouge-taskflow/README.md`](./fil-rouge-taskflow/README.md)

## Rendu

À la fin du J4, envoyez l'URL de votre repo `taskflow-ops` (accès lecture au formateur si privé). Le CI et le dernier run `Deploy` doivent être verts ; aucun secret ne doit figurer en clair dans le repo.
