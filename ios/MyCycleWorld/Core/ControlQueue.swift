import Foundation

/// Exactly one FTMS write in flight; both GATT write and FTMS indication must succeed.
struct ControlQueue {
    private(set) var waiting: [[UInt8]] = []
    private(set) var pending: [UInt8]?
    private var writeAcknowledged = false
    private var result: UInt8?
    mutating func enqueue(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        // Coalesce unsent setpoints, preserving request-control/start ordering.
        if [0x04, 0x05, 0x11].contains(bytes[0]) {
            waiting.removeAll { [0x04, 0x05, 0x11].contains($0[0]) }
        }
        waiting.append(bytes)
    }
    mutating func next() -> [UInt8]? {
        guard pending == nil, !waiting.isEmpty else { return nil }
        pending = waiting.removeFirst()
        writeAcknowledged = false
        result = nil
        return pending
    }
    mutating func didWrite() { writeAcknowledged = true }
    mutating func response(_ bytes: [UInt8]) {
        guard bytes.count >= 3, bytes[0] == 0x80, bytes[1] == pending?.first else { return }
        result = bytes[2]
    }
    mutating func completed() -> (opcode: UInt8, result: UInt8)? {
        guard writeAcknowledged, let result, let opcode = pending?.first else { return nil }
        pending = nil
        return (opcode, result)
    }
    mutating func stop() { waiting = [[8, 1]] }
    mutating func clear() { self = ControlQueue() }
}
