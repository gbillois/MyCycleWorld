import XCTest
@testable import CycleProtocol

final class GymIdentifyTests: XCTestCase {
    private let a = UUID(), b = UUID(), c = UUID()

    func testPhoneOnTheConsoleWinsOnlyWithAClearMargin() {
        XCTAssertEqual(GymIdentify.byContact([(a, -62), (b, -38), (c, -71)]), b)
        XCTAssertEqual(GymIdentify.byContact([(b, -45)]), b, "seule machine entendue, assez proche")
        XCTAssertNil(GymIdentify.byContact([(a, -44), (b, -48)]), "deux machines presque aussi fortes : on ne tranche pas")
        XCTAssertNil(GymIdentify.byContact([(a, -58), (b, -80)]), "devant la machine, mais téléphone pas posé dessus")
        XCTAssertNil(GymIdentify.byContact([]))
    }

    func testMovementInDataPackets() {
        XCTAssertEqual(GymIdentify.moving(characteristic: "2ad2", bytes: [0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0]), true)
        XCTAssertEqual(GymIdentify.moving(characteristic: "2AD2", bytes: [0x44, 0, 0, 0, 0, 0, 0, 0]), false, "machine branchée, personne ne pédale")
        // Rameur : drapeaux (cadence de coups présente), 52 = 26 coups/min, 120 coups.
        XCTAssertEqual(GymIdentify.moving(characteristic: "2AD1", bytes: [0x00, 0x00, 52, 120, 0]), true)
        XCTAssertEqual(GymIdentify.moving(characteristic: "2AD1", bytes: [0x00, 0x00, 0, 0, 0]), false)
        XCTAssertNil(GymIdentify.moving(characteristic: "2AD2", bytes: [0x44]), "paquet tronqué")
        XCTAssertNil(GymIdentify.moving(characteristic: "2A37", bytes: [0, 70]), "cardio : sans intérêt")
        XCTAssertTrue(GymIdentify.moving(BikeReading(stepRate: 40)))
        XCTAssertFalse(GymIdentify.moving(BikeReading(speed: 0.3)))
    }

    func testTheMachineThatStartsAfterThePromptIsMine() {
        var t = MotionTracker()
        // Période calme : b est utilisée par quelqu'un d'autre, a et c ne bougent pas.
        t.record(a, moving: false, at: 0.5)
        t.record(b, moving: true, at: 0.6)
        t.record(c, moving: false, at: 0.7)
        t.prompt(at: 2)
        XCTAssertEqual(t.busy, [b])
        t.record(b, moving: true, at: 2.2)
        t.record(b, moving: true, at: 2.4)
        t.record(c, moving: true, at: 3.0)
        XCTAssertNil(t.winner(), "un seul paquet : pas encore confirmé")
        t.record(c, moving: true, at: 3.3)
        XCTAssertEqual(t.winner(), c)
        t.record(a, moving: true, at: 4)
        t.record(a, moving: true, at: 4.2)
        XCTAssertEqual(t.winner(), c, "la première à démarrer après le signal")
    }

    func testSimultaneousStartGoesToTheStrongestSignal() {
        var t = MotionTracker()
        t.prompt(at: 0)
        for id in [a, b] { t.record(id, moving: true, at: 1); t.record(id, moving: true, at: 1.5) }
        XCTAssertEqual(t.winner(rssi: [a: -70, b: -55]), b)
        XCTAssertEqual(t.winner(rssi: [a: -50, b: -55]), a)
    }

    func testNothingFoundWhenOnlyBusyMachinesMove() {
        var t = MotionTracker()
        t.record(a, moving: true, at: 0)
        t.prompt(at: 1)
        t.record(a, moving: true, at: 2); t.record(a, moving: true, at: 3)
        XCTAssertNil(t.winner(), "le joueur ramait déjà pendant la période calme : il doit s'arrêter puis recommencer")
    }
}
