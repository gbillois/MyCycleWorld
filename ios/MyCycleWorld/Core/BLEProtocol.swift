import Foundation

enum PacketError: Error { case truncated, invalid }

struct ByteReader {
    let bytes: [UInt8]
    var offset = 0
    init(_ bytes: [UInt8]) { self.bytes = bytes }
    mutating func take(_ count: Int) throws -> [UInt8] {
        guard count >= 0, count <= bytes.count - offset else { throw PacketError.truncated }
        defer { offset += count }
        return Array(bytes[offset..<(offset + count)])
    }
    mutating func u8() throws -> Int { Int(try take(1)[0]) }
    mutating func u16() throws -> Int { let b = try take(2); return Int(b[0]) | Int(b[1]) << 8 }
    mutating func i16() throws -> Int { Int(Int16(bitPattern: UInt16(try u16()))) }
    mutating func u24() throws -> Int { let b = try take(3); return Int(b[0]) | Int(b[1]) << 8 | Int(b[2]) << 16 }
    mutating func varint() throws -> UInt64 {
        var value: UInt64 = 0
        for index in 0..<10 {
            let byte = try u8()
            if index == 9 && byte > 1 { throw PacketError.invalid }
            value |= UInt64(byte & 127) << (index * 7)
            if byte & 128 == 0 { return value }
        }
        throw PacketError.invalid
    }
}

/// Mesures d'une machine FTMS (vélo, elliptique, rameur). Les champs absents du paquet restent nil.
struct BikeReading: Equatable {
    var speed: Double?
    var cadence: Double?
    var power: Int?
    var heartRate: Int?
    /// Niveau de résistance (brut pour vélo et rameur, résolution 0,1 pour l'elliptique, comme le jeu web).
    var resistance: Double?
    /// Rameur : coups par minute (résolution 0,5) et nombre de coups.
    var strokeRate: Double?
    var strokeCount: Int?
    /// Distance en mètres (24 bits).
    var distance: Int?
    /// Rameur : allure en secondes pour 500 m.
    var pace: Int?
    /// Elliptique : pas par minute.
    var stepRate: Int?
    var avgStrokeRate: Double?
    var avgPace: Int?
    var avgPower: Int?
    var avgStepRate: Int?
    var strideCount: Double?
    var inclination: Double?
    var elapsed: Int?
    var remaining: Int?
    var backward: Bool?
}

enum BLEProtocol {
    static func indoorBike(_ bytes: [UInt8]) throws -> BikeReading {
        var r = ByteReader(bytes)
        let flags = try r.u16()
        var result = BikeReading()
        if flags & 1 == 0 { result.speed = Double(try r.u16()) / 100 }
        if flags & 2 != 0 { _ = try r.take(2) }
        if flags & 4 != 0 { result.cadence = Double(try r.u16()) / 2 }
        if flags & 8 != 0 { _ = try r.take(2) }
        if flags & 16 != 0 { result.distance = try r.u24() }
        if flags & 32 != 0 { result.resistance = Double(try r.i16()) }
        if flags & 64 != 0 { result.power = try r.i16() }
        if flags & 128 != 0 { _ = try r.take(2) }
        if flags & 256 != 0 { _ = try r.take(5) }
        if flags & 512 != 0 { result.heartRate = try r.u8() }
        if flags & 1024 != 0 { _ = try r.take(1) }
        if flags & 2048 != 0 { _ = try r.take(2) }
        if flags & 4096 != 0 { _ = try r.take(2) }
        return result
    }
    /// FTMS Rower Data (0x2AD1), décodé comme parseRowerData dans src/ble/trainer.js.
    static func rower(_ bytes: [UInt8]) throws -> BikeReading {
        var r = ByteReader(bytes)
        let flags = try r.u16()
        var result = BikeReading()
        if flags & 1 == 0 {
            result.strokeRate = Double(try r.u8()) / 2
            result.strokeCount = try r.u16()
        }
        if flags & 2 != 0 { result.avgStrokeRate = Double(try r.u8()) / 2 }
        if flags & 4 != 0 { result.distance = try r.u24() }
        if flags & 8 != 0 { result.pace = try r.u16() }
        if flags & 16 != 0 { result.avgPace = try r.u16() }
        if flags & 32 != 0 { result.power = try r.i16() }
        if flags & 64 != 0 { result.avgPower = try r.i16() }
        if flags & 128 != 0 { result.resistance = Double(try r.i16()) }
        if flags & 256 != 0 { _ = try r.take(5) }
        if flags & 512 != 0 { result.heartRate = try r.u8() }
        if flags & 1024 != 0 { _ = try r.take(1) }
        if flags & 2048 != 0 { result.elapsed = try r.u16() }
        if flags & 4096 != 0 { result.remaining = try r.u16() }
        return result
    }
    /// FTMS Cross Trainer Data (0x2ACE) : les drapeaux tiennent sur 3 octets (parseCrossTrainerData côté web).
    static func crossTrainer(_ bytes: [UInt8]) throws -> BikeReading {
        var r = ByteReader(bytes)
        let flags = try r.u24()
        var result = BikeReading()
        if flags & 1 == 0 { result.speed = Double(try r.u16()) / 100 }
        if flags & 2 != 0 { _ = try r.take(2) }
        if flags & 4 != 0 { result.distance = try r.u24() }
        if flags & 8 != 0 {
            result.stepRate = try r.u16()
            result.avgStepRate = try r.u16()
        }
        if flags & 16 != 0 { result.strideCount = Double(try r.u16()) / 10 }
        if flags & 32 != 0 { _ = try r.take(4) }
        if flags & 64 != 0 { result.inclination = Double(try r.i16()) / 10; _ = try r.take(2) }
        if flags & 128 != 0 { result.resistance = Double(try r.i16()) / 10 }
        if flags & 256 != 0 { result.power = try r.i16() }
        if flags & 512 != 0 { result.avgPower = try r.i16() }
        if flags & 1024 != 0 { _ = try r.take(5) }
        if flags & 2048 != 0 { result.heartRate = try r.u8() }
        if flags & 4096 != 0 { _ = try r.take(1) }
        if flags & 8192 != 0 { result.elapsed = try r.u16() }
        if flags & 16384 != 0 { result.remaining = try r.u16() }
        result.backward = flags & 32768 != 0
        return result
    }
    /// Puissance estimée d'un rameur à partir de l'allure (formule Concept2 : W = 2,8 / (s/m)³).
    static func rowerPower(pace500: Double) -> Double {
        guard pace500.isFinite, pace500 > 0 else { return 0 }
        return 2.8 / pow(pace500 / 500, 3)
    }
    /// Supported Resistance Level Range (0x2AD6) : minimum, maximum et pas, en dixièmes.
    static func resistanceRange(_ bytes: [UInt8]) throws -> LevelRange {
        var r = ByteReader(bytes)
        let lo = try r.i16(), hi = try r.i16(), step = try r.u16()
        guard lo <= hi else { throw PacketError.invalid }
        return LevelRange(min: Double(lo) / 10, max: Double(hi) / 10, step: Double(step) / 10)
    }
    static func cyclingPower(_ bytes: [UInt8]) throws -> (power: Int, revs: Int?, time: Int?) {
        var r = ByteReader(bytes)
        let flags = try r.u16(), power = try r.i16()
        if flags & 1 != 0 { _ = try r.take(1) }
        if flags & 4 != 0 { _ = try r.take(2) }
        if flags & 16 != 0 { _ = try r.take(6) }
        if flags & 32 != 0 { return (power, try r.u16(), try r.u16()) }
        return (power, nil, nil)
    }
    static func heartRate(_ bytes: [UInt8]) throws -> (bpm: Int, contact: Bool?) {
        var r = ByteReader(bytes)
        let flags = try r.u8()
        return (try flags & 1 == 0 ? r.u8() : r.u16(), flags & 4 == 0 ? nil : flags & 2 != 0)
    }
    static func signed16(_ value: Int) -> [UInt8] {
        let n = UInt16(bitPattern: Int16(clamping: value))
        return [UInt8(n & 255), UInt8(n >> 8)]
    }
    static func simulation(grade: Double) -> [UInt8] {
        let safe = grade.isFinite ? min(327, max(-327, grade)) : 0
        return [0x11, 0, 0] + signed16(Int((safe * 100).rounded())) + [40, 51]
    }
    static func targetPower(_ watts: Int) -> [UInt8] { [0x05] + signed16(watts) }
    // FTMS Target Resistance Level is a signed 16-bit value in tenths.
    static func resistance(_ level: Double) -> [UInt8] {
        [0x04] + signed16(Int((min(3276.7, max(-3276.8, level.isFinite ? level : 0)) * 10).rounded()))
    }
    // Variante FTMS 1.0 sur un octet (dixièmes, de 0 à 25,5) : celle du jeu web et des rameurs/elliptiques.
    static func resistance8(_ level: Double) -> [UInt8] {
        [0x04, UInt8(max(0, min(255, ((level.isFinite ? level : 0) * 10).rounded())))]
    }
}

struct CrankCadence {
    private var last: (revs: Int, time: Int)?
    private var lastChange: TimeInterval = 0
    private(set) var value: Double = 0
    mutating func update(revs: Int, time: Int, now: TimeInterval) -> Double {
        if let last {
            let dr = (revs - last.revs + 65536) % 65536
            let dt = (time - last.time + 65536) % 65536
            if dr > 0 && dt > 0 {
                value = Double(dr) * 61440 / Double(dt)
                lastChange = now
            } else if now - lastChange > 2.5 { value = 0 }
        } else { lastChange = now }
        last = (revs, time)
        return value
    }
}

struct VirtualGears {
    private(set) var gear = 12
    var difficulty = 1.0
    var step = 1.0
    mutating func shift(_ delta: Int) { gear = max(1, min(24, gear + delta)) }
    func grade(_ terrain: Double) -> Double {
        (max(-10, min(20, terrain * difficulty + Double(gear - 12) * step)) * 100).rounded() / 100
    }
}

struct ProtoField {
    var number: Int
    var value: UInt64?
    var bytes: [UInt8]?
}
enum ZwiftProtocol {
    static let rideOn: [UInt8] = Array("RideOn".utf8)
    static let vibrate: [UInt8] = [0x12, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x02, 0x10, 0, 0x18, 0x20]
    static func fields(_ bytes: [UInt8]) throws -> [ProtoField] {
        var r = ByteReader(bytes), result: [ProtoField] = []
        while r.offset < bytes.count {
            let key = try r.varint()
            guard key >> 3 > 0, key >> 3 <= 536870911 else { throw PacketError.invalid }
            let number = Int(key >> 3)
            switch key & 7 {
            case 0: result.append(ProtoField(number: number, value: try r.varint()))
            case 2:
                let count = try r.varint()
                guard count <= UInt64(bytes.count - r.offset) else { throw PacketError.truncated }
                result.append(ProtoField(number: number, bytes: try r.take(Int(count))))
            case 1: _ = try r.take(8)
            case 5: _ = try r.take(4)
            default: throw PacketError.invalid
            }
        }
        return result
    }
    struct Buttons: Equatable {
        var pressed: Set<String> = []
        var analog: [String: Int] = [:]
        var side: String?
    }
    static func buttons(_ bytes: [UInt8]) throws -> Buttons? {
        guard let type = bytes.first, [7, 0x23, 0x37].contains(type) else { return nil }
        let f = try fields(Array(bytes.dropFirst()))
        func value(_ n: Int) -> UInt64? { f.last(where: { $0.number == n })?.value }
        func on(_ n: Int) -> Bool { (value(n) ?? 0) == 0 }
        func zigzag(_ v: UInt64) throws -> Int {
            guard v <= UInt64(UInt32.max) else { throw PacketError.invalid }
            return v & 1 == 0 ? Int(v / 2) : -Int(v / 2) - 1
        }
        var result = Buttons()
        if type == 7 {
            let side = on(1) ? "R" : "L"
            result.side = side
            let names = side == "R" ? ["Y", "Z", "A", "B", "SHIFT", "ON"] : ["UP", "LEFT", "RIGHT", "DOWN", "SHIFT", "ON"]
            for (i, name) in names.enumerated() where on(i + 2) { result.pressed.insert(side + "_" + name) }
            let v = try zigzag(value(8) ?? 0)
            result.analog[side] = v
            if abs(v) >= 25 { result.pressed.insert(side + "_PADDLE") }
        } else if type == 0x37 {
            if on(1) { result.pressed.insert("R_SHIFT") }
            if on(2) { result.pressed.insert("L_SHIFT") }
        } else {
            let names = ["L_LEFT", "L_UP", "L_RIGHT", "L_DOWN", "R_A", "R_B", "R_Y", "R_Z", "L_SHIFT", "L_SHIFT2", "L_POWERUP", "L_ON", "R_SHIFT", "R_SHIFT2", "R_POWERUP", "R_ON"]
            if let mask = value(1) {
                for (bit, name) in names.enumerated() where mask & (1 << bit) == 0 { result.pressed.insert(name) }
            }
            for sub in f where sub.number == 3 {
                guard let data = sub.bytes else { continue }
                let p = try fields(data)
                let location = p.last(where: { $0.number == 1 })?.value ?? 0
                guard location < 2 else { continue }
                let side = location == 0 ? "L" : "R"
                let v = try zigzag(p.last(where: { $0.number == 2 })?.value ?? 0)
                result.analog[side] = v
                result.side = result.side ?? side
                if abs(v) >= 25 { result.pressed.insert(side + "_PADDLE") }
            }
        }
        return result
    }
}
