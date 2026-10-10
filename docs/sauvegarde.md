# Sauvegarde de la base

Chaque lundi (2h17 UTC), et à la demande avant une grosse étape
(*Actions → Sauvegarde → Run workflow*), l'action **Sauvegarde** exporte toute la base
Supabase : rôles, structure (tables, fonctions, règles d'accès) et
données. L'export est chiffré puis gardé **30 jours** dans l'onglet
*Actions* du dépôt.

Le dépôt est public : sans la phrase secrète, les fichiers sont
illisibles. **Perdre la phrase secrète, c'est perdre les sauvegardes.**

## Mise en place (une fois)

1. Supabase → projet → bouton **Connect** → onglet *Connection string*
   → **Session pooler** → copier l'URI
   (`postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`)
   et remplacer `[YOUR-PASSWORD]` par le mot de passe de la base.
2. GitHub → dépôt → **Settings → Secrets and variables → Actions →
   New repository secret** :
   - `SUPABASE_DB_URL` : l'URI complète de l'étape 1 ;
   - `BACKUP_PASSPHRASE` : une phrase longue, inventée, notée dans un
     gestionnaire de mots de passe.
3. GitHub → **Actions → Sauvegarde → Run workflow** pour un premier
   essai. Le job doit finir en vert avec un artefact
   `sauvegarde-AAAA-MM-JJ`.

GitHub met en pause les tâches planifiées d'un dépôt public après
60 jours sans aucun commit : un mail prévient, il suffit de les
réactiver dans *Actions*.

## Restaurer

1. *Actions → Sauvegarde* → la sauvegarde voulue → télécharger l'artefact,
   le dézipper : on obtient `protocol-AAAA-MM-JJ.tar.gz.gpg`.
2. Déchiffrer :

   ```sh
   gpg -d protocol-AAAA-MM-JJ.tar.gz.gpg | tar -xz
   ```

   (la phrase secrète est demandée) → `roles.sql`, `schema.sql`, `data.sql`.
3. Rejouer dans une base **neuve** (nouveau projet Supabase, de
   préférence, pour ne rien écraser) :

   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "<URI de la nouvelle base>"
   ```

   `session_replication_role = replica` désactive les déclencheurs le
   temps du chargement (sinon les jokers, notifications… se
   déclencheraient sur les données importées).

Pour ne récupérer qu'une table (par exemple des cartes effacées par
erreur), ouvrir `data.sql` et copier le bloc `COPY public.<table> …`
voulu dans l'éditeur SQL plutôt que de tout restaurer.
