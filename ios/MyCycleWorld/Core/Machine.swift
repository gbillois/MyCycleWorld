import Foundation

// Machines FTMS autres que le vélo (elliptique, rameur) : type détecté, mesures fusionnées, pente du jeu
// convertie en résistance. Même logique que src/ble/trainer.js côté web ; testé avec `swift test`.

/// Type de machine, d'après la caractéristique de données présente (valeurs identiques au jeu web).
enum MachineKind: String, CaseIterable, Codable {
    case bike, cross, rower, treadmill, power

    var label: String {
        switch self {
        case .bike: return "Vélo"
        case .cross: return "Vélo elliptique"
        case .rower: return "Rameur"
        case .treadmill: return "Tapis de course"
        case .power: return "Capteur de puissance"
        }
    }

    /// Même ordre que le web : vélo, rameur, elliptique, puis tapis, puis Cycling Power seul.
    /// `characteristics` : UUID courts en majuscules (« 2AD2 »), tels que CBUUID.uuidString les donne.
    static func detect(characteristics: Set<String>) -> MachineKind? {
        if characteristics.contains("2AD2") { return .bike }
        if characteristics.contains("2AD1") { return .rower }
        if characteristics.contains("2ACE") { return .cross }
        if characteristics.contains("2ACD") { return .treadmill }
        if characteristics.contains("2A63") { return .power }
        return nil
    }
}

/// Plage de niveaux (Supported Resistance Level Range), déjà divisée par 10.
struct LevelRange: Equatable {
    var min: Double
    var max: Double
    var step: Double

    /// Plage supposée quand la machine ne la publie pas (comme le web).
    static let fallback = LevelRange(min: 0, max: 20, step: 0)

    /// Niveau à une fraction de la plage (0 = minimum, 1 = maximum).
    func level(at fraction: Double) -> Double { min + (max - min) * fraction }
}

/// Comment appliquer la pente du jeu à la machine connectée.
enum GradeControl: Equatable {
    case simulation, resistance, none

    /// Elliptique, rameur (et tapis) : pas de mode simulation, la pente devient une résistance.
    /// Vélo : mode simulation ; repli sur la résistance si la machine ne sait faire que ça.
    static func choose(kind: MachineKind?, simulation: Bool, resistance: Bool) -> GradeControl {
        switch kind {
        case .cross?, .rower?, .treadmill?:
            return resistance ? .resistance : .none
        default:
            if simulation { return .simulation }
            return resistance ? .resistance : .none
        }
    }
}

/// Pente -> niveau de résistance (setResistanceForGrade côté web) :
/// t = (pente + 4) / 16 borné à [0, 1], niveau = min + (max - min) × (0,15 + 0,7 t).
struct GradeResistance {
    private(set) var lastLevel: Double?

    static func level(grade: Double, range: LevelRange?) -> Double {
        let r = range ?? .fallback
        let t = max(0, min(1, ((grade.isFinite ? grade : 0) + 4) / 16))
        return r.level(at: 0.15 + t * 0.7)
    }

    /// Niveau à envoyer, ou nil s'il diffère trop peu du dernier (moins d'un pas, 0,5 par défaut).
    mutating func next(grade: Double, range: LevelRange?) -> Double? {
        let level = GradeResistance.level(grade: grade, range: range)
        let step = (range ?? .fallback).step
        if let lastLevel, abs(level - lastLevel) < (step > 0 ? step : 0.5) { return nil }
        lastLevel = level
        return level
    }

    mutating func reset() { lastLevel = nil }
}

/// Codage de « Set Target Resistance Level » : un octet (FTMS 1.0, comme le web) par défaut,
/// deux octets signés si la valeur ne tient pas sur un octet ou si la machine a refusé la forme courte.
struct ResistanceEncoder {
    private(set) var wide = false

    func encode(_ level: Double) -> [UInt8] {
        let tenths = ((level.isFinite ? level : 0) * 10).rounded()
        if wide || tenths < 0 || tenths > 255 { return BLEProtocol.resistance(level) }
        return BLEProtocol.resistance8(level)
    }

    /// Réponse « paramètre invalide » à la forme courte : on passe à la forme longue. Vrai s'il faut renvoyer.
    mutating func refused(_ sent: [UInt8], result: UInt8) -> Bool {
        guard !wide, sent.count == 2, sent.first == 0x04, result == 3 else { return false }
        wide = true
        return true
    }
}

/// Journal des paquets : les `first` premiers, puis 1 sur `every` (packetSampler côté web).
struct PacketSampler {
    let first: Int
    let every: Int
    private(set) var count = 0

    init(first: Int, every: Int) {
        self.first = first
        self.every = max(1, every)
    }

    mutating func sample() -> Bool {
        count += 1
        return count <= first || count % every == 0
    }
}

/// Mesures du trainer ou de la machine, fusionnées comme dans Trainer.onFtmsData / onCpsData (web) :
/// FTMS reste la source d'une valeur dès qu'il l'a fournie ; une valeur sans nouvelle depuis 5 s disparaît.
struct TrainerFeed {
    static let staleAfter: TimeInterval = 5
    private static let live = ["power", "cadence", "speed", "heartRate", "strokeRate", "stepRate", "pace"]

    private(set) var data = BikeReading()
    private(set) var sources: [String: String] = [:]
    private(set) var packets = 0
    private(set) var lastPacket: TimeInterval?
    private var updated: [String: TimeInterval] = [:]
    private var crank = CrankCadence()
    private var strokeMark: (count: Int, time: TimeInterval)?
    private var derivedStrokeRate: Double?

    /// Cadence de coups de secours : certains rameurs (Skillrow notamment, vu par TrackMyIndoorWorkout)
    /// n'envoient pas la cadence instantanée, ou l'envoient à 0. On prend la moyenne, sinon on la déduit
    /// du compteur de coups.
    mutating func strokeRate(_ d: BikeReading, now: TimeInterval) -> Double? {
        if let count = d.strokeCount {
            if let mark = strokeMark, count >= mark.count {
                let dt = now - mark.time
                if count > mark.count, dt >= 1.5 {
                    let rate = Double(count - mark.count) / dt * 60
                    derivedStrokeRate = derivedStrokeRate.map { $0 * 0.5 + rate * 0.5 } ?? rate
                    strokeMark = (count, now)
                } else if dt > 8 {
                    derivedStrokeRate = 0 // plus aucun coup depuis 8 s
                    strokeMark = (count, now)
                }
            } else {
                strokeMark = (count, now)
            }
        }
        if let s = d.strokeRate, s > 0 { return s }
        if let a = d.avgStrokeRate, a > 0 { return a }
        if let derived = derivedStrokeRate { return derived }
        return d.strokeRate
    }

    /// Paquet FTMS (vélo, elliptique ou rameur). Renvoie les changements de source, pour le journal.
    @discardableResult
    mutating func ftms(_ d: BikeReading, kind: MachineKind, now: TimeInterval) -> [String] {
        packets += 1
        lastPacket = now
        var changes: [String] = []
        var power = d.power
        // Rameur sans puissance : estimée depuis l'allure.
        if power == nil, kind == .rower, let pace = d.pace, pace > 0 {
            power = Int(BLEProtocol.rowerPower(pace500: Double(pace)).rounded())
        }
        set(\.power, "power", power, "FTMS", now, &changes)
        set(\.cadence, "cadence", d.cadence, "FTMS", now, &changes)
        // Elliptique : une révolution = deux pas ; rameur : la « cadence » est la cadence de coups.
        if let steps = d.stepRate {
            set(\.stepRate, "stepRate", steps, "FTMS", now, &changes)
            set(\.cadence, "cadence", Double(steps) / 2, "FTMS", now, &changes)
        }
        if kind == .rower, let strokes = strokeRate(d, now: now) {
            set(\.strokeRate, "strokeRate", strokes, "FTMS", now, &changes)
            set(\.cadence, "cadence", strokes, "FTMS", now, &changes)
        } else if let strokes = d.strokeRate {
            set(\.strokeRate, "strokeRate", strokes, "FTMS", now, &changes)
            set(\.cadence, "cadence", strokes, "FTMS", now, &changes)
        }
        set(\.strokeCount, "strokeCount", d.strokeCount, "FTMS", now, &changes)
        set(\.distance, "distance", d.distance, "FTMS", now, &changes)
        set(\.pace, "pace", d.pace, "FTMS", now, &changes)
        set(\.speed, "speed", d.speed, "FTMS", now, &changes)
        if let hr = d.heartRate, hr > 0 { set(\.heartRate, "heartRate", hr, "FTMS", now, &changes) }
        set(\.resistance, "resistance", d.resistance, "FTMS", now, &changes)
        return changes
    }

    /// Paquet Cycling Power : utilisé seulement pour ce que FTMS ne fournit pas.
    @discardableResult
    mutating func cyclingPower(power: Int, revs: Int?, time: Int?, now: TimeInterval) -> [String] {
        packets += 1
        lastPacket = now
        var changes: [String] = []
        if sources["power"] != "FTMS" { set(\.power, "power", power, "Cycling Power", now, &changes) }
        if let revs, let time, sources["cadence"] != "FTMS" {
            let cadence = crank.update(revs: revs, time: time, now: now).rounded()
            set(\.cadence, "cadence", cadence, "Cycling Power", now, &changes)
        }
        return changes
    }

    /// Efface les mesures périmées. Vrai si quelque chose a changé.
    @discardableResult
    mutating func expire(now: TimeInterval) -> Bool {
        var changed = false
        for name in TrainerFeed.live {
            guard let at = updated[name], now - at > TrainerFeed.staleAfter else { continue }
            updated[name] = nil
            sources[name] = nil
            changed = true
            switch name {
            case "power": data.power = nil
            case "cadence": data.cadence = nil
            case "speed": data.speed = nil
            case "heartRate": data.heartRate = nil
            case "strokeRate": data.strokeRate = nil
            case "stepRate": data.stepRate = nil
            default: data.pace = nil
            }
        }
        return changed
    }

    private mutating func set<T>(_ key: WritableKeyPath<BikeReading, T?>, _ name: String, _ value: T?, _ source: String,
                                 _ now: TimeInterval, _ changes: inout [String]) {
        guard let value else { return }
        if sources[name] == "FTMS" && source != "FTMS" { return }
        data[keyPath: key] = value
        updated[name] = now
        if sources[name] != source {
            sources[name] = source
            changes.append("Source \(name) : \(source)")
        }
    }
}

/// Textes du test de connexion (mêmes libellés que la page web).
enum MachineText {
    /// Allure m:ss.s (formatSplit côté web).
    static func split(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds <= 5999 else { return "-:--" }
        let m = Int(seconds / 60)
        let s = seconds - Double(m * 60)
        return "\(m):\(s < 10 ? "0" : "")\(String(format: "%.1f", s))"
    }

    static func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    /// « 182 W · 26 coups/min · 300 m · 2:05.0 /500 m … »
    static func measures(_ d: BikeReading) -> String {
        var parts: [String] = []
        if let p = d.power { parts.append("\(p) W") }
        if let s = d.strokeRate { parts.append("\(Int(s.rounded())) coups/min") }
        else if let s = d.stepRate { parts.append("\(s) pas/min") }
        else if let c = d.cadence { parts.append("\(Int(c.rounded())) rpm") }
        if let v = d.speed { parts.append(String(format: "%.1f km/h", v)) }
        if let m = d.distance { parts.append("\(m) m") }
        if let pace = d.pace, pace > 0 { parts.append("\(split(Double(pace))) /500 m") }
        if let r = d.resistance { parts.append("résistance \(number(r))") }
        if let hr = d.heartRate, hr > 0 { parts.append("\(hr) bpm") }
        return parts.isEmpty ? "-" : parts.joined(separator: " · ")
    }

    /// « 850 ms » ou « 2.4 s »
    static func age(_ seconds: TimeInterval) -> String {
        seconds < 1 ? "\(Int((seconds * 1000).rounded())) ms" : String(format: "%.1f s", seconds)
    }
}
