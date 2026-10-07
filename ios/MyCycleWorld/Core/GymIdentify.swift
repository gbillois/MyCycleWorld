import Foundation

// Identifier SA machine parmi des dizaines qui émettent toutes (GymStore.swift). Deux méthodes, plus sûres que
// la position sur le plan pour départager deux machines voisines :
//   1. Téléphone posé sur la console : le signal de cette machine domine nettement tous les autres.
//   2. Mouvement : l'appli écoute brièvement (lecture seule) les machines les plus proches, demande de
//      commencer l'effort, et retient celle qui se met à bouger à ce moment-là. Les machines qui bougeaient
//      déjà (un autre sportif dessus) sont écartées.
// Module pur, testé dans Tests/GymIdentifyTests.swift. Le jeu reçoit le résultat dans la carte (GymPayload).

enum GymIdentify {
    /// Téléphone collé à la console : RSSI d'au moins -50 dBm…
    static let contactRSSI = -50
    /// … et au moins 8 dB de plus que la machine suivante (à 1 m, l'écart dépasse largement 10 dB).
    static let contactMargin = 8

    /// Machine sur laquelle le téléphone est posé, d'après les signaux entendus (dans n'importe quel ordre).
    static func byContact(_ heard: [(id: UUID, rssi: Int)]) -> UUID? {
        let sorted = heard.sorted { $0.rssi > $1.rssi }
        guard let first = sorted.first, first.rssi >= contactRSSI else { return nil }
        if sorted.count > 1, first.rssi - sorted[1].rssi < contactMargin { return nil }
        return first.id
    }

    /// Des données d'effort (quelqu'un pédale, rame ou marche) ? Même règle que le départ du jeu (isMoving).
    static func moving(_ r: BikeReading) -> Bool {
        (r.power ?? 0) > 0 || (r.cadence ?? 0) > 0 || (r.speed ?? 0) > 0.5 || (r.strokeRate ?? 0) > 0 || (r.stepRate ?? 0) > 0
    }

    /// Données d'effort dans un paquet d'une caractéristique de données (Indoor Bike, Rower, Cross Trainer,
    /// Treadmill Data, Cycling Power). nil : caractéristique sans intérêt ou paquet illisible.
    static func moving(characteristic id: String, bytes: [UInt8]) -> Bool? {
        switch id.uppercased() {
        case "2AD2": return (try? BLEProtocol.indoorBike(bytes)).map(moving)
        case "2AD1": return (try? BLEProtocol.rower(bytes)).map(moving)
        case "2ACE": return (try? BLEProtocol.crossTrainer(bytes)).map(moving)
        case "2ACD": return (try? BLEProtocol.treadmill(bytes)).map(moving)
        case "2A63": return (try? BLEProtocol.cyclingPower(bytes)).map { $0.power > 0 }
        default: return nil
        }
    }

    static let dataCharacteristics: Set<String> = ["2AD2", "2AD1", "2ACE", "2ACD", "2A63"]
}

/// Identification par le mouvement : une période calme (le joueur ne bouge pas), puis le signal « vas-y ».
/// Une machine qui bouge pendant la période calme est occupée par quelqu'un d'autre ; la machine du joueur
/// est celle qui se met à bouger après le signal (deux paquets d'effort au moins, pour ignorer un paquet isolé).
struct MotionTracker {
    /// Paquets d'effort nécessaires après le signal.
    static let confirmPackets = 2

    private(set) var promptAt: TimeInterval?
    private(set) var busy: Set<UUID> = []
    private var startedAt: [UUID: TimeInterval] = [:]
    private var counts: [UUID: Int] = [:]

    /// Fin de la période calme : le joueur doit commencer.
    mutating func prompt(at t: TimeInterval) { promptAt = t }

    mutating func record(_ id: UUID, moving: Bool, at t: TimeInterval) {
        guard let promptAt, t >= promptAt else {
            if moving { busy.insert(id) }
            return
        }
        guard moving, !busy.contains(id) else { return }
        if startedAt[id] == nil { startedAt[id] = t }
        counts[id, default: 0] += 1
    }

    /// Machine du joueur : la première confirmée après le signal ; à égalité, le signal le plus fort.
    func winner(rssi: [UUID: Int] = [:]) -> UUID? {
        let confirmed = counts.filter { $0.value >= MotionTracker.confirmPackets }.keys
        return confirmed.min { a, b in
            let ta = startedAt[a] ?? .infinity, tb = startedAt[b] ?? .infinity
            if abs(ta - tb) > 0.25 { return ta < tb }
            return (rssi[a] ?? -127) > (rssi[b] ?? -127)
        }
    }
}
