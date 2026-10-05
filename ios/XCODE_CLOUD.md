# Livraison automatique avec Xcode Cloud

Chaque `push` sur `main` déclenche le workflow **main vers TestFlight** : archivage iOS, signature par Apple et distribution au groupe interne **MyCycleGroup**.

Le workflow a été créé et enregistré dans Xcode le 5 octobre 2026. Sa configuration est hébergée chez Apple, pas dans un fichier GitHub Actions. Pour la modifier : navigateur Reports (⌘9), onglet Cloud, clic droit sur **main vers TestFlight**, **Edit Workflow**.

## Configuration enregistrée

| Section | Réglage |
| --- | --- |
| Produit | MyCycleWorld, `com.gbillois.MyCycleWorld` |
| Dépôt / projet | `gbillois/MyCycleWorld`, `ios/MyCycleWorld.xcodeproj` |
| Environment | Xcode et macOS : Latest Release |
| Start Conditions | Branch Changes, branche exacte `main`, tous les fichiers |
| Auto-cancel Builds | Activé : un nouveau push remplace le build précédent en attente ou en cours |
| Tests avant archive | `ios/ci_scripts/ci_post_clone.sh` exécute les 26 tests Swift ; un échec bloque l'archive |
| Actions | Archive iOS, scheme partagé `MyCycleWorld`, TestFlight (Internal Testing Only) |
| Post-Actions | TestFlight Internal Testing, groupe `MyCycleGroup` (2 membres lors de la configuration) |
| Numérotation | Prochain build initial fixé à `100`, puis incrémentation automatique par Xcode Cloud |

Le déclenchement couvre aussi les changements du site et de la documentation, conformément au choix « chaque push sur main ». Le jeu web est chargé depuis GitHub Pages ; son déploiement reste distinct de l'archive iOS.

Validation du 5 octobre 2026 : compilation Release pour appareil iOS, 26 tests Swift et 42 tests JavaScript réussis. Le push `4c9f666` a déclenché automatiquement le build cloud **100**, avec archivage et distribution TestFlight réussis en environ 3 minutes. Le build **1.0 (100)** est disponible en statut **Testing** dans `MyCycleGroup`.

## État du dépôt (vérifié)

- Scheme partagé `MyCycleWorld` (`ios/MyCycleWorld.xcodeproj/xcshareddata/xcschemes/`) : obligatoire pour Xcode Cloud.
- Manifeste de liaison au produit Apple dans `ios/MyCycleWorld.xcodeproj/xcshareddata/xcodecloud/manifest.json` ; les actions et déclencheurs se modifient chez Apple.
- Aucune dépendance Swift externe ni Pods. Le package Swift local teste les protocoles et le pont du jeu ; le script `ci_post_clone.sh` l'exécute avant archivage, sans installer d'outil supplémentaire.
- Signature automatique, équipe `JQ4Z5PXR5K`, Bundle ID `com.gbillois.MyCycleWorld`, iOS 17 minimum.
- Le workflow utilise la dernière version stable de Xcode disponible chez Apple.
- Aucun secret dans le dépôt (il est public) : la signature est gérée par Apple dans le cloud.

## Reconfiguration / dépannage

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
| Files and Folders | **Start a Build If Any File Changes** |
| Actions | **Archive, iOS**, scheme `MyCycleWorld`, Deployment Preparation : **TestFlight (Internal Testing Only)** |
| Post-Actions | **TestFlight Internal Testing**, groupe `MyCycleGroup` |

5. Enregistre le workflow.

### 3. Les testeurs

Les testeurs internes doivent être des utilisateurs App Store Connect (**Users and Access**) et membres du groupe interne choisi dans la post-action. Adresses prévues dans `testflight_upload.command` : `vincent@billois.com` et `gerome@billois.com`.

### 4. Vérifier

1. Lance un premier build à la main (**Start Build** dans Xcode, ou dans App Store Connect, onglet Xcode Cloud).
2. Quand il est vert et que le build apparaît dans TestFlight, pousse un changement sur `main` : un build doit démarrer tout seul.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « The bundle version must be higher... » | Étape 1 : augmenter le Next Build Number. |
| Échec de signature | Vérifier l'équipe dans Xcode et que le Bundle ID est bien enregistré dans le compte Apple. |
| Aucun build après un push | Vérifier que le workflow est activé, la branche (`main`) et l'accès GitHub. |
| Build vert mais rien dans TestFlight | Vérifier la post-action TestFlight et l'appartenance des testeurs au groupe. |

Le programme développeur inclut un quota mensuel d'heures de calcul Xcode Cloud (25 heures au moment de l'écriture, à vérifier dans App Store Connect). Cette appli, sans dépendance, compile vite.

La disponibilité dans TestFlight dépend de la file d'attente Xcode Cloud, de l'archivage et du traitement Apple. Le déclenchement est automatique, mais un délai de quelques minutes ne peut pas être garanti. Activer les mises à jour automatiques de l'app dans TestFlight sur l'iPhone/iPad si souhaité.

## Si le projet change

- Ajout de dépendances externes : compléter `ios/ci_scripts/ci_post_clone.sh` (au même niveau que le `.xcodeproj`, exécutable) en conservant les tests avant archivage.
- Envoi manuel de secours : `ios/testflight_upload.command` ou `ios/scripts/archive.sh` restent valables.
