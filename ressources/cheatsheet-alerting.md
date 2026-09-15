# Cheatsheet — Alerting (règles Prometheus, Alertmanager, bonnes pratiques)

> ForEach Academy — Formation Automatisation CI & Monitoring — Formateur : Fabrice Claeys

---

## 1. Règles d'alerte et recording rules

```yaml
# monitoring/prometheus/rules/taskflow.yml
groups:
  - name: taskflow.rules            # recording rules : pré-calcul de requêtes coûteuses
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job, env) (rate(http_requests_total[5m]))
      - record: job:http_errors:ratio5m
        expr: |
          sum by (job, env) (rate(http_requests_total{status_code=~"5.."}[5m]))
            / sum by (job, env) (rate(http_requests_total[5m]))

  - name: taskflow.alerts
    rules:
      - alert: HighErrorRate
        expr: job:http_errors:ratio5m > 0.05
        for: 5m                                  # pending pendant 5 min, puis firing
        labels:
          severity: warning                      # utilisé par le routage Alertmanager
          team: web
        annotations:
          summary: "Taux d'erreur élevé sur {{ $labels.env }}"
          description: "{{ $value | humanizePercentage }} d'erreurs 5xx depuis 5 min (job {{ $labels.job }})."
          runbook_url: https://github.com/<owner>/taskflow-ops/blob/main/docs/runbooks/high-error-rate.md
```

Cycle : **inactive → pending** (expr vraie, `for` pas écoulé) **→ firing** (envoyé à Alertmanager) **→ resolved**.

Templating disponible dans `annotations` : `{{ $labels.instance }}`, `{{ $value }}`, filtres `humanize`, `humanizePercentage`, `humanizeDuration`, `humanize1024`.

Convention de nommage des recording rules : `niveau:metrique:operations` (ex. `instance:node_cpu:ratio`).

## 2. Bonnes pratiques d'une règle

| Règle | Pourquoi |
|---|---|
| Toujours un `for` (≥ 1-5 min sauf pannes franches) | filtre les pics transitoires |
| Un `severity` par alerte (`critical` = réveille quelqu'un, `warning` = à traiter en heures ouvrées, `info` = tableau de bord) | routage et priorisation |
| `summary` court + `description` avec valeur et contexte | lisible dans une notification mobile |
| `runbook_url` vers une procédure | l'astreinte sait quoi faire à 3 h du matin |
| Alerter sur les **symptômes** (SLO : erreurs, latence, disponibilité) | les causes (CPU, RAM) génèrent du bruit |
| Seuils basés sur des données réelles (regarder 2 semaines d'historique) | éviter les seuils « au doigt mouillé » |
| Tester avec `promtool test rules` | monitoring as code |
| Une alerte `Watchdog` toujours *firing* | vérifie que la chaîne d'alerting fonctionne |

## 3. Catalogue : 10 alertes prêtes à copier

```yaml
- alert: Watchdog
  expr: vector(1)
  labels: { severity: none }
  annotations: { summary: "Dead man's switch — doit toujours être firing" }

- alert: InstanceDown
  expr: up == 0
  for: 1m
  labels: { severity: critical }
  annotations: { summary: "{{ $labels.job }}/{{ $labels.instance }} injoignable depuis 1 min" }

- alert: TaskFlowApiDown
  expr: probe_success{job="blackbox"} == 0
  for: 1m
  labels: { severity: critical }
  annotations: { summary: "Sonde HTTP en échec sur {{ $labels.instance }}" }

- alert: HighErrorRate
  expr: |
    sum by (env) (rate(http_requests_total{status_code=~"5.."}[5m]))
      / sum by (env) (rate(http_requests_total[5m])) > 0.05
  for: 5m
  labels: { severity: warning }
  annotations: { summary: "{{ $labels.env }} : {{ $value | humanizePercentage }} d'erreurs 5xx" }

- alert: HighLatencyP95
  expr: histogram_quantile(0.95, sum by (le, env) (rate(http_request_duration_seconds_bucket[5m]))) > 0.3
  for: 5m
  labels: { severity: warning }
  annotations: { summary: "p95 > 300 ms sur {{ $labels.env }} ({{ $value | humanizeDuration }})" }

- alert: HostHighCpu
  expr: 100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100 > 80
  for: 10m
  labels: { severity: warning }
  annotations: { summary: "CPU > 80 % depuis 10 min sur {{ $labels.instance }}" }

- alert: HostOutOfMemory
  expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10
  for: 5m
  labels: { severity: warning }
  annotations: { summary: "Moins de 10 % de mémoire disponible sur {{ $labels.instance }}" }

- alert: DiskWillFillIn4h
  expr: predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[1h], 4*3600) < 0
  for: 15m
  labels: { severity: critical }
  annotations: { summary: "{{ $labels.mountpoint }} plein dans < 4 h sur {{ $labels.instance }}" }

- alert: ContainerRestarting
  expr: increase(container_restart_count{name!=""}[15m]) > 2   # ou changes(container_last_seen[15m])
  for: 0m
  labels: { severity: warning }
  annotations: { summary: "Le conteneur {{ $labels.name }} redémarre en boucle" }

- alert: TlsCertExpiringSoon
  expr: probe_ssl_earliest_cert_expiry - time() < 14 * 86400
  for: 1h
  labels: { severity: warning }
  annotations: { summary: "Certificat de {{ $labels.instance }} expire dans < 14 jours" }
```

Alerte SLO multi-fenêtres (burn rate, intro) — SLO 99,5 % → budget d'erreur 0,5 % :

```yaml
- alert: ErrorBudgetBurnFast
  expr: |
    (job:http_errors:ratio5m > (14.4 * 0.005))
    and (job:http_errors:ratio1h > (14.4 * 0.005))
  labels: { severity: critical }
```

## 4. `alertmanager.yml`

```yaml
global:
  resolve_timeout: 5m
  smtp_smarthost: 'mailhog:1025'
  smtp_from: 'alertmanager@taskflow.local'
  smtp_require_tls: false

route:                                   # arbre de routage
  receiver: mail                         # receiver par défaut
  group_by: ['alertname', 'env']         # 1 notification par (alertname, env)
  group_wait: 30s                        # attente avant 1re notification d'un groupe
  group_interval: 5m                     # attente avant d'envoyer les nouvelles alertes du groupe
  repeat_interval: 4h                    # re-notification si toujours firing
  routes:
    - matchers: ['severity = critical']
      receiver: discord
      continue: true                     # continue vers les routes suivantes (mail aussi)
    - matchers: ['severity = critical']
      receiver: mail
    - matchers: ['alertname = Watchdog']
      receiver: 'null'                   # ou un receiver "dead man's switch" externe
      repeat_interval: 1m

receivers:
  - name: 'null'
  - name: mail
    email_configs:
      - to: 'ops@taskflow.local'
        send_resolved: true
  - name: discord
    discord_configs:
      - webhook_url: 'https://discord.com/api/webhooks/CHANGE_ME'   # → variable d'env / fichier secret hors dépôt
        send_resolved: true
  # - name: slack
  #   slack_configs:
  #     - api_url: 'https://hooks.slack.com/services/CHANGE_ME'
  #       channel: '#alertes'
  #       title: '{{ .CommonAnnotations.summary }}'
  #       text: '{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}'
  # - name: pagerduty
  #   pagerduty_configs:
  #     - routing_key: 'CHANGE_ME'
  # - name: webhook
  #   webhook_configs:
  #     - url: 'http://mon-service/hook'

inhibit_rules:                           # une critical masque les warning du même env
  - source_matchers: ['severity = critical']
    target_matchers: ['severity = warning']
    equal: ['env']
```

Secrets : `webhook_url_file:` / `api_url_file:` (fichier monté) plutôt qu'en clair ; ne jamais committer une URL de webhook réelle.

Timings à retenir : `group_wait` court (30 s), `group_interval` moyen (5 min), `repeat_interval` long (4 h–24 h selon la sévérité).

## 5. `amtool` et `promtool`

```bash
# Alertmanager
amtool check-config alertmanager.yml
amtool --alertmanager.url=http://localhost:9093 alert query                 # alertes actives
amtool --alertmanager.url=http://localhost:9093 silence add alertname=HostHighCpu env=staging \
       --duration=2h --author=fabrice --comment="maintenance"
amtool --alertmanager.url=http://localhost:9093 silence query
amtool --alertmanager.url=http://localhost:9093 silence expire <id>
amtool --alertmanager.url=http://localhost:9093 config routes test severity=critical env=prod   # quel receiver ?

# Prometheus
promtool check config prometheus.yml
promtool check rules rules/*.yml
promtool test rules tests/alerts.test.yml
```

Via Docker (sans installation) :

```bash
docker run --rm -v "$PWD/monitoring/prometheus:/p" prom/prometheus:v2.53.0 promtool check rules /p/rules/taskflow.yml
docker run --rm -v "$PWD/monitoring/alertmanager:/a" prom/alertmanager:v0.27.0 amtool check-config /a/alertmanager.yml
# depuis le compose démarré :
docker compose exec prometheus promtool check rules /etc/prometheus/rules/taskflow.yml
docker compose exec alertmanager amtool silence query
```

## 6. Tests unitaires de règles (`promtool test rules`)

`monitoring/prometheus/tests/alerts.test.yml` :

```yaml
rule_files:
  - ../rules/taskflow.yml
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
      - series: 'up{job="taskflow-api", instance="192.168.64.11:80", env="staging"}'
        values: '1 1 0 0 0'                     # tombe à 0 à t=2m
    alert_rule_test:
      - eval_time: 3m
        alertname: InstanceDown
        exp_alerts:
          - exp_labels: { severity: critical, job: taskflow-api, instance: "192.168.64.11:80", env: staging }
            exp_annotations: { summary: "taskflow-api/192.168.64.11:80 injoignable depuis 1 min" }
      - eval_time: 1m
        alertname: InstanceDown
        exp_alerts: []                          # pas encore firing
```

Lancer : `promtool test rules monitoring/prometheus/tests/alerts.test.yml` (les chemins de `rule_files` sont relatifs au fichier de test).

## 7. Valider dans le CI (job `lint-monitoring`)

```yaml
lint-monitoring:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: promtool check config
      uses: docker://prom/prometheus:v2.53.0
      with: { entrypoint: promtool, args: check config monitoring/prometheus/prometheus.yml }
    - name: promtool check rules
      uses: docker://prom/prometheus:v2.53.0
      with: { entrypoint: promtool, args: check rules monitoring/prometheus/rules/taskflow.yml }
    - name: promtool test rules
      uses: docker://prom/prometheus:v2.53.0
      with: { entrypoint: promtool, args: test rules monitoring/prometheus/tests/alerts.test.yml }
    - name: amtool check-config
      uses: docker://prom/alertmanager:v0.27.0
      with: { entrypoint: amtool, args: check-config monitoring/alertmanager/alertmanager.yml }
```

`promtool check config` échoue si `rule_files` référence des fichiers absents dans le contexte : utiliser des chemins relatifs cohérents ou `--lint-fatal`/`--syntax-only` selon le besoin.

## 8. Tester une alerte de bout en bout

1. Provoquer la panne : `ssh ubuntu@<staging> sudo systemctl stop taskflow-api`.
2. Prometheus → *Alerts* : `TaskFlowApiDown` passe **pending** (jaune) puis **firing** (rouge) après `for`.
3. Alertmanager (http://localhost:9093) : l'alerte apparaît, groupée ; *Status* montre la config chargée.
4. Notification : MailHog (http://localhost:8025) et/ou Discord.
5. Réparer : `sudo systemctl start taskflow-api` → alerte *resolved* (`send_resolved: true` envoie la résolution).
6. Pendant une maintenance planifiée : poser un **silence** (UI ou `amtool silence add`) avant l'intervention.

Simuler sans casser : `curl -X POST localhost:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[{"labels":{"alertname":"TestAlert","severity":"critical","env":"staging"},"annotations":{"summary":"test manuel"}}]'`.

## 9. Checklist anti-fatigue d'alerte

- [ ] Chaque alerte `critical` justifie de réveiller quelqu'un ; sinon c'est un `warning`.
- [ ] Chaque alerte a un `for`, un `runbook_url` et un propriétaire (label `team`).
- [ ] Les seuils viennent de l'historique (p95 réel, utilisation disque réelle), pas d'une intuition.
- [ ] Une alerte qui a sonné 3 fois sans action → supprimée, seuil relevé, ou transformée en dashboard.
- [ ] Inhibition configurée (une panne d'hôte n'envoie pas 15 alertes de services).
- [ ] `group_by` évite le spam par instance ; `repeat_interval` ≥ 4 h.
- [ ] `Watchdog` + vérification externe : on sait quand l'alerting est cassé.
- [ ] Les alertes sont versionnées et validées dans le CI ; les changements passent par une PR.
- [ ] Revue mensuelle : nombre d'alertes, temps de réponse, faux positifs.

## 10. Templates

**Runbook** (`docs/runbooks/<alerte>.md`) :

```markdown
# HighErrorRate
**Sévérité** : warning — **Propriétaire** : équipe web
## Symptôme
Taux d'erreurs 5xx > 5 % pendant 5 min sur l'API TaskFlow.
## Impact
Les utilisateurs voient des erreurs lors de la création/lecture de tâches.
## Diagnostic (5 min)
1. Dashboard « TaskFlow RED » → panel erreurs par route ; annotation de déploiement récente ?
2. `ssh ubuntu@<ip> sudo journalctl -u taskflow-api -n 100`
3. `curl -i http://<ip>/health`
## Actions
- Déploiement récent → rollback : `gh workflow run deploy.yml -f rollback_to=<N-1>`
- Sinon : redémarrer l'API `sudo systemctl restart taskflow-api`, escalader si persiste.
## Résolution et suivi
Vérifier le retour < 1 % ; ouvrir un post-mortem si impact > 30 min.
```

**Post-mortem sans blâme** :

```markdown
# Post-mortem — <titre> — <date>
**Durée** : détection hh:mm (MTTD : …) → résolution hh:mm (MTTR : …)
**Impact** : qui, combien de temps, quel pourcentage de requêtes.
## Chronologie
- hh:mm déploiement v42 (annotation Grafana)
- hh:mm alerte HighErrorRate firing → notification Discord
- hh:mm rollback vers v41
## Cause racine
(Ce qui a rendu l'incident possible, pas « qui ».)
## Ce qui a bien fonctionné / ce qui a manqué
## Actions (propriétaire, échéance)
- [ ] Ajouter un test sur … — @… — <date>
- [ ] Abaisser le seuil de … / ajouter l'alerte … — @… — <date>
```

**Métriques DORA** à suivre depuis le CI/CD + monitoring : fréquence de déploiement, lead time (commit → prod), taux d'échec des changements (déploiements suivis d'un rollback/incident), MTTR.
