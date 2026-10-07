import XCTest
@testable import CycleProtocol

final class FTMSDebugTests: XCTestCase {
    func testIndoorBikeAllFieldsAreListed() {
        let line = FTMSDebug.describe("2ad2", [0x44, 0, 0xb8, 0x0b, 0xb4, 0, 0xfa, 0])
        XCTAssertTrue(line.hasPrefix("Indoor Bike Data [2AD2] 8 o : 44 00 b8 0b b4 00 fa 00 → "))
        XCTAssertTrue(line.contains("drapeaux 0x0044 (bits 2,6)"))
        XCTAssertTrue(line.contains("vitesse inst. 30.00 km/h"))
        XCTAssertTrue(line.contains("cadence inst. 90.0 tr/min"))
        XCTAssertTrue(line.contains("puissance inst. 250 W"))
    }

    func testFieldsTheAppIgnoresAreShownToo() {
        // Vitesse moyenne (bit 1), énergie (bit 8), temps écoulé (bit 11), sans vitesse instantanée (bit 0).
        let b: [UInt8] = [0x03, 0x09, 0x10, 0x0e, 12, 0, 0xf4, 0x01, 3, 75, 0]
        let parts = FTMSDebug.fields(b, flagBytes: 2, groups: FTMSDebug.indoorBike)
        XCTAssertEqual(parts, ["drapeaux 0x0903 (bits 0,1,8,11)", "vitesse moy. 36.00 km/h", "énergie totale 12 kcal",
                               "énergie par heure 500 kcal/h", "énergie par minute 3 kcal/min", "temps écoulé 75 s"])
    }

    func testTruncatedAndExtraBytesAreReported() {
        let truncated = FTMSDebug.fields([0x40, 0, 0x10], flagBytes: 2, groups: FTMSDebug.indoorBike)
        XCTAssertEqual(truncated.last, "TRONQUÉ : « vitesse inst. » attendait 2 octet(s), il en reste 1")
        let extra = FTMSDebug.fields([0x01, 0, 0xaa, 0xbb], flagBytes: 2, groups: FTMSDebug.indoorBike)
        XCTAssertEqual(extra.last, "octets en trop : aa bb")
    }

    func testCrossTrainerUsesThreeFlagBytesAndRowerItsOwnFields() {
        let cross = FTMSDebug.describe("2ACE", [0x08, 0x01, 0x00, 0x10, 0x27, 0x60, 0, 0x5a, 0, 0xb4, 0])
        XCTAssertTrue(cross.contains("drapeaux 0x000108 (bits 3,8)"), cross)
        XCTAssertTrue(cross.contains("vitesse inst. 100.00 km/h"), cross)
        XCTAssertTrue(cross.contains("pas par minute 96 pas/min"), cross)
        XCTAssertTrue(cross.contains("puissance inst. 180 W"), cross)
        let rower = FTMSDebug.describe("2AD1", [0x00, 0x00, 52, 120, 0])
        XCTAssertTrue(rower.contains("cadence de coups 26.0 coups/min · nombre de coups 120"), rower)
    }

    func testCyclingPowerStatusFeatureAndRanges() {
        XCTAssertTrue(FTMSDebug.describe("2A63", [0x20, 0, 0xc8, 0, 10, 0, 0, 4]).contains("puissance inst. 200 W · tours de pédalier 10 · dernier tour de pédalier 1.00 s"))
        XCTAssertTrue(FTMSDebug.describe("2ADA", [0x04]).contains("démarrage ou reprise par l'utilisateur"))
        XCTAssertTrue(FTMSDebug.describe("2AD9", [0x80, 0x00, 0x05]).contains("réponse à 0x00 : contrôle refusé"))
        XCTAssertTrue(FTMSDebug.describe("2AD3", [0x00, 0x0d]).contains("mode manuel (Quick Start)"))
        let feature = FTMSDebug.describe("2ACC", [0x86, 0x40, 0, 0, 0x0c, 0x20, 0, 0])
        XCTAssertTrue(feature.contains("mesures : cadence, distance totale, résistance, puissance"), feature)
        XCTAssertTrue(feature.contains("consignes : résistance, puissance (ERG), simulation vélo (pente)"), feature)
        XCTAssertTrue(FTMSDebug.describe("2AD6", [0, 0, 0xc8, 0, 10, 0]).contains("min 0.0 · max 20.0 · pas 1.0"))
        XCTAssertEqual(FTMSDebug.describe("FFF1", [1, 2]), "FFF1 [FFF1] 2 o : 01 02")
    }
}
