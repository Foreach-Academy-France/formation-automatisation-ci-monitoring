# Cible SSH de secours (si aucune VM Multipass/Incus n'est possible).
# Ubuntu 22.04 + sshd + python3 : suffisant pour `ansible -m ping` et le
# déploiement du front statique. PAS de systemd → l'API Node ne sera pas
# gérée comme sur une vraie VM (voir README.md).
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server sudo python3 rsync curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && useradd -m -s /bin/bash ubuntu \
    && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && mkdir -p /home/ubuntu/.ssh && chmod 700 /home/ubuntu/.ssh
COPY authorized_keys /home/ubuntu/.ssh/authorized_keys
RUN chown -R ubuntu:ubuntu /home/ubuntu/.ssh && chmod 600 /home/ubuntu/.ssh/authorized_keys
EXPOSE 22 80
CMD ["/usr/sbin/sshd", "-D", "-e"]
