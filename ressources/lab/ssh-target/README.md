# ssh-target — cible SSH de secours (sans VM)

À n'utiliser que si Multipass **et** Incus sont impossibles sur votre poste.

```bash
cd ressources/lab/ssh-target
cp ~/.ssh/taskflow_lab.pub authorized_keys
docker network create monitoring 2>/dev/null || true
docker compose up -d --build
```

Inventaire à utiliser (`ansible/inventory/hosts.ini`) :

```ini
[staging]
taskflow-web1 ansible_host=host.docker.internal ansible_port=2201
[prod]
taskflow-web2 ansible_host=host.docker.internal ansible_port=2202
```

(depuis le runner en conteneur ; depuis votre poste remplacez `host.docker.internal` par `localhost`).

## Limites (importantes)

| Fonctionne | Ne fonctionne pas |
|---|---|
| `ansible -m ping`, apt, users, fichiers, templates | **systemd** : `taskflow-api` et `node_exporter` ne démarrent pas par `systemctl` |
| Déploiement du front (nginx doit être lancé à la main : `sudo nginx`) | UFW |
| Scrape Prometheus via le réseau `monitoring` (`taskflow-web1:80`) | node_exporter en service |

Pour l'API et node_exporter, lancez-les à la main dans le conteneur pour la démonstration :
```bash
docker compose exec web1 bash -c 'cd /opt/taskflow/current/api && PORT=3000 APP_ENV=staging nohup node src/server.js &'
```
Le rôle `taskflow` échouera aux tâches systemd : utilisez `--skip-tags systemd` si vous avez taggé ces tâches, ou commentez-les.
