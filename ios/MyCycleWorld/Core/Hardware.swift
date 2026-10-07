import Foundation

// Profils de matériel de l'onglet « Appareils » : mêmes choix que le jeu web (src/core/hardware.js).
//   zwift     : home trainer (FTMS ou Cycling Power) + manettes Zwift Play / Ride / Click
//   technogym : vélos, elliptiques et rameurs Technogym (FTMS), reconnus aussi par leur nom ou leur fabricant
//   ble       : n'importe quelle machine Bluetooth standard (FTMS, Cycling Power)

enum DeviceRole: String, CaseIterable, Identifiable {
    case trainer = "Home trainer", heart = "Ceinture cardio", controller = "Manette Zwift"
    var id: String { rawValue }
    var icon: String { self == .trainer ? "bicycle" : self == .heart ? "heart.fill" : "gamecontroller.fill" }
}

enum HardwareProfile: String, CaseIterable, Identifiable, Codable {
    case zwift, technogym, ble

    var id: String { rawValue }

    /// Débuts de noms Bluetooth des machines Technogym. Vérifiés dans qdomyos-zwift : « MYRUN » (tapis),
    /// « MYCYCLING » et « BIKE 1, BIKE 2… » (vélos), « TREADMILL » (Technogym Run), « MYELLIPTICAL », « MYCYCLE »,
    /// « RUN EXCITE », « Group Cycle ». Supposés : « Technogym », « SKILL », « EXCITE ».
    static let technogymNamePrefixes = ["Technogym", "TECHNOGYM", "MYCYCLING", "MYRUN", "BIKE ", "Treadmill", "TREADMILL", "Skill", "SKILL", "Excite", "EXCITE",
                                        "MYELLIPTICAL", "MYCYCLE", "RUN EXCITE", "Group Cycle", "GROUP CYCLE"]
    /// Service propriétaire des consoles Technogym Unity / Group Cycle sans FTMS (qdomyos-zwift #2166, #4500).
    static let technogymProprietaryService = "AE4A2645-916E-4D6B-8884-500B6A2E244C"
    /// Identifiant Bluetooth SIG de Technogym SpA, annoncé dans les données fabricant (petit-boutiste).
    static let technogymCompanyID: UInt16 = 0x026D
    static let zwiftCompanyID: UInt16 = 0x094A

    static let ftms = "1826", cyclingPower = "1818", heartRate = "180D"
    static let zwiftServices = ["00000001-19CA-4651-86E5-FA29DCDD09D1", "FC82"]

    var label: String {
        switch self {
        case .zwift: return "Zwift"
        case .technogym: return "Technogym"
        case .ble: return "BLE standard"
        }
    }

    /// Nom du rôle « machine » dans ce profil.
    var machineLabel: String {
        switch self {
        case .zwift: return "Home trainer"
        case .technogym: return "Machine Technogym"
        case .ble: return "Machine Bluetooth"
        }
    }

    var hint: String {
        switch self {
        case .zwift:
            return "Home trainer connecté (Wahoo, Tacx, Elite, Zwift Hub…) et manettes Zwift Play, Ride ou Click. Ferme Zwift et les autres applis connectées, puis choisis chaque manette séparément."
        case .technogym:
            return "Vélo, elliptique ou rameur Technogym. Sur la console, connecte-toi (compte mywellness si demandé) et active le Bluetooth vers les applis. Le rameur se réveille quand on tire la poignée ; si rien n’arrive, démarre une séance libre. Si la machine refuse le pilotage, elle reste lue en lecture seule."
        case .ble:
            return "Toute machine Bluetooth standard : FTMS (vélo, elliptique, rameur) ou capteur de puissance (Cycling Power)."
        }
    }

    /// Ce que la recherche fait apparaître dans la liste (les autres appareils restent visibles avec « Afficher aussi… »).
    var scanHint: String {
        switch self {
        case .zwift: return "Recherche : home trainers (FTMS, Cycling Power), manettes Zwift et ceintures cardio."
        case .technogym: return "Recherche : machines FTMS ou Cycling Power, appareils Technogym (fabricant 0x026D, noms MYCYCLING, MYRUN, BIKE n, SKILL…) et ceintures cardio."
        case .ble: return "Recherche : machines FTMS ou Cycling Power et ceintures cardio."
        }
    }

    /// Rôles affichés par défaut dans la liste des appareils de ce profil.
    func shows(_ role: DeviceRole) -> Bool {
        role != .controller || self == .zwift
    }

    func label(for role: DeviceRole) -> String {
        role == .trainer ? machineLabel : role.rawValue
    }

    /// Montres et ceintures cardio qui n'annoncent pas toujours le service cardio avant la connexion
    /// (montres Garmin en « diffusion FC », Polar, Wahoo TICKR, COROS, Suunto…). Mêmes noms que le web.
    static let heartRateNamePrefixes = ["Forerunner", "fenix", "Fenix", "FENIX", "Venu", "vivoactive", "vívoactive", "Epix", "epix", "Instinct", "Enduro", "Garmin", "HRM", "Polar", "TICKR", "Wahoo TICKR", "COROS", "Suunto", "WHOOP", "Scosche", "RHYTHM", "Coospo", "CooSpo", "Magene", "XOSS", "Decathlon"]
    /// Identifiants fabricant de montres et ceintures cardio : Garmin (0x0087), Polar (0x006B).
    static let heartRateCompanyIDs: Set<UInt16> = [0x0087, 0x006B]

    static func looksHeartRate(_ name: String) -> Bool {
        heartRateNamePrefixes.contains { name.hasPrefix($0) }
    }

    static func looksTechnogym(_ name: String) -> Bool {
        technogymNamePrefixes.contains { name.hasPrefix($0) }
    }

    /// Identifiant du fabricant (deux premiers octets des données fabricant, petit-boutiste).
    static func companyID(_ manufacturer: [UInt8]) -> UInt16? {
        guard manufacturer.count >= 2 else { return nil }
        return UInt16(manufacturer[0]) | UInt16(manufacturer[1]) << 8
    }

    /// Rôle proposé pour un appareil d'après son annonce. `services` : UUID en majuscules (CBUUID.uuidString).
    func role(name: String, services: [String], manufacturer: [UInt8]) -> DeviceRole? {
        let company = HardwareProfile.companyID(manufacturer)
        if name.localizedCaseInsensitiveContains("zwift") || company == HardwareProfile.zwiftCompanyID
            || services.contains(where: { HardwareProfile.zwiftServices.contains($0) }) { return .controller }
        if services.contains(HardwareProfile.ftms) || services.contains(HardwareProfile.cyclingPower) { return .trainer }
        if self == .technogym && (company == HardwareProfile.technogymCompanyID || HardwareProfile.looksTechnogym(name)) { return .trainer }
        // Cardio dans tous les profils : service annoncé, nom connu ou fabricant de montres et ceintures.
        if services.contains(HardwareProfile.heartRate) || HardwareProfile.looksHeartRate(name)
            || company.map({ HardwareProfile.heartRateCompanyIDs.contains($0) }) == true { return .heart }
        return nil
    }
}
