# VPS Hardening Prompt (v3)

Copy and paste this entire prompt into Claude Code (or any AI assistant with terminal access) while connected to your VPS. It will walk you through securing your server step by step.

> **Companion to:** [Application Security Audit](security-audit.md) — that covers your application code. This covers your server infrastructure.

---

## The Prompt

```
I need you to harden my VPS security. This is a fresh or existing Linux VPS (Ubuntu/Debian) that runs a web application or bot. Walk me through each step, explain what you're doing, and wait for my confirmation before making changes.

Here's what I need you to do, in this exact order:

### Phase 1: Audit Current State
Before changing anything, run these checks and show me the results:
- Check if a firewall (UFW) is installed and active
- Show all open ports (ss -tlnp) — flag any service listening on 0.0.0.0 that should be on 127.0.0.1
- Check SSH config for: PermitRootLogin, PasswordAuthentication, PubkeyAuthentication, MaxAuthTries, AllowUsers, ClientAliveInterval
- Check if fail2ban is installed
- Check if unattended-upgrades is installed
- List running services — identify any that aren't needed and could be disabled
- Show existing non-root users
- Check if Docker is installed (`docker ps` and `docker network ls`)
- If Docker exists, identify containers that proxy to host services (e.g., reverse proxies like Traefik/Nginx reaching host ports)
- Check file permissions on sensitive files: .env files (should be 600), .ssh directories (should be 700), authorized_keys (should be 600)
- Check what user application processes are running as (they should NOT be root)

Present the results in a clear table with a risk rating for each finding.

### Phase 2: Create Non-Root User (if needed)
If I'm logged in as root and there's no non-root user with sudo:
- Create a new user (ask me for the username)
- Add them to the sudo group
- Copy my SSH authorized_keys to the new user
- Set correct permissions on their .ssh directory (700 for .ssh, 600 for authorized_keys)
- Verify they can use sudo

### Phase 3: SSH Hardening
Modify /etc/ssh/sshd_config to:
- Set PermitRootLogin no
- Set PasswordAuthentication no
- Set PubkeyAuthentication yes
- Set MaxAuthTries 3
- Set AllowUsers <username> (restrict SSH to only the deploy user — not any account on the system)
- Set ClientAliveInterval 300
- Set ClientAliveCountMax 2 (drops idle sessions after 10 minutes)
- Ask me: "Do you want to change the SSH port from 22 to a non-standard port (e.g., 2222)? This eliminates 99% of automated scanner noise in logs. It's not security by itself, but it reduces noise significantly."
- Show me the diff before applying
- Restart the SSH service

IMPORTANT: Before restarting SSH, verify that:
1. The non-root user exists and has sudo access
2. The non-root user has SSH keys in their authorized_keys
3. I have another way to access the server (like a web console) in case something goes wrong
4. If the SSH port was changed, the new port is allowed through the firewall BEFORE restarting SSH

### Phase 4: Install and Configure Fail2Ban
- Install fail2ban
- Create /etc/fail2ban/jail.local with:
  - SSH jail enabled (use the correct port if SSH was moved in Phase 3)
  - maxretry = 3
  - bantime = 86400 (24 hours)
  - findtime = 600 (10 minutes)
  - bantime.increment = true (progressive banning — repeat offenders get longer bans)
  - bantime.factor = 2
- Enable and start the service
- Verify it's running

### Phase 5: Firewall (UFW) + Docker Awareness
- Install UFW if not present
- Set default deny incoming, allow outgoing
- Allow only these ports:
  - SSH port (22 or custom if changed in Phase 3)
  - 80/tcp (HTTP) — only if I'm using a web interface or webhook
  - 443/tcp (HTTPS) — only if I'm using SSL/webhook
- Ask me before opening any additional ports
- Enable UFW
- Show final firewall rules

IMPORTANT: Ask me what mode my application runs in:
- Polling mode (e.g., Telegram long-polling): Only needs SSH port
- Webhook mode: Needs SSH + 80 + 443
- Hybrid mode: Needs SSH + 80 + 443

IMPORTANT — Cloudflare origin protection:
Ask me: "Is your server behind Cloudflare (or another CDN/proxy)?"
If yes:
- Ports 80 and 443 should be restricted to only Cloudflare IP ranges — otherwise attackers can bypass Cloudflare and hit the origin directly
- Fetch the current Cloudflare ranges from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
- Create UFW rules that allow 80/443 only from those ranges:
  `ufw allow from <cloudflare-ip-range> to any port 80,443 proto tcp`
- Do NOT add a blanket `ufw allow 80` or `ufw allow 443` — that defeats the purpose

CRITICAL — Docker + UFW interaction:
If Docker is running on this server (you checked in Phase 1), you MUST handle this carefully. Docker and UFW have a well-known conflict:

1. Docker manipulates iptables directly and BYPASSES UFW rules entirely for container-exposed ports. This means UFW "deny incoming" does NOT block ports that Docker exposes. Be aware of this — it's not a bug, it's how Docker works.

2. However, the iptables INPUT chain CAN still block traffic from Docker bridge networks to services running on the HOST (not inside Docker). This is the most common cause of "my reverse proxy can't reach my app" after hardening.

3. If any Docker container needs to reach a service running directly on the host (not in another container), you must explicitly allow that traffic. Do this:
   a. Find Docker bridge subnets: `docker network inspect <network-name> -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`
   b. For each host port that Docker containers need to reach, add:
      `iptables -I INPUT -s <docker-subnet> -p tcp --dport <host-port> -j ACCEPT`
   c. Save the rules: `iptables-save > /etc/iptables/rules.v4`
   d. Install iptables-persistent if not present: `apt install -y iptables-persistent`

4. Ask me: "Are any Docker containers connecting to services running directly on this host (not in Docker)? If so, which ports?" Common examples:
   - Traefik/Nginx reverse proxy in Docker → app on host port 3000/8080
   - Docker container → host database on port 5432/3306

5. After applying UFW rules, TEST that Docker-to-host connections still work:
   `docker exec <container-name> wget -qO- --timeout=3 http://<host-gateway-ip>:<port>/health`

### Phase 6: File Permissions & Process Isolation
- Fix permissions on sensitive files:
  - All .env files: `chmod 600`
  - All .ssh directories: `chmod 700`
  - All authorized_keys files: `chmod 600`
  - Any private key files: `chmod 600`
- Check what user the application process runs as. If it runs as root:
  - Reconfigure PM2/systemd/supervisor to run the app as the non-root user
  - Verify the app still starts and can access its files
- Check for world-readable sensitive files: `find /home -name ".env*" -o -name "*.pem" -o -name "*.key" | xargs ls -la`

### Phase 7: Disable Unused Services
Review the running services from Phase 1 and ask me about any that look unnecessary:
- Common candidates: cups (printing), avahi-daemon (mDNS), rpcbind (NFS), postfix (mail)
- For each unnecessary service: `systemctl disable --now <service>`
- Only disable services I confirm are not needed

### Phase 8: Enable Automatic Security Updates
- Install unattended-upgrades if not present
- Configure it for security updates only
- Enable and verify

### Phase 9: Final Verification
Run the same audit from Phase 1 and show me a before/after comparison.
Show me a summary of all changes made.

CRITICAL post-hardening checks:
1. If Docker is running, verify all Docker-to-host connections still work
2. If using a reverse proxy (Traefik/Nginx), verify external URLs return 200 (not 502/504)
3. Verify the application itself is still responding
4. If the SSH port was changed, verify SSH works on the new port

Remind me to:
1. Update my local SSH config to use the new username and port (not root, not port 22 if changed)
2. Test SSH access with the new user before closing this session
3. Save my web console access URL in case I ever get locked out
4. If Docker is running, note down the iptables rules added for Docker bridge traffic — these must be re-applied if UFW is reset
5. If Cloudflare IPs were used in UFW rules, set a reminder to update them periodically (Cloudflare occasionally adds new ranges)

Be careful. Be methodical. Explain each step. Don't rush. If anything looks wrong, stop and ask me before proceeding.
```

---

## How to Use

1. **Connect to your VPS** via SSH or web terminal
2. **Open Claude Code** (or paste into ChatGPT/Claude with terminal access)
3. **Paste the entire prompt above**
4. **Follow the steps** — the AI will ask for confirmation before each change
5. **Test your access** before closing the session

## What This Does

| Protection | What It Prevents |
|-----------|-----------------|
| **Disable root login** | Attackers can't brute-force the root account |
| **Disable password auth** | Only SSH keys work — no passwords to guess |
| **AllowUsers directive** | Only your deploy user can SSH in — not any system account |
| **Idle session timeout** | Abandoned sessions don't stay open indefinitely |
| **Optional port change** | Eliminates 99% of automated scanner noise |
| **Fail2Ban (24h progressive)** | Auto-blocks IPs with escalating ban times for repeat offenders |
| **UFW Firewall** | Only allows the ports you actually need |
| **Cloudflare origin lock** | Attackers can't bypass your CDN to hit the server directly |
| **Docker-aware firewall** | Prevents firewall from breaking Docker-to-host traffic |
| **File permissions** | .env and keys aren't world-readable |
| **Non-root processes** | App runs as limited user — compromise doesn't give root |
| **Disable unused services** | Smaller attack surface — less running, less risk |
| **Auto-updates** | Security patches install automatically |

## After Hardening

Your VPS attack surface is now minimal:
- **Polling mode**: Only SSH is exposed (smallest possible surface)
- **Webhook mode**: SSH + HTTPS exposed, locked to Cloudflare IPs if applicable

For even more security, consider:
- **Tailscale** (free VPN) — access your VPS over a private network instead of public SSH
- **[Application Security Audit](security-audit.md)** — harden your application code, not just the server

## Changelog

### v3
- **Generic title** — no longer project-specific, works for any VPS
- **SSH AllowUsers** — restricts SSH to the deploy user only
- **SSH idle timeout** — drops abandoned sessions after 10 minutes
- **Optional SSH port change** — reduces automated scanner noise
- **Fail2Ban upgraded** — 24-hour bans with progressive escalation for repeat offenders
- **Cloudflare origin protection** — locks ports 80/443 to Cloudflare IP ranges
- **File permissions phase** — audits and fixes .env, .ssh, and key file permissions
- **Process isolation** — verifies app doesn't run as root
- **Bind address check** — flags services on 0.0.0.0 that should be on 127.0.0.1
- **Disable unused services phase** — reduces attack surface
- **SSH port-change safety** — ensures new port is allowed through firewall before restarting SSH

### v2
- Added Docker network awareness to Phase 1
- Rewrote Phase 5 with Docker + UFW section
- Added post-hardening verification in Phase 7
- Added reminder to document iptables rules

---

*Created from real-world VPS hardening across multiple production deployments. Every check reflects an actual misconfiguration or vulnerability that was discovered in the wild.*
