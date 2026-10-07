import XCTest
@testable import CycleProtocol

final class GymMapTests: XCTestCase {
    /// RSSI simulé : modèle log-distance, RSSI à 1 m donné, bruit pseudo-aléatoire reproductible.
    private func rssi(from s: (Double, Double), to m: (Double, Double), tx: Double, noise: Double = 0, seed: Int = 0) -> Double {
        let d = max(0.5, hypot(s.0 - m.0, s.1 - m.1))
        let jitter = noise * sin(Double(seed) * 12.9898 + s.0 * 78.233 + s.1 * 37.719)
        return tx - 10 * GymLocator.pathLoss * log10(d) + jitter
    }

    private func walk(_ machine: (Double, Double), tx: Double, noise: Double = 0) -> [GymReading] {
        // Tour de salle 20 × 12 m : une station tous les 4 m environ.
        let path: [(Double, Double)] = [(1, 11), (5, 11), (10, 11), (15, 11), (19, 11), (19, 6), (19, 1), (14, 1), (9, 1), (4, 1), (1, 1), (1, 6), (10, 6)]
        return path.enumerated().map { i, s in GymReading(x: s.0, y: s.1, rssi: rssi(from: s, to: machine, tx: tx, noise: noise, seed: i)) }
    }

    func testLocatesMachineWithoutKnowingItsTransmitPower() throws {
        for (machine, tx) in [((6.0, 4.0), -55.0), ((15.0, 9.0), -68.0), ((2.0, 2.5), -60.0)] {
            let e = try XCTUnwrap(GymLocator.locate(walk(machine, tx: tx), width: 20, depth: 12))
            XCTAssertLessThan(hypot(e.x - machine.0, e.y - machine.1), 0.6, "machine \(machine)")
            XCTAssertLessThan(e.error, 3)
        }
    }

    func testNoisySignalsStayWithinAFewMetres() throws {
        let machine = (12.0, 5.0)
        let e = try XCTUnwrap(GymLocator.locate(walk(machine, tx: -60, noise: 4), width: 20, depth: 12))
        XCTAssertLessThan(hypot(e.x - machine.0, e.y - machine.1), 4)
        XCTAssertGreaterThan(e.error, 0.5)
    }

    func testFewStationsGiveTheStrongestStationAndALargeError() throws {
        let e = try XCTUnwrap(GymLocator.locate([GymReading(x: 3, y: 4, rssi: -70), GymReading(x: 9, y: 4, rssi: -52)], width: 20, depth: 12))
        XCTAssertEqual(e.x, 9); XCTAssertEqual(e.y, 4)
        XCTAssertGreaterThanOrEqual(e.error, 1.5)
        XCTAssertNil(GymLocator.locate([], width: 20, depth: 12))
    }

    func testEstimateStaysInsideThePlan() throws {
        // Machine hors du plan déclaré : la position est ramenée sur le bord.
        let e = try XCTUnwrap(GymLocator.locate(walk((25, 6), tx: -59), width: 20, depth: 12))
        XCTAssert((0...20).contains(e.x) && (0...12).contains(e.y))
        XCTAssertGreaterThan(e.x, 14, "vers le bord le plus proche de la vraie machine")
    }

    func testLatestSessionWinsForAMovedMachine() {
        let id = UUID()
        var place = GymPlace(name: "Club", width: 20, depth: 12)
        place.see(id: id, name: "SKILLROW 1", at: Date())
        func session(_ machine: (Double, Double)) -> GymSession {
            GymSession(date: Date(), stations: walk(machine, tx: -60).map { GymStation(x: $0.x, y: $0.y, rssi: [id.uuidString: $0.rssi]) })
        }
        place.sessions = [session((4, 4))]
        place.relocate()
        XCTAssertEqual(place.machine(id)?.x ?? 0, 4, accuracy: 0.6)
        place.sessions.append(session((16, 8)))
        place.relocate()
        XCTAssertEqual(place.machine(id)?.x ?? 0, 16, accuracy: 0.6)
        XCTAssertEqual(place.machine(id)?.y ?? 0, 8, accuracy: 0.6)
    }

    func testPinnedMachinesAreNotMovedAndCanBeReleased() {
        let id = UUID()
        var place = GymPlace(name: "Club", width: 20, depth: 12)
        place.see(id: id, name: "BIKE 3", at: Date())
        place.sessions = [GymSession(date: Date(), stations: walk((5, 5), tx: -60).map { GymStation(x: $0.x, y: $0.y, rssi: [id.uuidString: $0.rssi]) })]
        place.pin(id, x: 30, y: -2)
        XCTAssertEqual(place.machine(id)?.x, 20); XCTAssertEqual(place.machine(id)?.y, 0)
        place.relocate()
        XCTAssertEqual(place.machine(id)?.x, 20)
        place.unpin(id)
        XCTAssertEqual(place.machine(id)?.x ?? 0, 5, accuracy: 0.6)
        XCTAssertEqual(place.machine(id)?.pinned, false)
    }

    func testRemovedMachinesDoNotComeBack() {
        let id = UUID()
        var place = GymPlace(name: "Club")
        XCTAssertTrue(place.see(id: id, name: "MYRUN", at: Date()))
        place.remove(id)
        XCTAssertFalse(place.see(id: id, name: "MYRUN", at: Date()))
        XCTAssertNil(place.machine(id))
    }

    func testKindSourcesKeepTheSafestOne() {
        var m = GymMachine(id: UUID(), name: "SKILLROW")
        m.offer(kind: .rower, source: .name)
        m.offer(kind: .bike, source: .detected)
        XCTAssertEqual(m.kind, .bike)
        m.offer(kind: .rower, source: .advertised)
        XCTAssertEqual(m.kind, .bike, "une annonce ne remplace pas un type lu sur la machine")
        m.offer(kind: .cross, source: .chosen)
        m.offer(kind: .rower, source: .detected)
        XCTAssertEqual(m.kind, .cross, "le choix du joueur fait foi")
        m.offer(kind: nil, source: .chosen)
        XCTAssertEqual(m.kind, .cross)
    }

    func testKindGuesses() {
        XCTAssertEqual(GymKindGuess.name("SKILLROW 0042"), .rower)
        XCTAssertEqual(GymKindGuess.name("MYRUN"), .treadmill)
        XCTAssertEqual(GymKindGuess.name("SKILLMILL"), .treadmill)
        XCTAssertEqual(GymKindGuess.name("BIKE 3"), .bike)
        XCTAssertEqual(GymKindGuess.name("MYCYCLING"), .bike)
        XCTAssertEqual(GymKindGuess.name("Synchro Forma"), .cross)
        XCTAssertNil(GymKindGuess.name("Technogym"))
        // Données de service FTMS : drapeaux puis type (bit 4 rameur, bit 5 vélo, bit 1 elliptique, bit 0 tapis).
        XCTAssertEqual(GymKindGuess.ftmsServiceData([0x01, 0x10, 0x00]), .rower)
        XCTAssertEqual(GymKindGuess.ftmsServiceData([0x01, 0x20, 0x00]), .bike)
        XCTAssertEqual(GymKindGuess.ftmsServiceData([0x01, 0x02, 0x00]), .cross)
        XCTAssertEqual(GymKindGuess.ftmsServiceData([0x01, 0x01, 0x00]), .treadmill)
        XCTAssertNil(GymKindGuess.ftmsServiceData([0x01, 0x04, 0x00]))
        XCTAssertNil(GymKindGuess.ftmsServiceData([0x01]))
    }

    func testBookDefaultPlaceAndLookup() {
        var book = GymBook()
        XCTAssertNil(book.defaultPlace)
        let a = book.add(name: "Salle du bureau")
        let b = book.add(name: "Club de vacances", width: 300, depth: 1)
        XCTAssertEqual(book.defaultPlace?.id, a, "le premier lieu devient le lieu par défaut")
        XCTAssertEqual(book.place(b)?.width, GymPlace.sizeRange.upperBound)
        XCTAssertEqual(book.place(b)?.depth, GymPlace.sizeRange.lowerBound)
        let machine = UUID()
        book.update(b) { $0.see(id: machine, name: "BIKE 1", at: Date()) }
        XCTAssertEqual(book.place(containing: machine)?.id, b)
        XCTAssertTrue(book.contains(machine: machine))
        book.remove(a)
        XCTAssertEqual(book.defaultPlace?.id, b)
    }

    func testPayloadForTheGame() throws {
        var book = GymBook()
        let p = book.add(name: "Club")
        let id = try XCTUnwrap(UUID(uuidString: "11111111-2222-3333-4444-555555555555"))
        book.update(p) { place in
            place.see(id: id, name: "SKILLROW", at: Date())
            place.update(id) { $0.label = "Rameur fenêtre "; $0.offer(kind: .rower, source: .detected) }
            place.pin(id, x: 3.14159, y: 2)
        }
        let payload = GymPayload(book: book, nearby: [
            .init(id: "a", name: "A", kind: nil, rssi: -80),
            .init(id: id.uuidString, name: "SKILLROW", kind: "rower", rssi: -50),
        ], scanning: true)
        let json = try XCTUnwrap(payload.json())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["defaultPlace"] as? String, p.uuidString)
        XCTAssertEqual(object["scanning"] as? Bool, true)
        let place = try XCTUnwrap((object["places"] as? [[String: Any]])?.first)
        let machine = try XCTUnwrap((place["machines"] as? [[String: Any]])?.first)
        XCTAssertEqual(machine["id"] as? String, id.uuidString)
        XCTAssertEqual(machine["kind"] as? String, "rower")
        XCTAssertEqual(machine["label"] as? String, "Rameur fenêtre")
        XCTAssertEqual(machine["x"] as? Double, 3.1)
        let nearby = try XCTUnwrap(object["nearby"] as? [[String: Any]])
        XCTAssertEqual(nearby.first?["rssi"] as? Int, -50, "le plus proche d'abord")
    }

    func testBookRoundTripsAsJSON() throws {
        var book = GymBook()
        let p = book.add(name: "Club")
        let id = UUID()
        book.update(p) { place in
            place.see(id: id, name: "BIKE 2", at: Date(timeIntervalSince1970: 1_000))
            place.sessions = [GymSession(date: Date(timeIntervalSince1970: 1_000), stations: [GymStation(x: 1, y: 2, rssi: [id.uuidString: -61.5])])]
        }
        let data = try JSONEncoder().encode(book)
        XCTAssertEqual(try JSONDecoder().decode(GymBook.self, from: data), book)
    }

    func testSignalHelpers() {
        XCTAssertNil(GymSignal.median([]))
        XCTAssertEqual(GymSignal.median([-70, -50, -60]), -60)
        XCTAssertEqual(GymSignal.median([-70, -50, -60, -40]), -55)
        XCTAssertEqual(GymSignal.proximity(-50), "juste devant toi")
        XCTAssertEqual(GymSignal.proximity(-90), "loin")
    }
}
