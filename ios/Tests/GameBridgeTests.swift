import XCTest
@testable import CycleProtocol

final class GameBridgeTests: XCTestCase {
    func testDecodesSimpleCommands() {
        XCTAssertEqual(GameCommand(body: ["type": "ready", "protocol": 1]), .ready)
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

    func testUnknownOrMalformedMessagesAreRefused() {
        XCTAssertNil(GameCommand(body: ["type": "eval", "code": "alert(1)"]))
        XCTAssertNil(GameCommand(body: ["type": 3]))
        XCTAssertNil(GameCommand(body: ["value": 1]))
        XCTAssertNil(GameCommand(body: "ready"))
        XCTAssertNil(GameCommand(body: [1, 2, 3]))
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
}
