# Plan de developpement API Hinge (version simple locale)

## Objectif

Construire une API JavaScript simple qui reproduit les fonctions utiles du bot, uniquement pour Hinge, en execution locale.

## Contraintes confirmees

- Hinge only (pas de multi-app).
- Un fichier de config unique pour changer facilement proxy/spoofing (restart serveur OK).
- Pas de Redis, pas de store persistant distribue.
- Pas de SMSPool (DaisySMS uniquement).
- Pas de phase admin/users.
- Pas de phase securite/prod enterprise.

## Configuration locale cible

- [ ] Fichier `config/local-config.js` (ou `.json`) avec:
- [ ] `proxy.providers` (ordre fallback local)
- [ ] `proxy.useScamalytics` (on/off)
- [ ] `photos.useSpoofing` (true/false)
- [ ] `photos.spoofer` (`random_three` ou `iphone_exif_gui_reconstructed`)
- [ ] `photos.count` (6 par defaut pour Hinge)
- [ ] `sms.provider = daisysms`
- [ ] `sms.serviceCode`
- [ ] `email.provider = anymessage`
- [ ] `airtable.enabled` + URLs formulaire

## Phase 0 - Fondations minimales

### Features

- [ ] Initialiser serveur API (Express/Fastify), structure modulaire.
- [ ] Charger `local-config` au demarrage.
- [ ] Store en memoire (Maps) pour sessions SMS/Email/proxy actifs.
- [ ] Logs simples + gestion d'erreurs centralisee.
- [ ] Endpoints utilitaires: `/health`.

### Livrables

- [ ] Skeleton API runnable localement.
- [ ] `.env.example` minimal.
- [ ] Validation d'entree de base.

## Phase 1 - Coeur generation compte Hinge

### Features

- [ ] Validation location `state, city` via CSV (US/UK/IT/AU/CA).
- [ ] Generation coordonnees random dans la ville.
- [ ] Generation proxy avec fallback providers (selon config locale).
- [ ] Verification proxy (IP via proxy + Scamalytics + match geo) si activee.
- [ ] Generation numero DaisySMS (pas SMSPool).
- [ ] Generation email AnyMessage.
- [ ] Generation photos pool/no-spoofing selon config.
- [ ] Generation birthdate/zodiac/model info.
- [ ] Payload prefill Airtable.

### Endpoints

- [ ] `POST /v1/accounts/generate`
- [ ] `POST /v1/proxies/regenerate`
- [ ] `POST /v1/phones/regenerate`
- [ ] `POST /v1/emails/regenerate`
- [ ] `POST /v1/photos/regenerate`
- [ ] `POST /v1/airtable/links`

### Criteres d'acceptation

- [ ] Reponse contient proxy, ip, phone, email, photos, model, birthdate, zodiac.
- [ ] Flux Hinge complet sans dependance Telegram.
- [ ] Fallback proxy fonctionnel selon ordre du config file.

## Phase 2 - Recuperation codes SMS et email

### Features

- [ ] Polling DaisySMS statut/code.
- [ ] Webhook DaisySMS entrant.
- [ ] Polling AnyMessage inbox + extraction code.
- [ ] Timeout/cancel auto (7 min) + nettoyage session memoire.
- [ ] Eviter les doublons de code (idempotence simple en memoire).

### Endpoints

- [ ] `GET /v1/sms/:requestId/status`
- [ ] `GET /v1/sms/:requestId/code`
- [ ] `POST /v1/webhooks/daisysms`
- [ ] `GET /v1/emails/:orderId/status`
- [ ] `GET /v1/emails/:orderId/code`
- [ ] `POST /v1/sessions/:sessionId/cancel`

### Criteres d'acceptation

- [ ] Codes disponibles par API comme dans le bot.
- [ ] Session expiree/cancel nettoyee proprement.

## Phase 3 - Worker photos local

### Features

- [ ] Reutiliser worker de pre-generation photo existant.
- [ ] Stock pool par modele.
- [ ] Mapping original filename <-> generated filename conserve.
- [ ] Stats basiques des pools.

### Endpoints

- [ ] `GET /v1/photos/pools/stats`

### Criteres d'acceptation

- [ ] Livraison photo rapide si stock disponible.
- [ ] Pas de corruption mapping sur usage normal local.

## Definition of done (scope local)

- [ ] API couvre les flux Hinge utiles du bot (generation + regeneration + codes).
- [ ] Config locale editable puis restart serveur.
- [ ] Aucune dependance Redis/SMSPool/admin.

## Ordre d'implementation recommande

1. Phase 0
2. Phase 1 (`POST /v1/accounts/generate` en premier)
3. Phase 2
4. Phase 3

## Mapping Telegram -> API (Hinge)

- Message `State, City` -> `POST /v1/accounts/generate`
- Bouton `New Proxy` -> `POST /v1/proxies/regenerate`
- Bouton `New Phone` -> `POST /v1/phones/regenerate`
- Bouton `New Email` -> `POST /v1/emails/regenerate`
- Bouton `Regenerate Photos` -> `POST /v1/photos/regenerate`
- Airtable status links -> `POST /v1/airtable/links`
