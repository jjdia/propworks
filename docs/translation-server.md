# Translation server (self-hosted LibreTranslate) — V 35

The app's **Tenant messages** screen (More → Tenant messages) translates
incoming tenant texts to English and Jeff's English replies into the tenant's
language. It calls the owner-only Supabase Edge Function `translate`, which
proxies to a LibreTranslate server you run yourself. No paid AI, no browser
built-in translation APIs — so it works the same on iPhone/Android, Safari
and Chrome.

```
App (owner JWT) ──▶ Supabase Edge Function `translate` ──▶ https://translate.<your-domain> (LibreTranslate)
```

The LibreTranslate URL and API key live **only** in Supabase secrets. They are
never shipped to the browser.

## 1. Create an Oracle Cloud Always Free VM

1. Sign up at <https://cloud.oracle.com> (Always Free tier).
2. Compute → Instances → **Create instance**
   - Image: **Ubuntu 22.04/24.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM), e.g. 2 OCPU / 12 GB RAM
     (Always Free allows up to 4 OCPU / 24 GB in total). The x86
     `VM.Standard.E2.1.Micro` (1 GB) is too small for LibreTranslate.
   - Add your SSH public key.
3. Networking → the instance's VCN → Security List → add **Ingress** rules for
   TCP **80** and **443** from `0.0.0.0/0`. (Do not open 5000.)
4. On the VM, Ubuntu's own firewall also blocks ports:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
5. Point a DNS **A record** (e.g. `translate.example.com`) at the VM's public IP.

## 2. Install Docker and run LibreTranslate (limited languages)

Loading only the languages you need saves a lot of RAM and startup time.
`en` must always be included. Example for English + Spanish + common NYC
tenant languages:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out/in afterwards

mkdir -p ~/libretranslate && cd ~/libretranslate
cat > docker-compose.yml <<'YAML'
services:
  libretranslate:
    image: libretranslate/libretranslate:latest   # multi-arch, works on ARM
    restart: unless-stopped
    ports:
      - "127.0.0.1:5000:5000"          # only reachable through the HTTPS proxy
    environment:
      LT_LOAD_ONLY: "en,es,zh,ru,ar,bn,fr,ht,pl"   # trim to what you need
      LT_API_KEYS: "true"
      LT_REQUIRE_API_KEY_ORIGIN: ""
      LT_API_KEYS_DB_PATH: /app/db/api_keys.db
      LT_DISABLE_WEB_UI: "true"
      LT_UPDATE_MODELS: "true"
    volumes:
      - lt_models:/home/libretranslate/.local
      - lt_db:/app/db
volumes:
  lt_models:
  lt_db:
YAML
docker compose up -d
docker compose logs -f   # first start downloads models; wait for "Running on"
```

Check it locally on the VM:

```bash
curl -s localhost:5000/languages
```

Rough RAM: ~300–500 MB per language pair loaded. Start with `en,es` and add
more later (edit `LT_LOAD_ONLY`, then `docker compose up -d`).

## 3. HTTPS (Caddy, automatic Let's Encrypt)

```bash
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF2'
translate.example.com {
  reverse_proxy 127.0.0.1:5000
}
EOF2
sudo systemctl reload caddy
curl -s https://translate.example.com/languages
```

## 4. Create an API key

With `LT_API_KEYS=true`, requests without a valid key are rate limited /
rejected, so the public endpoint can't be abused:

```bash
docker compose exec libretranslate ltmanage keys add 120   # 120 req/min
# prints the key — copy it, do not commit it or paste it in chat
docker compose exec libretranslate ltmanage keys          # list keys
```

Test (replace KEY):

```bash
curl -s https://translate.example.com/translate -H 'Content-Type: application/json' \
  -d '{"q":"La calefacción no funciona","source":"auto","target":"en","api_key":"KEY"}'
```

## 5. Set the Supabase secrets and deploy the function

Supabase dashboard → project `crdrwtxeogkloxuathzh` → Edge Functions →
Secrets, add:

| Secret | Value |
|---|---|
| `LIBRETRANSLATE_URL` | `https://translate.example.com` (no trailing slash needed) |
| `LIBRETRANSLATE_API_KEY` | the key from step 4 (optional if you didn't enable keys) |

Or with the CLI (values typed, never committed):

```bash
supabase secrets set LIBRETRANSLATE_URL=https://translate.example.com --project-ref crdrwtxeogkloxuathzh
supabase secrets set LIBRETRANSLATE_API_KEY=... --project-ref crdrwtxeogkloxuathzh
supabase functions deploy translate --project-ref crdrwtxeogkloxuathzh   # WITH JWT verification (no --no-verify-jwt)
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected by the platform. The
function never uses the service role key: it reads the caller's own profile
with their JWT and only allows `role = 'owner'`.

## Behavior when not configured

If `LIBRETRANSLATE_URL` is unset the function returns
`503 { "error": "translation_not_configured" }`. The app still saves the
message (original text), marks translation as unavailable, and offers
**Retry**. Replies can still be typed by hand in the preview and must still
be approved before sending.

## Release order (V 35)

1. Backup gate (HANDOFF): full dump + verified restore.
2. Apply `supabase/schema-v11-message-translation.sql`.
3. Deploy `translate` function; set secrets above.
4. Merge/deploy the app.
