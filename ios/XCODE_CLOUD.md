# Livraison automatique avec Xcode Cloud

Objectif : un `push` sur `main` qui modifie `ios/` compile l'appli et l'envoie sur TestFlight, sans rien faire à la main.

Le workflow Xcode Cloud est enregistré chez Apple, pas dans ce dépôt : il se crée **une seule fois** dans Xcode (environ 10 minutes). Ensuite tout est automatique.

## État du dépôt (vérifié)

- Scheme partagé `MyCycleWorld` (`ios/MyCycleWorld.xcodeproj/xcshareddata/xcschemes/`) : obligatoire pour Xcode Cloud.
- Aucune dépendance externe (ni Swift Package, ni npm, ni Pods) : aucun script `ci_scripts` n'est nécessaire.
- Signature automatique, équipe `JQ4Z5PXR5K`, Bundle ID `com.gbillois.MyCycleWorld`, iOS 17 minimum.
- Format de projet compatible avec les anciens Xcode : n'importe quelle version d'Xcode proposée par Xcode Cloud peut l'ouvrir.
- Aucun secret dans le dépôt (il est public) : la signature est gérée par Apple dans le cloud.

## À faire une fois

### 1. Régler le numéro de build (avant le premier build)

Xcode Cloud numérote ses builds lui-même en partant de 1. Le build 1 a déjà été envoyé à la main : sans réglage, l'envoi échoue avec « The bundle version must be higher than the previously uploaded version ».

Dans [App Store Connect](https://appstoreconnect.apple.com/) : ton app, onglet **Xcode Cloud**, **Settings**, **Build Number**, **Next Build Number**. Mets un nombre supérieur à tous les builds déjà envoyés, par exemple **100**. (L'intitulé exact peut varier légèrement selon la version de l'interface.)

Ensuite, ne change plus `CURRENT_PROJECT_VERSION` à la main : Xcode Cloud le remplace à chaque build.

### 2. Créer le workflow dans Xcode

1. Ouvre `ios/MyCycleWorld.xcodeproj` dans Xcode, compte Apple Developer connecté (**Settings, Accounts**).
2. **Report navigator** (⌘9), onglet **Cloud**, puis **Get Started** (ou **Create Workflow**), produit **MyCycleWorld**.
3. Autorise l'accès à GitHub quand Xcode le demande. Limite l'accès au dépôt `gbillois/MyCycleWorld` uniquement.
4. Règle le workflow :

| Section | Réglage |
| --- | --- |
| Nom | `main vers TestFlight` |
| Environment | Xcode : dernière version (Latest Release) ; macOS : dernière version |
| Start Conditions | **Branch Changes**, branche `main` |
| Files and Folders | **Custom** : ne garder que le dossier `ios` (les changements du site web ne relancent pas de build) |
| Actions | **Archive, iOS**, scheme `MyCycleWorld`, Deployment Preparation : **TestFlight (Internal Testing Only)** |
| Post-Actions | **TestFlight Internal Testing**, choisir le groupe de testeurs |

5. Enregistre le workflow.

### 3. Les testeurs

Les testeurs internes doivent être des utilisateurs App Store Connect (**Users and Access**) et membres du groupe interne choisi dans la post-action. Adresses prévues dans `testflight_upload.command` : `vincent@billois.com` et `gerome@billois.com`.

### 4. Vérifier

1. Lance un premier build à la main (**Start Build** dans Xcode, ou dans App Store Connect, onglet Xcode Cloud).
2. Quand il est vert et que le build apparaît dans TestFlight, pousse un petit changement dans `ios/` sur `main` : un build doit démarrer tout seul.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « The bundle version must be higher... » | Étape 1 : augmenter le Next Build Number. |
| Échec de signature | Vérifier l'équipe dans Xcode et que le Bundle ID est bien enregistré dans le compte Apple. |
| Aucun build après un push | Vérifier la branche (`main`), le filtre de dossiers (le changement doit toucher `ios/`) et que l'accès GitHub est bien accordé. |
| Build vert mais rien dans TestFlight | Vérifier la post-action TestFlight et l'appartenance des testeurs au groupe. |

Le programme développeur inclut un quota mensuel d'heures de calcul Xcode Cloud (25 heures au moment de l'écriture, à vérifier dans App Store Connect). Cette appli, sans dépendance, compile vite.

## Si le projet change

- Ajout d'un Swift Package, de npm ou de Pods : créer `ios/ci_scripts/ci_post_clone.sh` (au même niveau que le `.xcodeproj`, rendu exécutable avec `chmod +x`) pour installer les dépendances.
- Envoi manuel de secours : `ios/testflight_upload.command` ou `ios/scripts/archive.sh` restent valables.
