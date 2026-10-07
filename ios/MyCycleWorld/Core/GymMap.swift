import Foundation

// Cartographie des salles de sport : plusieurs lieux (un par défaut), chacun avec son plan rectangulaire
// (en mètres) et les machines repérées dessus. Cette partie ne dépend que de Foundation : elle est testée
// avec `swift test` (Tests/GymMapTests.swift). La recherche Bluetooth est dans GymStore.swift, les écrans
// dans GymViews.swift, et le choix de la machine au lancement d'un niveau dans le jeu (game/gym-picker.js).
//
// Repérage : on ne connaît pas la position du téléphone dans la salle. Le joueur touche le plan là où il se
// trouve et reste immobile quelques secondes (une « station ») : l'appli note la force du signal (RSSI) de
// chaque machine. Avec au moins trois stations bien réparties, la position de chaque machine est celle qui
// explique le mieux ces signaux avec un modèle d'affaiblissement en distance (log-distance), la puissance
// d'émission propre à chaque machine étant inconnue (estimée en même temps). Précision attendue : 2 à 4 m
// dans une salle (corps, métal) ; la machine « la plus proche maintenant » et le placement à la main
// complètent la carte.

/// D'où vient le type d'une machine (du plus sûr au moins sûr).
enum GymKindSource: String, Codable {
    /// Choisi à la main.
    case chosen
    /// Lu sur la machine (caractéristique FTMS de ses données) lors d'une connexion de quelques secondes.
    case detected
    /// Annoncé par la machine sans connexion (données de service FTMS de l'annonce Bluetooth).
    case advertised
    /// Deviné d'après son nom Bluetooth (SKILLROW, MYRUN, BIKE…).
    case name

    var rank: Int {
        switch self {
        case .chosen: return 3
        case .detected: return 2
        case .advertised: return 1
        case .name: return 0
        }
    }
}

/// Une machine repérée dans une salle. `id` est l'identifiant CoreBluetooth du périphérique (stable pour un
/// même téléphone).
struct GymMachine: Codable, Identifiable, Equatable {
    var id: UUID
    /// Nom annoncé en Bluetooth.
    var name: String
    /// Nom donné par le joueur (« Rameur près de la fenêtre »).
    var label: String?
    var kind: MachineKind?
    var kindSource: GymKindSource?
    /// Modèle lu sur la machine (Device Information), s'il y en a un.
    var model: String?
    /// Position en mètres sur le plan (x vers la droite, y vers l'entrée en bas), nil tant qu'elle est inconnue.
    var x: Double?
    var y: Double?
    /// Rayon d'incertitude de la position (m).
    var error: Double?
    /// Position posée à la main : la cartographie ne la déplace plus.
    var pinned = false
    var lastSeen: Date?

    var title: String {
        let custom = label?.trimmingCharacters(in: .whitespaces)
        return custom?.isEmpty == false ? custom! : name
    }
    var placed: Bool { x != nil && y != nil }

    /// Retient un type s'il vient d'une source au moins aussi sûre que l'actuelle.
    mutating func offer(kind: MachineKind?, source: GymKindSource) {
        guard let kind else { return }
        if let current = kindSource, current.rank > source.rank { return }
        self.kind = kind
        kindSource = source
    }
}

/// Une station de mesure : là où se tenait le joueur, et le RSSI médian de chaque machine entendue.
struct GymStation: Codable, Equatable {
    var x: Double
    var y: Double
    /// RSSI (dBm) par identifiant de machine (UUID en texte).
    var rssi: [String: Double]
}

/// Une séance de cartographie (initiale ou mise à jour). La plus récente fait foi pour une machine qu'elle a
/// assez entendue : une machine déplacée depuis est donc replacée.
struct GymSession: Codable, Equatable {
    var date: Date
    var stations: [GymStation] = []
}

/// Un lieu (salle de sport, club, hôtel…) et son plan.
struct GymPlace: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    /// Dimensions du plan (m) : largeur (gauche-droite) et profondeur (fond-entrée).
    var width: Double
    var depth: Double
    var machines: [GymMachine] = []
    var sessions: [GymSession] = []
    /// Appareils retirés de la carte : la cartographie ne les rajoute plus.
    var ignored: [UUID] = []

    static let sizeRange: ClosedRange<Double> = 4...120

    init(id: UUID = UUID(), name: String, width: Double = 20, depth: Double = 12) {
        self.id = id
        self.name = name
        self.width = min(GymPlace.sizeRange.upperBound, max(GymPlace.sizeRange.lowerBound, width))
        self.depth = min(GymPlace.sizeRange.upperBound, max(GymPlace.sizeRange.lowerBound, depth))
    }

    var stationCount: Int { sessions.reduce(0) { $0 + $1.stations.count } }

    func machine(_ id: UUID) -> GymMachine? { machines.first { $0.id == id } }

    /// Ajoute (ou met à jour) une machine entendue.
    @discardableResult
    mutating func see(id: UUID, name: String, at date: Date) -> Bool {
        guard !ignored.contains(id) else { return false }
        if let i = machines.firstIndex(where: { $0.id == id }) {
            if !name.isEmpty { machines[i].name = name }
            machines[i].lastSeen = date
        } else {
            machines.append(GymMachine(id: id, name: name, lastSeen: date))
        }
        return true
    }

    mutating func update(_ id: UUID, _ change: (inout GymMachine) -> Void) {
        guard let i = machines.firstIndex(where: { $0.id == id }) else { return }
        change(&machines[i])
    }

    mutating func remove(_ id: UUID) {
        machines.removeAll { $0.id == id }
        if !ignored.contains(id) { ignored.append(id) }
    }

    /// Pose une machine à la main (bornée au plan).
    mutating func pin(_ id: UUID, x: Double, y: Double) {
        let px = min(width, max(0, x)), py = min(depth, max(0, y))
        update(id) { m in
            m.x = px; m.y = py; m.error = 0.5; m.pinned = true
        }
    }

    /// Rend une machine posée à la main à la cartographie automatique.
    mutating func unpin(_ id: UUID) {
        update(id) { $0.pinned = false }
        relocate()
    }

    /// Change les dimensions du plan : stations et machines sont gardées dans le nouveau rectangle.
    mutating func resize(width w: Double, depth d: Double) {
        width = min(GymPlace.sizeRange.upperBound, max(GymPlace.sizeRange.lowerBound, w))
        depth = min(GymPlace.sizeRange.upperBound, max(GymPlace.sizeRange.lowerBound, d))
        for s in sessions.indices {
            for k in sessions[s].stations.indices {
                sessions[s].stations[k].x = min(width, sessions[s].stations[k].x)
                sessions[s].stations[k].y = min(depth, sessions[s].stations[k].y)
            }
        }
        for i in machines.indices where machines[i].pinned {
            machines[i].x = machines[i].x.map { min(width, $0) }
            machines[i].y = machines[i].y.map { min(depth, $0) }
        }
        relocate()
    }

    /// Relevés d'une machine : ceux de la séance la plus récente qui l'a entendue depuis au moins trois
    /// stations, sinon tous ceux des séances.
    func readings(for id: UUID) -> [GymReading] {
        let key = id.uuidString
        for session in sessions.reversed() {
            let found = session.stations.compactMap { s in s.rssi[key].map { GymReading(x: s.x, y: s.y, rssi: $0) } }
            if found.count >= GymLocator.minStations { return found }
        }
        return sessions.flatMap { $0.stations.compactMap { s in s.rssi[key].map { GymReading(x: s.x, y: s.y, rssi: $0) } } }
    }

    /// Recalcule la position des machines qui ne sont pas posées à la main.
    mutating func relocate() {
        for i in machines.indices where !machines[i].pinned {
            guard let e = GymLocator.locate(readings(for: machines[i].id), width: width, depth: depth) else { continue }
            machines[i].x = e.x; machines[i].y = e.y; machines[i].error = e.error
        }
    }
}

/// Un relevé : position du joueur et RSSI d'une machine.
struct GymReading: Equatable {
    var x: Double
    var y: Double
    var rssi: Double
}

/// Position estimée d'une machine.
struct GymEstimate: Equatable {
    var x: Double
    var y: Double
    /// Rayon d'incertitude (m).
    var error: Double
}

/// Estimation de position par moindres carrés pondérés sur un modèle log-distance :
///   rssi ≈ A − 10 n log10(d), avec A (RSSI à 1 m) inconnu, estimé pour chaque position candidate.
/// Recherche sur une grille du plan (0,5 m) puis affinage (0,1 m) autour du meilleur point.
enum GymLocator {
    /// Exposant d'affaiblissement en intérieur (2 en champ libre, plus avec les corps et le métal).
    static let pathLoss = 2.2
    /// Plage plausible du RSSI à 1 m pour une console de machine.
    static let txRange: ClosedRange<Double> = -75 ... -40
    static let minStations = 3

    /// Poids d'un relevé : un signal fort (machine proche) est plus fiable qu'un signal faible.
    static func weight(_ rssi: Double) -> Double {
        let t = max(0.15, min(1.5, (rssi + 100) / 40))
        return t * t
    }

    /// Distance (m) d'après un RSSI et le RSSI à 1 m.
    static func distance(rssi: Double, tx: Double = -59) -> Double {
        pow(10, (tx - rssi) / (10 * pathLoss))
    }

    static func cost(_ readings: [GymReading], x: Double, y: Double) -> Double {
        // v = rssi + 10 n log10(d) vaut A pour chaque relevé si le modèle est exact : on mesure leur dispersion.
        func value(_ r: GymReading) -> Double {
            let d = max(0.5, ((x - r.x) * (x - r.x) + (y - r.y) * (y - r.y)).squareRoot())
            return r.rssi + 10 * pathLoss * log10(d)
        }
        var sw = 0.0, sa = 0.0
        for r in readings { let w = weight(r.rssi); sw += w; sa += w * value(r) }
        guard sw > 0 else { return .infinity }
        let a = sa / sw
        var c = 0.0
        for r in readings { let e = value(r) - a; c += weight(r.rssi) * e * e }
        // A hors de la plage plausible : pénalité (évite une machine « très loin et très puissante »).
        let clamped = min(txRange.upperBound, max(txRange.lowerBound, a))
        c += sw * (a - clamped) * (a - clamped)
        return c / sw
    }

    static func locate(_ readings: [GymReading], width: Double, depth: Double) -> GymEstimate? {
        guard !readings.isEmpty, width > 0, depth > 0 else { return nil }
        if readings.count < minStations {
            // Une ou deux stations : la machine est vers la station qui l'entend le mieux, à la distance
            // donnée par son signal (direction inconnue).
            let best = readings.max { $0.rssi < $1.rssi }!
            return GymEstimate(x: best.x, y: best.y, error: min(max(width, depth), max(1.5, distance(rssi: best.rssi))))
        }
        let step = 0.5
        let nx = Int((width / step).rounded(.up)), ny = Int((depth / step).rounded(.up))
        var costs: [Double] = []
        costs.reserveCapacity((nx + 1) * (ny + 1))
        var best = (x: 0.0, y: 0.0, c: Double.infinity)
        for j in 0...ny {
            let y = min(depth, Double(j) * step)
            for i in 0...nx {
                let x = min(width, Double(i) * step)
                let c = cost(readings, x: x, y: y)
                costs.append(c)
                if c < best.c { best = (x, y, c) }
            }
        }
        // Affinage autour du meilleur point de la grille.
        var fine = best
        var dy = -step
        while dy <= step + 1e-9 {
            var dx = -step
            while dx <= step + 1e-9 {
                let x = min(width, max(0, best.x + dx)), y = min(depth, max(0, best.y + dy))
                let c = cost(readings, x: x, y: y)
                if c < fine.c { fine = (x, y, c) }
                dx += 0.1
            }
            dy += 0.1
        }
        // Incertitude : surface des points presque aussi bons (écart quadratique moyen à moins de 2 dB de plus).
        let threshold = (fine.c.squareRoot() + 2) * (fine.c.squareRoot() + 2)
        let near = costs.filter { $0 <= threshold }.count
        let radius = (Double(max(1, near)) * step * step / Double.pi).squareRoot()
        return GymEstimate(x: fine.x, y: fine.y, error: min(max(width, depth), max(0.5, radius)))
    }
}

/// Type de machine deviné sans connexion : données de service FTMS de l'annonce, ou nom Bluetooth.
enum GymKindGuess {
    /// Données de service FTMS (annonce) : Flags (1 octet), puis Fitness Machine Type (16 bits, petit-boutiste) :
    /// bit 0 tapis, 1 elliptique, 2 stepper, 3 escalier, 4 rameur, 5 vélo.
    static func ftmsServiceData(_ bytes: [UInt8]) -> MachineKind? {
        guard bytes.count >= 3 else { return nil }
        let type = UInt16(bytes[1]) | UInt16(bytes[2]) << 8
        if type & (1 << 5) != 0 { return .bike }
        if type & (1 << 4) != 0 { return .rower }
        if type & (1 << 1) != 0 { return .cross }
        if type & 1 != 0 { return .treadmill }
        return nil
    }

    /// Nom Bluetooth : SKILLROW → rameur, SKILLBIKE / MYCYCLING / BIKE n → vélo, MYRUN / SKILLMILL /
    /// TREADMILL → tapis, SYNCHRO / CROSS / VARIO → elliptique. Rien de sûr : une connexion le confirmera.
    static func name(_ name: String) -> MachineKind? {
        let n = name.uppercased()
        if n.contains("ROW") || n.contains("RAMEUR") { return .rower }
        if ["CROSS", "SYNCHRO", "VARIO", "ELLIP"].contains(where: { n.contains($0) }) { return .cross }
        if ["TREADMILL", "MILL", "MYRUN", "RUN ", "TAPIS"].contains(where: { n.contains($0) }) || n.hasSuffix("RUN") { return .treadmill }
        if ["BIKE", "CYCL", "SPIN", "RECLINE", "VELO", "VÉLO"].contains(where: { n.contains($0) }) { return .bike }
        return nil
    }
}

/// Toutes les salles et le lieu par défaut (enregistré tel quel en JSON).
struct GymBook: Codable, Equatable {
    var places: [GymPlace] = []
    var defaultID: UUID?

    var defaultPlace: GymPlace? { places.first { $0.id == defaultID } ?? places.first }

    func place(_ id: UUID) -> GymPlace? { places.first { $0.id == id } }

    mutating func update(_ id: UUID, _ change: (inout GymPlace) -> Void) {
        guard let i = places.firstIndex(where: { $0.id == id }) else { return }
        change(&places[i])
    }

    @discardableResult
    mutating func add(name: String, width: Double = 20, depth: Double = 12) -> UUID {
        let place = GymPlace(name: name, width: width, depth: depth)
        places.append(place)
        if defaultID == nil { defaultID = place.id }
        return place.id
    }

    mutating func remove(_ id: UUID) {
        places.removeAll { $0.id == id }
        if defaultID == id { defaultID = places.first?.id }
    }

    /// Lieu où figure une machine (le lieu par défaut d'abord).
    func place(containing machine: UUID) -> GymPlace? {
        if let p = defaultPlace, p.machine(machine) != nil { return p }
        return places.first { $0.machine(machine) != nil }
    }

    func contains(machine: UUID) -> Bool { place(containing: machine) != nil }
}

/// Carte envoyée au jeu (révision 4 du pont) : lieux, machines et signaux entendus à l'instant.
struct GymPayload: Encodable, Equatable {
    struct Machine: Encodable, Equatable {
        var id: String
        var name: String
        var label: String?
        var kind: String?
        var x: Double?
        var y: Double?
        var err: Double?
    }
    struct Place: Encodable, Equatable {
        var id: String
        var name: String
        var width: Double
        var depth: Double
        var machines: [Machine]
    }
    /// Machine entendue à l'instant (sur la carte ou non).
    struct Nearby: Encodable, Equatable {
        var id: String
        var name: String
        var kind: String?
        var rssi: Int
    }

    var v = 1
    var defaultPlace: String?
    var places: [Place]
    var nearby: [Nearby]
    var scanning: Bool

    init(book: GymBook, nearby: [Nearby] = [], scanning: Bool = false) {
        let round = { (v: Double?) in v.map { ($0 * 10).rounded() / 10 } }
        defaultPlace = book.defaultPlace?.id.uuidString
        places = book.places.map { p in
            Place(id: p.id.uuidString, name: p.name, width: p.width, depth: p.depth,
                  machines: p.machines.map { m in
                      Machine(id: m.id.uuidString, name: m.name, label: m.title == m.name ? nil : m.title, kind: m.kind?.rawValue,
                              x: round(m.x), y: round(m.y), err: round(m.error))
                  })
        }
        self.nearby = nearby.sorted { $0.rssi > $1.rssi }
        self.scanning = scanning
    }

    func json() -> String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// RSSI médian d'une série de mesures (robuste aux pics des corps qui passent).
enum GymSignal {
    static func median(_ values: [Int]) -> Double? {
        guard !values.isEmpty else { return nil }
        let s = values.sorted()
        return s.count % 2 == 1 ? Double(s[s.count / 2]) : Double(s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }

    /// Proximité en mots, d'après le RSSI (mêmes seuils que le jeu, src/core/gym.js).
    static func proximity(_ rssi: Int) -> String {
        if rssi >= -55 { return "juste devant toi" }
        if rssi >= -67 { return "tout près" }
        if rssi >= -80 { return "dans la salle" }
        return "loin"
    }
}
