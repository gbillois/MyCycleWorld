# Validation locale — 4 octobre 2026

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
