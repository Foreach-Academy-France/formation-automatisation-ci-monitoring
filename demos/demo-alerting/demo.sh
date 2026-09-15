#!/usr/bin/env bash
# Démo J4 : alerte de bout en bout en ~1 min
set -e; cd "$(dirname "$0")"
docker compose up -d
echo "Ouvrir : Prometheus http://localhost:9090/alerts  | Alertmanager http://localhost:9093 | MailHog http://localhost:8025"
sleep 15
echo "--- On coupe la cible"; docker compose stop victime
echo "Observer : inactive → pending (30 s) → firing → mail dans MailHog (group_wait 5 s)"
sleep 60
echo "--- Silence : amtool"; docker compose exec alertmanager amtool silence add alertname=InstanceDown --duration=10m --comment="maintenance" --author=formateur --alertmanager.url=http://localhost:9093
echo "--- On relance la cible → mail RESOLVED"; docker compose start victime
