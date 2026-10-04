import XCTest
@testable import CycleProtocol

final class BLEProtocolTests: XCTestCase {
    func testIndoorBikeGoldenPacket() throws {
        let result = try BLEProtocol.indoorBike([0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0])
        XCTAssertEqual(result, BikeReading(speed: 30, cadence: 90, power: 250))
    }
    func testMoreDataAndOptionalFields() throws {
        let result = try BLEProtocol.indoorBike([0x61, 2, 10, 0, 0x2c, 1, 140])
        XCTAssertNil(result.speed)
        XCTAssertEqual(result.resistance, 10)
        XCTAssertEqual(result.power, 300)
        XCTAssertEqual(result.heartRate, 140)
        // Every optional field through remaining time, including 24-bit distance and energy.
        let all: [UInt8] = [0xfe, 0x1f, 0xb8, 0x0b, 0, 0, 180, 0, 0, 0, 1, 2, 3, 10, 0, 250, 0, 0, 0, 1, 0, 2, 0, 3, 140, 1, 10, 0, 20, 0]
        XCTAssertEqual(try BLEProtocol.indoorBike(all).heartRate, 140)
        for count in 0..<all.count { XCTAssertThrowsError(try BLEProtocol.indoorBike(Array(all.prefix(count)))) }
    }
    func testNegativePowerAndTruncation() throws {
        XCTAssertEqual(try BLEProtocol.indoorBike([0x41, 0, 0xff, 0xff]).power, -1)
        let packet: [UInt8] = [0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]
        for count in 0..<packet.count { XCTAssertThrowsError(try BLEProtocol.indoorBike(Array(packet.prefix(count)))) }
    }
    func testCyclingPowerAndCadenceWraparound() throws {
        let d = try BLEProtocol.cyclingPower([0x20, 0, 200, 0, 10, 0, 0, 4])
        XCTAssertEqual(d.power, 200); XCTAssertEqual(d.revs, 10); XCTAssertEqual(d.time, 1024)
        var crank = CrankCadence()
        _ = crank.update(revs: 65535, time: 65000, now: 0)
        XCTAssertEqual(crank.update(revs: 0, time: (65000 + 683) % 65536, now: 1), 90, accuracy: 0.1)
        XCTAssertEqual(crank.update(revs: 0, time: (65000 + 683) % 65536, now: 4), 0)
        XCTAssertThrowsError(try BLEProtocol.cyclingPower([0x20, 0, 200, 0]))
    }
    func testHeartRateContactAnd16Bit() throws {
        let h = try BLEProtocol.heartRate([6, 72])
        XCTAssertEqual(h.bpm, 72); XCTAssertEqual(h.contact, true)
        XCTAssertEqual(try BLEProtocol.heartRate([1, 0x2c, 1]).bpm, 300)
        XCTAssertNil(try BLEProtocol.heartRate([1, 0x2c, 1]).contact)
        XCTAssertEqual(try BLEProtocol.heartRate([4, 60]).contact, false)
        XCTAssertThrowsError(try BLEProtocol.heartRate([]))
        XCTAssertThrowsError(try BLEProtocol.heartRate([1, 72]))
    }
    func testFTMSCommands() {
        XCTAssertEqual(BLEProtocol.simulation(grade: 5), [0x11, 0, 0, 0xf4, 1, 40, 51])
        XCTAssertEqual(BLEProtocol.simulation(grade: -2.5), [0x11, 0, 0, 6, 0xff, 40, 51])
        XCTAssertEqual(BLEProtocol.targetPower(300), [5, 0x2c, 1])
        XCTAssertEqual(BLEProtocol.resistance(30), [4, 0x2c, 1])
        XCTAssertEqual(BLEProtocol.resistance(-1), [4, 0xf6, 0xff])
        XCTAssertEqual(BLEProtocol.simulation(grade: .nan), BLEProtocol.simulation(grade: 0))
    }
    func testVirtualGears() {
        var gears = VirtualGears()
        XCTAssertEqual(gears.grade(5), 5)
        gears.shift(-4); XCTAssertEqual(gears.grade(5), 1)
        gears.shift(-100); XCTAssertEqual(gears.gear, 1); XCTAssertEqual(gears.grade(0), -10)
        gears.difficulty = 0.5; gears.shift(100); XCTAssertEqual(gears.grade(10), 17)
    }
    func testZwiftPlayGoldenPackets() throws {
        let left: [UInt8] = [7, 8, 1, 16, 1, 24, 1, 32, 1, 40, 1, 48, 1, 56, 1, 64, 0, 72, 0]
        XCTAssertEqual(try ZwiftProtocol.buttons(left)?.pressed, [])
        XCTAssertEqual(try ZwiftProtocol.buttons(left)?.side, "L")
        var right = left; right[2] = 0; right[8] = 0
        XCTAssertEqual(try ZwiftProtocol.buttons(right)?.pressed, ["R_A"])
        var paddle = left; paddle.replaceSubrange(16...16, with: [0xc7, 1])
        XCTAssertEqual(try ZwiftProtocol.buttons(paddle)?.analog["L"], -100)
        XCTAssertEqual(try ZwiftProtocol.buttons(paddle)?.pressed, ["L_PADDLE"])
    }
    func testZwiftRideAndClick() throws {
        XCTAssertEqual(try ZwiftProtocol.buttons([0x23, 8, 255, 255, 255, 255, 15])?.pressed, [])
        let ride: [UInt8] = [0x23, 8, 254, 255, 255, 255, 15, 0x1a, 5, 8, 1, 16, 0xc8, 1]
        XCTAssertEqual(try ZwiftProtocol.buttons(ride)?.pressed, ["L_LEFT", "R_PADDLE"])
        XCTAssertEqual(try ZwiftProtocol.buttons(ride)?.analog["R"], 100)
        XCTAssertEqual(try ZwiftProtocol.buttons([0x37, 8, 0, 16, 1])?.pressed, ["R_SHIFT"])
        // Proto3 omitted zero-valued fields mean pressed.
        XCTAssertEqual(try ZwiftProtocol.buttons([0x37, 16, 1])?.pressed, ["R_SHIFT"])
        XCTAssertNil(try ZwiftProtocol.buttons([0x15]))
    }
    func testMalformedProtobufCannotOverflowOrReadPastBuffer() {
        for packet: [UInt8] in [[8, 128], [0], [0x1a, 20, 1], [15], [8] + Array(repeating: 255, count: 10)] {
            XCTAssertThrowsError(try ZwiftProtocol.fields(packet))
        }
    }
    func testCommandQueueWaitsForBothAcknowledgements() {
        var q = ControlQueue()
        q.enqueue([0]); q.enqueue([7])
        XCTAssertEqual(q.next(), [0]); XCTAssertNil(q.next())
        q.response([0x80, 7, 1]); q.didWrite(); XCTAssertNil(q.completed())
        q.response([0x80, 0, 1]); XCTAssertEqual(q.completed()?.result, 1)
        XCTAssertEqual(q.next(), [7])
        q.response([0x80, 7, 1]); XCTAssertNil(q.completed())
        q.didWrite(); XCTAssertEqual(q.completed()?.opcode, 7)
    }
    func testQueueCoalescesSetpointsAndClearsOnDisconnect() {
        var q = ControlQueue()
        q.enqueue([0]); _ = q.next()
        q.enqueue([7]); q.enqueue(BLEProtocol.simulation(grade: 3)); q.enqueue(BLEProtocol.targetPower(100))
        XCTAssertEqual(q.waiting, [[7], [5, 100, 0]])
        q.clear(); XCTAssertNil(q.pending); XCTAssertNil(q.next())
        q.response([0x80, 0, 1]); XCTAssertNil(q.completed())
    }
    func testStopRemovesUnsentSetpoints() {
        var q = ControlQueue()
        q.enqueue([0]); _ = q.next(); q.enqueue([7]); q.enqueue([5, 100, 0])
        q.stop()
        XCTAssertEqual(q.pending, [0]); XCTAssertEqual(q.waiting, [[8, 1]])
    }
}

final class PeripheralWriteQueueTests: XCTestCase {
    func testBackpressurePreservesHandshakeAndOrder() {
        var queue = PeripheralWriteQueue()
        XCTAssertTrue(queue.enqueue(ZwiftProtocol.rideOn))
        XCTAssertTrue(queue.enqueue(ZwiftProtocol.vibrate))
        XCTAssertNil(queue.next(writable: false))
        XCTAssertEqual(queue.waiting.count, 2)
        XCTAssertEqual(queue.next(writable: true), ZwiftProtocol.rideOn)
        XCTAssertNil(queue.next(writable: true))
        queue.didWrite()
        XCTAssertEqual(queue.next(writable: true), ZwiftProtocol.vibrate)
        queue.didWrite()
        XCTAssertNil(queue.next(writable: true))
    }
    func testDisconnectDropsPendingWritesAndQueueIsBounded() {
        var queue = PeripheralWriteQueue()
        XCTAssertFalse(queue.enqueue([]))
        for _ in 0..<16 { XCTAssertTrue(queue.enqueue([1])) }
        XCTAssertFalse(queue.enqueue([2]))
        _ = queue.next(writable: true)
        queue.clear()
        XCTAssertNil(queue.inFlight)
        XCTAssertNil(queue.next(writable: true))
    }
    func testManufacturerIdentityNeedsCorrectCompanyAndType() {
        XCTAssertNil(ZwiftModel.fromManufacturerData([]))
        XCTAssertNil(ZwiftModel.fromManufacturerData([0x4a, 9]))
        XCTAssertNil(ZwiftModel.fromManufacturerData([0x4b, 9, 2]))
        XCTAssertNil(ZwiftModel.fromManufacturerData([0x4a, 9, 255]))
        XCTAssertEqual(ZwiftModel.fromManufacturerData([0x4a, 9, 2]), .playRight)
        XCTAssertEqual(ZwiftModel.fromManufacturerData([0x4a, 9, 3]), .playLeft)
        XCTAssertEqual(ZwiftModel.fromManufacturerData([0x4a, 9, 9]), .click)
        XCTAssertEqual(ZwiftModel.fromManufacturerData([0x4a, 9, 0x0e]), .playFW2)
        XCTAssertNotNil(ZwiftModel.fromManufacturerData([0x4a, 9, 0x0a])?.compatibilityNote)
        XCTAssertNil(ZwiftModel.playRight.compatibilityNote)
    }
}
