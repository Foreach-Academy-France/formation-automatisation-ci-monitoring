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
# Jour 4 — Monitoring avancé, alerting & bonnes pratiques

**Automatisation du système CI & Monitoring**
M2 — ForEach Academy

Formateur : Fabrice Claeys

---

## Programme du Jour 4

| Créneau | Contenu |
|---------|---------|
| 09h00 – 09h45 | Surveillance de l'infrastructure : node_exporter, cAdvisor, blackbox, capacité |
| 09h45 – 11h00 | Alertes et notifications : règles Prometheus, Alertmanager |
| **11h00 – 11h15** | **Pause** |
| 11h15 – 11h45 | Analyse des tendances : annotations, logs, post-mortem, DORA |
| 11h45 – 12h15 | Bonnes pratiques : monitoring as code, checklist prod, synthèse |
| **12h15 – 13h15** | **Pause déjeuner** |
| 13h15 – 16h00 | **TP4** : Monitoring complet + alerting |
| 16h15 – 17h00 | **QCM final** (30 questions) |

---

## Où en est-on dans la chaîne ?

```
 commit ──► build ──► test ──► déploiement ──► monitoring ──► alerte
   J1         J1       J1          J2            J3          J4 ◄──
```

Hier : Prometheus scrape l'API TaskFlow (staging + prod) et les VMs (node_exporter), Grafana affiche le dashboard RED.

Mais **personne ne regarde un dashboard à 3 h du matin**.

> Aujourd'hui : les métriques deviennent des **alertes**, les alertes deviennent des **notifications**, et le déploiement laisse une **trace** sur les courbes.

---

<!-- _class: lead -->
# Surveillance de l'infrastructure

---

## node_exporter — CPU

`node_cpu_seconds_total{cpu="0", mode="idle|user|system|iowait|steal|…"}` : compteur de secondes passées dans chaque mode, **par cœur**.

```promql
# % CPU utilisé par VM (100 - % idle)
100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100

# Répartition par mode (user, system, iowait…) pour une VM
sum by (mode) (rate(node_cpu_seconds_total{instance="192.168.64.12:9100", mode!="idle"}[5m]))

# Load average (gauges) vs nombre de cœurs
node_load1 / count without (cpu, mode) (node_cpu_seconds_total{mode="idle"})
```

- `iowait` élevé → le disque ralentit le CPU ; `steal` élevé → l'hyperviseur vole du temps (VM surchargée)
- **Saturation** CPU = load1 > nombre de cœurs pendant plusieurs minutes

---

## node_exporter — mémoire

```promql
# % mémoire utilisée (MemAvailable tient compte du cache réutilisable)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# Mémoire disponible en octets (à tracer avec l'unité "bytes")
node_memory_MemAvailable_bytes

# Swap utilisé — signe de saturation
node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes

# Pression mémoire (PSI, noyau ≥ 4.20) : % du temps où des tâches ont attendu de la RAM
rate(node_pressure_memory_waiting_seconds_total[5m]) * 100
```

> Ne pas utiliser `MemFree` : Linux utilise volontairement la RAM « libre » comme cache disque. `MemAvailable` est la bonne mesure de ce qui est réellement disponible.

---

## node_exporter — disque et réseau

```promql
# % disque utilisé sur / (exclure tmpfs et overlay des conteneurs)
(1 - node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}
       / node_filesystem_size_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}) * 100

# Débit d'I/O disque (octets lus / écrits par seconde)
rate(node_disk_read_bytes_total[5m])
rate(node_disk_written_bytes_total[5m])

# % du temps où le disque est occupé (saturation I/O)
rate(node_disk_io_time_seconds_total[5m]) * 100

# Réseau : octets reçus / émis par seconde (hors loopback)
rate(node_network_receive_bytes_total{device!="lo"}[5m])
rate(node_network_transmit_bytes_total{device!="lo"}[5m])

# Erreurs et paquets perdus
rate(node_network_receive_errs_total[5m]) + rate(node_network_receive_drop_total[5m])
```

---

## Méthode USE appliquée à node_exporter

| Ressource | **U**tilization | **S**aturation | **E**rrors |
|-----------|-----------------|----------------|------------|
| **CPU** | `100 - idle %` | `node_load1` > nb cœurs | — |
| **Mémoire** | `1 - MemAvailable/MemTotal` | swap utilisé, PSI, OOM kills (`node_vmstat_oom_kill`) | — |
| **Disque** | `1 - avail/size` | `io_time` %, file d'attente | `node_disk_io_errors` (selon kernel) |
| **Réseau** | `receive/transmit_bytes` vs bande passante | drops | `receive_errs`, `transmit_errs` |

- Le dashboard **Node Exporter Full (1860)** implémente exactement cette grille
- Un « panel par ressource × USE » = vue infra complète en 12 panels

---

## cAdvisor — les conteneurs

**cAdvisor** (Google) expose les métriques de chaque conteneur de l'hôte Docker (CPU, mémoire, réseau, filesystem, redémarrages).

```yaml
# monitoring/docker-compose.yml (extrait)
cadvisor:
  image: gcr.io/cadvisor/cadvisor:v0.49.1
  ports: ["8081:8080"]
  volumes:
    - /:/rootfs:ro
    - /var/run:/var/run:ro
    - /sys:/sys:ro
    - /var/lib/docker/:/var/lib/docker:ro
```

```promql
# CPU par conteneur (cœurs utilisés)
sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[5m]))

# Mémoire par conteneur vs limite
container_memory_working_set_bytes{name!=""} / container_spec_memory_limit_bytes{name!=""} > 0

# Conteneur qui redémarre en boucle
increase(container_start_time_seconds{name!=""}[10m]) > 0
```

> Alternative légère : `dockerd --metrics-addr 0.0.0.0:9323` expose des métriques du démon Docker (moins détaillées).

---

## blackbox_exporter — vu de l'extérieur

Sonde **synthétique** : Prometheus demande à blackbox_exporter de tester une cible (HTTP, TCP, ICMP, DNS) et récupère le résultat en métriques.

```yaml
# monitoring/blackbox/blackbox.yml
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: []       # défaut : 2xx
      method: GET
      follow_redirects: true
      fail_if_ssl: false
```

```
probe_success                     1      ← 1 = OK, 0 = KO  (LA métrique d'uptime)
probe_duration_seconds            0.043
probe_http_status_code            200
probe_ssl_earliest_cert_expiry    1.76e9 ← date d'expiration TLS (epoch)
```

---

## blackbox_exporter — le relabeling

Prometheus doit scraper **blackbox** en lui passant la **cible** en paramètre `?target=…` :

```yaml
# monitoring/prometheus/prometheus.yml
- job_name: blackbox
  metrics_path: /probe
  params:
    module: [http_2xx]
  static_configs:
    - targets: ['http://192.168.64.11/health']
      labels: { env: staging }
    - targets: ['http://192.168.64.12/health']
      labels: { env: prod }
  relabel_configs:
    - source_labels: [__address__]         # l'URL cible…
      target_label: __param_target         # …devient le paramètre ?target=
    - source_labels: [__param_target]
      target_label: instance               # …et le label instance (lisible)
    - target_label: __address__
      replacement: blackbox-exporter:9115  # le vrai endpoint scrapé
```

> `relabel_configs` s'exécute **avant** le scrape : on réécrit l'adresse. C'est le mécanisme standard pour tous les exporters « multi-cibles » (blackbox, snmp).

---

## Capacité et tendances : `predict_linear()`

```promql
# Octets disponibles sur / dans 4 heures, par régression linéaire sur la dernière heure
predict_linear(node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}[1h], 4 * 3600)

# Alerte : le disque sera plein dans moins de 4 h
predict_linear(node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}[1h], 4 * 3600) < 0

# Croissance du nombre de séries Prometheus sur 7 jours
predict_linear(prometheus_tsdb_head_series[7d], 30 * 24 * 3600)
```

- Alerter sur **« sera plein dans X h »** vaut mieux que « 90 % utilisé » : un disque de 10 To à 90 % peut tenir des mois, un disque de 20 Go à 60 % peut être plein dans une heure
- Tendances longues (7 j / 30 j) dans Grafana : saisonnalité (pics le lundi matin), croissance → dimensionnement
- Prévoir la **rétention** en conséquence (15 j par défaut ne montrent pas une tendance mensuelle)

---

## À retenir — Infrastructure

- **node_exporter** couvre CPU / mémoire / disque / réseau ; appliquer la grille **USE**
- `MemAvailable` (pas `MemFree`), `mode="idle"` pour le CPU, exclure `tmpfs|overlay` pour les disques
- **cAdvisor** : métriques par conteneur (CPU, mémoire vs limite, redémarrages)
- **blackbox_exporter** : sondes HTTP/TCP/ICMP ; `probe_success` = l'uptime ; relabeling pour passer la cible
- `predict_linear()` : alerter sur ce qui **va** arriver, pas seulement sur ce qui est arrivé

---

<!-- _class: lead -->
# Alertes et notifications

---

## La chaîne d'alerting

```
┌────────────┐  évalue les règles   ┌──────────────┐  groupe / route   ┌──────────────┐
│ PROMETHEUS │ ───────────────────► │ ALERTMANAGER │ ────────────────► │  RECEIVERS   │
│ rules/*.yml│  toutes les 15 s     │ :9093        │                   │ Discord/Slack│
│            │  pending → firing    │ silences,    │                   │ e-mail       │
│            │                      │ inhibition   │                   │ PagerDuty    │
└────────────┘                      └──────────────┘                   └──────────────┘
```

| Responsabilité | Prometheus | Alertmanager |
|----------------|-----------|--------------|
| Décider **si** une alerte est active | ✅ (`expr`, `for`) | |
| Décider **qui** prévenir, **quand**, **comment** | | ✅ (routes, receivers) |
| Dédoublonner, grouper, faire taire | | ✅ |

---

## Une règle d'alerte

```yaml
# monitoring/prometheus/rules/taskflow.yml
groups:
  - name: taskflow.alerts
    rules:
      - alert: TaskFlowApiDown
        expr: probe_success{job="blackbox"} == 0
        for: 1m                                  # doit rester vrai 1 min → évite les faux positifs
        labels:
          severity: critical                     # utilisé par le routage Alertmanager
          team: web
        annotations:
          summary: "API TaskFlow injoignable ({{ $labels.env }})"
          description: "{{ $labels.instance }} ne répond plus depuis 1 min (valeur : {{ $value }})."
          runbook_url: "https://github.com/<vous>/taskflow-ops/blob/main/docs/runbooks/api-down.md"
```

- `expr` : une requête PromQL ; chaque série retournée = **une alerte** (avec ses labels)
- États : **inactive** → **pending** (expr vraie, `for` pas écoulé) → **firing**
- `annotations` : texte pour les humains (templating Go : `{{ $labels.x }}`, `{{ $value }}`)

---

## Le catalogue d'alertes du TP

| Alerte | `expr` (résumé) | `for` | severity |
|--------|-----------------|-------|----------|
| `Watchdog` | `vector(1)` — toujours active : prouve que la chaîne fonctionne | — | none |
| `InstanceDown` | `up == 0` | 1m | critical |
| `TaskFlowApiDown` | `probe_success == 0` | 1m | critical |
| `HighErrorRate` | ratio 5xx / total `> 0.05` | 5m | warning |
| `HighLatencyP95` | `histogram_quantile(0.95, …) > 0.3` | 5m | warning |
| `HostHighCpu` | `100 - idle % > 80` | 10m | warning |
| `HostOutOfMemory` | `MemAvailable / MemTotal < 0.10` | 5m | warning |
| `DiskWillFillIn4h` | `predict_linear(avail[1h], 4h) < 0` | 5m | warning |
| `ContainerRestarting` | `increase(container_start_time_seconds[10m]) > 0` | — | warning |

> Chaque alerte a un **`summary`**, une **`description`** et un **`runbook_url`** : celui qui la reçoit doit savoir quoi faire.

---

## Recording rules — précalculer

Une requête lourde évaluée dans 5 panels et 3 alertes = 8 fois le calcul. Une **recording rule** la calcule une fois et la stocke sous un nouveau nom.

```yaml
groups:
  - name: taskflow.rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job, env) (rate(http_requests_total[5m]))

      - record: job:http_errors:ratio5m
        expr: |
          sum by (job, env) (rate(http_requests_total{status_code=~"5.."}[5m]))
            /
          sum by (job, env) (rate(http_requests_total[5m]))
```

```yaml
      # l'alerte devient triviale et rapide
      - alert: HighErrorRate
        expr: job:http_errors:ratio5m > 0.05
```

- Convention de nommage : `niveau:métrique:opération` (`job:http_errors:ratio5m`)

---

## Alertmanager — la configuration

```yaml
# monitoring/alertmanager/alertmanager.yml
global:
  smtp_smarthost: 'mailhog:1025'
  smtp_from: 'alertmanager@taskflow.local'
  smtp_require_tls: false

route:                                   # arbre de routage
  receiver: mail                         # receveur par défaut
  group_by: ['alertname', 'env']         # 1 notification par (alerte, env)
  group_wait: 30s                        # attendre 30 s pour regrouper les premières alertes
  group_interval: 5m                     # nouvelles alertes du même groupe : au plus toutes les 5 min
  repeat_interval: 4h                    # re-notifier une alerte toujours active toutes les 4 h
  routes:
    - matchers: ['severity="critical"']
      receiver: discord
      continue: true                     # …et continuer vers le receveur par défaut (mail)

receivers:
  - name: mail
    email_configs:
      - to: 'ops@taskflow.local'
  - name: discord
    discord_configs:
      - webhook_url: 'https://discord.com/api/webhooks/CHANGE_ME'
```

---

## Receivers : où envoyer

| Receiver | Config | Usage |
|----------|--------|-------|
| **Discord** | `discord_configs: webhook_url` | Salon d'équipe (natif depuis 0.25) |
| **Slack** | `slack_configs: api_url, channel` | Idem |
| **E-mail** | `email_configs: to` + `global.smtp_*` | Trace écrite, MailHog en lab |
| **PagerDuty / Opsgenie** | `pagerduty_configs: routing_key` | Astreinte, escalade, accusé de réception |
| **Webhook générique** | `webhook_configs: url` | n8n, script maison, ticketing |
| **Telegram, Teams, WeChat, Pushover…** | intégrés | |

```yaml
  - name: slack
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/T000/B000/XXXX'
        channel: '#alertes'
        title: '{{ .CommonLabels.alertname }} ({{ .CommonLabels.env }})'
        text: '{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}'
```

---

## Grouping, timing et inhibition

**Pourquoi grouper ?** Si un switch tombe, 50 `InstanceDown` partent en même temps : 1 notification groupée plutôt que 50 messages.

| Paramètre | Rôle | Valeur typique |
|-----------|------|----------------|
| `group_by` | Clé de regroupement | `['alertname', 'env']` |
| `group_wait` | Délai avant la 1re notification d'un groupe (laisser arriver les alertes liées) | 30 s |
| `group_interval` | Délai minimum entre deux notifications pour un groupe modifié | 5 min |
| `repeat_interval` | Rappel d'une alerte toujours active | 4 h |

```yaml
inhibit_rules:                            # si critical est active, taire les warning du même env
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: ['env']
```

> Si `TaskFlowApiDown` (critical) est active sur prod, inutile de recevoir aussi `HighErrorRate` (warning) sur prod : l'inhibition la masque.

---

## Silences et `amtool`

**Silence** : couper les notifications pendant une maintenance planifiée, sans toucher aux règles.

```bash
# Via l'UI : http://localhost:9093 → Silences → New silence (matchers + durée + commentaire)

# Via amtool (dans le conteneur Alertmanager)
docker compose exec alertmanager amtool --alertmanager.url=http://localhost:9093 \
  silence add env=staging alertname=~".+" --duration=2h --comment="Maintenance VM staging"

docker compose exec alertmanager amtool --alertmanager.url=http://localhost:9093 alert   # alertes actives
docker compose exec alertmanager amtool --alertmanager.url=http://localhost:9093 silence # silences
docker compose exec alertmanager amtool check-config /etc/alertmanager/alertmanager.yml  # valider
```

- Un silence a toujours un **auteur**, un **commentaire** et une **fin** : jamais de silence permanent
- Un silence oublié = une panne non détectée

---

## Symptômes plutôt que causes

<div class="columns">
<div>

### ❌ Alerter sur les causes
- « CPU > 80 % »
- « 200 connexions ouvertes »
- « Mémoire à 90 % »

Souvent **sans impact** utilisateur → bruit, ignoré, puis la vraie panne passe inaperçue.

</div>
<div>

### ✅ Alerter sur les symptômes
- « Taux d'erreur > 5 % » (SLO)
- « p95 > 300 ms » (SLO)
- « `probe_success == 0` » (dispo)

Toujours **lié à l'expérience utilisateur** → chaque alerte mérite une action.

</div>
</div>

> Les métriques de cause (CPU, RAM) restent utiles sur les **dashboards** pour diagnostiquer, et en alerte **prédictive** (« disque plein dans 4 h »).

---

## Burn rate multi-fenêtres (intro)

SLO 99,5 % sur 30 jours → budget d'erreur 0,5 %. Le **burn rate** = vitesse de consommation du budget (1 = consommé exactement en 30 j).

| Burn rate | Budget épuisé en | Fenêtres (longue / courte) | Severity |
|-----------|------------------|----------------------------|----------|
| 14,4 | 2 jours | 1 h / 5 min | **page** (réveiller quelqu'un) |
| 6 | 5 jours | 6 h / 30 min | page |
| 1 | 30 jours | 3 j / 6 h | ticket |

```promql
# Alerte "page" : le taux d'erreur dépasse 14,4 × 0,5 % sur 1 h ET sur 5 min
(job:http_errors:ratio1h > 14.4 * 0.005) and (job:http_errors:ratio5m > 14.4 * 0.005)
```

- Fenêtre longue : évite de réagir à un pic isolé ; fenêtre courte : s'arrête vite quand c'est réparé
- Référence : *SRE Workbook*, chapitre « Alerting on SLOs »

---

## Éviter la fatigue d'alerte

| Symptôme | Remède |
|----------|--------|
| Alertes qui « flappent » (on/off) | `for: 5m`, seuils avec hystérésis, `rate` sur fenêtre plus large |
| Alertes ignorées « c'est normal » | Supprimer ou transformer en dashboard ; une alerte = une action |
| 50 notifications pour une cause | `group_by`, `inhibit_rules` |
| Réveil pour un problème non urgent | `severity: warning` → ticket ; `critical` → page |
| « Que dois-je faire ? » | `runbook_url` obligatoire sur chaque alerte |
| Alertes de nuit sur staging | Route avec `matchers: env="staging"` → salon Discord seulement, `repeat_interval: 24h` |

> Règle d'or : **chaque alerte reçue doit nécessiter une action humaine immédiate et intelligente**. Sinon, ce n'est pas une alerte.

---

## Démo live — de la panne à Discord

```bash
# 1. Tout est vert
open http://localhost:9090/alerts        # Watchdog firing, le reste inactive

# 2. Couper l'API sur staging
multipass exec taskflow-web1 -- sudo systemctl stop taskflow-api

# 3. Observer : ~15 s → TaskFlowApiDown "pending" ; +1 min → "firing"
# 4. Alertmanager :9093 → alerte reçue, groupée par (alertname, env)
# 5. group_wait 30 s → message Discord + mail dans MailHog :8025

# 6. Poser un silence sur env=staging, réparer
multipass exec taskflow-web1 -- sudo systemctl start taskflow-api
# 7. Alerte "resolved" → notification de résolution (send_resolved: true)
```

> Chronométrer le **temps de détection** (MTTD) : ici ~1 min 45 s (scrape 15 s + `for` 1 min + `group_wait` 30 s). C'est un choix : plus court = plus de faux positifs.

---

## À retenir — Alerting

- **Prometheus** décide *si* (règles `expr` + `for`), **Alertmanager** décide *qui / quand / comment*
- Une alerte = labels (`severity`) + annotations (`summary`, `description`, `runbook_url`)
- **Recording rules** pour précalculer les requêtes réutilisées
- Alertmanager : `route` (arbre, matchers), `receivers`, `group_by` / `group_wait` / `repeat_interval`, `inhibit_rules`, **silences**
- Alerter sur les **symptômes** (SLO) ; les causes vont sur les dashboards
- `Watchdog` toujours active = preuve que la chaîne fonctionne

---

<!-- _class: lead -->
# Analyse des tendances et du comportement

---

## Corréler déploiements et incidents

La cause n°1 des incidents en production : **un changement**. Il faut voir les déploiements *sur* les courbes.

```yaml
# .github/workflows/deploy.yml — job final
annotate-grafana:
  runs-on: [self-hosted, lab]
  needs: [deploy-prod]
  if: always() && needs.deploy-prod.result == 'success'
  steps:
    - name: Annotation Grafana
      run: |
        curl -fsS -X POST "${{ vars.GRAFANA_URL }}/api/annotations" \
          -H "Authorization: Bearer ${{ secrets.GRAFANA_TOKEN }}" \
          -H "Content-Type: application/json" \
          -d '{"tags":["deploy","prod"],
               "text":"Déploiement #${{ github.run_number }} (${{ github.sha }}) par ${{ github.actor }}"}'
```

- Token : Grafana → *Administration → Service accounts* → rôle Editor → token → secret `GRAFANA_TOKEN`
- Dans le dashboard : *Settings → Annotations → Grafana → filter by tags `deploy`* → ligne verticale sur tous les panels
- Une courbe qui se dégrade **juste après** la ligne → rollback (J2) sans chercher plus loin

---

## Logs : Loki + Promtail (bonus TP)

Les métriques disent **qu'il y a** des erreurs ; les logs disent **lesquelles**.

```
  API TaskFlow ──stdout/journald──► Promtail ──push──► Loki ◄──query── Grafana
                                    (agent)            (index labels,
                                                        stockage chunks)
```

- **Loki** : « Prometheus pour les logs » — indexe uniquement les **labels** (`job`, `env`, `host`), pas le texte → léger
- **Promtail** : lit les fichiers / journald, ajoute des labels, envoie à Loki
- **LogQL** : même esprit que PromQL

```logql
{job="taskflow-api", env="prod"} |= "error"                        # filtre texte
{job="taskflow-api"} | json | status_code >= 500                    # parser JSON
sum by (env) (rate({job="taskflow-api"} |= "error" [5m]))           # métriques depuis les logs
```

> Traces (OpenTelemetry + Tempo/Jaeger) : le 3e pilier, hors périmètre. Même logique : corréler via des labels communs (`env`, `trace_id`).

---

## Post-mortem sans blâme

Après chaque incident significatif, un document court :

| Section | Contenu |
|---------|---------|
| **Résumé** | Quoi, quand, impact (utilisateurs, durée, SLO consommé) |
| **Chronologie** | Horodatée : détection, escalade, actions, résolution |
| **Cause racine** | Technique **et** organisationnelle (« pourquoi le test ne l'a pas vu ? ») |
| **Ce qui a bien marché** | L'alerte a sonné en 2 min, le rollback a pris 3 min |
| **Actions** | Concrètes, avec un responsable et une date : nouvelle alerte, test, runbook |

- **Sans blâme** : on cherche les défauts du *système*, pas les fautes des personnes — sinon plus personne ne dit la vérité
- Métriques d'incident : **MTTD** (temps de détection), **MTTR** (temps de rétablissement), **MTBF** (temps entre pannes)

---

## DORA metrics : le lien CI/CD ↔ monitoring

| Métrique | Question | Source |
|----------|----------|--------|
| **Deployment frequency** | À quelle fréquence déploie-t-on en prod ? | Runs de `deploy.yml` (annotations Grafana !) |
| **Lead time for changes** | Délai commit → prod | Timestamp commit vs fin du job `deploy-prod` |
| **Change failure rate** | % de déploiements suivis d'un incident / rollback | Runs `rollback` / runs `deploy` |
| **Time to restore** (MTTR) | Délai incident → rétablissement | Alerte firing → resolved |

| Niveau | Fréquence | Lead time | CFR | MTTR |
|--------|-----------|-----------|-----|------|
| Élite | à la demande (plusieurs/jour) | < 1 h | 0-15 % | < 1 h |
| Faible | < 1/mois | > 6 mois | > 30 % | > 1 semaine |

> Les 4 jours de ce cours construisent exactement les outils qui permettent de **mesurer** ces 4 métriques. Automatisation et monitoring sont les deux faces de la même pièce.

---

## À retenir — Tendances

- **Annotations** de déploiement sur les dashboards : la corrélation la plus rentable qui existe
- **Loki / LogQL** : les logs avec les mêmes labels que les métriques → navigation métrique → log
- **Post-mortem** sans blâme : chronologie, cause racine, actions datées
- **DORA** : fréquence, lead time, taux d'échec, MTTR — mesurables avec ce qu'on a construit

---

<!-- _class: lead -->
# Bonnes pratiques pour un monitoring proactif

---

## Monitoring as code

Tout ce qui définit le monitoring vit **dans le repo**, revu et testé comme le code :

```
monitoring/
├── docker-compose.yml                 ← la stack
├── prometheus/prometheus.yml          ← cibles
├── prometheus/rules/taskflow.yml      ← alertes + recording rules
├── alertmanager/alertmanager.yml      ← routage
├── blackbox/blackbox.yml
└── grafana/provisioning/              ← datasources + dashboards JSON
```

| Avantage | Conséquence |
|----------|-------------|
| Revue par PR | « Pourquoi ce seuil à 80 % ? » se discute avant la mise en prod |
| Historique Git | Qui a désactivé cette alerte, et quand ? |
| Reproductible | Même stack en local, staging, prod |
| **Testable dans le CI** | Une règle mal écrite ne part jamais en prod |

---

## Valider les règles dans le CI

```yaml
# .github/workflows/ci.yml — job ajouté au J4
lint-monitoring:
  name: Lint monitoring
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: promtool check rules
      uses: docker://prom/prometheus:v2.53.0
      with:
        entrypoint: promtool
        args: check rules monitoring/prometheus/rules/taskflow.yml

    - name: promtool check config
      uses: docker://prom/prometheus:v2.53.0
      with:
        entrypoint: promtool
        args: check config --syntax-only monitoring/prometheus/prometheus.yml

    - name: amtool check-config
      uses: docker://prom/alertmanager:v0.27.0
      with:
        entrypoint: amtool
        args: check-config monitoring/alertmanager/alertmanager.yml
```

> `uses: docker://image` lance un conteneur avec le workspace monté : pas d'installation, versions épinglées.

---

## Tester les alertes : `promtool test rules`

On peut **tester unitairement** une règle avec des séries simulées :

```yaml
# monitoring/prometheus/tests/taskflow_test.yml
rule_files:
  - ../rules/taskflow.yml
evaluation_interval: 15s
tests:
  - interval: 15s
    input_series:
      - series: 'probe_success{job="blackbox", env="prod", instance="http://192.168.64.12/health"}'
        values: '1 1 1 0 0 0 0 0 0'            # OK 45 s, puis KO 90 s
    alert_rule_test:
      - eval_time: 2m
        alertname: TaskFlowApiDown
        exp_alerts:
          - exp_labels: { severity: critical, env: prod, job: blackbox,
                          instance: "http://192.168.64.12/health" }
            exp_annotations:
              summary: "API TaskFlow injoignable (prod)"
```

```bash
promtool test rules monitoring/prometheus/tests/taskflow_test.yml   # → SUCCESS
```

---

## Monitorer le monitoring

| Risque | Parade |
|--------|--------|
| Prometheus ne scrape plus une cible | Alerte `InstanceDown` sur `up == 0` |
| La cible a **disparu** de la config (plus de série `up` du tout) | `absent(up{job="taskflow-api"})` |
| Prometheus est lui-même tombé | **Watchdog** : alerte toujours active → un service externe (Healthchecks.io, PagerDuty *dead man's switch*) alerte s'il **cesse** de la recevoir |
| Alertmanager ne notifie plus | Idem Watchdog ; `alertmanager_notifications_failed_total` |
| Disque Prometheus plein | `DiskWillFillIn4h` sur le serveur de monitoring |
| Trop de séries (cardinalité) | `prometheus_tsdb_head_series`, `scrape_samples_scraped` |

```yaml
- alert: Watchdog
  expr: vector(1)
  labels: { severity: none }
  annotations:
    summary: "Alerte permanente : si elle disparaît, la chaîne d'alerting est cassée"
```

---

## Rétention, stockage et sécurité

**Rétention**
- Par défaut 15 j ; `--storage.tsdb.retention.time=90d` ou `retention.size=50GB`
- Long terme / multi-sites : **Thanos**, **Cortex/Mimir**, **VictoriaMetrics** (remote write vers un stockage objet) — mention

**Sécurité**
- Prometheus et Alertmanager n'ont **pas d'authentification** native : reverse proxy (nginx + basic auth / OIDC) ou réseau privé, jamais exposés sur Internet
- Grafana : changer `admin/admin`, SSO (OAuth/OIDC), rôles Viewer/Editor/Admin, **service accounts** pour les scripts (le token du workflow)
- Secrets (webhooks, SMTP) : fichiers `_file` ou variables d'environnement, jamais dans Git en clair
- Exporters : restreindre les ports 9100/9115/8080 au serveur Prometheus (UFW / security group)

---

## Checklist « prêt pour la prod »

- [ ] Chaque service expose `/metrics` (RED) et `/health` (blackbox)
- [ ] Chaque hôte a node_exporter ; chaque hôte Docker a cAdvisor
- [ ] Dashboard **vue d'ensemble** (1 écran) + dashboards détail par service
- [ ] SLO écrits ; alertes sur les **symptômes** avec `for`, `severity`, `runbook_url`
- [ ] Alerte `Watchdog` + dead man's switch externe
- [ ] Routage : critical → astreinte, warning → salon/ticket ; staging ne réveille personne
- [ ] Annotations de déploiement automatiques
- [ ] Config de monitoring versionnée, validée par `promtool` / `amtool` dans le CI
- [ ] Rétention adaptée ; sauvegardes des dashboards (JSON) ; accès sécurisés
- [ ] Post-mortem après chaque incident ; revue trimestrielle des alertes (supprimer celles jamais actionnées)

---

## Synthèse des 4 jours — la chaîne complète

```
   git push
      │
      ▼
 ┌─────────────┐   workflow réutilisable    ┌──────────────┐
 │  ci.yml     │ lint → test → build →      │ artefact     │  J1
 │ (+ lint-    │ promtool/amtool            │ dist + api   │
 │  monitoring)│                            └──────┬───────┘
 └─────────────┘                                   │
      ▼                                            ▼
 ┌─────────────┐  runner self-hosted + Ansible  ┌───────────────────┐
 │ deploy.yml  │ ──────────────────────────────►│ taskflow-web1     │  J2
 │ staging →   │  environments, approbation,    │ taskflow-web2     │
 │ approve →   │  smoke test, rollback          │ nginx + API +     │
 │ prod        │                                │ node_exporter     │
 └──────┬──────┘                                └────────┬──────────┘
        │ annotation                                     │ scrape /metrics, :9100, /health
        ▼                                                ▼
 ┌─────────────┐        ┌─────────────┐ règles  ┌──────────────┐ Discord / mail
 │  Grafana    │◄───────│ Prometheus  │────────►│ Alertmanager │──────────────►  J3 + J4
 └─────────────┘        └─────────────┘         └──────────────┘
```

---

## Synthèse du Jour 4

- **Infra** : USE avec node_exporter, cAdvisor pour les conteneurs, blackbox pour l'uptime, `predict_linear` pour la capacité
- **Alertes** : Prometheus évalue, Alertmanager route ; symptômes > causes ; `for`, `severity`, `runbook_url`
- **Notifications** : grouping, inhibition, silences — contre la fatigue d'alerte
- **Tendances** : annotations de déploiement, logs Loki, post-mortem, DORA
- **Monitoring as code** : tout versionné, `promtool`/`amtool` dans le CI, Watchdog
- Un déploiement automatisé **et** surveillé : c'est ce que le titre du cours appelle « automatisation du système CI et monitoring »

---

<!-- _class: lead -->
# TP de l'après-midi

---

## TP4 — Monitoring complet + alerting (2h45)

| Étape | Contenu | Durée |
|-------|---------|-------|
| 1 | Ajouter cAdvisor + blackbox_exporter (+ Alertmanager, MailHog) à la stack ; jobs Prometheus ; panels infra | 30 min |
| 2 | `rules/taskflow.yml` : `InstanceDown`, `TaskFlowApiDown`, `HighErrorRate`, `HighLatencyP95`, `DiskWillFillIn4h`, `HostHighCpu` ; job CI `lint-monitoring` (`promtool` + `amtool` via `docker://`) | 45 min |
| 3 | Alertmanager : route par `severity`, receiver Discord/Slack + MailHog ; couper l'API → recevoir l'alerte ; poser un silence | 45 min |
| 4 | Job `annotate-grafana` dans `deploy.yml` (secret `GRAFANA_TOKEN`, variable `GRAFANA_URL`) ; vérifier la corrélation déploiement ↔ courbes | 30 min |
| Bonus | Loki + Promtail : logs de l'API dans Grafana | 15 min |

**Livrable** : monitoring complet (infra + app + uptime), alertes routées et notifiées, règles validées par le CI, annotations de déploiement — **repo final rendu** (état évalué sur 100 points).

---

## QCM final — 16h15 – 17h00

| Paramètre | Valeur |
|-----------|--------|
| Questions | 30, une seule bonne réponse parmi 4 (A/B/C/D) |
| Durée | 45 minutes |
| Sections | 1. Automatisation CI & runners · 2. Build, test, pipeline as code · 3. Déploiement & configuration · 4. Monitoring, Prometheus, PromQL, Grafana · 5. Alerting & bonnes pratiques |
| Validation | ≥ 15 / 30 (= 10/20) |
| Support | Aucun document ; pas de pénalité pour une mauvaise réponse |

> Le QCM et le TP fil rouge sont **deux notes indépendantes**, chacune validée à partir de 10/20.

---

<!-- _class: lead -->
# Questions ?

Merci pour ces quatre jours.

**Rendu du TP fil rouge** : URL du repo `taskflow-ops` avec l'état final (workflows, Ansible, API instrumentée, stack monitoring).

Formateur : Fabrice Claeys — ForEach Academy
