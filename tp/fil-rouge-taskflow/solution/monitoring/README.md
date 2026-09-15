# Stack de monitoring TaskFlow

Prometheus + Grafana + Alertmanager + exporters, en Docker Compose sur le poste étudiant.

```bash
docker compose up -d
docker compose ps
```

| Service | URL | Rôle |
|---|---|---|
| Prometheus | http://localhost:9090 | collecte, PromQL, règles d'alerte (Status → Targets / Rules / Alerts) |
| Grafana | http://localhost:3001 (admin / admin) | dashboards provisionnés (dossier *TaskFlow*) |
| Alertmanager | http://localhost:9093 | alertes actives, silences |
| MailHog | http://localhost:8025 | mails envoyés par Alertmanager |
| node-exporter | http://localhost:9100/metrics | métriques du poste |
| cAdvisor | http://localhost:8081 | métriques des conteneurs |
| blackbox | http://localhost:9115 | sondes HTTP (`/probe?module=http_2xx&target=…`) |

## Modifier la configuration

```bash
# Valider avant de recharger (ce que fait aussi le job lint-monitoring du CI)
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose exec prometheus promtool check rules /etc/prometheus/rules/taskflow.yml
docker compose exec alertmanager amtool check-config /etc/alertmanager/alertmanager.yml

# Recharger sans redémarrer
curl -X POST http://localhost:9090/-/reload
curl -X POST http://localhost:9093/-/reload
```

Les dashboards Grafana sont provisionnés depuis `grafana/provisioning/dashboards/json/`.
Après une modification dans l'UI : *Share → Export → Save to file*, puis remplacer le JSON et committer.

## Tester une alerte

```bash
# Sur la VM staging : couper l'API → TaskFlowApiDown (critical) en ~1 min
ssh -i ~/.ssh/taskflow_lab ubuntu@<ip_web1> sudo systemctl stop taskflow-api

# Faire monter le taux d'erreur → HighErrorRate (warning) après 5 min
for i in $(seq 1 300); do curl -s http://<ip_web1>/api/boom > /dev/null; done
```
