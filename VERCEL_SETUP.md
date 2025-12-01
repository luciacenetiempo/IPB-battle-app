# Setup per Vercel

Questa applicazione è stata convertita per funzionare su Vercel usando API routes e Upstash Redis invece di Socket.io.

## Configurazione Richiesta

### 1. Upstash Redis

1. Vai su [Upstash Console](https://console.upstash.com/)
2. Crea un nuovo database Redis (piano gratuito disponibile)
3. Copia le credenziali:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Variabili d'Ambiente su Vercel

Aggiungi queste variabili d'ambiente nel progetto Vercel (Settings → Environment Variables):

```
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
REPLICATE_API_TOKEN=your_replicate_token
```

### 3. Sviluppo Locale

Per sviluppo locale, crea un file `.env.local`:

```
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
REPLICATE_API_TOKEN=your_replicate_token
```

## Installazione Dipendenze

```bash
npm install
```

## Funzionalità

L'applicazione ora usa:
- **API REST** invece di Socket.io per tutte le comunicazioni
- **Polling** (ogni 500ms) per aggiornamenti real-time
- **Upstash Redis** per lo stato persistente
- **Timer basato su timestamp** invece di polling continuo

## Note

- Il timer viene calcolato in base al timestamp di inizio, quindi è preciso anche con polling
- Lo stato è persistente su Redis, quindi sopravvive ai riavvii
- Le API routes hanno timeout di 60 secondi per la generazione immagini

## Deploy

1. Push del codice su GitHub
2. Connetti il repository a Vercel
3. Configura le variabili d'ambiente
4. Deploy!

