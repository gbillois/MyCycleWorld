import XCTest
@testable import CycleProtocol

/// Elliptiques et rameurs FTMS : mêmes vecteurs d'octets que tests/rowing.test.js côté web.
final class MachineTests: XCTestCase {
    private func u16(_ v: Int) -> [UInt8] { [UInt8(v & 0xff), UInt8((v >> 8) & 0xff)] }
    private func u24(_ v: Int) -> [UInt8] { [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff)] }
    private func join(_ parts: [UInt8]...) -> [UInt8] { parts.flatMap { $0 } }

    func testRowerDataStrokeRateCountDistancePacePowerHeartRate() throws {
        let flags = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 9)
        let packet = join(u16(flags), [52], u16(120), [0x2c, 0x01, 0x00], u16(125), u16(181), [140])
        let d = try BLEProtocol.rower(packet)
        XCTAssertEqual(d, BikeReading(power: 181, heartRate: 140, strokeRate: 26, strokeCount: 120, distance: 300, pace: 125))
        for count in 0..<packet.count { XCTAssertThrowsError(try BLEProtocol.rower(Array(packet.prefix(count)))) }
    }

    func testRowerMoreDataPacketHasNoStrokeRate() throws {
        let p = try BLEProtocol.rower(u16(1 | (1 << 5)) + u16(150))
        XCTAssertNil(p.strokeRate)
        XCTAssertEqual(p.power, 150)
        XCTAssertEqual(BLEProtocol.rowerPower(pace500: 120), 202.5, accuracy: 0.5)
        XCTAssertEqual(BLEProtocol.rowerPower(pace500: 0), 0)
    }

    func testRowerAllOptionalFields() throws {
        let flags = 0x1ffe // bits 1 à 12, plus cadence (bit 0 à zéro)
        let packet = join(u16(flags), [50], u16(7), [44], u24(10000), u16(110), u16(115), u16(220), u16(210),
                          u16(12), [1, 0, 2, 0, 3], [150], [9], u16(600), u16(30))
        let d = try BLEProtocol.rower(packet)
        XCTAssertEqual(d.strokeRate, 25)
        XCTAssertEqual(d.avgStrokeRate, 22)
        XCTAssertEqual(d.distance, 10000)
        XCTAssertEqual(d.pace, 110)
        XCTAssertEqual(d.avgPace, 115)
        XCTAssertEqual(d.power, 220)
        XCTAssertEqual(d.avgPower, 210)
        XCTAssertEqual(d.resistance, 12)
        XCTAssertEqual(d.heartRate, 150)
        XCTAssertEqual(d.elapsed, 600)
        XCTAssertEqual(d.remaining, 30)
        XCTAssertThrowsError(try BLEProtocol.rower(Array(packet.dropLast())))
    }

    func testCrossTrainerThreeByteFlagsStepRateResistancePower() throws {
        let flags = (1 << 3) | (1 << 7) | (1 << 8) | (1 << 15)
        let packet = join(u24(flags), u16(950), u16(140), u16(138), u16(85), u16(160))
        let d = try BLEProtocol.crossTrainer(packet)
        XCTAssertEqual(d.speed, 9.5)
        XCTAssertEqual(d.stepRate, 140)
        XCTAssertEqual(d.avgStepRate, 138)
        XCTAssertEqual(d.resistance, 8.5)
        XCTAssertEqual(d.power, 160)
        XCTAssertEqual(d.backward, true)
        for count in 0..<packet.count { XCTAssertThrowsError(try BLEProtocol.crossTrainer(Array(packet.prefix(count)))) }
    }

    func testCrossTrainerAllOptionalFields() throws {
        let flags = 0x7ffe // bits 1 à 14, vitesse présente
        let packet = join(u24(flags), u16(1000), u16(900), u24(100), u16(120), u16(118),
                          u16(55), [1, 0, 2, 0], u16(25), u16(0), u16(72), u16(190), u16(180), [1, 0, 2, 0, 3], [131], [4],
                          u16(300), u16(60))
        let d = try BLEProtocol.crossTrainer(packet)
        XCTAssertEqual(d.speed, 10)
        XCTAssertEqual(d.distance, 100)
        XCTAssertEqual(d.stepRate, 120)
        XCTAssertEqual(d.strideCount, 5.5)
        XCTAssertEqual(d.inclination, 2.5)
        XCTAssertEqual(d.resistance, 7.2)
        XCTAssertEqual(d.power, 190)
        XCTAssertEqual(d.avgPower, 180)
        XCTAssertEqual(d.heartRate, 131)
        XCTAssertEqual(d.elapsed, 300)
        XCTAssertEqual(d.remaining, 60)
        XCTAssertEqual(d.backward, false)
    }

    func testIndoorBikeDistance() throws {
        let d = try BLEProtocol.indoorBike([0x10, 0, 0xb8, 0x0b, 0x2c, 0x01, 0x00])
        XCTAssertEqual(d.distance, 300)
        XCTAssertEqual(d.speed, 30)
    }

    func testMachineKindFromDataCharacteristic() {
        XCTAssertEqual(MachineKind.detect(characteristics: ["2AD9", "2AD2", "2A63"]), .bike)
        XCTAssertEqual(MachineKind.detect(characteristics: ["2AD1", "2AD9"]), .rower)
        XCTAssertEqual(MachineKind.detect(characteristics: ["2ACE"]), .cross)
        XCTAssertEqual(MachineKind.detect(characteristics: ["2ACD", "2A63"]), .treadmill)
        XCTAssertEqual(MachineKind.detect(characteristics: ["2A63"]), .power)
        XCTAssertNil(MachineKind.detect(characteristics: ["2A37", "2A19"]))
        XCTAssertEqual(MachineKind.rower.rawValue, "rower")
        XCTAssertEqual(MachineKind.cross.label, "Vélo elliptique")
    }

    func testFeedRowerWithoutPowerEstimatesItFromPace() {
        var feed = TrainerFeed()
        let changes = feed.ftms(BikeReading(strokeRate: 26, strokeCount: 10, distance: 120, pace: 120), kind: .rower, now: 0)
        XCTAssertEqual(feed.data.power, 203) // 2,8 / 0,24³ = 202,5…
        XCTAssertEqual(feed.data.cadence, 26, "au rameur, la cadence est la cadence de coups")
        XCTAssertEqual(feed.data.strokeRate, 26)
        XCTAssertEqual(feed.data.strokeCount, 10)
        XCTAssertEqual(feed.data.distance, 120)
        XCTAssertEqual(feed.packets, 1)
        XCTAssertTrue(changes.contains("Source power : FTMS"))
        // Pas d'estimation pour un elliptique ni avec une allure nulle.
        var other = TrainerFeed()
        other.ftms(BikeReading(pace: 0), kind: .rower, now: 0)
        XCTAssertNil(other.data.power)
    }

    func testFeedCrossTrainerCadenceIsHalfTheStepRate() {
        var feed = TrainerFeed()
        feed.ftms(BikeReading(power: 160, heartRate: 0, resistance: 8.5, stepRate: 140), kind: .cross, now: 0)
        XCTAssertEqual(feed.data.cadence, 70)
        XCTAssertEqual(feed.data.stepRate, 140)
        XCTAssertEqual(feed.data.resistance, 8.5)
        XCTAssertNil(feed.data.heartRate, "un cardio à 0 n'est pas une mesure")
    }

    func testFeedKeepsFtmsAsSourceAndExpiresStaleValues() {
        var feed = TrainerFeed()
        feed.cyclingPower(power: 300, revs: nil, time: nil, now: 0)
        XCTAssertEqual(feed.data.power, 300)
        XCTAssertEqual(feed.sources["power"], "Cycling Power")
        feed.ftms(BikeReading(power: 250), kind: .bike, now: 1)
        feed.cyclingPower(power: 400, revs: nil, time: nil, now: 2)
        XCTAssertEqual(feed.data.power, 250, "FTMS reste la source")
        XCTAssertEqual(feed.packets, 3)
        XCTAssertFalse(feed.expire(now: 5))
        XCTAssertTrue(feed.expire(now: 6.5))
        XCTAssertNil(feed.data.power)
        XCTAssertNil(feed.sources["power"])
        feed.cyclingPower(power: 410, revs: nil, time: nil, now: 7)
        XCTAssertEqual(feed.data.power, 410, "Cycling Power reprend la main quand FTMS se tait")
    }

    func testCyclingPowerWinsWhenFtmsOnlySendsZeros() {
        // Vélo Technogym : Indoor Bike Data à 0, vraie puissance et cadence en Cycling Power.
        var feed = TrainerFeed()
        feed.ftms(BikeReading(speed: 0, cadence: 0, power: 0), kind: .bike, now: 0)
        feed.cyclingPower(power: 180, revs: 10, time: 0, now: 0.2)
        XCTAssertEqual(feed.data.power, 180, "un FTMS à zéro ne masque plus Cycling Power")
        XCTAssertEqual(feed.sources["power"], "Cycling Power")
        feed.ftms(BikeReading(speed: 0, cadence: 0, power: 0), kind: .bike, now: 0.5)
        XCTAssertEqual(feed.data.power, 180, "le zéro FTMS n'écrase pas une source qui mesure un effort")
        feed.cyclingPower(power: 190, revs: 11, time: 683, now: 1)
        XCTAssertEqual(feed.data.cadence, 90, "cadence du pédalier quand FTMS la donne à 0")
        // Arrêt : Cycling Power muet depuis plus de 3 s, le zéro FTMS reprend.
        feed.ftms(BikeReading(speed: 0, cadence: 0, power: 0), kind: .bike, now: 4.5)
        XCTAssertEqual(feed.data.power, 0)
        // FTMS se met à mesurer : il refait foi.
        feed.cyclingPower(power: 200, revs: nil, time: nil, now: 5)
        feed.ftms(BikeReading(power: 210), kind: .bike, now: 5.2)
        feed.cyclingPower(power: 220, revs: nil, time: nil, now: 5.4)
        XCTAssertEqual(feed.data.power, 210)
        XCTAssertEqual(feed.sources["power"], "FTMS")
    }

    func testFeedCrankCadenceIsRounded() {
        var feed = TrainerFeed()
        feed.cyclingPower(power: 200, revs: 10, time: 0, now: 0)
        feed.cyclingPower(power: 200, revs: 11, time: 683, now: 1)
        XCTAssertEqual(feed.data.cadence, 90)
    }

    func testGradeBecomesResistanceLikeTheWebGame() {
        let range = LevelRange(min: 1, max: 25, step: 1)
        XCTAssertEqual(GradeResistance.level(grade: -4, range: range), 1 + 24 * 0.15, accuracy: 1e-9)
        XCTAssertEqual(GradeResistance.level(grade: 12, range: range), 1 + 24 * 0.85, accuracy: 1e-9)
        XCTAssertEqual(GradeResistance.level(grade: 40, range: range), 1 + 24 * 0.85, accuracy: 1e-9)
        XCTAssertEqual(GradeResistance.level(grade: 4, range: nil), 20 * (0.15 + 0.35), accuracy: 1e-9)
        var g = GradeResistance()
        XCTAssertEqual(try XCTUnwrap(g.next(grade: 0, range: nil)), 6.5, accuracy: 1e-9)
        XCTAssertNil(g.next(grade: 0.5, range: nil), "moins de 0,5 niveau d'écart : rien")
        XCTAssertNotNil(g.next(grade: 1, range: nil))
        var h = GradeResistance()
        XCTAssertEqual(try XCTUnwrap(h.next(grade: 0, range: range)), 8.8, accuracy: 1e-9)
        XCTAssertNil(h.next(grade: 0.5, range: range), "moins d'un pas de la machine")
        h.reset()
        XCTAssertNotNil(h.next(grade: 0.5, range: range))
    }

    func testGradeControlChoice() {
        XCTAssertEqual(GradeControl.choose(kind: .rower, simulation: true, resistance: true), .resistance)
        XCTAssertEqual(GradeControl.choose(kind: .cross, simulation: false, resistance: false), .none)
        XCTAssertEqual(GradeControl.choose(kind: .bike, simulation: true, resistance: true), .simulation)
        XCTAssertEqual(GradeControl.choose(kind: .bike, simulation: false, resistance: true), .resistance)
        XCTAssertEqual(GradeControl.choose(kind: nil, simulation: true, resistance: false), .simulation)
    }

    func testResistanceEncodingOneByteThenTwoBytes() {
        XCTAssertEqual(BLEProtocol.resistance8(8.5), [4, 85])
        XCTAssertEqual(BLEProtocol.resistance8(-3), [4, 0])
        XCTAssertEqual(BLEProtocol.resistance8(99), [4, 255])
        var e = ResistanceEncoder()
        XCTAssertEqual(e.encode(6.5), [4, 65])
        XCTAssertEqual(e.encode(30), [4, 0x2c, 1], "au-delà de 25,5 : forme longue")
        XCTAssertFalse(e.refused([4, 65], result: 5))
        XCTAssertTrue(e.refused([4, 65], result: 3))
        XCTAssertEqual(e.encode(6.5), [4, 65, 0])
        XCTAssertFalse(e.refused([4, 65, 0], result: 3), "une seule bascule")
        XCTAssertEqual(try BLEProtocol.resistanceRange([10, 0, 0xfa, 0, 10, 0]), LevelRange(min: 1, max: 25, step: 1))
        XCTAssertThrowsError(try BLEProtocol.resistanceRange([0xfa, 0, 10, 0, 1, 0]))
    }

    func testUnansweredStartIsAbandonedWithoutDroppingQueuedSetpoints() {
        var q = ControlQueue()
        q.enqueue([7]); _ = q.next()
        q.enqueue(BLEProtocol.resistance8(6.5))
        q.abandon()
        XCTAssertNil(q.pending)
        XCTAssertEqual(q.next(), [4, 65])
        q.response([0x80, 7, 1]); q.didWrite()
        XCTAssertNil(q.completed(), "une réponse tardive au démarrage ne valide pas la résistance")
        q.response([0x80, 4, 1])
        XCTAssertEqual(q.completed()?.opcode, 4)
    }

    func testPacketSampler() {
        var s = PacketSampler(first: 30, every: 20)
        let logged = (1...100).filter { _ in s.sample() }
        XCTAssertEqual(logged, Array(1...30) + [40, 60, 80, 100])
    }

    func testMachineTexts() {
        XCTAssertEqual(MachineText.split(125.34), "2:05.3")
        XCTAssertEqual(MachineText.split(65), "1:05.0")
        XCTAssertEqual(MachineText.split(.infinity), "-:--")
        XCTAssertEqual(MachineText.measures(BikeReading(power: 181, resistance: 8.5, strokeRate: 26, distance: 300, pace: 125)),
                       "181 W · 26 coups/min · 300 m · 2:05.0 /500 m · résistance 8.5")
        XCTAssertEqual(MachineText.measures(BikeReading(cadence: 70, stepRate: 140)), "140 pas/min")
        XCTAssertEqual(MachineText.measures(BikeReading()), "-")
        XCTAssertEqual(MachineText.age(0.25), "250 ms")
        XCTAssertEqual(MachineText.age(2.44), "2.4 s")
    }
}

final class HardwareProfileTests: XCTestCase {
    func testProfilesMatchTheWebGame() {
        XCTAssertEqual(HardwareProfile.allCases.map(\.rawValue), ["zwift", "technogym", "ble"])
        XCTAssertEqual(HardwareProfile.technogym.label, "Technogym")
        XCTAssertTrue(HardwareProfile.looksTechnogym("Technogym SKILLROW"))
        XCTAssertTrue(HardwareProfile.looksTechnogym("BIKE 2"))
        XCTAssertTrue(HardwareProfile.looksTechnogym("MYRUN 1234"))
        XCTAssertFalse(HardwareProfile.looksTechnogym("KICKR CORE"))
        XCTAssertFalse(HardwareProfile.looksTechnogym("BIKER"))
    }

    func testRoleFromAdvertisement() {
        let zwift = HardwareProfile.zwift, tg = HardwareProfile.technogym, ble = HardwareProfile.ble
        XCTAssertEqual(zwift.role(name: "Zwift Play", services: [], manufacturer: []), .controller)
        XCTAssertEqual(ble.role(name: "", services: [], manufacturer: [0x4a, 0x09, 0x03]), .controller)
        XCTAssertEqual(zwift.role(name: "KICKR", services: ["1826"], manufacturer: []), .trainer)
        XCTAssertEqual(ble.role(name: "Stages", services: ["1818"], manufacturer: []), .trainer)
        XCTAssertEqual(ble.role(name: "HRM", services: ["180D"], manufacturer: []), .heart)
        // Technogym : reconnu au nom ou au fabricant même sans service annoncé, seulement dans son profil.
        XCTAssertEqual(tg.role(name: "MYCYCLING", services: [], manufacturer: []), .trainer)
        XCTAssertEqual(tg.role(name: "", services: [], manufacturer: [0x6d, 0x02, 1]), .trainer)
        XCTAssertNil(ble.role(name: "MYCYCLING", services: [], manufacturer: []))
        XCTAssertNil(zwift.role(name: "TV", services: ["1812"], manufacturer: [0x6d, 0x02]))
        XCTAssertEqual(HardwareProfile.companyID([0x6d, 0x02]), 0x026D)
        // Cardio dans tous les profils, même sans service annoncé (montre Garmin en diffusion FC).
        for p in HardwareProfile.allCases {
            XCTAssertEqual(p.role(name: "Forerunner 255", services: [], manufacturer: []), .heart)
            XCTAssertEqual(p.role(name: "", services: [], manufacturer: [0x87, 0x00, 1]), .heart)
            XCTAssertTrue(p.shows(.heart))
        }
        // Un trainer Garmin (Tacx) annonce FTMS : il reste un trainer.
        XCTAssertEqual(tg.role(name: "Tacx Neo", services: ["1826"], manufacturer: [0x87, 0x00]), .trainer)
    }

    func testListFilterAndLabels() {
        XCTAssertTrue(HardwareProfile.zwift.shows(.controller))
        XCTAssertFalse(HardwareProfile.technogym.shows(.controller))
        XCTAssertTrue(HardwareProfile.ble.shows(.heart))
        XCTAssertEqual(HardwareProfile.technogym.label(for: .trainer), "Machine Technogym")
        XCTAssertEqual(HardwareProfile.zwift.label(for: .heart), "Ceinture cardio")
    }
}

final class GATTTextTests: XCTestCase {
    func testNamesHexAndAscii() {
        XCTAssertEqual(GATTText.name("2AD1"), "Rower Data [2ad1]")
        XCTAssertEqual(GATTText.name("00002AD1-0000-1000-8000-00805F9B34FB"), "Rower Data [2ad1]")
        XCTAssertEqual(GATTText.name("FFF0"), "fff0")
        XCTAssertEqual(GATTText.plainName("1826"), "Fitness Machine (FTMS)")
        XCTAssertEqual(GATTText.name("A913BFC0-929E-11E5-B928-0002A5D5C51B"), "Technogym (propriétaire) [a913bfc0-929e-11e5-b928-0002a5d5c51b]")
        XCTAssertEqual(GATTText.hex([0x80, 0, 0x0a]), "80 00 0a")
        XCTAssertEqual(GATTText.ascii([84, 71, 32, 49, 0]), "TG 1")
        XCTAssertNil(GATTText.ascii([1, 200]))
        XCTAssertNil(GATTText.ascii([]))
        XCTAssertEqual(GATTText.properties(read: true, write: false, writeWithoutResponse: false, notify: true, indicate: false), "read,notify")
    }

    /// Rameur qui envoie une cadence à 0 (ou pas de cadence) : moyenne, sinon déduite du compteur de coups.
    func testRowerStrokeRateFallbacks() {
        var feed = TrainerFeed()
        var avg = BikeReading()
        avg.strokeRate = 0
        avg.avgStrokeRate = 24
        avg.power = 150
        feed.ftms(avg, kind: .rower, now: 0)
        XCTAssertEqual(feed.data.strokeRate, 24)
        var counted = TrainerFeed()
        for (i, t) in [0.0, 2.3, 4.6, 6.9].enumerated() {
            var d = BikeReading()
            d.strokeCount = i
            d.power = 160
            counted.ftms(d, kind: .rower, now: t)
        }
        XCTAssertEqual(counted.data.strokeRate ?? 0, 26, accuracy: 1.5)
    }
}

final class TreadmillTests: XCTestCase {
    func testTreadmillData() throws {
        // Drapeaux : distance (bit 2) et pente (bit 3) ; vitesse 10,50 km/h, 1 234 m, pente 2,0 %.
        let d = try BLEProtocol.treadmill([0x0C, 0x00, 0x1A, 0x04, 0xD2, 0x04, 0x00, 0x14, 0x00, 0x0B, 0x00])
        XCTAssertEqual(d.speed, 10.5)
        XCTAssertEqual(d.distance, 1234)
        XCTAssertEqual(d.inclination, 2)
        XCTAssertNil(d.power)
    }

    func testRunningPowerEstimate() {
        XCTAssertEqual(BLEProtocol.runningPower(speedKmh: 0), 0)
        let flat = BLEProtocol.runningPower(speedKmh: 10)
        XCTAssertEqual(flat, 216.7, accuracy: 1)
        XCTAssertGreaterThan(BLEProtocol.runningPower(speedKmh: 10, grade: 5), flat)
    }

    func testFeedEstimatesTreadmillPowerAndCadence() throws {
        var feed = TrainerFeed()
        let d = try BLEProtocol.treadmill([0x00, 0x00, 0x1A, 0x04])
        feed.ftms(d, kind: .treadmill, now: 1)
        XCTAssertEqual(feed.data.speed, 10.5)
        XCTAssertNotNil(feed.data.power)
        XCTAssertGreaterThan(feed.data.power ?? 0, 150)
        XCTAssertGreaterThan(feed.data.cadence ?? 0, 70)
    }

    func testRunningSpeedSensor() throws {
        // RSC : vitesse 3,0 m/s (768/256), cadence 170 pas/min.
        let r = try BLEProtocol.runningSpeed([0x00, 0x00, 0x03, 170])
        XCTAssertEqual(r.speed, 10.8, accuracy: 0.01)
        XCTAssertEqual(r.cadence, 170)
        var feed = TrainerFeed()
        feed.runningSpeed(speed: r.speed, cadence: r.cadence, now: 1)
        XCTAssertEqual(feed.data.cadence, 85)
        XCTAssertNotNil(feed.data.power)
    }
}
