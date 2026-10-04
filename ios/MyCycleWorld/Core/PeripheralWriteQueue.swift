import Foundation

/// A small FIFO for one peripheral. Backpressure must never drop RideOn.
struct PeripheralWriteQueue {
    private(set) var waiting: [[UInt8]] = []
    private(set) var inFlight: [UInt8]?
    @discardableResult mutating func enqueue(_ bytes: [UInt8]) -> Bool {
        guard !bytes.isEmpty, waiting.count < 16 else { return false }
        waiting.append(bytes)
        return true
    }
    mutating func next(writable: Bool) -> [UInt8]? {
        guard writable, inFlight == nil, !waiting.isEmpty else { return nil }
        inFlight = waiting.removeFirst()
        return inFlight
    }
    mutating func didWrite() { inFlight = nil }
    mutating func clear() { self = PeripheralWriteQueue() }
}

/// Advertising protocol identifiers, not a promise of firmware compatibility.
enum ZwiftModel: String {
    case playLeft = "Zwift Play gauche", playRight = "Zwift Play droite"
    case playFW2 = "Zwift Play fw2", rideLeft = "Zwift Ride gauche", rideRight = "Zwift Ride droite"
    case click = "Zwift Click", clickV2Left = "Zwift Click v2 gauche", clickV2Right = "Zwift Click v2 droite"

    static func fromManufacturerData(_ bytes: [UInt8]) -> ZwiftModel? {
        guard bytes.count >= 3, bytes[0] == 0x4a, bytes[1] == 0x09 else { return nil }
        switch bytes[2] {
        case 0x02: return .playRight
        case 0x03: return .playLeft
        case 0x07: return .rideRight
        case 0x08: return .rideLeft
        case 0x09: return .click
        case 0x0a: return .clickV2Right
        case 0x0b: return .clickV2Left
        case 0x0e: return .playFW2
        default: return nil
        }
    }

    var compatibilityNote: String? {
        switch self {
        case .clickV2Left, .clickV2Right:
            return "Click v2 détecté : activation spécifique non implémentée dans cette bêta."
        default: return nil
        }
    }
}
