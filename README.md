# FORGE AI — Roblox Studio Bridge

Ce dossier contient le **vrai** pont entre le frontend Forge AI et Roblox Studio :
un backend Express + SQLite, et un plugin Roblox Studio qui interroge ce backend
et crée réellement les instances dans le jeu.

Aucune étape n'est simulée : le statut "Connected" n'apparaît que si un heartbeat
réel a été reçu du plugin dans les 15 dernières secondes.

```
forge-ai/
├── server/                # Backend Express + SQLite
│   ├── server.js
│   ├── database.js
│   ├── routes/studio.js
│   └── package.json
├── roblox-plugin/
│   └── ForgeAI.server.lua # Plugin Roblox Studio (fichier unique)
├── .env.example
└── README.md
```

Le frontend Forge AI (l'artefact React que tu as dans Claude) génère déjà le
code Luau côté navigateur. Ce backend ne sert PAS à générer du code IA — il
sert uniquement de file d'attente entre "SEND TO ROBLOX STUDIO" et le plugin.

---

## 1. Lancer le backend en local

```bash
cd server
npm install
cp ../.env.example .env
npm start
```

Le serveur écoute sur `http://localhost:3000` par défaut.
Vérifie qu'il tourne :

```bash
curl http://localhost:3000/api/health
# {"ok":true,"service":"forge-ai-backend","time":...}
```

La base SQLite (`server/forge.sqlite3`) est créée automatiquement au premier
lancement — pas de configuration de base de données à faire.

---

## 2. Déployer le backend (pour que le plugin Studio puisse le joindre)

Le plugin tourne dans Roblox Studio, sur ta machine ou celle d'un joueur —
il ne peut pas atteindre `localhost`. Il te faut une URL publique.

Options simples (toutes ont un plan gratuit ou très bon marché) :

- **Render** : crée un "Web Service", pointe-le sur `server/`, build command
  `npm install`, start command `npm start`. Render fournit automatiquement
  `PORT` — ne le fixe pas en dur.
- **Railway** : `railway init` puis `railway up` depuis `server/`.
- **Fly.io** : `fly launch` depuis `server/`, puis `fly deploy`.

⚠️ Point important sur SQLite : sur la plupart de ces hébergeurs, le
filesystem est éphémère (il est réinitialisé à chaque redéploiement). Pour un
usage personnel/test c'est très bien. Pour une vraie prod, monte un volume
persistant (Render/Fly proposent des "disks"/"volumes") et pointe `DB_PATH`
dessus dans `.env`.

Une fois déployé, tu obtiens une URL du type :

```
https://forge-ai-backend-xxxx.onrender.com
```

Le backend API est accessible sur `https://.../api/...`.

---

## 3. Configurer le frontend Forge AI (l'artefact Claude)

Dans la page **Roblox Studio** de Forge AI :

1. Colle l'URL de ton backend déployé (ex: `https://forge-ai-backend-xxxx.onrender.com/api`).
2. Le code de connexion du projet est généré automatiquement — clique sur
   "Register project" pour l'enregistrer côté backend.
3. Le statut passera à 🟢 Connected uniquement quand le plugin Studio aura
   effectivement envoyé un heartbeat.

**Limite importante à connaître** : les artefacts Claude tournent dans un
bac à sable navigateur dont la politique de sécurité (CSP) peut restreindre
les requêtes réseau sortantes à une liste d'hôtes autorisés. Si le `fetch()`
vers ton backend échoue silencieusement ou renvoie une erreur réseau/CORS
alors que `curl` fonctionne très bien vers la même URL, c'est cette
restriction du bac à sable — pas un bug du backend. Dans ce cas, héberge le
frontend Forge AI toi-même (en dehors de l'aperçu Claude) pour lever la
restriction : le code du composant React est réutilisable tel quel dans un
projet Vite/Next.js classique.

---

## 4. Installer le plugin dans Roblox Studio

Le plugin est un fichier Lua unique, sans dépendance externe.

1. Dans Roblox Studio : **File → Advanced → Open Plugins Folder** (ou
   **Fichier → Avancé → Ouvrir le dossier des plugins**).
2. Copie `roblox-plugin/ForgeAI.server.lua` dans ce dossier.
3. Redémarre Roblox Studio (ou clique sur **Plugins → Manage Plugins → Reload**
   si disponible).
4. Un bouton **Forge AI** apparaît dans l'onglet Plugins. Clique dessus pour
   ouvrir le panneau.
5. Colle l'URL du backend (avec `/api` à la fin) et le code de connexion du
   projet, puis clique sur **Test Connection**.
6. Si tout fonctionne, le statut passe à 🟢 Connected et le plugin se
   synchronise automatiquement toutes les 5 secondes tant que Studio reste
   ouvert avec ce panneau chargé.

Si `HttpService` refuse les requêtes, va dans **Game Settings → Security**
et active **Allow HTTP Requests** — cela ne concerne normalement que les
scripts du jeu et pas les plugins, mais certaines configurations d'entreprise
le restreignent aussi pour les plugins ; l'activer ne coûte rien à tester.

---

## 5. Utiliser le flux complet

1. Dans **AI Builder**, décris ta mécanique et génère le système.
2. Clique sur **SEND TO ROBLOX STUDIO**.
   - Si le plugin est connecté : `🟢 Build envoyé à Roblox Studio`
   - Sinon : `🟡 Build ajouté à la file d'attente` — il sera livré
     automatiquement dès la prochaine reconnexion du plugin (prochain
     heartbeat), pas besoin de relancer quoi que ce soit.
3. Le plugin crée/actualise les instances aux emplacements exacts décrits par
   `path` (dossiers créés automatiquement si absents, instances existantes
   mises à jour plutôt que dupliquées).
4. En cas d'erreur sur un fichier, le build entier s'arrête (traitement
   atomique) et l'erreur est renvoyée au backend, consultable via
   `GET /api/studio/builds/:code`.

---

## 6. Référence API

| Méthode | Route | Appelée par | Rôle |
|---|---|---|---|
| POST | `/api/studio/register` | Frontend | Enregistre un code de connexion pour un projet |
| POST | `/api/studio/heartbeat/:code` | Plugin | Ping toutes les 5s, récupère les builds en attente |
| GET | `/api/studio/status/:code` | Frontend | Statut de connexion en temps réel |
| POST | `/api/studio/build` | Frontend | Met un système généré en file d'attente |
| GET | `/api/studio/builds/:code` | Frontend | Historique des builds |
| POST | `/api/studio/build/:id/result` | Plugin | Rapport de succès/échec après création des instances |

---

## 7. Sécurité

- Le backend ne contient aucune clé API Anthropic — la génération IA se fait
  directement depuis l'artefact Forge AI via l'infrastructure Claude, qui ne
  nécessite pas de clé côté client. Ce backend ne sert que de file d'attente
  Studio.
- `CORS_ORIGIN` dans `.env` restreint qui peut appeler l'API depuis un
  navigateur — mets `*` en développement, une origine précise en production.
- Les codes de connexion ne sont pas des secrets forts (8 caractères) : ne
  les partage pas publiquement si ton backend est ouvert à tous, ou ajoute
  ta propre couche d'authentification si tu déploies ça pour plusieurs
  utilisateurs.
