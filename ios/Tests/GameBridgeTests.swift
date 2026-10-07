import XCTest
@testable import CycleProtocol

final class GameBridgeTests: XCTestCase {
    func testDecodesSimpleCommands() {
        XCTAssertEqual(GameCommand(body: ["type": "ready", "protocol": 1]), .ready(minor: 0), "jeu d'avant la révision 1 : pas de minor")
        XCTAssertEqual(GameCommand(body: ["type": "ready", "protocol": 1, "minor": 1]), .ready(minor: 1))
        XCTAssertEqual(GameCommand(body: ["type": "ready", "protocol": 1, "minor": 2]), .ready(minor: 2))
        XCTAssertEqual(GameCommand(body: ["type": "ready", "minor": "2"]), .ready(minor: 0), "révision invalide : 0")
        XCTAssertEqual(GameCommand(body: ["type": "ready", "minor": Double.nan]), .ready(minor: 0))
        XCTAssertEqual(GameCommand(body: ["type": "ready", "minor": -1]), .ready(minor: 0))
        XCTAssertEqual(GameCommand(body: ["type": "takeControl"]), .takeControl)
        XCTAssertEqual(GameCommand(body: ["type": "vibrate"]), .vibrate)
    }

    func testDecodesGradeWithIntegerOrDecimalValues() {
        XCTAssertEqual(GameCommand(body: ["type": "grade", "value": 6.5]), .grade(6.5))
        XCTAssertEqual(GameCommand(body: ["type": "grade", "value": 8]), .grade(8))
        XCTAssertEqual(GameCommand(body: ["type": "grade", "value": NSNumber(value: -3.25)]), .grade(-3.25))
    }

    func testGradeIsClampedAndNonFiniteIsRefused() {
        XCTAssertEqual(GameCommand(body: ["type": "grade", "value": 900.0]), .grade(30))
        XCTAssertEqual(GameCommand(body: ["type": "grade", "value": -900.0]), .grade(-25))
        XCTAssertNil(GameCommand(body: ["type": "grade", "value": Double.nan]))
        XCTAssertNil(GameCommand(body: ["type": "grade", "value": Double.infinity]))
        XCTAssertNil(GameCommand(body: ["type": "grade", "value": "6"]))
        XCTAssertNil(GameCommand(body: ["type": "grade"]))
    }

    func testShiftIsReducedToOneStep() {
        XCTAssertEqual(GameCommand(body: ["type": "shift", "delta": 1]), .shift(1))
        XCTAssertEqual(GameCommand(body: ["type": "shift", "delta": -7.0]), .shift(-1))
        XCTAssertNil(GameCommand(body: ["type": "shift", "delta": 0]))
        XCTAssertNil(GameCommand(body: ["type": "shift"]))
    }

    func testDecodesOpenNativeWithScreenAndProfile() {
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": "technogym"]), .openNative(.devices, profile: .technogym))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": "zwift"]), .openNative(.devices, profile: .zwift))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": "ble"]), .openNative(.devices, profile: .ble))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "cockpit"]), .openNative(.cockpit, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "inspector"]), .openNative(.inspector, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "log"]), .openNative(.log, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "settings"]), .openNative(.settings, profile: nil))
    }

    func testOpenNativeFallsBackToSettingsAndIgnoresUnknownProfiles() {
        XCTAssertEqual(GameCommand(body: ["type": "openNative"]), .openNative(.settings, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "écran-futur"]), .openNative(.settings, profile: nil), "écran inconnu : accueil des réglages")
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": 3]), .openNative(.settings, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": "peloton"]), .openNative(.devices, profile: nil), "profil inconnu ignoré")
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": ["zwift"]]), .openNative(.devices, profile: nil))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "devices", "profile": "Zwift"]), .openNative(.devices, profile: nil), "casse exacte")
    }

    func testUnknownOrMalformedMessagesAreRefused() {
        XCTAssertNil(GameCommand(body: ["type": "eval", "code": "alert(1)"]))
        XCTAssertNil(GameCommand(body: ["type": 3]))
        XCTAssertNil(GameCommand(body: ["value": 1]))
        XCTAssertNil(GameCommand(body: "ready"))
        XCTAssertNil(GameCommand(body: [1, 2, 3]))
        XCTAssertNil(GameCommand(body: ["type": "OpenNative", "screen": "devices"]))
    }

    private func sampleState() -> GameState {
        GameState(demo: false,
                  trainer: .init(connected: true, controllable: true, controlled: false, controlReady: true, name: "KICKR \"Core\"", status: "Prêt"),
                  hr: .init(connected: false, name: nil),
                  controllers: ["Zwift Play"],
                  power: 210, cadence: 88.5, speed: nil, heartRate: nil, gear: 13)
    }

    func testStateEncodesAsJSONThePageCanRead() throws {
        let json = try XCTUnwrap(sampleState().json())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["v"] as? Int, 1)
        XCTAssertEqual(object["power"] as? Int, 210)
        XCTAssertEqual(object["cadence"] as? Double, 88.5)
        XCTAssertEqual(object["gear"] as? Int, 13)
        XCTAssertEqual(object["controllers"] as? [String], ["Zwift Play"])
        let trainer = try XCTUnwrap(object["trainer"] as? [String: Any])
        XCTAssertEqual(trainer["connected"] as? Bool, true)
        XCTAssertEqual(trainer["controlled"] as? Bool, false)
        XCTAssertEqual(trainer["name"] as? String, "KICKR \"Core\"")
        XCTAssertNil(object["speed"], "une mesure absente n'est pas envoyée")
        XCTAssertEqual(object["minor"] as? Int, 4)
        XCTAssertEqual(object["capabilities"] as? [String], ["openNative", "reconnect", "gym", "identify"], "l'appli annonce l'ouverture des écrans natifs, la reconnexion et la carte des salles")
        XCTAssertNil(object["machineKind"], "champs machine facultatifs : absents quand inconnus")
        XCTAssertNil(object["strokeRate"])
    }

    func testStateCarriesMachineFieldsForRowersAndEllipticals() throws {
        var state = sampleState()
        state.hardware = HardwareProfile.technogym.rawValue
        state.machineKind = MachineKind.rower.rawValue
        state.strokeRate = 26.5
        state.strokeCount = 120
        state.distance = 300
        state.pace = 125
        state.stepRate = 140
        state.resistance = 8.5
        let json = try XCTUnwrap(state.json())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["v"] as? Int, 1, "le protocole 1 reste compatible")
        XCTAssertEqual(object["hardware"] as? String, "technogym")
        XCTAssertEqual(object["machineKind"] as? String, "rower")
        XCTAssertEqual(object["strokeRate"] as? Double, 26.5)
        XCTAssertEqual(object["strokeCount"] as? Int, 120)
        XCTAssertEqual(object["distance"] as? Int, 300)
        XCTAssertEqual(object["pace"] as? Int, 125)
        XCTAssertEqual(object["stepRate"] as? Int, 140)
        XCTAssertEqual(object["resistance"] as? Double, 8.5)
        XCTAssertEqual(object["power"] as? Int, 210)
    }

    func testStateWithNotANumberIsNotSent() {
        var state = sampleState()
        state.speed = Double.nan
        XCTAssertNil(state.json())
        XCTAssertNil(GameScript.state(state))
    }

    func testStateScriptCallsTheBridge() throws {
        let script = try XCTUnwrap(GameScript.state(sampleState()))
        XCTAssertTrue(script.hasPrefix("window.mcwNative&&window.mcwNative.state({"))
        XCTAssertTrue(script.hasSuffix("})"))
    }

    func testButtonScript() {
        XCTAssertEqual(GameScript.button(ButtonEvent(button: "L_LEFT", down: true)), "window.mcwNative&&window.mcwNative.button('L_LEFT',true)")
        XCTAssertEqual(GameScript.button(ButtonEvent(button: "R_SHIFT2", down: false)), "window.mcwNative&&window.mcwNative.button('R_SHIFT2',false)")
    }

    func testButtonNameCannotInjectCode() {
        XCTAssertNil(GameScript.button(ButtonEvent(button: "a');alert(1);('", down: true)))
        XCTAssertNil(GameScript.button(ButtonEvent(button: "", down: true)))
        XCTAssertNil(GameScript.button(ButtonEvent(button: "é", down: true)))
        XCTAssertNil(GameScript.button(ButtonEvent(button: String(repeating: "A", count: 33), down: true)))
    }

    func testReconnectCommandAndState() throws {
        XCTAssertEqual(GameCommand(body: ["type": "reconnect"]), .reconnect)
        var state = sampleState()
        XCTAssertNil(try XCTUnwrap(JSONSerialization.jsonObject(with: Data(state.json()!.utf8)) as? [String: Any])["reconnect"])
        state.reconnect = .init(trainer: "Rower RWX", hr: nil, waiting: true)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(state.json()!.utf8)) as? [String: Any])
        let r = try XCTUnwrap(object["reconnect"] as? [String: Any])
        XCTAssertEqual(r["trainer"] as? String, "Rower RWX")
        XCTAssertEqual(r["waiting"] as? Bool, true)
    }

    func testGymCommandsAndState() throws {
        let id = "11111111-2222-3333-4444-555555555555"
        XCTAssertEqual(GameCommand(body: ["type": "useMachine", "id": id, "kind": "rower"]), .useMachine(UUID(uuidString: id)!, kind: .rower))
        XCTAssertEqual(GameCommand(body: ["type": "useMachine", "id": id, "kind": "fusée"]), .useMachine(UUID(uuidString: id)!, kind: nil), "type inconnu : ignoré")
        XCTAssertNil(GameCommand(body: ["type": "useMachine", "id": "pas-un-uuid"]))
        XCTAssertNil(GameCommand(body: ["type": "useMachine"]))
        XCTAssertEqual(GameCommand(body: ["type": "releaseMachine"]), .releaseMachine)
        XCTAssertEqual(GameCommand(body: ["type": "gymScan", "active": true]), .gymScan(true))
        XCTAssertEqual(GameCommand(body: ["type": "gymScan", "active": "oui"]), .gymScan(false))
        XCTAssertEqual(GameCommand(body: ["type": "identify", "active": true]), .identify(true))
        XCTAssertEqual(GameCommand(body: ["type": "identify"]), .identify(false))
        XCTAssertEqual(GameCommand(body: ["type": "openNative", "screen": "gym"]), .openNative(.gym, profile: nil))

        var state = sampleState()
        var trainer = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(state.json()!.utf8)) as? [String: Any])["trainer"] as? [String: Any]
        XCTAssertNil(trainer?["id"], "sans machine choisie : pas d'identifiant")
        state.trainer.id = id
        state.trainer.waiting = true
        trainer = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(state.json()!.utf8)) as? [String: Any])["trainer"] as? [String: Any]
        XCTAssertEqual(trainer?["id"] as? String, id)
        XCTAssertEqual(trainer?["waiting"] as? Bool, true)

        let script = try XCTUnwrap(GameScript.gym(GymPayload(book: GymBook())))
        XCTAssertTrue(script.hasPrefix("window.mcwNative&&window.mcwNative.gym&&window.mcwNative.gym({"))
    }
}
