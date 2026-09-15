# QCM — Formation M2 DevOps : Automatisation du système CI et monitoring

**Durée** : 45 minutes
**Questions** : 30
**Validation** : Note >= 10/20

> Chaque question comporte **une seule bonne réponse** parmi les quatre
> propositions. Aucune pénalité pour les mauvaises réponses.

---

## Section 1 — Automatisation du système CI, runners, sécurité

**1.** Quelle est la différence fondamentale entre un runner *GitHub-hosted*
(`ubuntu-latest`) et un runner *self-hosted* ?

A. Le runner self-hosted ne peut exécuter que des workflows `workflow_dispatch`.
B. Le runner self-hosted est une machine que vous installez et maintenez vous-même ; il peut accéder à votre réseau privé.
C. Le runner GitHub-hosted est facturé à l'installation, le self-hosted est gratuit sans limite.
D. Le runner self-hosted ne supporte pas les actions du Marketplace.

---

**2.** Dans le fil rouge, pourquoi le job `deploy-staging` doit-il tourner sur
un runner self-hosted plutôt que sur `ubuntu-latest` ?

A. Parce qu'Ansible ne peut pas être installé sur les runners GitHub-hosted.
B. Parce que les runners GitHub-hosted n'ont pas le droit d'utiliser des secrets.
C. Parce que les VMs Multipass du lab sont sur un réseau privé, injoignable depuis les datacenters GitHub.
D. Parce que `download-artifact` ne fonctionne que sur les runners self-hosted.

---

**3.** Quel est le principal risque de sécurité d'un runner self-hosted
attaché à un dépôt **public** ?

A. N'importe qui peut ouvrir une pull request depuis un fork et faire exécuter du code arbitraire sur votre machine.
B. Les logs des runs deviennent visibles par tous les utilisateurs GitHub.
C. Le runner publie automatiquement ses variables d'environnement dans le README.
D. GitHub désactive le chiffrement des secrets pour les dépôts publics.

---

**4.** Dans la correspondance Jenkins ↔ GitHub Actions, quel est l'équivalent
du `Jenkinsfile` ?

A. Le fichier `action.yml` d'une action composite.
B. Le fichier `.github/CODEOWNERS`.
C. Le fichier `.env` du runner.
D. Un fichier de workflow YAML dans `.github/workflows/`.

---

**5.** À quoi sert la clé `permissions:` au niveau d'un workflow ou d'un job ?

A. À définir les droits Unix des fichiers créés dans le workspace.
B. À restreindre (ou étendre) les droits du `GITHUB_TOKEN` fourni au job, selon le principe du moindre privilège.
C. À indiquer quels utilisateurs peuvent déclencher le workflow.
D. À autoriser le runner à installer des paquets système.

---

**6.** Comment un job cible-t-il un runner self-hosted précis ?

A. Par son adresse IP dans `runs-on`.
B. Par son nom d'hôte dans `environment`.
C. Par ses **labels** dans `runs-on`, par exemple `runs-on: [self-hosted, lab]`.
D. Par un secret `RUNNER_TOKEN` référencé dans le job.

---

## Section 2 — Build, test, workflows réutilisables

**7.** Pourquoi utiliser `npm ci` plutôt que `npm install` dans un pipeline CI ?

A. `npm ci` installe exactement les versions du lockfile et échoue si `package.json` et le lockfile sont incohérents : le build est reproductible.
B. `npm ci` est plus lent mais installe aussi les dépendances globales.
C. `npm ci` met à jour le lockfile automatiquement vers les dernières versions.
D. `npm ci` ne fonctionne que sur les runners self-hosted.

---

**8.** Dans une **action composite**, quelle clé est obligatoire sur chaque
step `run:` ?

A. `working-directory`
B. `shell`
C. `timeout-minutes`
D. `continue-on-error`

---

**9.** Comment déclare-t-on et appelle-t-on un **workflow réutilisable** ?

A. Il se déclare avec `on: workflow_dispatch` et s'appelle avec `uses:` dans un step.
B. Il se déclare avec `on: push` et s'appelle avec `needs:`.
C. Il se déclare avec `runs: using: composite` et s'appelle avec `uses:` dans un step.
D. Il se déclare avec `on: workflow_call` et s'appelle avec `jobs.<id>.uses: ./.github/workflows/<fichier>.yml`.

---

**10.** Que produit cette configuration ?

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

A. Les jobs du workflow s'exécutent un par un au lieu d'en parallèle.
B. Le workflow ne peut être lancé qu'une fois par jour et par branche.
C. Un nouveau push sur la même branche annule le run encore en cours de cette branche.
D. Le workflow refuse de démarrer si un autre workflow tourne sur le dépôt.

---

**11.** À quoi sert le rapport de tests au format **JUnit XML** dans un pipeline ?

A. C'est un format standard que le CI (GitHub Actions, Jenkins, GitLab…) sait lire pour publier les résultats de tests, indépendamment du framework.
B. Il remplace la couverture de code.
C. Il n'est lisible que par des projets Java.
D. Il sert à stocker les artefacts de build.

---

**12.** Que fait la commande `mvn -B verify` dans un job de CI Java ?

A. Elle déploie l'artefact sur le dépôt Maven distant.
B. Elle exécute le lifecycle Maven jusqu'à la phase `verify` (compilation, tests unitaires et d'intégration inclus), en mode non interactif (`-B`).
C. Elle ne vérifie que la syntaxe du `pom.xml`.
D. Elle télécharge les dépendances sans compiler.

---

## Section 3 — Déploiement automatisé et gestion des configurations

**13.** Que signifie le principe « build once, deploy many » ?

A. On construit une image par environnement pour tenir compte des différences de configuration.
B. On lance plusieurs builds en parallèle pour aller plus vite.
C. Un seul artefact est produit par le CI, puis ce **même** artefact est promu de staging vers la production sans être reconstruit.
D. On déploie plusieurs versions simultanément sur le même serveur.

---

**14.** Un job déclare `environment: production` et l'environment
`production` a un *required reviewer*. Que se passe-t-il ?

A. Le job attend qu'un reviewer autorisé approuve dans l'interface GitHub avant de démarrer.
B. Le job démarre immédiatement mais un mail est envoyé au reviewer.
C. Le job est refusé tant que la branche n'est pas `main`.
D. Le job s'exécute deux fois : une fois pour le reviewer, une fois pour l'auteur.

---

**15.** Quelle est la différence entre *Continuous Delivery* et
*Continuous Deployment* ?

A. La delivery concerne le front, le deployment concerne le back-end.
B. En delivery, chaque version validée est **prête** à être mise en production, mais la mise en production est déclenchée par une décision humaine ; en deployment, elle est automatique.
C. Le deployment nécessite Kubernetes, la delivery non.
D. Il n'y a aucune différence, ce sont deux noms pour la même pratique.

---

**16.** Quelle stratégie de déploiement consiste à maintenir deux
environnements de production identiques et à basculer le trafic de l'un à
l'autre ?

A. Recreate
B. Rolling update
C. Canary
D. Blue/green

---

**17.** Comment fournir correctement la clé SSH privée au job Ansible ?

A. En committant `~/.ssh/taskflow_lab` dans le dossier `ansible/` du dépôt.
B. En la collant dans le fichier `hosts.ini`.
C. En la stockant dans un **secret** (repo ou environment) et en l'injectant au runtime via `ssh-agent` ou un fichier temporaire en `chmod 600`.
D. En la passant en paramètre `workflow_dispatch` à chaque déploiement.

---

**18.** Avec une arborescence `/opt/taskflow/releases/<version>` et un lien
symbolique `current`, en quoi consiste un rollback ?

A. Rebasculer le lien `current` vers la release précédente puis redémarrer le service (et recharger nginx).
B. Supprimer la release courante et relancer le build complet.
C. Restaurer une sauvegarde de la base de données.
D. Redémarrer la VM pour revenir à l'état précédent.

---

## Section 4 — Monitoring, Prometheus, PromQL, Grafana

**19.** Quel est le modèle de collecte de Prometheus ?

A. Push : chaque application envoie ses métriques au serveur Prometheus.
B. Pull : le serveur Prometheus interroge (« scrape ») périodiquement l'endpoint `/metrics` de chaque target.
C. Streaming : les métriques sont envoyées en continu par WebSocket.
D. Batch : les métriques sont importées une fois par jour depuis des fichiers.

---

**20.** Quel type de métrique Prometheus convient pour « nombre total de
requêtes HTTP reçues depuis le démarrage » ?

A. Gauge
B. Summary
C. Counter
D. Histogram

---

**21.** Que renvoie `rate(http_requests_total[5m])` ?

A. Le taux moyen de requêtes **par seconde** calculé sur la fenêtre des 5 dernières minutes.
B. Le nombre total de requêtes reçues dans les 5 dernières minutes.
C. Le nombre de requêtes par minute, arrondi.
D. La valeur instantanée du compteur il y a 5 minutes.

---

**22.** Que calcule
`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` ?

A. Le pourcentage de requêtes qui durent moins de 0,95 seconde.
B. La durée moyenne des requêtes sur 5 minutes.
C. Le nombre de requêtes qui dépassent le 95e percentile.
D. Le 95e percentile de la latence (p95) estimé à partir des buckets de l'histogramme ; le label `le` doit être conservé.

---

**23.** Quels sont les quatre *golden signals* définis par Google SRE ?

A. CPU, mémoire, disque, réseau.
B. Latence, trafic, erreurs, saturation.
C. Disponibilité, sécurité, coût, performance.
D. MTTD, MTTR, lead time, change failure rate.

---

**24.** Comment Grafana est-il « provisionné en code » dans le fil rouge ?

A. En exportant manuellement chaque dashboard après l'avoir créé dans l'interface.
B. En stockant les dashboards dans la base SQLite de Grafana versionnée dans Git.
C. Via des fichiers YAML dans `provisioning/datasources/` et `provisioning/dashboards/` (+ dashboards JSON) chargés automatiquement au démarrage.
D. Via des variables d'environnement `GF_DASHBOARD_*` contenant le JSON.

---

## Section 5 — Alerting et bonnes pratiques

**25.** Dans une règle d'alerte Prometheus, à quoi sert `for: 5m` ?

A. L'alerte ne passe à l'état *firing* que si son expression reste vraie pendant 5 minutes consécutives (état *pending* entre-temps).
B. L'alerte est évaluée toutes les 5 minutes.
C. L'alerte se résout automatiquement après 5 minutes.
D. La notification est répétée toutes les 5 minutes.

---

**26.** Que fait `group_by: ['alertname', 'env']` dans Alertmanager ?

A. Il trie les alertes par ordre alphabétique dans l'interface.
B. Il envoie une notification distincte pour chaque instance concernée.
C. Il regroupe les alertes ayant le même `alertname` et le même `env` en une seule notification.
D. Il supprime les alertes qui n'ont pas de label `env`.

---

**27.** Pourquoi configure-t-on une alerte `Watchdog` avec `expr: vector(1)`,
donc **toujours** en état *firing* ?

A. Pour tester la charge d'Alertmanager.
B. C'est un *dead man's switch* : si cette alerte cesse d'arriver, c'est que la chaîne Prometheus → Alertmanager → notification est cassée.
C. Pour garder Prometheus éveillé et éviter qu'il ne passe en veille.
D. Pour forcer le regroupement des autres alertes.

---

**28.** Pourquoi exécuter `promtool check rules` dans le CI ?

A. Pour déployer les règles sur le serveur Prometheus.
B. Pour mesurer la latence de Prometheus.
C. Pour générer automatiquement les dashboards Grafana.
D. Pour valider la syntaxe et les expressions des règles d'alerte **avant** le merge, comme n'importe quel code (monitoring as code).

---

**29.** Quelle alerte illustre le mieux le principe « alerter sur les
symptômes plutôt que sur les causes » ?

A. « Taux d'erreurs 5xx de l'API > 5 % pendant 5 minutes ».
B. « CPU de la VM > 80 % pendant 2 minutes ».
C. « Un conteneur a redémarré une fois ».
D. « La mémoire libre est inférieure à 1 Go ».

---

**30.** Que détecte l'expression
`predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 4 * 3600) < 0` ?

A. Que le disque est déjà plein.
B. Que le disque a été rempli à plus de 80 % dans la dernière heure.
C. Que, si la tendance de la dernière heure se poursuit, l'espace disponible sur `/` sera épuisé dans moins de 4 heures.
D. Que le disque a été démonté il y a 4 heures.

---

**Fin du QCM** — vérifiez que vous avez répondu aux 30 questions.
