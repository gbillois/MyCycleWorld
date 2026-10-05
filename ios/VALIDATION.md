# Validation du jeu iOS — 5 octobre 2026

Environnement : Xcode 27.0 (27A266a), iPhone 18 Pro et iPad Pro 13 pouces (M5) simulés sous iOS/iPadOS 27.0, lancement avec `--demo`.

| Vérification | Résultat |
| --- | --- |
| Intégration à l'app | `ContentView` présente `GameView` dans l'onglet Jeu ; `GameView.swift` et `Core/GameBridge.swift` appartiennent à la phase Sources du projet Xcode |
| Compilation Debug pour simulateur | Réussie |
| Tests Swift exécutés par `ci_scripts/ci_post_clone.sh` | 26 réussis, dont 10 tests du protocole du pont du jeu |
| Tests JavaScript | 42 réussis, dont 13 tests du pont natif |
| iPhone : accueil et départ de course | Scène 3D chargée, décompte, coureurs en mouvement et vitesse de course visibles |
| iPhone : mesures du pont natif | Watts, cadence et cardio du mode démo Swift actualisés dans le jeu |
| iPhone : bouton + | Vitesse 12 → 13 après échange jeu → Swift → jeu, pente ressentie +1 % sur terrain plat |
| iPad : accueil et départ de course | Scène 3D et mesures du mode démo visibles, course en mouvement |
| iPad : paysage et pause | Mise en page adaptée après rotation ; écran Pause et chronomètre arrêté |
| Pipeline avant cette nouvelle vérification | Push `4c9f666` → build cloud 100 → TestFlight 1.0 (100), statut Testing dans MyCycleGroup (Vincent et Gérôme) |

Le jeu est intégré à l'app via une **WKWebView** : le rendu et la simulation de course restent en JavaScript, chargés depuis GitHub Pages. Le cockpit, CoreBluetooth et le pont de commandes sont en Swift. Le jeu exige Internet pour charger la page et Three.js. Il ne s'agit pas d'un port complet du moteur 3D en Swift.

Le script post-clone exécute désormais les tests Swift avant chaque archive Xcode Cloud et bloque la livraison en cas d'échec. Les tests JavaScript sont exécutés localement ; aucun runtime Node n'est installé par ce script.

Limites : les mesures observées sont simulées. Le matériel Bluetooth réel, les manettes physiques et l'exécution sur iOS 17 n'ont pas été testés pendant cette vérification. Les captures locales se trouvent dans `~/Documents/MyCycleWorld-livraison/jeu-iphone.jpg` et `jeu-ipad.jpg`.

## Historique — validation locale du 4 octobre 2026

Environnement : Xcode 27.0 (27A266a), simulateurs iOS/iPadOS 27.0. Cible minimale configurée à iOS 17 ; aucun test d’exécution sur iOS 17 effectué.

| Vérification | Résultat |
| --- | --- |
| Tests JavaScript existants | 14 réussis, 0 échec |
| Tests Swift des protocoles et de la file FTMS | 16 réussis, 0 échec |
| Build Debug simulateur arm64 et x86_64 | Réussi |
| Installation/lancement démo iPhone 18 Pro simulé | Réussis, cockpit visible et mesures actualisées |
| Installation/lancement démo iPad Pro 13 pouces simulé | Réussis, cockpit visible et mesures actualisées |
| Archive Release arm64 sans signature | Réussie |
| Validation syntaxique des plist / projet Xcode | Réussie |
| Archive signée avec provisioning automatique | Bloquée : Xcode « No Accounts », aucun profil pour com.gbillois.MyCycleWorld |
| Envoi App Store Connect / disponibilité TestFlight | Non effectué |
| Connexion BLE et contrôle du trainer réels | Non testés : aucun iPhone/iPad physique connecté au Mac lors de la vérification |
| Boutons/firmware Zwift réels | Non testés |

L’avertissement Xcode « Metadata extraction skipped, no AppIntents.framework dependency found » est attendu : aucune fonction App Intents n’est définie.

Les captures et journaux locaux se trouvent dans `build/verification/` (ignorés par Git). L’archive `build/MyCycleWorld-unsigned.xcarchive` sert à vérifier la compilation Release ; elle n’est pas signée et ne peut pas être envoyée telle quelle sur TestFlight.

Les vérifications visuelles portent sur le cockpit en démo. Le parcours interactif complet, l’autorisation Bluetooth sur appareil réel, le changement d’orientation et le comportement radio nécessitent la recette décrite dans le README. L’accès automatisé à l’interface du Mac était bloqué par le verrouillage de session.

Prochaine action : connecter le compte Apple Developer à Xcode et confirmer l’équipe/Bundle ID, puis lancer `scripts/archive.sh`. En cas de choix d’une autre équipe, adapter `ExportOptions.plist` avant export en ligne de commande.

Après revue des dépôts de référence : écritures Zwift mises en file, identification du matériel et diagnostics de compatibilité ajoutés. Les 16 tests Swift et le build Debug simulateur passent. Les captures de cockpit ci-dessus précèdent cette révision du diagnostic ; aucun nouveau test radio réel effectué. Voir `REFERENCES.md`.
